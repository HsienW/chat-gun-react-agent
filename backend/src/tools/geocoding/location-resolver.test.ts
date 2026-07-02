// Location Resolver Unit Tests — Task 2.7, 2.8, 3.10, 3.11, 3.12
// Tests normalization, query variants, candidate scoring, ambiguity, not_found, and provider_error.

import { describe, it, expect } from "vitest";
import {
  validateLocationInput,
  normalizeLocation,
  buildLocationQuery,
  buildGeocodingQueryVariants,
  buildQueryVariants,
} from "./location-normalizer.js";
import { scoreCandidate, resolveLocation, DEFAULT_RESOLVER_OPTIONS } from "./location-resolver.js";
import { MockGeocodingProvider } from "./mock-providers.js";
import { GeocodingProvider, LocationCandidate, LocationQuery } from "../weather-types.js";

// ──────────────────────────────────────────
// Section 2: Normalization (Task 2.2 - 2.6)
// ──────────────────────────────────────────

describe("validateLocationInput", () => {
  it("should reject null or undefined", () => {
    expect(validateLocationInput(null)).not.toBeNull();
    expect(validateLocationInput(undefined)).not.toBeNull();
  });

  it("should reject empty string", () => {
    expect(validateLocationInput("")).not.toBeNull();
    expect(validateLocationInput("   ")).not.toBeNull();
  });

  it("should reject control characters", () => {
    expect(validateLocationInput("Taipei\x00")).not.toBeNull();
    expect(validateLocationInput("\x1bNew York")).not.toBeNull();
  });

  it("should accept valid location", () => {
    expect(validateLocationInput("Taipei")).toBeNull();
    expect(validateLocationInput("São Paulo")).toBeNull();
    expect(validateLocationInput("München")).toBeNull();
    expect(validateLocationInput("台北")).toBeNull();
  });
});

describe("normalizeLocation", () => {
  it("should trim whitespace", () => {
    expect(normalizeLocation("  Taipei  ")).toBe("Taipei");
  });

  it("should collapse multiple spaces", () => {
    expect(normalizeLocation("New   York")).toBe("New York");
  });

  it("should apply NFKC normalization", () => {
    expect(normalizeLocation("Ｔaipei")).toBe("Taipei"); // 全形 T
  });

  it("should remove control characters", () => {
    expect(normalizeLocation("Taipei\x00City")).toBe("TaipeiCity");
  });

  it("should preserve meaningful unicode (accented chars)", () => {
    expect(normalizeLocation("São Paulo")).toBe("São Paulo");
    expect(normalizeLocation("München")).toBe("München");
  });
});

describe("buildLocationQuery", () => {
  it("should preserve raw text (Task 2.4)", () => {
    const query = buildLocationQuery("  台北  ", "TW");
    expect(query.raw).toBe("  台北  ");
    expect(query.location).toBe("台北");
    // normalizeLocation does not lowercase country codes
    expect(query.country).toBe("TW");
  });
  it("should preserve generic weather-query text in provider-facing location", () => {
    const query = buildLocationQuery("\u53f0\u5317\u73fe\u5728 \u5982\u4f55");
    expect(query.raw).toBe("\u53f0\u5317\u73fe\u5728 \u5982\u4f55");
    expect(query.location).toBe("\u53f0\u5317\u73fe\u5728 \u5982\u4f55");
  });

  it("should not strip a full Chinese weather question into a guessed city", () => {
    const query = buildLocationQuery("\u53f0\u5317\u73fe\u5728\u5929\u6c23\u5982\u4f55\uFF1F");
    expect(query.raw).toBe("\u53f0\u5317\u73fe\u5728\u5929\u6c23\u5982\u4f55\uFF1F");
    expect(query.location).toBe("\u53f0\u5317\u73fe\u5728\u5929\u6c23\u5982\u4f55?");
    expect(query.location).not.toBe("\u53f0\u5317");
  });

  it("should preserve English weather residue for planner or repair handling", () => {
    const query = buildLocationQuery("Tokyo weather now");
    expect(query.location).toBe("Tokyo weather now");
  });
});

describe("buildQueryVariants (Task 2.5, 2.6)", () => {
  it("should generate location-only variant", () => {
    const query: LocationQuery = { raw: "Tokyo", location: "Tokyo" };
    const variants = buildQueryVariants(query);
    expect(variants).toContain("Tokyo");
  });

  it("should include country and region variants", () => {
    const query: LocationQuery = { raw: "Springfield", location: "Springfield", country: "US" };
    const variants = buildQueryVariants(query);
    expect(variants.length).toBeGreaterThan(1);
    expect(variants.some((v) => v.includes("US"))).toBe(true);
  });

  it("should respect max variants", () => {
    const query: LocationQuery = {
      raw: "Test",
      location: "Test",
      country: "Country",
      region: "Region",
    };
    const variants = buildQueryVariants(query, 3);
    expect(variants.length).toBeLessThanOrEqual(3);
  });

  it("should deduplicate variants", () => {
    const query: LocationQuery = { raw: "Tokyo", location: "Tokyo" };
    const variants = buildQueryVariants(query, 20);
    expect(variants.length).toBe(new Set(variants.map((v) => v.toLowerCase())).size);
  });

  it("should include provider language fallback variants", () => {
    const query: LocationQuery = { raw: "台北", location: "台北" };
    const variants = buildGeocodingQueryVariants(query, 6);
    expect(variants.some((variant) => variant.language === "zh")).toBe(true);
    expect(variants.some((variant) => variant.language === "en")).toBe(true);
  });

  it("prioritizes queryName before the original CJK location while preserving fallback", () => {
    const query: LocationQuery = { raw: "台北", location: "台北" };

    const variants = buildGeocodingQueryVariants(query, 6, "Taipei");

    expect(variants[0]).toEqual({
      text: "Taipei",
      strategy: "original",
    });
    expect(variants[1]).toEqual({
      text: "台北",
      strategy: "original",
    });
    expect(variants.map((variant) => variant.text)).toContain("台北");
  });

  it("deduplicates queryName when it matches location", () => {
    const query: LocationQuery = { raw: "Tokyo", location: "Tokyo" };
    const baseline = buildGeocodingQueryVariants(query, 20);

    const variants = buildGeocodingQueryVariants(query, 20, "Tokyo");

    expect(variants).toEqual(baseline);
    expect(variants[0]?.text).toBe("Tokyo");
  });

  it("adds queryName with country context before locale fallbacks", () => {
    const query: LocationQuery = {
      raw: "北京市",
      location: "北京市",
      country: "China",
    };

    const variants = buildGeocodingQueryVariants(query, 6, "Beijing");

    expect(variants.map((variant) => `${variant.text}|${variant.language ?? "default"}`)).toEqual([
      "Beijing|default",
      "北京市|default",
      "Beijing, China|default",
      "北京市, China|default",
      "Beijing|zh",
      "北京市|zh",
    ]);
  });

  it("keeps existing variant order when queryName is absent", () => {
    const query: LocationQuery = {
      raw: "Fengshan",
      location: "Fengshan",
      region: "Kaohsiung",
      country: "Taiwan",
    };

    const variants = buildGeocodingQueryVariants(query, 6);

    expect(variants.map((variant) => `${variant.text}|${variant.language ?? "default"}`)).toEqual([
      "Fengshan|default",
      "Fengshan, Kaohsiung|default",
      "Fengshan, Kaohsiung, Taiwan|default",
      "Fengshan, Taiwan|default",
      "Fengshan|zh",
      "Fengshan, Kaohsiung|zh",
    ]);
  });

  it("keeps Fengshan full context before language fallbacks within max queries", () => {
    const query: LocationQuery = {
      raw: "\u9ad8\u96c4\u9cf3\u5c71",
      location: "Fengshan",
      region: "Kaohsiung",
      country: "Taiwan",
    };

    const variants = buildGeocodingQueryVariants(query, 6);

    expect(variants.map((variant) => `${variant.text}|${variant.language ?? "default"}`)).toEqual([
      "Fengshan|default",
      "Fengshan, Kaohsiung|default",
      "Fengshan, Kaohsiung, Taiwan|default",
      "Fengshan, Taiwan|default",
      "Fengshan|zh",
      "Fengshan, Kaohsiung|zh",
    ]);
  });

  it("should honor configurable max input length", () => {
    expect(validateLocationInput("Tokyo", 4)).not.toBeNull();
    expect(validateLocationInput("Tokyo", 5)).toBeNull();
  });
});

// ──────────────────────────────────────────
// Section 3: Candidate Scoring (Task 3.5)
// ──────────────────────────────────────────

describe("scoreCandidate", () => {
  const taipei: LocationCandidate = {
    provider: "open-meteo",
    name: "Taipei",
    displayName: "Taipei, Taiwan",
    country: "臺灣",
    countryCode: "TW",
    admin1: "Taipei City",
    latitude: 25.033,
    longitude: 121.565,
    timezone: "Asia/Taipei",
    population: 7_000_000,
  };

  it("should give high score for exact name match", () => {
    const query: LocationQuery = { raw: "Taipei", location: "Taipei" };
    expect(scoreCandidate(taipei, query)).toBeGreaterThanOrEqual(40);
  });

  it("should add country match score", () => {
    const query: LocationQuery = { raw: "Taipei", location: "Taipei", country: "TW" };
    expect(scoreCandidate(taipei, query)).toBeGreaterThanOrEqual(75);
  });

  it("should add region match score", () => {
    const query: LocationQuery = {
      raw: "Taipei",
      location: "Taipei",
      country: "TW",
      region: "Taipei City",
    };
    expect(scoreCandidate(taipei, query)).toBeGreaterThanOrEqual(100);
  });

  it("scores provider candidates whose admin fields cover a multi-token Latin queryName", () => {
    const fengshan: LocationCandidate = {
      provider: "open-meteo",
      name: "Fengshan",
      displayName: "Fengshan, Kaohsiung City, Taiwan",
      country: "Taiwan",
      countryCode: "TW",
      admin1: "Kaohsiung City",
      admin2: "Fengshan District",
      latitude: 22.624,
      longitude: 120.355,
      timezone: "Asia/Taipei",
      population: 350_000,
    };

    expect(scoreCandidate(fengshan, { raw: "高雄鳳山", location: "Kaohsiung Fengshan" }))
      .toBeGreaterThanOrEqual(DEFAULT_RESOLVER_OPTIONS.minScore);
  });
});

// ──────────────────────────────────────────
// Section 3: Resolver (Task 3.7 - 3.12)
// ──────────────────────────────────────────

describe("resolveLocation", () => {
  const mockProvider = new MockGeocodingProvider();

  function providerFor(candidates: LocationCandidate[]): GeocodingProvider {
    return {
      name: "live-derived-mock",
      async search() {
        return candidates;
      },
    };
  }

  it("should resolve a well-known city (Task 3.7: resolved)", async () => {
    const query: LocationQuery = { raw: "Tokyo", location: "Tokyo" };
    const result = await resolveLocation(query, mockProvider);
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.candidate.name).toBe("Tokyo");
      expect(result.attemptedQueries.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("should return ambiguous for Springfield without context (Task 3.12)", async () => {
    const query: LocationQuery = { raw: "Springfield", location: "Springfield" };
    const result = await resolveLocation(query, mockProvider);
    expect(result.status).toBe("ambiguous");
    if (result.status === "ambiguous") {
      expect(result.candidates.length).toBeLessThanOrEqual(5);
      expect(result.candidates.length).toBeGreaterThan(1);
    }
  });

  it("should match region correctly (Task 3.5)", () => {
    const mockedProvider = new MockGeocodingProvider();
    // Admin1 match
    const illinois = {
      provider: "open-meteo" as const,
      name: "Springfield",
      displayName: "Springfield, Illinois",
      countryCode: "US",
      admin1: "Illinois",
      latitude: 39.781,
      longitude: -89.65,
    };
    expect(scoreCandidate(illinois, { raw: "Springfield", location: "Springfield", country: "US", region: "Illinois" }))
      .toBeGreaterThan(80);
    // Non-matching region should only get name + country match (no region bonus)
    const missouri = {
      provider: "open-meteo" as const,
      name: "Springfield",
      displayName: "Springfield, Missouri",
      countryCode: "US",
      admin1: "Missouri",
      latitude: 37.215,
      longitude: -93.298,
    };
    // Both get name (40) + country (35). Illinois gets +25 region, Missouri doesn't.
    const illinoisScore = scoreCandidate(illinois, { raw: "Springfield", location: "Springfield", country: "US", region: "Illinois" });
    const missouriScore = scoreCandidate(missouri, { raw: "Springfield", location: "Springfield", country: "US", region: "Illinois" });
    expect(illinoisScore).toBeGreaterThan(missouriScore);
    // The gap should be at least 20 (the region match bonus minus pop difference)
    expect(illinoisScore - missouriScore).toBeGreaterThan(20);
  });

  it("should resolve Springfield with country context (Task 3.11)", async () => {
    const query: LocationQuery = {
      raw: "Springfield",
      location: "Springfield",
      country: "US",
      region: "Illinois",
    };
    const result = await resolveLocation(query, mockProvider);
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.candidate.admin1).toBe("Illinois");
    }
  });

  it("should keep Zhongshan ambiguous without context and resolve with country context", async () => {
    // Without country, "zhongshan" matches Zhongshan, CN strongly (name match + high pop)
    const queryNoContext: LocationQuery = { raw: "中山", location: "zhongshan" };
    queryNoContext.raw = "\u4e2d\u5c71";
    const resultNoContext = await resolveLocation(queryNoContext, mockProvider);
    expect(resultNoContext.status).toBe("ambiguous");

    // With country=TW, it should match Zhongshan District, Taipei
    const queryTW: LocationQuery = { raw: "中山", location: "zhongshan", country: "TW" };
    queryTW.raw = "\u4e2d\u5c71";
    const resultTW = await resolveLocation(queryTW, mockProvider);
    expect(resultTW.status).toBe("resolved");
    if (resultTW.status === "resolved") {
      expect(resultTW.candidate.countryCode).toBe("TW");
    }
  });

  it("should return not_found for unknown location (Task 3.7)", async () => {
    const query: LocationQuery = { raw: "Xyzzyville", location: "xyzzyville" };
    const result = await resolveLocation(query, mockProvider);
    expect(result.status).toBe("not_found");
  });

  it("includes provider language in attempted query diagnostics", async () => {
    const emptyProvider: GeocodingProvider = {
      name: "empty",
      async search() {
        return [];
      },
    };
    const query: LocationQuery = {
      raw: "\u9ad8\u96c4\u9cf3\u5c71",
      location: "Fengshan",
      region: "Kaohsiung",
      country: "Taiwan",
    };

    const result = await resolveLocation(query, emptyProvider, {
      ...DEFAULT_RESOLVER_OPTIONS,
      maxQueries: 6,
    });

    expect(result.status).toBe("not_found");
    if (result.status === "not_found") {
      expect(result.attemptedQueries).toContain("Fengshan, Kaohsiung, Taiwan [language=default]");
      expect(result.attemptedQueries.some((queryText) => queryText.includes("[language=zh]"))).toBe(true);
    }
  });

  it("should return provider_error when provider fails (Task 3.7)", async () => {
    const failingProvider = new MockGeocodingProvider();
    failingProvider.setFailure(true, "Network error: connection refused");
    const query: LocationQuery = { raw: "Tokyo", location: "Tokyo" };
    const result = await resolveLocation(query, failingProvider);
    expect(result.status).toBe("provider_error");
  });

  it("should pass language, limit, and AbortSignal to provider (Task 3.3)", async () => {
    const provider = new MockGeocodingProvider();
    const controller = new AbortController();
    const query: LocationQuery = { raw: "Tokyo", location: "Tokyo" };
    await resolveLocation(query, provider, {
      ...DEFAULT_RESOLVER_OPTIONS,
      maxQueries: 3,
      maxCandidates: 7,
      signal: controller.signal,
    });

    expect(provider.calls.some((call) => call.language === "zh")).toBe(true);
    expect(provider.calls.every((call) => call.limit === 7)).toBe(true);
    expect(provider.calls.every((call) => call.signal === controller.signal)).toBe(true);
  });

  it("should return non-retryable provider_error when cancelled", async () => {
    const provider = new MockGeocodingProvider();
    const controller = new AbortController();
    controller.abort();
    const query: LocationQuery = { raw: "Tokyo", location: "Tokyo" };
    const result = await resolveLocation(query, provider, {
      ...DEFAULT_RESOLVER_OPTIONS,
      signal: controller.signal,
    });

    expect(result.status).toBe("provider_error");
    if (result.status === "provider_error") {
      expect(result.code).toBe("weather_geocoding_cancelled");
      expect(result.retryable).toBe(false);
    }
  });

  it("should stop with provider_error when cancelled after partial candidates", async () => {
    const candidate: LocationCandidate = {
      provider: "open-meteo",
      name: "Tokyo",
      displayName: "Tokyo, Japan",
      countryCode: "JP",
      latitude: 35.676,
      longitude: 139.65,
      timezone: "Asia/Tokyo",
    };
    let callCount = 0;
    const provider: GeocodingProvider = {
      name: "partial-cancel",
      async search() {
        callCount += 1;
        if (callCount === 1) {
          return [candidate];
        }
        throw new Error("weather_geocoding_cancelled");
      },
    };

    const result = await resolveLocation(
      { raw: "Tokyo", location: "Tokyo" },
      provider,
      {
        ...DEFAULT_RESOLVER_OPTIONS,
        maxQueries: 2,
      }
    );

    expect(result.status).toBe("provider_error");
    if (result.status === "provider_error") {
      expect(result.code).toBe("weather_geocoding_cancelled");
      expect(result.retryable).toBe(false);
    }
  });

  it("should preserve llm_repair strategy on repaired resolution", async () => {
    const query: LocationQuery = { raw: "Tokyo", location: "Tokyo" };
    const result = await resolveLocation(query, mockProvider, {
      ...DEFAULT_RESOLVER_OPTIONS,
      strategy: "llm_repair",
    });

    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.strategy).toBe("llm_repair");
    }
  });

  it("should not choose by population alone (Task 3.9)", async () => {
    const query: LocationQuery = {
      raw: "Springfield",
      location: "Springfield",
      country: "US",
    };
    const result = await resolveLocation(query, mockProvider);
    // With US country context but no state, should still try to resolve
    // The resolver should use country matching to narrow down
    if (result.status === "resolved") {
      expect(result.candidate.countryCode).toBe("US");
    }
  });

  it("should respect country filter (Task 3.11)", async () => {
    const query: LocationQuery = {
      raw: "Springfield",
      location: "Springfield",
      country: "US",
      region: "Missouri",
    };
    const result = await resolveLocation(query, mockProvider);
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.candidate.admin1).toBe("Missouri");
    }
  });

  it("resolves Tokyo Japan from live-derived homonyms by provider prominence", async () => {
    const result = await resolveLocation(
      { raw: "Tokyo", location: "Tokyo" },
      providerFor([
        {
          provider: "open-meteo",
          name: "Tokyo",
          displayName: "Tokyo, Japan",
          country: "Japan",
          countryCode: "JP",
          admin1: "Tokyo",
          latitude: 35.676,
          longitude: 139.65,
          timezone: "Asia/Tokyo",
          population: 14_000_000,
        },
        {
          provider: "open-meteo",
          name: "Tokyo",
          displayName: "Tokyo, Papua New Guinea",
          country: "Papua New Guinea",
          countryCode: "PG",
          latitude: -6.2,
          longitude: 146.6,
          population: 20_000,
        },
        {
          provider: "open-meteo",
          name: "Tokyo",
          displayName: "Tokyo, Nepal",
          country: "Nepal",
          countryCode: "NP",
          latitude: 28.2,
          longitude: 84.0,
          population: 5_000,
        },
      ])
    );

    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.candidate.countryCode).toBe("JP");
    }
  });

  it("resolves Sao Paulo Brazil from live-derived homonyms by provider prominence", async () => {
    const result = await resolveLocation(
      { raw: "São Paulo", location: "São Paulo" },
      providerFor([
        {
          provider: "open-meteo",
          name: "São Paulo",
          displayName: "São Paulo, Brazil",
          country: "Brazil",
          countryCode: "BR",
          admin1: "São Paulo",
          latitude: -23.55,
          longitude: -46.633,
          timezone: "America/Sao_Paulo",
          population: 12_000_000,
        },
        {
          provider: "open-meteo",
          name: "São Paulo",
          displayName: "São Paulo, Portugal",
          country: "Portugal",
          countryCode: "PT",
          latitude: 38.7,
          longitude: -9.1,
          population: 12_000,
        },
        {
          provider: "open-meteo",
          name: "São Paulo",
          displayName: "São Paulo, São Tomé and Príncipe",
          country: "São Tomé and Príncipe",
          countryCode: "ST",
          latitude: 0.3,
          longitude: 6.7,
          population: 7_000,
        },
      ])
    );

    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.candidate.countryCode).toBe("BR");
    }
  });

  it("resolves Munchen Bavaria Germany from live-derived homonyms by provider prominence", async () => {
    const result = await resolveLocation(
      { raw: "München", location: "München" },
      providerFor([
        {
          provider: "open-meteo",
          name: "München",
          displayName: "München, Bavaria, Germany",
          country: "Germany",
          countryCode: "DE",
          admin1: "Bavaria",
          latitude: 48.137,
          longitude: 11.575,
          timezone: "Europe/Berlin",
          population: 1_500_000,
        },
        {
          provider: "open-meteo",
          name: "München",
          displayName: "München, Brandenburg, Germany",
          country: "Germany",
          countryCode: "DE",
          admin1: "Brandenburg",
          latitude: 52.1,
          longitude: 13.4,
          population: 3_000,
        },
        {
          provider: "open-meteo",
          name: "München",
          displayName: "München, Switzerland",
          country: "Switzerland",
          countryCode: "CH",
          latitude: 47.3,
          longitude: 8.3,
          population: 1_500,
        },
        {
          provider: "open-meteo",
          name: "München",
          displayName: "München, Austria",
          country: "Austria",
          countryCode: "AT",
          latitude: 48.0,
          longitude: 14.0,
          population: 1_000,
        },
      ])
    );

    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.candidate.countryCode).toBe("DE");
      expect(result.candidate.admin1).toBe("Bavaria");
    }
  });

  it("resolves Singapore city-state while deduplicating duplicate city candidates and not choosing airport", async () => {
    const result = await resolveLocation(
      { raw: "Singapore", location: "Singapore" },
      providerFor([
        {
          provider: "open-meteo",
          name: "Singapore",
          displayName: "Singapore, Singapore",
          country: "Singapore",
          countryCode: "SG",
          latitude: 1.352,
          longitude: 103.82,
          timezone: "Asia/Singapore",
          population: 5_600_000,
        },
        {
          provider: "open-meteo",
          name: "Singapore",
          displayName: "Singapore, Singapore",
          country: "Singapore",
          countryCode: "SG",
          latitude: 1.3521,
          longitude: 103.8201,
          timezone: "Asia/Singapore",
          population: 5_600_000,
        },
        {
          provider: "open-meteo",
          name: "Singapore Changi Airport",
          displayName: "Singapore Changi Airport, Singapore",
          country: "Singapore",
          countryCode: "SG",
          latitude: 1.364,
          longitude: 103.991,
          timezone: "Asia/Singapore",
        },
      ])
    );

    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.candidate.name).toBe("Singapore");
      expect(result.candidate.displayName).toBe("Singapore, Singapore");
    }
  });

  it("keeps Springfield ambiguous across multiple US states", async () => {
    const result = await resolveLocation(
      { raw: "Springfield", location: "Springfield" },
      providerFor([
        {
          provider: "open-meteo",
          name: "Springfield",
          displayName: "Springfield, Illinois, United States",
          country: "United States",
          countryCode: "US",
          admin1: "Illinois",
          latitude: 39.781,
          longitude: -89.65,
          population: 114_000,
        },
        {
          provider: "open-meteo",
          name: "Springfield",
          displayName: "Springfield, Missouri, United States",
          country: "United States",
          countryCode: "US",
          admin1: "Missouri",
          latitude: 37.215,
          longitude: -93.298,
          population: 168_000,
        },
        {
          provider: "open-meteo",
          name: "Springfield",
          displayName: "Springfield, Massachusetts, United States",
          country: "United States",
          countryCode: "US",
          admin1: "Massachusetts",
          latitude: 42.101,
          longitude: -72.59,
          population: 155_000,
        },
      ])
    );

    expect(result.status).toBe("ambiguous");
  });

  it("keeps short CJK Zhongshan ambiguous without country or region context", async () => {
    const result = await resolveLocation(
      { raw: "\u4e2d\u5c71", location: "\u4e2d\u5c71" },
      providerFor([
        {
          provider: "open-meteo",
          name: "\u4e2d\u5c71",
          displayName: "\u4e2d\u5c71, Guangdong, China",
          country: "China",
          countryCode: "CN",
          admin1: "Guangdong",
          latitude: 22.521,
          longitude: 113.378,
          population: 4_400_000,
        },
        {
          provider: "open-meteo",
          name: "\u4e2d\u5c71",
          displayName: "\u4e2d\u5c71, Taipei, Taiwan",
          country: "Taiwan",
          countryCode: "TW",
          admin1: "Taipei City",
          admin2: "Zhongshan District",
          latitude: 25.064,
          longitude: 121.533,
          population: 220_000,
        },
      ])
    );

    expect(result.status).toBe("ambiguous");
  });

  it("keeps queryName-matched short CJK places ambiguous when country leaves multiple regions", async () => {
    const result = await resolveLocation(
      { raw: "\u5927\u5bee", location: "\u5927\u5bee", country: "TW" },
      providerFor([
        {
          provider: "open-meteo",
          providerId: "daliao-new-taipei",
          name: "Daliao",
          displayName: "Daliao, New Taipei City, Taiwan",
          country: "Taiwan",
          countryCode: "TW",
          admin1: "Taipei",
          admin2: "New Taipei City",
          latitude: 25.09755,
          longitude: 121.78241,
          population: 100_000,
        },
        {
          provider: "open-meteo",
          providerId: "daliao-kaohsiung",
          name: "Daliao",
          displayName: "Daliao, Kaohsiung, Taiwan",
          country: "Taiwan",
          countryCode: "TW",
          admin1: "Kaohsiung",
          admin2: "Kaohsiung",
          latitude: 22.78167,
          longitude: 120.3,
          population: 100_000,
        },
      ]),
      {
        ...DEFAULT_RESOLVER_OPTIONS,
        queryName: "Daliao",
      }
    );

    expect(result.status).toBe("ambiguous");
    if (result.status === "ambiguous") {
      expect(result.candidates).toHaveLength(2);
    }
  });

  it("resolves München Bavaria Germany by conservative Latin prominence dominance", async () => {
    const result = await resolveLocation(
      { raw: "M\u00fcnchen", location: "M\u00fcnchen" },
      providerFor([
        {
          provider: "open-meteo",
          name: "M\u00fcnchen",
          displayName: "M\u00fcnchen, Brandenburg, Germany",
          country: "Germany",
          countryCode: "DE",
          admin1: "Brandenburg",
          latitude: 52.1,
          longitude: 13.4,
          population: 3_000,
        },
        {
          provider: "open-meteo",
          name: "Munich",
          displayName: "Munich, Bavaria, Germany",
          country: "Germany",
          countryCode: "DE",
          admin1: "Bavaria",
          latitude: 48.137,
          longitude: 11.575,
          timezone: "Europe/Berlin",
          population: 1_500_000,
        },
        {
          provider: "open-meteo",
          name: "M\u00fcnchen",
          displayName: "M\u00fcnchen, Bavaria, Germany",
          country: "Germany",
          countryCode: "DE",
          admin1: "Bavaria",
          latitude: 48.1372,
          longitude: 11.5754,
        },
        {
          provider: "open-meteo",
          name: "M\u00fcnchen",
          displayName: "M\u00fcnchen, Switzerland",
          country: "Switzerland",
          countryCode: "CH",
          latitude: 47.3,
          longitude: 8.3,
          population: 1_500,
        },
        {
          provider: "open-meteo",
          name: "M\u00fcnchen",
          displayName: "M\u00fcnchen, Austria",
          country: "Austria",
          countryCode: "AT",
          latitude: 48.0,
          longitude: 14.0,
          population: 1_000,
        },
      ])
    );

    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.candidate.countryCode).toBe("DE");
      expect(result.candidate.admin1).toBe("Bavaria");
      expect(result.candidate.name).toBe("M\u00fcnchen");
      expect(result.candidate.population).toBe(1_500_000);
    }
  });

  it("does not resolve Latin homonyms when prominence ratio is not dominant", async () => {
    const result = await resolveLocation(
      { raw: "Springfield", location: "Springfield" },
      providerFor([
        {
          provider: "open-meteo",
          name: "Springfield",
          displayName: "Springfield, Illinois, United States",
          country: "United States",
          countryCode: "US",
          admin1: "Illinois",
          latitude: 39.781,
          longitude: -89.65,
          population: 520_000,
        },
        {
          provider: "open-meteo",
          name: "Springfield",
          displayName: "Springfield, Missouri, United States",
          country: "United States",
          countryCode: "US",
          admin1: "Missouri",
          latitude: 37.215,
          longitude: -93.298,
          population: 168_000,
        },
      ])
    );

    expect(result.status).toBe("ambiguous");
  });

  it("does not apply prominence dominance to short CJK place names", async () => {
    const result = await resolveLocation(
      { raw: "\u4e2d\u5c71", location: "\u4e2d\u5c71" },
      providerFor([
        {
          provider: "open-meteo",
          name: "\u4e2d\u5c71",
          displayName: "\u4e2d\u5c71, Guangdong, China",
          country: "China",
          countryCode: "CN",
          admin1: "Guangdong",
          latitude: 22.521,
          longitude: 113.378,
          population: 4_400_000,
        },
        {
          provider: "open-meteo",
          name: "\u4e2d\u5c71",
          displayName: "\u4e2d\u5c71, Taipei, Taiwan",
          country: "Taiwan",
          countryCode: "TW",
          admin1: "Taipei City",
          admin2: "Zhongshan District",
          latitude: 25.064,
          longitude: 121.533,
          population: 120_000,
        },
      ])
    );

    expect(result.status).toBe("ambiguous");
  });
});

// ──────────────────────────────────────────
// Multilingual support (Task 2.8)
// ──────────────────────────────────────────

describe("multilingual location normalization", () => {
  it("should handle Traditional Chinese", () => {
    const n = normalizeLocation("臺北");
    expect(n).toBe("臺北");
  });

  it("should handle Simplified Chinese", () => {
    const n = normalizeLocation("北京");
    expect(n).toBe("北京");
  });

  it("should handle accented characters", () => {
    const n = normalizeLocation("São Paulo");
    expect(n).toBe("São Paulo");
    expect(normalizeLocation("München")).toBe("München");
  });

  it("should handle administrative suffixes", () => {
    const n = normalizeLocation("高雄市鳳山區");
    expect(n).toBe("高雄市鳳山區");
  });
});
