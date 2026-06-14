import { describe, expect, it } from "vitest";

import { deepResearcherWeatherTestInternals } from "./deep-researcher.js";
import type { WeatherToolResult } from "../tools/weather-types.js";

type WeatherState = Parameters<
  typeof deepResearcherWeatherTestInternals.buildWeatherToolAnswer
>[0];

function stateWithWeather(result: WeatherToolResult): WeatherState {
  return {
    weatherExecution:
      result.status === "success"
        ? { status: "success", result }
        : result.status === "needs_clarification"
          ? { status: "needs_clarification", result }
          : { status: "failed", result },
  } as WeatherState;
}

describe("Deep Research weather structured result integration", () => {
  it("builds a final weather answer from structured success state", () => {
    const result: WeatherToolResult = {
      schemaVersion: "1.0",
      tool: "current_weather",
      status: "success",
      requestedLocation: { raw: "Tokyo", location: "Tokyo" },
      resolvedLocation: {
        provider: "open-meteo",
        name: "Tokyo",
        displayName: "Tokyo, Japan",
        country: "Japan",
        countryCode: "JP",
        admin1: "Tokyo",
        latitude: 35.676,
        longitude: 139.65,
        timezone: "Asia/Tokyo",
      },
      observedAt: "2026-06-14T12:00",
      timezone: "Asia/Tokyo",
      current: {
        conditionText: "clear sky",
        temperature: 22,
        relativeHumidity: 65,
        windSpeed: 10,
        windDirectionText: "N",
      },
      units: {
        temperature_2m: "°C",
        relative_humidity_2m: "%",
        wind_speed_10m: "km/h",
      },
      provider: "Open-Meteo",
      sourceUrl: "https://api.open-meteo.com/v1/forecast?latitude=35.676&longitude=139.65",
      summary: "Current weather for Tokyo: 22°C, clear sky.",
    };

    const answer = deepResearcherWeatherTestInternals.buildWeatherToolAnswer(
      stateWithWeather(result)
    );

    const content = String(answer?.content);
    expect(content).toContain("Current weather for Tokyo");
    expect(content).toContain("Temperature: 22°C");
    expect(content).toContain("Humidity: 65%");
  });

  it("keeps not_found as a failed terminal state with clarification text", () => {
    const result: WeatherToolResult = {
      schemaVersion: "1.0",
      tool: "current_weather",
      status: "not_found",
      requestedLocation: { raw: "Missing Place", location: "Missing Place" },
      code: "weather_location_not_found",
      message: "Could not find location.",
      summary: "Could not find Missing Place.",
    };

    const answer = deepResearcherWeatherTestInternals.buildWeatherToolAnswer(
      stateWithWeather(result)
    );

    const content = String(answer?.content);
    expect(content).toContain("Could not find");
    expect(content).toContain("more specific location");
  });

  it("keeps cancelled weather result as failed terminal state", () => {
    const result: WeatherToolResult = {
      schemaVersion: "1.0",
      tool: "current_weather",
      status: "error",
      requestedLocation: { raw: "Tokyo", location: "Tokyo" },
      code: "weather_cancelled",
      retryable: false,
      message: "weather_fetch_cancelled",
      summary: "Weather lookup was cancelled.",
    };

    const answer = deepResearcherWeatherTestInternals.buildWeatherToolAnswer(
      stateWithWeather(result)
    );

    expect(String(answer?.content)).toContain("could not retrieve weather");
  });

  it("propagates RunnableConfig AbortSignal to current_weather", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await deepResearcherWeatherTestInternals.targetedTools(
      ({
        plan: {
          question: "Tokyo weather now",
          answerMode: "weather",
          rationale: "weather request",
          queries: [],
          urls: [],
          weather: { location: "Tokyo" },
          requiredSourceCount: 3,
        },
        messages: [],
      } as unknown) as Parameters<typeof deepResearcherWeatherTestInternals.targetedTools>[0],
      { signal: controller.signal }
    );

    expect(result.weatherExecution?.status).toBe("failed");
    const weatherResult =
      result.weatherExecution?.status === "failed"
        ? result.weatherExecution.result
        : undefined;
    expect(weatherResult?.status).toBe("error");
    if (weatherResult?.status === "error") {
      expect(weatherResult.code).toBe("weather_cancelled");
      expect(weatherResult.retryable).toBe(false);
    }
  });
});
