import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { afterEach, describe, expect, it, vi } from "vitest";

process.env.WEATHER_TEST_GEOCODING_PROVIDER = "open-meteo";

import { deepResearcherWeatherTestInternals } from "./deep-researcher.js";
import { llmGateway } from "../platform/llm-gateway.js";
import type { WeatherToolResult } from "../tools/weather-types.js";

type WeatherState = Parameters<
  typeof deepResearcherWeatherTestInternals.buildWeatherToolAnswer
>[0];
type ResumeClarifyState = Parameters<
  typeof deepResearcherWeatherTestInternals.resumeClarify
>[0];

const MISSING_WEATHER_LOCATION =
  "\u8acb\u63d0\u4f9b\u8981\u67e5\u8a62\u5929\u6c23\u7684\u57ce\u5e02\u6216\u5730\u5340\u3002";
const KAOHSIUNG_FENGSHAN = "\u9ad8\u96c4\u9cf3\u5c71";
const BEIJING_CITY = "\u5317\u4eac\u5e02";
const MUNCHEN = "M\u00fcnchen";

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

function stateWithSpringfieldClarification(
  userReply: string | undefined,
  overrides: Partial<NonNullable<ResumeClarifyState["clarification"]>> = {}
): ResumeClarifyState {
  return ({
    messages: [],
    reasoning_model: "qwen-plus",
    clarification: {
      status: "resuming",
      candidates: [
        {
          provider: "open-meteo",
          providerId: "geo-1",
          name: "Springfield",
          displayName: "Springfield, Illinois, United States",
          country: "United States",
          countryCode: "US",
          admin1: "Illinois",
          latitude: 39.7817,
          longitude: -89.6501,
          timezone: "America/Chicago",
        },
        {
          provider: "open-meteo",
          providerId: "geo-2",
          name: "Springfield",
          displayName: "Springfield, Missouri, United States",
          country: "United States",
          countryCode: "US",
          admin1: "Missouri",
          latitude: 37.209,
          longitude: -93.2923,
          timezone: "America/Chicago",
        },
      ],
      originalQuery: { raw: "Springfield", location: "Springfield" },
      weatherCapability: "current",
      summary: "Location Springfield matches multiple candidates.",
      interruptCheckpointStep: Date.now(),
      rounds: 0,
      userReply,
      ...overrides,
    },
  } as unknown) as ResumeClarifyState;
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    statusText: init?.statusText,
    headers: { "content-type": "application/json" },
  });
}

function installTaipeiWeatherFetchMock(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url
      );

      if (url.hostname === "geocoding-api.open-meteo.com") {
        const name = url.searchParams.get("name");
        return jsonResponse({
          results:
            name === "\u53f0\u5317"
              ? [
                  {
                    name: "\u53f0\u5317",
                    latitude: 25.033,
                    longitude: 121.565,
                    country: "Taiwan",
                    country_code: "TW",
                    admin1: "Taipei City",
                    timezone: "Asia/Taipei",
                    population: 7_000_000,
                  },
                ]
              : [],
        });
      }

      if (url.hostname === "api.open-meteo.com") {
        return jsonResponse({
          latitude: 25.033,
          longitude: 121.565,
          timezone: "Asia/Taipei",
          current: {
            time: "2026-06-14T12:00",
            temperature_2m: 24,
            relative_humidity_2m: 70,
            weather_code: 1,
            wind_speed_10m: 8,
            wind_direction_10m: 90,
          },
          current_units: {
            temperature_2m: "\u00b0C",
            relative_humidity_2m: "%",
            wind_speed_10m: "km/h",
            wind_direction_10m: "\u00b0",
          },
        });
      }

      throw new Error(`Unexpected network call: ${url.toString()}`);
    })
  );
}

function installTaipeiForecastFetchMock(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url
      );

      if (url.hostname === "geocoding-api.open-meteo.com") {
        return jsonResponse({
          results: [
            {
              name: "\u53f0\u5317",
              latitude: 25.033,
              longitude: 121.565,
              country: "Taiwan",
              country_code: "TW",
              admin1: "Taipei City",
              timezone: "Asia/Taipei",
              population: 7_000_000,
            },
          ],
        });
      }

      if (url.hostname === "api.open-meteo.com") {
        if (url.searchParams.has("daily")) {
          return jsonResponse({
            latitude: 25.033,
            longitude: 121.565,
            timezone: "Asia/Taipei",
            daily: {
              time: ["2026-06-24", "2026-06-25"],
              weather_code: [61, 1],
              temperature_2m_max: [31, 33],
              temperature_2m_min: [25, 26],
              precipitation_probability_max: [80, 20],
              precipitation_sum: [8, 0],
            },
            daily_units: {
              temperature_2m_max: "\u00b0C",
              temperature_2m_min: "\u00b0C",
              precipitation_probability_max: "%",
              precipitation_sum: "mm",
            },
          });
        }

        return jsonResponse({
          latitude: 25.033,
          longitude: 121.565,
          timezone: "Asia/Taipei",
          hourly: {
            time: ["2026-06-23T18:00", "2026-06-23T21:00"],
            temperature_2m: [27, 25],
            precipitation_probability: [40, 70],
            precipitation: [0.1, 2.4],
            weather_code: [3, 61],
          },
          hourly_units: {
            temperature_2m: "\u00b0C",
            precipitation_probability: "%",
            precipitation: "mm",
          },
        });
      }

      throw new Error(`Unexpected network call: ${url.toString()}`);
    })
  );
}

function installRepairWeatherFetchMock(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url
      );

      if (url.hostname === "geocoding-api.open-meteo.com") {
        const name = url.searchParams.get("name");
        const results =
          name === "Beijing"
            ? [
                {
                  name: "Beijing",
                  latitude: 39.904,
                  longitude: 116.407,
                  country: "China",
                  country_code: "CN",
                  admin1: "Beijing",
                  timezone: "Asia/Shanghai",
                  population: 21_000_000,
                },
              ]
            : name === "Fengshan"
              ? [
                  {
                    name: "Fengshan",
                    latitude: 22.624,
                    longitude: 120.355,
                    country: "Taiwan",
                    country_code: "TW",
                    admin1: "Kaohsiung City",
                    admin2: "Fengshan District",
                    timezone: "Asia/Taipei",
                    population: 350_000,
                  },
                ]
              : name === "Daliao"
                ? [
                    {
                      name: "Daliao",
                      latitude: 22.585,
                      longitude: 120.396,
                      country: "Taiwan",
                      country_code: "TW",
                      admin1: "Kaohsiung City",
                      admin2: "Fengshan District",
                      timezone: "Asia/Taipei",
                      population: 110_000,
                    },
                  ]
                : name === MUNCHEN
                ? [
                    {
                      name: MUNCHEN,
                      latitude: 52.1,
                      longitude: 13.4,
                      country: "Germany",
                      country_code: "DE",
                      admin1: "Brandenburg",
                      timezone: "Europe/Berlin",
                      population: 3_000,
                    },
                    {
                      name: "Munich",
                      latitude: 48.137,
                      longitude: 11.575,
                      country: "Germany",
                      country_code: "DE",
                      admin1: "Bavaria",
                      timezone: "Europe/Berlin",
                      population: 1_500_000,
                    },
                    {
                      name: MUNCHEN,
                      latitude: 48.1372,
                      longitude: 11.5754,
                      country: "Germany",
                      country_code: "DE",
                      admin1: "Bavaria",
                    },
                    {
                      name: MUNCHEN,
                      latitude: 47.3,
                      longitude: 8.3,
                      country: "Switzerland",
                      country_code: "CH",
                      timezone: "Europe/Zurich",
                      population: 1_500,
                    },
                  ]
                : [];
        return jsonResponse({ results });
      }

      if (url.hostname === "api.open-meteo.com") {
        return jsonResponse({
          latitude: Number(url.searchParams.get("latitude")),
          longitude: Number(url.searchParams.get("longitude")),
          timezone: "UTC",
          current: {
            time: "2026-06-14T12:00",
            temperature_2m: 24,
            relative_humidity_2m: 70,
            weather_code: 1,
            wind_speed_10m: 8,
            wind_direction_10m: 90,
          },
          current_units: {
            temperature_2m: "\u00b0C",
            relative_humidity_2m: "%",
            wind_speed_10m: "km/h",
            wind_direction_10m: "\u00b0",
          },
        });
      }

      throw new Error(`Unexpected network call: ${url.toString()}`);
    })
  );
}

function installDaliaoWeatherFetchMock(geocodingQueries: string[]): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url
      );

      if (url.hostname === "geocoding-api.open-meteo.com") {
        geocodingQueries.push(url.searchParams.get("name") ?? "");
        return jsonResponse({
          results: [
            {
              id: 1,
              name: "大寮區",
              latitude: 22.585,
              longitude: 120.396,
              country: "台灣",
              country_code: "TW",
              admin1: "高雄市",
              admin2: "大寮區",
              timezone: "Asia/Taipei",
              population: 110_000,
            },
            {
              id: 1,
              name: "Daliao",
              latitude: 22.585,
              longitude: 120.396,
              country: "Taiwan",
              country_code: "TW",
              admin1: "Kaohsiung",
              admin2: "Daliao District",
              timezone: "Asia/Taipei",
              population: 110_000,
            },
            {
              id: 2,
              name: "Daliao",
              latitude: 4.2,
              longitude: -74.3,
              country: "Colombia",
              country_code: "CO",
              admin1: "Cundinamarca",
              timezone: "America/Bogota",
              population: 500,
            },
          ],
        });
      }

      if (url.hostname === "api.open-meteo.com" && url.searchParams.has("daily")) {
        return jsonResponse({
          latitude: 22.585,
          longitude: 120.396,
          timezone: "Asia/Taipei",
          daily: {
            time: ["2026-06-28"],
            weather_code: [61],
            temperature_2m_max: [31],
            temperature_2m_min: [25],
            precipitation_probability_max: [80],
            precipitation_sum: [8],
          },
          daily_units: {
            temperature_2m_max: "°C",
            temperature_2m_min: "°C",
            precipitation_probability_max: "%",
            precipitation_sum: "mm",
          },
        });
      }

      if (url.hostname === "api.open-meteo.com") {
        return jsonResponse({
          latitude: 22.585,
          longitude: 120.396,
          timezone: "Asia/Taipei",
          current: {
            time: "2026-06-28T12:00",
            temperature_2m: 30,
            relative_humidity_2m: 75,
            weather_code: 1,
            wind_speed_10m: 8,
            wind_direction_10m: 180,
          },
          current_units: {
            temperature_2m: "°C",
            relative_humidity_2m: "%",
            wind_speed_10m: "km/h",
            wind_direction_10m: "°",
          },
        });
      }

      throw new Error(`Unexpected network call: ${url.toString()}`);
    })
  );
}

function makePlannerState(
  messages: Array<HumanMessage | AIMessage>
): Parameters<typeof deepResearcherWeatherTestInternals.planResearch>[0] {
  return ({
    messages,
    imageObservations: [],
    initial_search_query_count: 3,
    max_research_loops: 5,
    reasoning_model: "qwen-plus",
  } as unknown) as Parameters<typeof deepResearcherWeatherTestInternals.planResearch>[0];
}

describe("Deep Research weather structured result integration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

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
        temperature_2m: "簞C",
        relative_humidity_2m: "%",
        wind_speed_10m: "km/h",
      },
      provider: "Open-Meteo",
      sourceUrl: "https://api.open-meteo.com/v1/forecast?latitude=35.676&longitude=139.65",
      summary: "Current weather for Tokyo: 22簞C, clear sky.",
    };

    const answer = deepResearcherWeatherTestInternals.buildWeatherToolAnswer(
      stateWithWeather(result)
    );

    const content = String(answer?.content);
    expect(content).toContain("Current weather for Tokyo");
    expect(content).toContain("Temperature: 22簞C");
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

  it("routes provider-backed clarification candidates to LangGraph interrupt", () => {
    const result: WeatherToolResult = {
      schemaVersion: "1.0",
      tool: "current_weather",
      status: "needs_clarification",
      requestedLocation: { raw: "Springfield", location: "Springfield" },
      candidates: [
        {
          name: "Springfield",
          displayName: "Springfield, Illinois, United States",
          country: "United States",
          countryCode: "US",
          admin1: "Illinois",
          providerId: "geo-1",
          latitude: 39.7817,
          longitude: -89.6501,
          timezone: "America/Chicago",
        },
        {
          name: "Springfield",
          displayName: "Springfield, Missouri, United States",
          country: "United States",
          countryCode: "US",
          admin1: "Missouri",
          providerId: "geo-2",
          latitude: 37.209,
          longitude: -93.2923,
          timezone: "America/Chicago",
        },
      ],
      message: "Location is ambiguous.",
      summary: "Location Springfield matches multiple candidates.",
    };
    const state = {
      ...stateWithWeather(result),
      planningResult: {
        schemaVersion: 2,
        question: "Springfield weather",
        kind: "weather",
        rationale: "weather",
        weather: {
          rawLocation: "Springfield",
          weatherCapability: "current",
          units: "metric",
        },
      },
      clarification: undefined,
    } as Parameters<typeof deepResearcherWeatherTestInternals.routeAfterTargetedTools>[0];

    expect(deepResearcherWeatherTestInternals.routeAfterTargetedTools(state)).toBe("clarify_interrupt");

    const config = { configurable: { thread_id: "thread-weather" }, runId: "run-weather" } as never;
    const clarification = deepResearcherWeatherTestInternals.buildClarificationState(state, config);
    expect(clarification?.weatherCapability).toBe("current");
    expect(clarification?.candidates).toHaveLength(2);

    const payload = clarification
      ? deepResearcherWeatherTestInternals.buildClarificationInterrupt(clarification, state, config)
      : undefined;
    expect(payload?.type).toBe("weather_clarification");
    expect(payload?.threadId).toBe("thread-weather");
    expect(payload?.candidates[1].index).toBe(2);
    expect(payload?.candidates[1].providerId).toBe("geo-2");
  });

  it("does not interrupt legacy clarification candidates without coordinates", () => {
    const result: WeatherToolResult = {
      schemaVersion: "1.0",
      tool: "current_weather",
      status: "needs_clarification",
      requestedLocation: { raw: "Springfield", location: "Springfield" },
      candidates: [
        { name: "Springfield", displayName: "Springfield, Illinois", country: "United States", admin1: "Illinois" },
        { name: "Springfield", displayName: "Springfield, Missouri", country: "United States", admin1: "Missouri" },
      ],
      message: "Location is ambiguous.",
      summary: "Location Springfield matches multiple candidates.",
    };

    const state = {
      ...stateWithWeather(result),
      clarification: undefined,
    } as Parameters<typeof deepResearcherWeatherTestInternals.routeAfterTargetedTools>[0];

    expect(deepResearcherWeatherTestInternals.routeAfterTargetedTools(state)).toBe("synthesize");
  });

  it("validates structured clarification resolution output", () => {
    expect(
      deepResearcherWeatherTestInternals.coerceClarificationResolution({
        resolutionType: "select_candidate",
        candidateIndex: 2,
      })
    ).toEqual({ resolutionType: "select_candidate", candidateIndex: 2 });
    expect(
      deepResearcherWeatherTestInternals.coerceClarificationResolution({
        resolutionType: "cancel",
        cancel: true,
      })
    ).toEqual({ resolutionType: "cancel", cancel: true });
    expect(
      deepResearcherWeatherTestInternals.coerceClarificationResolution({
        resolutionType: "select_candidate",
        candidateIndex: "second",
      })
    ).toBeUndefined();
  });

  it("dispatches clarification candidate index selection without repeating geocoding", async () => {
    vi.spyOn(llmGateway, "createChatModel").mockReturnValue({
      invoke: vi.fn(async () =>
        new AIMessage(JSON.stringify({ resolutionType: "select_candidate", candidateIndex: 2 }))
      ),
    });

    const result = await deepResearcherWeatherTestInternals.resumeClarify(
      stateWithSpringfieldClarification("2"),
      {}
    );

    expect(result.clarification?.status).toBe("resolved");
    expect(result.weatherExecution?.status).toBe("running");
    expect(result.selectedWeatherCandidate?.providerId).toBe("geo-2");
  });

  it("dispatches clarification region filters to a single provider-backed candidate", async () => {
    vi.spyOn(llmGateway, "createChatModel").mockReturnValue({
      invoke: vi.fn(async () =>
        new AIMessage(JSON.stringify({ resolutionType: "filter_candidates", filter: { region: "Illinois" } }))
      ),
    });

    const result = await deepResearcherWeatherTestInternals.resumeClarify(
      stateWithSpringfieldClarification("Illinois"),
      {}
    );

    expect(result.clarification?.status).toBe("resolved");
    expect(result.selectedWeatherCandidate?.providerId).toBe("geo-1");
  });

  it("dispatches clarification location changes as fresh weather requests", async () => {
    vi.spyOn(llmGateway, "createChatModel").mockReturnValue({
      invoke: vi.fn(async () =>
        new AIMessage(JSON.stringify({ resolutionType: "new_location", newLocationText: "Tokyo" }))
      ),
    });

    const result = await deepResearcherWeatherTestInternals.resumeClarify(
      stateWithSpringfieldClarification("actually Tokyo"),
      {}
    );

    expect(result.clarification?.status).toBe("resolved");
    expect(result.weatherExecution?.status).toBe("running");
    expect(
      result.planningResult?.kind === "weather"
        ? result.planningResult.weather.rawLocation
        : undefined
    ).toBe("Tokyo");
    expect(result.selectedWeatherCandidate).toBeUndefined();
  });

  it("dispatches clarification cancellation to a terminal cancelled weather result", async () => {
    vi.spyOn(llmGateway, "createChatModel").mockReturnValue({
      invoke: vi.fn(async () =>
        new AIMessage(JSON.stringify({ resolutionType: "cancel", cancel: true }))
      ),
    });

    const result = await deepResearcherWeatherTestInternals.resumeClarify(
      stateWithSpringfieldClarification("cancel"),
      {}
    );

    expect(result.clarification?.status).toBe("cancelled");
    expect(result.weatherExecution?.status).toBe("failed");
    if (result.weatherExecution?.status === "failed" && result.weatherExecution.result.status === "error") {
      expect(result.weatherExecution.result.code).toBe("weather_cancelled");
    }
  });

  it("rejects empty, over-length, and exhausted unrecognized clarification replies", async () => {
    const empty = await deepResearcherWeatherTestInternals.resumeClarify(
      stateWithSpringfieldClarification("   "),
      {}
    );
    expect(empty.weatherExecution?.status).toBe("failed");

    const overLength = await deepResearcherWeatherTestInternals.resumeClarify(
      stateWithSpringfieldClarification("x".repeat(501)),
      {}
    );
    expect(overLength.clarification?.status).toBe("exhausted");

    vi.spyOn(llmGateway, "createChatModel").mockReturnValue({
      invoke: vi.fn(async () =>
        new AIMessage(JSON.stringify({ resolutionType: "unrecognized" }))
      ),
    });
    const exhausted = await deepResearcherWeatherTestInternals.resumeClarify(
      stateWithSpringfieldClarification("not enough", { rounds: 1 }),
      {}
    );

    expect(exhausted.clarification?.status).toBe("exhausted");
    expect(exhausted.weatherExecution?.status).toBe("failed");
  });

  it("terminates clarification resume as weather_timeout after the configured timeout", async () => {
    const state = stateWithSpringfieldClarification("1", { interruptCheckpointStep: 0 });

    const result = await deepResearcherWeatherTestInternals.resumeClarify(state, {
      configurable: { weatherClarificationTimeoutMs: 1 },
    });

    expect(result.clarification?.status).toBe("timeout");
    expect(result.weatherExecution?.status).toBe("failed");
    if (result.weatherExecution?.status === "failed") {
      expect(result.weatherExecution.result.status).toBe("error");
      if (result.weatherExecution.result.status === "error") {
        expect(result.weatherExecution.result.code).toBe("weather_timeout");
      }
    }
  });

  it("propagates RunnableConfig AbortSignal to current_weather", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await deepResearcherWeatherTestInternals.targetedTools(
      ({
        planningResult: {
          schemaVersion: 2,
          question: "Tokyo weather now",
          kind: "weather",
          rationale: "weather request",
          weather: {
            rawLocation: "Tokyo",
            weatherCapability: "current",
            units: "metric",
          },
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

  it.each([
    {
      question: "高雄大寮今天會下雨嗎",
      rawLocation: "高雄大寮",
      weatherCapability: "daily" as const,
      timeRange: { kind: "today" as const, granularity: "daily" as const },
      expectedTool: "weather_forecast",
    },
    {
      question: "大寮天氣",
      rawLocation: "大寮",
      weatherCapability: "current" as const,
      expectedTool: "current_weather",
    },
    {
      question: "高雄市大寮區天氣",
      rawLocation: "高雄市大寮區",
      weatherCapability: "current" as const,
      expectedTool: "current_weather",
    },
    {
      question: "Daliao, Kaohsiung weather",
      rawLocation: "Daliao, Kaohsiung",
      weatherCapability: "current" as const,
      expectedTool: "current_weather",
    },
  ])(
    "preserves rawLocation and resolves Daliao in Taiwan: $question",
    async ({ question, rawLocation, weatherCapability, timeRange, expectedTool }) => {
      const geocodingQueries: string[] = [];
      installDaliaoWeatherFetchMock(geocodingQueries);
      vi.spyOn(llmGateway, "createChatModel").mockReturnValue({
        invoke: vi.fn(async () =>
          new AIMessage(
            JSON.stringify({
              schemaVersion: 2,
              question,
              kind: "weather",
              rationale: "Weather request with a complete user-provided location.",
              weather: {
                rawLocation,
                weatherCapability,
                ...(timeRange ? { timeRange } : {}),
                units: "metric",
              },
            })
          )
        ),
      });

      const state = makePlannerState([new HumanMessage(question)]);
      const planned = await deepResearcherWeatherTestInternals.planResearch(state, {});

      expect(planned.planningResult?.kind).toBe("weather");
      expect(
        planned.planningResult?.kind === "weather"
          ? planned.planningResult.weather.rawLocation
          : undefined
      ).toBe(rawLocation);
      expect(
        deepResearcherWeatherTestInternals.routeAfterPlan({
          ...state,
          planningResult: planned.planningResult,
        } as Parameters<typeof deepResearcherWeatherTestInternals.routeAfterPlan>[0])
      ).toBe("targeted_tools");

      const toolResult = await deepResearcherWeatherTestInternals.targetedTools(
        {
          ...state,
          planningResult: planned.planningResult,
        } as Parameters<typeof deepResearcherWeatherTestInternals.targetedTools>[0],
        {}
      );

      expect((toolResult.messages?.[0] as { name?: string } | undefined)?.name).toBe(expectedTool);
      expect(toolResult.weatherExecution?.status).toBe("success");
      const weatherResult =
        toolResult.weatherExecution?.status === "success"
          ? toolResult.weatherExecution.result
          : undefined;
      expect(weatherResult?.requestedLocation.raw).toBe(rawLocation);
      expect(weatherResult?.requestedLocation.location).toBe(rawLocation);
      expect(weatherResult?.status).toBe("success");
      if (weatherResult?.status === "success") {
        expect(weatherResult.resolvedLocation.countryCode).toBe("TW");
        expect(weatherResult.resolvedLocation.admin1).toMatch(/高雄|Kaohsiung/);
        expect(weatherResult.resolvedLocation.latitude).toBeCloseTo(22.585);
      }
      expect(geocodingQueries[0]).toBe(rawLocation);
      expect(JSON.stringify(planned.planningResult)).not.toContain("queryName");
    }
  );

  it("plans a full Taipei weather question into a location request before invoking current_weather", async () => {
    installTaipeiWeatherFetchMock();
    vi.spyOn(llmGateway, "createChatModel").mockReturnValue({
      invoke: vi.fn(async () =>
        new AIMessage(
          JSON.stringify({
            schemaVersion: 2,
            question: "\u53f0\u5317\u73fe\u5728\u5929\u6c23\u5982\u4f55\uFF1F",
            kind: "weather",
            rationale: "Weather intent with user-provided location.",
            weather: {
              rawLocation: "\u53f0\u5317",
              weatherCapability: "current",
              units: "metric",
            },
          })
        )
      ),
    });

    const state = ({
      messages: [
        new HumanMessage("\u53f0\u5317\u73fe\u5728\u5929\u6c23\u5982\u4f55\uFF1F"),
      ],
      imageObservations: [],
      initial_search_query_count: 3,
      max_research_loops: 5,
      reasoning_model: "qwen-plus",
    } as unknown) as Parameters<typeof deepResearcherWeatherTestInternals.planResearch>[0];

    const planned = await deepResearcherWeatherTestInternals.planResearch(state, {});

    expect(planned.planningResult?.kind).toBe("weather");
    expect(
      planned.planningResult?.kind === "weather"
        ? planned.planningResult.weather.rawLocation
        : undefined
    ).toBe("\u53f0\u5317");

    const toolResult = await deepResearcherWeatherTestInternals.targetedTools(
      {
        ...state,
        planningResult: planned.planningResult,
      } as Parameters<typeof deepResearcherWeatherTestInternals.targetedTools>[0],
      {}
    );

    expect(toolResult.weatherExecution?.status).toBe("success");
    const weatherResult =
      toolResult.weatherExecution?.status === "success"
        ? toolResult.weatherExecution.result
        : undefined;
    expect(weatherResult?.status).toBe("success");
    if (weatherResult?.status === "success" && weatherResult.tool === "current_weather") {
      expect(weatherResult.requestedLocation.raw).toBe("\u53f0\u5317");
      expect(weatherResult.requestedLocation.location).toBe("\u53f0\u5317");
      expect(JSON.stringify(weatherResult)).not.toContain("queryName");
      expect(weatherResult.resolvedLocation.name).toBe("\u53f0\u5317");
      expect(weatherResult.current.temperature).toBe(24);
    }
  });

  it("routes tomorrow daily forecast to weather_forecast while preserving rawLocation", async () => {
    installTaipeiForecastFetchMock();
    vi.spyOn(llmGateway, "createChatModel").mockReturnValue({
      invoke: vi.fn(async () =>
        new AIMessage(
          JSON.stringify({
            schemaVersion: 2,
            question: "\u53f0\u5317\u660e\u5929\u6703\u4e0b\u96e8\u55ce\uFF1F",
            kind: "weather",
            rationale: "Forecast request with user-provided location.",
            weather: {
              rawLocation: "\u53f0\u5317",
              weatherCapability: "daily",
              timeRange: { kind: "tomorrow", startDate: "2026-06-24", endDate: "2026-06-24", granularity: "daily" },
              units: "metric",
              locale: "zh-TW",
            },
          })
        )
      ),
    });

    const state = makePlannerState([new HumanMessage("\u53f0\u5317\u660e\u5929\u6703\u4e0b\u96e8\u55ce\uFF1F")]);
    const planned = await deepResearcherWeatherTestInternals.planResearch(state, {});
    const toolResult = await deepResearcherWeatherTestInternals.targetedTools(
      {
        ...state,
        planningResult: planned.planningResult,
      } as Parameters<typeof deepResearcherWeatherTestInternals.targetedTools>[0],
      {}
    );

    expect(
      planned.planningResult?.kind === "weather"
        ? planned.planningResult.weather.weatherCapability
        : undefined
    ).toBe("daily");
    expect(
      planned.planningResult?.kind === "weather"
        ? planned.planningResult.weather.timeRange?.kind
        : undefined
    ).toBe("tomorrow");
    expect((toolResult.messages?.[0] as { name?: string } | undefined)?.name).toBe("weather_forecast");
    expect(toolResult.weatherExecution?.status).toBe("success");
    const weatherResult = toolResult.weatherExecution?.status === "success"
      ? toolResult.weatherExecution.result
      : undefined;
    expect(weatherResult?.tool).toBe("weather_forecast");
    if (weatherResult?.status === "success" && weatherResult.tool === "weather_forecast") {
      expect(weatherResult.weatherCapability).toBe("daily");
      expect(weatherResult.daily?.[0]?.precipitationProbabilityMax).toBe(80);
      expect(JSON.stringify(weatherResult)).not.toContain("queryName");
    }
  });

  it("routes tonight hourly forecast to weather_forecast", async () => {
    installTaipeiForecastFetchMock();
    vi.spyOn(llmGateway, "createChatModel").mockReturnValue({
      invoke: vi.fn(async () =>
        new AIMessage(
          JSON.stringify({
            schemaVersion: 2,
            question: "\u53f0\u5317\u4eca\u665a\u6703\u8b8a\u51b7\u55ce\uFF1F",
            kind: "weather",
            rationale: "Hourly forecast request.",
            weather: {
              rawLocation: "\u53f0\u5317",
              weatherCapability: "hourly",
              timeRange: { kind: "tonight", startDate: "2026-06-23", endDate: "2026-06-24", granularity: "hourly" },
              units: "metric",
            },
          })
        )
      ),
    });

    const state = makePlannerState([new HumanMessage("\u53f0\u5317\u4eca\u665a\u6703\u8b8a\u51b7\u55ce\uFF1F")]);
    const planned = await deepResearcherWeatherTestInternals.planResearch(state, {});
    const toolResult = await deepResearcherWeatherTestInternals.targetedTools(
      {
        ...state,
        planningResult: planned.planningResult,
      } as Parameters<typeof deepResearcherWeatherTestInternals.targetedTools>[0],
      {}
    );

    expect(
      planned.planningResult?.kind === "weather"
        ? planned.planningResult.weather.weatherCapability
        : undefined
    ).toBe("hourly");
    expect((toolResult.messages?.[0] as { name?: string } | undefined)?.name).toBe("weather_forecast");
    const weatherResult = toolResult.weatherExecution?.status === "success"
      ? toolResult.weatherExecution.result
      : undefined;
    expect(weatherResult?.tool).toBe("weather_forecast");
    if (weatherResult?.status === "success" && weatherResult.tool === "weather_forecast") {
      expect(weatherResult.hourly?.[1]?.temperature).toBe(25);
    }
  });

  it("accepts weekend daily timeRange without routing through current_weather", async () => {
    installTaipeiForecastFetchMock();
    vi.spyOn(llmGateway, "createChatModel").mockReturnValue({
      invoke: vi.fn(async () =>
        new AIMessage(
          JSON.stringify({
            schemaVersion: 2,
            question: "\u53f0\u5317\u9031\u672b\u5929\u6c23\u5982\u4f55\uFF1F",
            kind: "weather",
            rationale: "Weekend forecast request.",
            weather: {
              rawLocation: "\u53f0\u5317",
              weatherCapability: "daily",
              timeRange: { kind: "weekend", granularity: "daily" },
              units: "metric",
            },
          })
        )
      ),
    });

    const state = makePlannerState([new HumanMessage("\u53f0\u5317\u9031\u672b\u5929\u6c23\u5982\u4f55\uFF1F")]);
    const planned = await deepResearcherWeatherTestInternals.planResearch(state, {});
    const toolResult = await deepResearcherWeatherTestInternals.targetedTools(
      {
        ...state,
        planningResult: planned.planningResult,
      } as Parameters<typeof deepResearcherWeatherTestInternals.targetedTools>[0],
      {}
    );

    expect(
      planned.planningResult?.kind === "weather"
        ? planned.planningResult.weather.timeRange?.kind
        : undefined
    ).toBe("weekend");
    expect((toolResult.messages?.[0] as { name?: string } | undefined)?.name).toBe("weather_forecast");
  });

  it("rejects unknown weatherCapability before tool execution", async () => {
    vi.spyOn(llmGateway, "createChatModel").mockReturnValue({
      invoke: vi.fn(async () =>
        new AIMessage(
          JSON.stringify({
            question: "Taipei historical weather",
            answerMode: "weather",
            rationale: "Unsupported weather capability.",
            queries: [],
            urls: [],
            weather: {
              location: "Taipei",
              weatherCapability: "historical",
              timeRange: { kind: "date_range", startDate: "2020-01-01", endDate: "2020-01-02" },
            },
            requiredSourceCount: 1,
          })
        )
      ),
    });

    const state = makePlannerState([new HumanMessage("Taipei historical weather")]);
    const planned = await deepResearcherWeatherTestInternals.planResearch(state, {});

    expect(planned.planningResult?.kind).toBe("extraction_error");
    expect(
      planned.planningResult?.kind === "extraction_error"
        ? planned.planningResult.errorCode
        : undefined
    ).toBe("planner_schema_rejected");
  });

  it("does not invoke weather_forecast when forecast location is missing", async () => {
    vi.spyOn(llmGateway, "createChatModel").mockReturnValue({
      invoke: vi.fn(async () =>
        new AIMessage(
          JSON.stringify({
            schemaVersion: 2,
            question: "\u660e\u5929\u6703\u4e0b\u96e8\u55ce\uFF1F",
            kind: "missing_location",
            rationale: "Forecast request missing location.",
            clarification: MISSING_WEATHER_LOCATION,
          })
        )
      ),
    });

    const state = makePlannerState([new HumanMessage("\u660e\u5929\u6703\u4e0b\u96e8\u55ce\uFF1F")]);
    const planned = await deepResearcherWeatherTestInternals.planResearch(state, {});

    expect(planned.planningResult?.kind).toBe("missing_location");
    expect(
      planned.planningResult?.kind === "missing_location"
        ? planned.planningResult.clarification
        : undefined
    ).toBe(MISSING_WEATHER_LOCATION);
  });

  it("planner prompt preserves rawLocation without provider-oriented fields", async () => {
    const invoke = vi.fn(async () =>
      new AIMessage(
        JSON.stringify({
          schemaVersion: 2,
          question: "Tokyo weather now",
          kind: "weather",
          rationale: "Weather request.",
          weather: {
            rawLocation: "Tokyo",
            weatherCapability: "current",
            units: "metric",
          },
        })
      )
    );
    vi.spyOn(llmGateway, "createChatModel").mockReturnValue({ invoke });

    const state = makePlannerState([new HumanMessage("Tokyo weather now")]);
    const planned = await deepResearcherWeatherTestInternals.planResearch(state, {});
    const plannerPrompt = String((invoke.mock.calls as unknown as Array<[unknown]>)[0]?.[0]);

    expect(JSON.stringify(planned.planningResult)).not.toContain("queryName");
    expect(plannerPrompt).not.toContain("queryName");
    expect(plannerPrompt).toContain("weather.rawLocation");
    expect(plannerPrompt).toContain("original writing system");
  });

  it("accepts a rawLocation-only weather plan", async () => {
    const invoke = vi.fn(async () =>
      new AIMessage(
        JSON.stringify({
          schemaVersion: 2,
          question: "Tokyo weather now",
          kind: "weather",
          rationale: "Weather request.",
          weather: {
            rawLocation: "Tokyo",
            weatherCapability: "current",
            units: "metric",
          },
        })
      )
    );
    vi.spyOn(llmGateway, "createChatModel").mockReturnValue({ invoke });

    const state = makePlannerState([new HumanMessage("Tokyo weather now")]);
    const planned = await deepResearcherWeatherTestInternals.planResearch(state, {});

    expect(planned.planningResult?.kind).toBe("weather");
    expect(
      planned.planningResult?.kind === "weather"
        ? planned.planningResult.weather.rawLocation
        : undefined
    ).toBe("Tokyo");
    expect(JSON.stringify(planned.planningResult)).not.toContain("queryName");
  });

  it("plans only the latest user message in a multi-turn weather clarification thread", async () => {
    const latestQuestion = `${BEIJING_CITY}\u73fe\u5728\u5e7e\u5ea6\uFF1F`;
    const invoke = vi.fn(async () =>
      new AIMessage(
        JSON.stringify({
          schemaVersion: 2,
          question: latestQuestion,
          kind: "weather",
          rationale: "Weather request for the latest user message.",
          weather: {
            rawLocation: BEIJING_CITY,
            weatherCapability: "current",
            units: "metric",
          },
        })
      )
    );
    vi.spyOn(llmGateway, "createChatModel").mockReturnValue({ invoke });

    const state = makePlannerState([
      new HumanMessage(`${KAOHSIUNG_FENGSHAN}\u4eca\u5929\u6703\u4e0b\u96e8\u55ce\uFF1F`),
      new AIMessage(MISSING_WEATHER_LOCATION),
      new HumanMessage(latestQuestion),
    ]);

    const planned = await deepResearcherWeatherTestInternals.planResearch(state, {});

    expect(planned.planningResult?.question).toBe(latestQuestion);
    expect(planned.planningResult?.kind).toBe("weather");
    expect(
      planned.planningResult?.kind === "weather"
        ? planned.planningResult.weather.rawLocation
        : undefined
    ).toBe(BEIJING_CITY);
    expect(
      deepResearcherWeatherTestInternals.routeAfterPlan({
        ...state,
        planningResult: planned.planningResult,
      } as Parameters<typeof deepResearcherWeatherTestInternals.routeAfterPlan>[0])
    ).toBe("targeted_tools");
    const plannerPrompt = (invoke.mock.calls as unknown as Array<[unknown]>)[0]?.[0];
    expect(String(plannerPrompt)).toContain(`Current user request:\n${latestQuestion}`);
  });

  it("9.3 retries weather planner extraction for Kaohsiung Fengshan before targeted_tools", async () => {
    installRepairWeatherFetchMock();
    const question = `${KAOHSIUNG_FENGSHAN}\u4eca\u5929\u6703\u4e0b\u96e8\u55ce\uFF1F`;
    const invoke = vi
      .fn()
      .mockResolvedValueOnce(
        new AIMessage(
          JSON.stringify({
            schemaVersion: 2,
            question,
            kind: "missing_location",
            rationale: "Planner failed to extract the weather location.",
            clarification: MISSING_WEATHER_LOCATION,
          })
        )
      )
      .mockResolvedValueOnce(
        new AIMessage(
          JSON.stringify({
            schemaVersion: 2,
            question,
            kind: "weather",
            rationale: "Recovered the complete location span.",
            weather: {
              rawLocation: KAOHSIUNG_FENGSHAN,
              weatherCapability: "current",
              units: "metric",
            },
          })
        )
      )
      .mockResolvedValueOnce(
        new AIMessage(
          JSON.stringify({
            candidates: [
              {
                location: "Fengshan District",
                country: "Taiwan",
                region: "Kaohsiung",
              },
              {
                location: "Fengshan",
                country: "Taiwan",
                region: "Kaohsiung",
              },
            ],
          })
        )
      );
    vi.spyOn(llmGateway, "createChatModel").mockReturnValue({ invoke });

    const state = makePlannerState([new HumanMessage(question)]);
    const planned = await deepResearcherWeatherTestInternals.planResearch(state, {});

    expect(planned.planningResult?.question).toBe(question);
    expect(planned.planningResult?.kind).toBe("weather");
    expect(
      planned.planningResult?.kind === "weather"
        ? planned.planningResult.weather.rawLocation
        : undefined
    ).toBe(KAOHSIUNG_FENGSHAN);
    expect(
      deepResearcherWeatherTestInternals.routeAfterPlan({
        ...state,
        planningResult: planned.planningResult,
      } as Parameters<typeof deepResearcherWeatherTestInternals.routeAfterPlan>[0])
    ).toBe("targeted_tools");

    const toolResult = await deepResearcherWeatherTestInternals.targetedTools(
      {
        ...state,
        planningResult: planned.planningResult,
      } as Parameters<typeof deepResearcherWeatherTestInternals.targetedTools>[0],
      {}
    );

    expect((toolResult.messages?.[0] as { name?: string } | undefined)?.name).toBe("current_weather");
    expect(toolResult.weatherExecution?.status).toBe("success");
    const weatherResult =
      toolResult.weatherExecution?.status === "success"
        ? toolResult.weatherExecution.result
        : undefined;
    expect(weatherResult?.status).toBe("success");
    if (weatherResult?.status === "success" && weatherResult.tool === "current_weather") {
      expect(weatherResult.requestedLocation.raw).toBe(KAOHSIUNG_FENGSHAN);
      expect(weatherResult.requestedLocation.location).toBe("Fengshan");
      expect(weatherResult.resolvedLocation.admin2).toBe("Fengshan District");
    }
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  it("9.4 retries weather planner extraction for Beijing before targeted_tools", async () => {
    installRepairWeatherFetchMock();
    const question = `${BEIJING_CITY}\u73fe\u5728\u5e7e\u5ea6\uFF1F`;
    const invoke = vi
      .fn()
      .mockResolvedValueOnce(
        new AIMessage(
          JSON.stringify({
            question,
            answerMode: "weather",
            rationale: "Weather request, but location was omitted.",
            queries: [],
            urls: [],
            weather: {},
            requiredSourceCount: 1,
          })
        )
      )
      .mockResolvedValueOnce(
        new AIMessage(
          JSON.stringify({
            schemaVersion: 2,
            question,
            kind: "weather",
            rationale: "Recovered the complete location span.",
            weather: {
              rawLocation: BEIJING_CITY,
              weatherCapability: "current",
              units: "metric",
            },
          })
        )
      )
      .mockResolvedValueOnce(
        new AIMessage(
          JSON.stringify({
            candidates: [
              {
                location: "Beijing",
                country: "China",
              },
            ],
          })
        )
      );
    vi.spyOn(llmGateway, "createChatModel").mockReturnValue({ invoke });

    const state = makePlannerState([new HumanMessage(question)]);
    const planned = await deepResearcherWeatherTestInternals.planResearch(state, {});

    expect(planned.planningResult?.question).toBe(question);
    expect(planned.planningResult?.kind).toBe("weather");
    expect(
      planned.planningResult?.kind === "weather"
        ? planned.planningResult.weather.rawLocation
        : undefined
    ).toBe(BEIJING_CITY);
    expect(
      deepResearcherWeatherTestInternals.routeAfterPlan({
        ...state,
        planningResult: planned.planningResult,
      } as Parameters<typeof deepResearcherWeatherTestInternals.routeAfterPlan>[0])
    ).toBe("targeted_tools");

    const toolResult = await deepResearcherWeatherTestInternals.targetedTools(
      {
        ...state,
        planningResult: planned.planningResult,
      } as Parameters<typeof deepResearcherWeatherTestInternals.targetedTools>[0],
      {}
    );

    expect((toolResult.messages?.[0] as { name?: string } | undefined)?.name).toBe("current_weather");
    expect(toolResult.weatherExecution?.status).toBe("success");
    const weatherResult =
      toolResult.weatherExecution?.status === "success"
        ? toolResult.weatherExecution.result
        : undefined;
    expect(weatherResult?.status).toBe("success");
    if (weatherResult?.status === "success") {
      expect(weatherResult.requestedLocation.raw).toBe(BEIJING_CITY);
      expect(weatherResult.requestedLocation.location).toBe("Beijing");
      expect(weatherResult.resolvedLocation.name).toBe("Beijing");
    }
    expect(invoke).toHaveBeenCalledTimes(3);
  });

  it("9.8 routes Muenchen weather through current_weather and resolves Bavaria Germany", async () => {
    installRepairWeatherFetchMock();
    const question = `${MUNCHEN} weather`;
    const invoke = vi.fn(async () =>
      new AIMessage(
        JSON.stringify({
          schemaVersion: 2,
          question,
          kind: "weather",
          rationale: "Weather request for a user-provided Latin-script location.",
          weather: {
            rawLocation: MUNCHEN,
            weatherCapability: "current",
            units: "metric",
          },
        })
      )
    );
    vi.spyOn(llmGateway, "createChatModel").mockReturnValue({ invoke });

    const state = makePlannerState([new HumanMessage(question)]);
    const planned = await deepResearcherWeatherTestInternals.planResearch(state, {});

    expect(planned.planningResult?.question).toBe(question);
    expect(planned.planningResult?.kind).toBe("weather");
    expect(
      planned.planningResult?.kind === "weather"
        ? planned.planningResult.weather.rawLocation
        : undefined
    ).toBe(MUNCHEN);
    expect(
      deepResearcherWeatherTestInternals.routeAfterPlan({
        ...state,
        planningResult: planned.planningResult,
      } as Parameters<typeof deepResearcherWeatherTestInternals.routeAfterPlan>[0])
    ).toBe("targeted_tools");

    const toolResult = await deepResearcherWeatherTestInternals.targetedTools(
      {
        ...state,
        planningResult: planned.planningResult,
      } as Parameters<typeof deepResearcherWeatherTestInternals.targetedTools>[0],
      {}
    );

    expect((toolResult.messages?.[0] as { name?: string } | undefined)?.name).toBe("current_weather");
    expect(toolResult.weatherExecution?.status).toBe("success");
    const weatherResult =
      toolResult.weatherExecution?.status === "success"
        ? toolResult.weatherExecution.result
        : undefined;
    expect(weatherResult?.status).toBe("success");
    if (weatherResult?.status === "success") {
      expect(weatherResult.requestedLocation.raw).toBe(MUNCHEN);
      expect(weatherResult.resolvedLocation.countryCode).toBe("DE");
      expect(weatherResult.resolvedLocation.admin1).toBe("Bavaria");
    }
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("repairs Beijing city suffix after not_found while preserving the original raw request", async () => {
    installRepairWeatherFetchMock();
    const invoke = vi
      .fn()
      .mockResolvedValueOnce(
        new AIMessage(
          JSON.stringify({
            schemaVersion: 2,
            question: "\u5317\u4eac\u5e02\u73fe\u5728\u5e7e\u5ea6\uFF1F",
            kind: "weather",
            rationale: "Weather request for Beijing.",
            weather: {
              rawLocation: "\u5317\u4eac\u5e02",
              weatherCapability: "current",
              units: "metric",
            },
          })
        )
      )
      .mockResolvedValueOnce(
        new AIMessage(
          JSON.stringify({
            candidates: [
              {
                location: "Beijing",
                country: "China",
                reason: "Provider may recognize the city by its English name and country.",
              },
            ],
          })
        )
      );
    vi.spyOn(llmGateway, "createChatModel").mockReturnValue({
      invoke,
    });

    const state = ({
      messages: [new HumanMessage("\u5317\u4eac\u5e02\u73fe\u5728\u5e7e\u5ea6\uFF1F")],
      imageObservations: [],
      initial_search_query_count: 3,
      max_research_loops: 5,
      reasoning_model: "qwen-plus",
    } as unknown) as Parameters<typeof deepResearcherWeatherTestInternals.planResearch>[0];

    const planned = await deepResearcherWeatherTestInternals.planResearch(state, {});
    expect(
      planned.planningResult?.kind === "weather"
        ? planned.planningResult.weather.rawLocation
        : undefined
    ).toBe("\u5317\u4eac\u5e02");

    const toolResult = await deepResearcherWeatherTestInternals.targetedTools(
      {
        ...state,
        planningResult: planned.planningResult,
      } as Parameters<typeof deepResearcherWeatherTestInternals.targetedTools>[0],
      {}
    );

    expect(toolResult.weatherExecution?.status).toBe("success");
    const weatherResult =
      toolResult.weatherExecution?.status === "success"
        ? toolResult.weatherExecution.result
        : undefined;
    expect(weatherResult?.status).toBe("success");
    if (weatherResult?.status === "success") {
      expect(weatherResult.requestedLocation.raw).toBe("\u5317\u4eac\u5e02");
      expect(weatherResult.requestedLocation.location).toBe("Beijing");
      expect(weatherResult.requestedLocation.country).toBe("China");
      expect(weatherResult.resolvedLocation.name).toBe("Beijing");
    }
    expect(String(invoke.mock.calls[1][0])).toContain("\u5317\u4eac\u5e02\u73fe\u5728\u5e7e\u5ea6");
    expect(String(invoke.mock.calls[1][0])).toContain("Provider attempted queries");
    expect(String(invoke.mock.calls[1][0])).toContain("\u5317\u4eac\u5e02");
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("repairs Kaohsiung Fengshan not_found into structured provider-friendly context and reruns resolver", async () => {
    installRepairWeatherFetchMock();
    const invoke = vi
      .fn()
      .mockResolvedValueOnce(
        new AIMessage(
          JSON.stringify({
            schemaVersion: 2,
            question: "\u9ad8\u96c4\u9cf3\u5c71\u4eca\u5929\u6703\u4e0b\u96e8\u55ce\uFF1F",
            kind: "weather",
            rationale: "Weather request for Fengshan in Kaohsiung.",
            weather: {
              rawLocation: "\u9ad8\u96c4\u9cf3\u5c71",
              weatherCapability: "current",
              units: "metric",
            },
          })
        )
      )
      .mockResolvedValueOnce(
        new AIMessage(
          JSON.stringify({
            candidates: [
              {
                location: "Fengshan District",
                country: "Taiwan",
                region: "Kaohsiung",
                reason: "The district form is implied by the user question.",
              },
              {
                location: "Fengshan",
                country: "Taiwan",
                region: "Kaohsiung",
                reason: "The base district name may be recognized by the provider.",
              },
            ],
          })
        )
      );
    vi.spyOn(llmGateway, "createChatModel").mockReturnValue({
      invoke,
    });

    const state = ({
      messages: [new HumanMessage("\u9ad8\u96c4\u9cf3\u5c71\u4eca\u5929\u6703\u4e0b\u96e8\u55ce\uFF1F")],
      imageObservations: [],
      initial_search_query_count: 3,
      max_research_loops: 5,
      reasoning_model: "qwen-plus",
    } as unknown) as Parameters<typeof deepResearcherWeatherTestInternals.planResearch>[0];

    const planned = await deepResearcherWeatherTestInternals.planResearch(state, {});
    expect(
      planned.planningResult?.kind === "weather"
        ? planned.planningResult.weather.rawLocation
        : undefined
    ).toBe("\u9ad8\u96c4\u9cf3\u5c71");

    const toolResult = await deepResearcherWeatherTestInternals.targetedTools(
      {
        ...state,
        planningResult: planned.planningResult,
      } as Parameters<typeof deepResearcherWeatherTestInternals.targetedTools>[0],
      {}
    );

    expect(toolResult.weatherExecution?.status).toBe("success");
    const weatherResult =
      toolResult.weatherExecution?.status === "success"
        ? toolResult.weatherExecution.result
        : undefined;
    expect(weatherResult?.status).toBe("success");
    if (weatherResult?.status === "success") {
      expect(weatherResult.requestedLocation.raw).toBe("\u9ad8\u96c4\u9cf3\u5c71");
      expect(weatherResult.requestedLocation.location).toBe("Fengshan");
      expect(weatherResult.requestedLocation.country).toBe("Taiwan");
      expect(weatherResult.requestedLocation.region).toBe("Kaohsiung");
      expect(weatherResult.resolvedLocation.admin2).toBe("Fengshan District");
    }
    expect(String(invoke.mock.calls[1][0])).toContain("\u9ad8\u96c4\u9cf3\u5c71\u4eca\u5929");
    expect(String(invoke.mock.calls[1][0])).toContain("Provider attempted queries");
    expect(String(invoke.mock.calls[1][0])).toContain("\u9ad8\u96c4\u9cf3\u5c71");
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("rejects LLM repair output that includes coordinates instead of a provider-facing query", async () => {
    vi.spyOn(llmGateway, "createChatModel").mockReturnValue({
      invoke: vi.fn(async () =>
        new AIMessage(
          JSON.stringify({
            location: "Beijing",
            country: "China",
            latitude: 39.904,
            longitude: 116.407,
          })
        )
      ),
    });

    const repaired = await deepResearcherWeatherTestInternals.repairWeatherRequest(
      { raw: "\u5317\u4eac\u5e02", location: "\u5317\u4eac\u5e02" },
      ({ reasoning_model: "qwen-plus" } as unknown) as Parameters<
        typeof deepResearcherWeatherTestInternals.repairWeatherRequest
      >[1]
    );

    expect(repaired).toEqual([]);
  });

  it("records sanitized planner diagnostics without leaking sensitive fields", async () => {
    const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const question = `${BEIJING_CITY}\u73fe\u5728\u5e7e\u5ea6\uFF1F`;
    const invoke = vi
      .fn()
      .mockResolvedValueOnce(
        new AIMessage(
          JSON.stringify({
            schemaVersion: 2,
            question,
            kind: "missing_location",
            rationale: "Planner failed to extract the weather location.",
            clarification: MISSING_WEATHER_LOCATION,
            apiKey: "sk-secret-value",
          })
        )
      )
      .mockResolvedValueOnce(
        new AIMessage(
          JSON.stringify({
            schemaVersion: 2,
            question,
            kind: "weather",
            rationale: "Recovered the original location span.",
            weather: {
              rawLocation: BEIJING_CITY,
              weatherCapability: "current",
              units: "metric",
            },
          })
        )
      );
    vi.spyOn(llmGateway, "createChatModel").mockReturnValue({ invoke });

    const state = makePlannerState([new HumanMessage(question)]);
    const planned = await deepResearcherWeatherTestInternals.planResearch(state, {});

    expect(planned.planningResult?.kind).toBe("weather");
    const logs = consoleSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(logs).toContain("weather.llm.diagnostic");
    expect(logs).toContain('"phase":"planner_extraction"');
    expect(logs).toContain('"plannerJson"');
    expect(logs).toContain("[redacted]");
    expect(logs).not.toContain("sk-secret-value");
  });

  it("records repair parse failure diagnostics instead of silently swallowing empty repair", async () => {
    const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(llmGateway, "createChatModel").mockReturnValue({
      invoke: vi.fn(async () => new AIMessage('{"apiKey":"sk-secret-value"')),
    });

    const repaired = await deepResearcherWeatherTestInternals.repairWeatherRequest(
      { raw: BEIJING_CITY, location: BEIJING_CITY },
      ({ reasoning_model: "qwen-plus" } as unknown) as Parameters<
        typeof deepResearcherWeatherTestInternals.repairWeatherRequest
      >[1]
    );

    expect(repaired).toEqual([]);
    const logs = consoleSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(logs).toContain("weather.llm.diagnostic");
    expect(logs).toContain('"phase":"repair"');
    expect(logs).toContain('"failureCode":"parse_failed"');
    expect(logs).toContain('"responseContentLength":');
    expect(logs).not.toContain("sk-secret-value");
  });

  it("uses JSON object response format for the planner model call", async () => {
    const createChatModel = vi.spyOn(llmGateway, "createChatModel").mockReturnValue({
      invoke: vi.fn(async () =>
        new AIMessage(
          JSON.stringify({
            schemaVersion: 2,
            question: "Tokyo weather now",
            kind: "weather",
            rationale: "Weather request.",
            weather: {
              rawLocation: "Tokyo",
              weatherCapability: "current",
              units: "metric",
            },
          })
        )
      ),
    });

    const state = makePlannerState([new HumanMessage("Tokyo weather now")]);
    await deepResearcherWeatherTestInternals.planResearch(state, {});

    expect(createChatModel).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: "research",
        responseFormat: { type: "json_object" },
      })
    );
  });

  it("12.3 extracts composite three-level Chinese admin place name as weather.location", async () => {
    installRepairWeatherFetchMock();
    const question = "\u53f0\u7063\u9ad8\u96c4\u5927\u5bee\u5929\u6c23\u5982\u4f55\uff1f";
    const invoke = vi
      .fn()
      .mockResolvedValueOnce(
        new AIMessage(
          JSON.stringify({
            schemaVersion: 2,
            question,
            kind: "missing_location",
            rationale: "Planner failed to extract the weather location.",
            clarification: MISSING_WEATHER_LOCATION,
          })
        )
      )
      .mockResolvedValueOnce(
        new AIMessage(
          JSON.stringify({
            schemaVersion: 2,
            question,
            kind: "weather",
            rationale: "Recovered the complete location span.",
            weather: {
              rawLocation: "\u53f0\u7063\u9ad8\u96c4\u5927\u5bee",
              weatherCapability: "current",
              units: "metric",
            },
          })
        )
      )
      .mockResolvedValueOnce(
        new AIMessage(
          JSON.stringify({
            candidates: [
              {
                location: "Daliao",
                country: "Taiwan",
                region: "Kaohsiung",
              },
            ],
          })
        )
      );
    vi.spyOn(llmGateway, "createChatModel").mockReturnValue({ invoke });

    const state = makePlannerState([new HumanMessage(question)]);
    const planned = await deepResearcherWeatherTestInternals.planResearch(state, {});

    expect(planned.planningResult?.kind).toBe("weather");
    expect(
      planned.planningResult?.kind === "weather"
        ? planned.planningResult.weather.rawLocation
        : undefined
    ).toBe("\u53f0\u7063\u9ad8\u96c4\u5927\u5bee");
    expect(JSON.stringify(planned.planningResult)).not.toContain("queryName");
    expect(String(invoke.mock.calls[0]?.[0])).toContain("complete user-provided location span");
    expect(String(invoke.mock.calls[1]?.[0])).toContain(
      "complete user-provided location span"
    );
    expect(
      deepResearcherWeatherTestInternals.routeAfterPlan({
        ...state,
        planningResult: planned.planningResult,
      } as Parameters<typeof deepResearcherWeatherTestInternals.routeAfterPlan>[0])
    ).toBe("targeted_tools");

    const toolResult = await deepResearcherWeatherTestInternals.targetedTools(
      {
        ...state,
        planningResult: planned.planningResult,
      } as Parameters<typeof deepResearcherWeatherTestInternals.targetedTools>[0],
      {}
    );

    expect((toolResult.messages?.[0] as { name?: string } | undefined)?.name).toBe(
      "current_weather"
    );
    expect(toolResult.weatherExecution?.status).toBe("success");
  });
});
