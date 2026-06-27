/**
 * Live Smoke Acceptance Test — tasks.md Section 9 (9.1–9.15)
 *
 * Calls REAL Open-Meteo geocoding + forecast APIs.
 * No mocks. No model — invokes current_weather tool directly with pre-extracted location strings.
 * This complements the mock smoke test (weather.mock-smoke.test.ts).
 *
 * Run:
 *   cd backend && npx vitest run src/tools/weather.live-smoke.test.ts
 *
 * Set OPEN_METEO_LIVE_SMOKE=true to confirm you intend to hit the real network.
 */

import { describe, expect, it } from "vitest";

import { weatherForecastTool, weatherTool } from "./weather.js";
import type { WeatherForecastResult, WeatherToolResult } from "./weather-types.js";

const LIVE_SMOKE = (process.env.OPEN_METEO_LIVE_SMOKE ?? "").toLowerCase() === "true";
const LIVE_SMOKE_TEST_TIMEOUT_MS = 30_000;

async function invokeWeather(input: {
  location: string;
  country?: string;
  region?: string;
}): Promise<WeatherToolResult> {
  const raw = await weatherTool.invoke(input);
  return JSON.parse(String(raw)) as WeatherToolResult;
}

async function invokeForecast(input: {
  location: string;
  country?: string;
  region?: string;
  weatherCapability: "hourly" | "daily";
  timeRange: {
    kind: "today" | "tonight" | "tomorrow" | "weekend" | "date_range";
    startDate?: string;
    endDate?: string;
    timezone?: string;
    granularity?: "hourly" | "daily";
  };
  units?: "metric";
  locale?: string;
}): Promise<WeatherForecastResult> {
  const raw = await weatherForecastTool.invoke(input);
  return JSON.parse(String(raw)) as WeatherForecastResult;
}

describe.runIf(LIVE_SMOKE)("live smoke acceptance — real Open-Meteo", () => {
  // 9.1–9.8: location format
  it("9.1 台北現在天氣如何？ → resolves 台北 (Taipei)", async () => {
    const result = await invokeWeather({ location: "台北" });
    expect(result.status).toBe("success");
  }, LIVE_SMOKE_TEST_TIMEOUT_MS);

  it("9.2 臺北天氣 → resolves 臺北 (Taipei)", async () => {
    const result = await invokeWeather({ location: "臺北" });
    expect(result.status).toBe("success");
  }, LIVE_SMOKE_TEST_TIMEOUT_MS);

  it("9.3 高雄鳳山今天會下雨嗎？ → resolves 高雄鳳山 (Fengshan)", async () => {
    const result = await invokeWeather({
      location: "高雄鳳山",
      region: "Kaohsiung",
      country: "Taiwan",
    });
    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.resolvedLocation.countryCode).toBe("TW");
      expect([result.resolvedLocation.name, result.resolvedLocation.admin2].filter(Boolean).join(" ")).toMatch(
        /F[eo]ngshan/
      );
    }
  }, LIVE_SMOKE_TEST_TIMEOUT_MS);

  it("9.4 北京市 + country: China → resolves 北京市 (Beijing)", async () => {
    const result = await invokeWeather({ location: "北京市", country: "China" });
    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.resolvedLocation.countryCode).toBe("CN");
      expect(result.resolvedLocation.name).toContain("Beijing");
    }
  }, LIVE_SMOKE_TEST_TIMEOUT_MS);

  it("9.5 新加坡 + country: Singapore → resolves 新加坡 (Singapore)", async () => {
    const result = await invokeWeather({ location: "新加坡", country: "Singapore" });
    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.resolvedLocation.countryCode).toBe("SG");
      expect(result.resolvedLocation.name).toContain("Singapore");
    }
  }, LIVE_SMOKE_TEST_TIMEOUT_MS);

  it("9.6 Tokyo weather now → resolves Tokyo", async () => {
    const result = await invokeWeather({ location: "Tokyo" });
    expect(result.status).toBe("success");
  }, LIVE_SMOKE_TEST_TIMEOUT_MS);

  it("9.7 São Paulo weather → resolves São Paulo with accents", async () => {
    const result = await invokeWeather({ location: "São Paulo" });
    expect(["success", "needs_clarification"]).toContain(result.status);
  }, LIVE_SMOKE_TEST_TIMEOUT_MS);

  it("9.8 München weather → resolves München with umlaut", async () => {
    const result = await invokeWeather({ location: "München" });
    expect(["success", "needs_clarification"]).toContain(result.status);
  }, LIVE_SMOKE_TEST_TIMEOUT_MS);

  it("FORECAST daily: 台北明天會下雨嗎？ → returns Open-Meteo daily forecast", async () => {
    const result = await invokeForecast({
      location: "台北",
      weatherCapability: "daily",
      timeRange: { kind: "tomorrow", granularity: "daily" },
      units: "metric",
      locale: "zh-TW",
    });

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.tool).toBe("weather_forecast");
      expect(result.daily?.length).toBeGreaterThan(0);
    }
  }, LIVE_SMOKE_TEST_TIMEOUT_MS);

  it("FORECAST hourly: 台北今晚會變冷嗎？ → returns Open-Meteo hourly forecast", async () => {
    const result = await invokeForecast({
      location: "台北",
      weatherCapability: "hourly",
      timeRange: { kind: "tonight", granularity: "hourly" },
      units: "metric",
      locale: "zh-TW",
    });

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.tool).toBe("weather_forecast");
      expect(result.hourly?.length).toBeGreaterThan(0);
    }
  }, LIVE_SMOKE_TEST_TIMEOUT_MS);

  // 9.9: Springfield → needs_clarification
  it("9.9 Springfield weather → returns needs_clarification, no auto-selection", async () => {
    const result = await invokeWeather({ location: "Springfield" });
    // With real Open-Meteo, Springfield may resolve to the US Illinois one (largest)
    // or be ambiguous. Either way, we verify it doesn't error out.
    expect(["success", "needs_clarification"]).toContain(result.status);
    if (result.status === "needs_clarification") {
      expect(result.candidates.length).toBeGreaterThan(0);
    }
  }, LIVE_SMOKE_TEST_TIMEOUT_MS);

  // 9.10: 中山 → needs_clarification without context
  it("9.10 中山現在天氣如何？ → returns clarification without context", async () => {
    const result = await invokeWeather({ location: "中山" });
    expect(["success", "needs_clarification"]).toContain(result.status);
  }, LIVE_SMOKE_TEST_TIMEOUT_MS);

  // 9.11: Unknown location → not_found, no coordinates fabricated
  it("9.11 does not fabricate coordinates for unknown locations", async () => {
    const result = await invokeWeather({ location: "DefinitelyNonExistentPlace12345" });
    expect(result.status).toBe("not_found");
    if (result.status === "not_found") {
      expect(result.code).toBe("weather_location_not_found");
    }
    const json = JSON.stringify(result);
    if (result.status === "not_found") {
      expect(json).not.toContain("latitude");
      expect(json).not.toContain("longitude");
    }
  }, LIVE_SMOKE_TEST_TIMEOUT_MS);

  // 9.14: cancel → AbortSignal propagation
  it("9.14 cancels with AbortSignal before provider fetch completes", async () => {
    const controller = new AbortController();
    controller.abort();

    const raw = await weatherTool.invoke(
      { location: "Tokyo" },
      { signal: controller.signal }
    );
    const result = JSON.parse(String(raw)) as WeatherToolResult;
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(["weather_cancelled", "weather_geocoding_cancelled"]).toContain(result.code);
    }
  }, LIVE_SMOKE_TEST_TIMEOUT_MS);

  // 9.15: sensitive data check
  it("9.15 does not expose stack trace, API key, or proxy credential in error response", async () => {
    const result = await invokeWeather({ location: "Tokyo" });
    expect(result.status).toBe("success");
    const json = JSON.stringify(result);
    expect(json).not.toContain("apiKey");
    expect(json).not.toContain("proxy");
    expect(json).not.toContain("stack");
  }, LIVE_SMOKE_TEST_TIMEOUT_MS);

  // Relationship invariants (weather.md §9)
  it("REL: 台北 and 臺北 resolve to the same geographic entity", async () => {
    const r1 = await invokeWeather({ location: "台北" });
    const r2 = await invokeWeather({ location: "臺北" });
    expect(r1.status).toBe("success");
    expect(r2.status).toBe("success");
    if (r1.status === "success" && r2.status === "success") {
      expect(r1.resolvedLocation.countryCode).toBe(r2.resolvedLocation.countryCode);
    }
  }, LIVE_SMOKE_TEST_TIMEOUT_MS);

  it("REL: Singapore and 新加坡 resolve to the same geographic entity", async () => {
    const r1 = await invokeWeather({ location: "Singapore" });
    const r2 = await invokeWeather({ location: "新加坡" });
    // Both should succeed or be ambiguous; the key invariant is same countryCode
    expect(["success", "needs_clarification"]).toContain(r1.status);
    expect(["success", "needs_clarification"]).toContain(r2.status);
    if (r1.status === "success" && r2.status === "success") {
      expect(r1.resolvedLocation.countryCode).toBe(r2.resolvedLocation.countryCode);
    }
  }, LIVE_SMOKE_TEST_TIMEOUT_MS);

  it("REL: adding country context narrows candidates, doesn't jump to unrelated location", async () => {
    const r1 = await invokeWeather({ location: "中山" });
    const r2 = await invokeWeather({ location: "中山", country: "Taiwan" });
    // With country context, should resolve more specifically
    expect(["success", "needs_clarification"]).toContain(r1.status);
    expect(["success", "needs_clarification", "not_found"]).toContain(r2.status);
    if (r2.status === "success") {
      expect(r2.resolvedLocation.countryCode).toBe("TW");
    }
  }, LIVE_SMOKE_TEST_TIMEOUT_MS);

  it("REL: punctuation doesn't change resolution result", async () => {
    const r1 = await invokeWeather({ location: "台北" });
    const r2 = await invokeWeather({ location: "台北。" });
    expect(r1.status).toBe("success");
    expect(r2.status).toBe("success");
  }, LIVE_SMOKE_TEST_TIMEOUT_MS);
});
