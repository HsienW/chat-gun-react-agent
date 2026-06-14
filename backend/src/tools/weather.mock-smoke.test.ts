import { afterEach, describe, expect, it, vi } from "vitest";

import { weatherTool } from "./weather.js";
import type { WeatherToolResult } from "./weather-types.js";

// NOTE: This file implements mock smoke acceptance for the OpenSpec manual acceptance
// matrix (scenarios 9.1-9.13).  Both geocoding and forecast providers are mocked.
//
// Live acceptance against the real Open-Meteo API is still PENDING.
// Before closing this change, run each scenario manually against production.
// See tasks.md Section 9 for the full manual acceptance matrix.

type Scenario =
  | { kind: "normal" }
  | { kind: "geocoding_failure" }
  | { kind: "forecast_failure" };

type OpenMeteoResult = {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  country_code?: string;
  admin1?: string;
  admin2?: string;
  timezone?: string;
  population?: number;
};

const TAIPEI_SIMPLIFIED = "\u53f0\u5317";
const TAIPEI_TRADITIONAL = "\u81fa\u5317";
const KAOHSIUNG_FENGSHAN = "\u9ad8\u96c4\u9cf3\u5c71";
const BEIJING_CITY = "\u5317\u4eac\u5e02";
const SINGAPORE_ZH = "\u65b0\u52a0\u5761";
const ZHONGSHAN_ZH = "\u4e2d\u5c71";
const SAO_PAULO = "S\u00e3o Paulo";
const MUNCHEN = "M\u00fcnchen";

const candidates: Record<string, OpenMeteoResult[]> = {
  [TAIPEI_SIMPLIFIED]: [
    {
      name: TAIPEI_SIMPLIFIED,
      latitude: 25.033,
      longitude: 121.565,
      country: "Taiwan",
      country_code: "TW",
      admin1: "Taipei City",
      timezone: "Asia/Taipei",
      population: 7_000_000,
    },
  ],
  [TAIPEI_TRADITIONAL]: [
    {
      name: TAIPEI_TRADITIONAL,
      latitude: 25.033,
      longitude: 121.565,
      country: "Taiwan",
      country_code: "TW",
      admin1: "Taipei City",
      timezone: "Asia/Taipei",
      population: 7_000_000,
    },
  ],
  [KAOHSIUNG_FENGSHAN]: [
    {
      name: KAOHSIUNG_FENGSHAN,
      latitude: 22.624,
      longitude: 120.355,
      country: "Taiwan",
      country_code: "TW",
      admin1: "Kaohsiung City",
      admin2: "Fengshan District",
      timezone: "Asia/Taipei",
      population: 350_000,
    },
  ],
  [BEIJING_CITY]: [
    {
      name: BEIJING_CITY,
      latitude: 39.904,
      longitude: 116.407,
      country: "China",
      country_code: "CN",
      admin1: "Beijing",
      timezone: "Asia/Shanghai",
      population: 21_000_000,
    },
  ],
  [SINGAPORE_ZH]: [
    {
      name: SINGAPORE_ZH,
      latitude: 1.352,
      longitude: 103.82,
      country: "Singapore",
      country_code: "SG",
      timezone: "Asia/Singapore",
      population: 5_600_000,
    },
  ],
  tokyo: [
    {
      name: "Tokyo",
      latitude: 35.676,
      longitude: 139.65,
      country: "Japan",
      country_code: "JP",
      admin1: "Tokyo",
      timezone: "Asia/Tokyo",
      population: 14_000_000,
    },
  ],
  [SAO_PAULO.toLowerCase()]: [
    {
      name: SAO_PAULO,
      latitude: -23.55,
      longitude: -46.633,
      country: "Brazil",
      country_code: "BR",
      admin1: SAO_PAULO,
      timezone: "America/Sao_Paulo",
      population: 12_000_000,
    },
  ],
  [MUNCHEN.toLowerCase()]: [
    {
      name: MUNCHEN,
      latitude: 48.137,
      longitude: 11.575,
      country: "Germany",
      country_code: "DE",
      admin1: "Bavaria",
      timezone: "Europe/Berlin",
      population: 1_500_000,
    },
  ],
  springfield: [
    {
      name: "Springfield",
      latitude: 39.781,
      longitude: -89.65,
      country: "United States",
      country_code: "US",
      admin1: "Illinois",
      timezone: "America/Chicago",
      population: 114_000,
    },
    {
      name: "Springfield",
      latitude: 37.215,
      longitude: -93.298,
      country: "United States",
      country_code: "US",
      admin1: "Missouri",
      timezone: "America/Chicago",
      population: 168_000,
    },
  ],
  [ZHONGSHAN_ZH]: [
    {
      name: ZHONGSHAN_ZH,
      latitude: 22.521,
      longitude: 113.378,
      country: "China",
      country_code: "CN",
      admin1: "Guangdong",
      timezone: "Asia/Shanghai",
      population: 4_400_000,
    },
    {
      name: ZHONGSHAN_ZH,
      latitude: 25.064,
      longitude: 121.533,
      country: "Taiwan",
      country_code: "TW",
      admin1: "Taipei City",
      admin2: "Zhongshan District",
      timezone: "Asia/Taipei",
      population: 220_000,
    },
  ],
};

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    statusText: init?.statusText,
    headers: { "content-type": "application/json" },
  });
}

function installMockOpenMeteoFetch(scenario: Scenario = { kind: "normal" }): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);

      if (url.hostname === "geocoding-api.open-meteo.com") {
        if (scenario.kind === "geocoding_failure") {
          return jsonResponse({ reason: "geocoding unavailable" }, { status: 503, statusText: "Service Unavailable" });
        }

        const name = (url.searchParams.get("name") ?? "").toLowerCase();
        const results = Object.entries(candidates).find(([key]) => name.includes(key.toLowerCase()))?.[1] ?? [];
        return jsonResponse({ results });
      }

      if (url.hostname === "api.open-meteo.com") {
        if (scenario.kind === "forecast_failure") {
          return jsonResponse({ reason: "forecast unavailable" }, { status: 503, statusText: "Service Unavailable" });
        }

        return jsonResponse({
          latitude: Number(url.searchParams.get("latitude")),
          longitude: Number(url.searchParams.get("longitude")),
          timezone: "UTC",
          current: {
            time: "2026-06-14T12:00",
            temperature_2m: 24,
            apparent_temperature: 25,
            relative_humidity_2m: 70,
            precipitation: 0,
            rain: 0,
            weather_code: 1,
            cloud_cover: 20,
            pressure_msl: 1012,
            wind_speed_10m: 8,
            wind_direction_10m: 90,
            wind_gusts_10m: 12,
          },
          current_units: {
            temperature_2m: "\u00b0C",
            apparent_temperature: "\u00b0C",
            relative_humidity_2m: "%",
            precipitation: "mm",
            rain: "mm",
            cloud_cover: "%",
            pressure_msl: "hPa",
            wind_speed_10m: "km/h",
            wind_direction_10m: "\u00b0",
            wind_gusts_10m: "km/h",
          },
        });
      }

      throw new Error(`Unexpected network call: ${url.toString()}`);
    })
  );
}

async function invokeWeather(input: {
  location: string;
  country?: string;
  region?: string;
}): Promise<WeatherToolResult> {
  const raw = await weatherTool.invoke(input);
  return JSON.parse(String(raw)) as WeatherToolResult;
}

describe("mock smoke acceptance for weather manual matrix", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["9.1", TAIPEI_SIMPLIFIED, TAIPEI_SIMPLIFIED],
    ["9.2", TAIPEI_TRADITIONAL, TAIPEI_TRADITIONAL],
    ["9.3", KAOHSIUNG_FENGSHAN, KAOHSIUNG_FENGSHAN],
    ["9.4", BEIJING_CITY, BEIJING_CITY],
    ["9.5", SINGAPORE_ZH, SINGAPORE_ZH],
    ["9.6", "Tokyo", "Tokyo"],
    ["9.7", SAO_PAULO, SAO_PAULO],
    ["9.8", MUNCHEN, MUNCHEN],
  ])("%s resolves %s through mocked providers", async (_taskId, location, expectedName) => {
    installMockOpenMeteoFetch();

    const result = await invokeWeather({ location });

    expect(result.status).toBe("success");
    if (result.status === "success") {
      expect(result.resolvedLocation.name).toBe(expectedName);
      expect(result.current.temperature).toBe(24);
      expect(result.sourceUrl).toContain("api.open-meteo.com");
    }
  });

  it("9.9 returns clarification candidates for Springfield without choosing one", async () => {
    installMockOpenMeteoFetch();

    const result = await invokeWeather({ location: "Springfield" });

    expect(result.status).toBe("needs_clarification");
    if (result.status === "needs_clarification") {
      expect(result.candidates.map((candidate) => candidate.displayName)).toEqual(
        expect.arrayContaining(["Springfield, Illinois, United States", "Springfield, Missouri, United States"])
      );
    }
  });

  it("9.10 returns clarification candidates for Zhongshan without context", async () => {
    installMockOpenMeteoFetch();

    const result = await invokeWeather({ location: ZHONGSHAN_ZH });

    expect(result.status).toBe("needs_clarification");
    if (result.status === "needs_clarification") {
      expect(result.candidates.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("9.11 returns not_found without coordinates for unknown locations", async () => {
    installMockOpenMeteoFetch();

    const result = await invokeWeather({ location: "Definitely Missing Place" });

    expect(result.status).toBe("not_found");
    if (result.status === "not_found") {
      expect(result.code).toBe("weather_location_not_found");
      expect(JSON.stringify(result)).not.toContain("latitude");
      expect(JSON.stringify(result)).not.toContain("longitude");
    }
  });

  it("9.12 maps geocoding provider failure to provider error, not not_found", async () => {
    installMockOpenMeteoFetch({ kind: "geocoding_failure" });

    const result = await invokeWeather({ location: "Tokyo" });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.code).toBe("weather_geocoding_provider_error");
      expect(result.code).not.toBe("weather_location_not_found");
    }
  });

  it("9.13 maps forecast provider failure to terminal error", async () => {
    installMockOpenMeteoFetch({ kind: "forecast_failure" });

    const result = await invokeWeather({ location: "Tokyo" });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.code).toBe("weather_forecast_provider_error");
      expect(result.summary).toBeTruthy();
    }
  });
});
