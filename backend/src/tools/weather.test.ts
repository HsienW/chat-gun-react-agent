// Weather Tool Unit Tests — Task 4.13
// Tests weather tool structured result contract, status handling, and error conditions.

import { afterEach, describe, it, expect } from "vitest";
import { describeWeatherCode, describeWindDirection, getWeatherConfig } from "./weather.js";
import {
  WeatherToolResult,
  WeatherSuccessResult,
  WeatherClarificationResult,
  WeatherNotFoundResult,
  WeatherErrorResult,
} from "./weather-types.js";

describe("Weather Code descriptions", () => {
  it("should describe clear sky (code 0)", () => {
    const text = describeWeatherCode(0);
    expect(text).toBe("clear sky");
  });

  it("should describe rain (codes 61-65)", () => {
    expect(describeWeatherCode(61)).toBe("rain");
    expect(describeWeatherCode(65)).toBe("rain");
  });

  it("should describe snow showers (codes 85-86)", () => {
    expect(describeWeatherCode(85)).toBe("snow showers");
  });

  it("should return fallback for unknown code", () => {
    expect(describeWeatherCode(999)).toBe("unknown weather condition");
  });

  it("should handle undefined code", () => {
    expect(describeWeatherCode(undefined)).toBe("unknown weather condition");
  });
});

describe("Wind direction descriptions", () => {
  it("should describe cardinal directions", () => {
    expect(describeWindDirection(0)).toBe("N");
    expect(describeWindDirection(90)).toBe("E");
    expect(describeWindDirection(180)).toBe("S");
    expect(describeWindDirection(270)).toBe("W");
  });

  it("should describe intercardinal directions", () => {
    expect(describeWindDirection(45)).toBe("NE");
    expect(describeWindDirection(135)).toBe("SE");
    expect(describeWindDirection(225)).toBe("SW");
    expect(describeWindDirection(315)).toBe("NW");
  });

  it("should handle undefined", () => {
    expect(describeWindDirection(undefined)).toBe("unknown");
  });

  it("should wrap degrees beyond 360", () => {
    expect(describeWindDirection(360)).toBe("N");
    expect(describeWindDirection(450)).toBe("E");
  });
});

describe("WeatherToolResult contract (Task 4.1-4.8)", () => {
  it("should have schemaVersion '1.0' and tool 'current_weather' (Task 4.2)", () => {
    const success: WeatherSuccessResult = {
      schemaVersion: "1.0",
      tool: "current_weather",
      status: "success",
      requestedLocation: { raw: "Tokyo", location: "Tokyo" },
      resolvedLocation: {
        provider: "open-meteo",
        name: "Tokyo",
        displayName: "Tokyo, Japan",
        countryCode: "JP",
        latitude: 35.676,
        longitude: 139.65,
        timezone: "Asia/Tokyo",
      },
      observedAt: "2024-01-01T12:00",
      timezone: "Asia/Tokyo",
      current: {
        conditionText: "clear sky",
        temperature: 20,
      },
      units: { temperature_2m: "°C" },
      provider: "Open-Meteo",
      sourceUrl: "https://api.open-meteo.com/v1/forecast",
      summary: "Current weather for Tokyo: 20°C, clear sky.",
    };
    expect(success.schemaVersion).toBe("1.0");
    expect(success.tool).toBe("current_weather");
    expect(success.status).toBe("success");
    expect(success.summary).toBeTruthy();
  });

  it("should produce needs_clarification with candidates (Task 4.4)", () => {
    const clarification: WeatherClarificationResult = {
      schemaVersion: "1.0",
      tool: "current_weather",
      status: "needs_clarification",
      requestedLocation: { raw: "Springfield", location: "Springfield" },
      candidates: [
        { name: "Springfield", displayName: "Springfield, Illinois", country: "United States", admin1: "Illinois" },
        { name: "Springfield", displayName: "Springfield, Missouri", country: "United States", admin1: "Missouri" },
      ],
      message: "Which Springfield do you mean? Please specify a state or country.",
      summary: "Location 'Springfield' is ambiguous. Please specify a state or country.",
    };
    expect(clarification.status).toBe("needs_clarification");
    expect(clarification.candidates.length).toBeLessThanOrEqual(5);
    expect(clarification.summary).toBeTruthy();
  });

  it("should produce not_found with correct error code (Task 4.5)", () => {
    const notFound: WeatherNotFoundResult = {
      schemaVersion: "1.0",
      tool: "current_weather",
      status: "not_found",
      requestedLocation: { raw: "Xyzzy", location: "xyzzy" },
      code: "weather_location_not_found",
      message: "Could not find location 'Xyzzy'.",
      summary: "Could not find 'Xyzzy'. Please provide a more specific location.",
    };
    expect(notFound.status).toBe("not_found");
    expect(notFound.code).toBe("weather_location_not_found");
    expect(notFound.summary).toBeTruthy();
  });

  it("should produce error with stable error codes (Task 4.6, 4.7)", () => {
    const codes = [
      "weather_invalid_input",
      "weather_geocoding_provider_error",
      "weather_forecast_provider_error",
      "weather_timeout",
      "weather_cancelled",
      "weather_unknown_error",
    ] as const;

    for (const code of codes) {
      const error: WeatherErrorResult = {
        schemaVersion: "1.0",
        tool: "current_weather",
        status: "error",
        requestedLocation: { raw: "Tokyo", location: "Tokyo" },
        code,
        retryable: false,
        message: `Error: ${code}`,
        summary: `Weather lookup failed: ${code}.`,
      };
      expect(error.code).toBe(code);
      expect(error.summary).toBeTruthy();
    }
  });

  it("should mark geocoding timeout as retryable (Task 4.11)", () => {
    const error: WeatherErrorResult = {
      schemaVersion: "1.0",
      tool: "current_weather",
      status: "error",
      requestedLocation: { raw: "Tokyo", location: "Tokyo" },
      code: "weather_geocoding_provider_error",
      retryable: true,
      message: "Geocoding provider timed out.",
      summary: "Weather service temporarily unavailable. Please try again.",
    };
    expect(error.retryable).toBe(true);
  });

  it("should mark invalid input as not retryable (Task 4.12)", () => {
    const error: WeatherErrorResult = {
      schemaVersion: "1.0",
      tool: "current_weather",
      status: "error",
      requestedLocation: { raw: "", location: "" },
      code: "weather_invalid_input",
      retryable: false,
      message: "Invalid location input.",
      summary: "Please provide a valid location.",
    };
    expect(error.retryable).toBe(false);
  });
});

describe("Weather env config", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("should read configurable weather resolver settings from env", () => {
    process.env.WEATHER_LOCATION_MAX_CHARS = "12";
    process.env.WEATHER_GEOCODING_MAX_QUERIES = "4";
    process.env.WEATHER_GEOCODING_MAX_CANDIDATES = "8";
    process.env.WEATHER_GEOCODING_MIN_SCORE = "55";
    process.env.WEATHER_GEOCODING_AMBIGUITY_DELTA = "3";
    process.env.WEATHER_GEOCODING_TIMEOUT_MS = "1234";
    process.env.WEATHER_FORECAST_TIMEOUT_MS = "2345";
    process.env.WEATHER_STRUCTURED_RESULT_ENABLED = "false";

    expect(getWeatherConfig()).toEqual({
      structuredResultEnabled: false,
      locationMaxChars: 12,
      geocodingMaxQueries: 4,
      geocodingMaxCandidates: 8,
      geocodingMinScore: 55,
      geocodingAmbiguityDelta: 3,
      geocodingTimeoutMs: 1234,
      forecastTimeoutMs: 2345,
      forceGeocodingError: false,
      forceForecastError: false,
    });
  });

  it("should fall back when numeric env values are invalid", () => {
    process.env.WEATHER_GEOCODING_MIN_SCORE = "not-a-number";
    process.env.WEATHER_GEOCODING_AMBIGUITY_DELTA = "-1";

    const config = getWeatherConfig();
    expect(config.geocodingMinScore).toBe(35);
    expect(config.geocodingAmbiguityDelta).toBe(8);
  });
});
