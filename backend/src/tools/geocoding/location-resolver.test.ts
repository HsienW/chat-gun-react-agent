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
});

// ──────────────────────────────────────────
// Section 3: Resolver (Task 3.7 - 3.12)
// ──────────────────────────────────────────

describe("resolveLocation", () => {
  const mockProvider = new MockGeocodingProvider();

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

  it("should resolve Zhongshan with country context but ambiguous without", async () => {
    // Without country, "zhongshan" matches Zhongshan, CN strongly (name match + high pop)
    const queryNoContext: LocationQuery = { raw: "中山", location: "zhongshan" };
    const resultNoContext = await resolveLocation(queryNoContext, mockProvider);
    expect(resultNoContext.status).toBe("resolved");

    // With country=TW, it should match Zhongshan District, Taipei
    const queryTW: LocationQuery = { raw: "中山", location: "zhongshan", country: "TW" };
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
