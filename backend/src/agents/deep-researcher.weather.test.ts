import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { afterEach, describe, expect, it, vi } from "vitest";

import { deepResearcherWeatherTestInternals } from "./deep-researcher.js";
import { llmGateway } from "../platform/llm-gateway.js";
import type { WeatherToolResult } from "../tools/weather-types.js";

type WeatherState = Parameters<
  typeof deepResearcherWeatherTestInternals.buildWeatherToolAnswer
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

function makePlannerState(
  messages: Array<HumanMessage | AIMessage>
): Parameters<typeof deepResearcherWeatherTestInternals.planResearch>[0] {
  return ({
    messages,
    imageObservations: [],
    initial_search_query_count: 3,
    max_research_loops: 5,
    reasoning_model: "gemini-2.5-flash",
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

  it("plans a full Taipei weather question into a location request before invoking current_weather", async () => {
    installTaipeiWeatherFetchMock();
    vi.spyOn(llmGateway, "createChatModel").mockReturnValue({
      invoke: vi.fn(async () =>
        new AIMessage(
          JSON.stringify({
            question: "\u53f0\u5317\u73fe\u5728\u5929\u6c23\u5982\u4f55\uFF1F",
            answerMode: "weather",
            rationale: "Weather intent with user-provided location.",
            queries: [],
            urls: [],
            weather: {
              location: "\u53f0\u5317",
            },
            requiredSourceCount: 1,
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
      reasoning_model: "gemini-2.5-flash",
    } as unknown) as Parameters<typeof deepResearcherWeatherTestInternals.planResearch>[0];

    const planned = await deepResearcherWeatherTestInternals.planResearch(state, {});

    expect(planned.plan?.answerMode).toBe("weather");
    expect(planned.plan?.weather?.location).toBe("\u53f0\u5317");

    const toolResult = await deepResearcherWeatherTestInternals.targetedTools(
      {
        ...state,
        plan: planned.plan,
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
      expect(weatherResult.requestedLocation.raw).toBe("\u53f0\u5317");
      expect(weatherResult.resolvedLocation.name).toBe("\u53f0\u5317");
      expect(weatherResult.current.temperature).toBe(24);
    }
  });

  it("plans only the latest user message in a multi-turn weather clarification thread", async () => {
    const latestQuestion = `${BEIJING_CITY}\u73fe\u5728\u5e7e\u5ea6\uFF1F`;
    const invoke = vi.fn(async () =>
      new AIMessage(
        JSON.stringify({
          question: "User: stale transcript should not be used",
          answerMode: "weather",
          rationale: "Weather request for the latest user message.",
          queries: [],
          urls: [],
          weather: {
            location: BEIJING_CITY,
          },
          requiredSourceCount: 1,
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

    expect(planned.plan?.question).toBe(latestQuestion);
    expect(planned.plan?.answerMode).toBe("weather");
    expect(planned.plan?.weather?.location).toBe(BEIJING_CITY);
    expect(
      deepResearcherWeatherTestInternals.routeAfterPlan({
        ...state,
        plan: planned.plan,
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
            question,
            answerMode: "clarify",
            rationale: "Planner failed to extract the weather location.",
            queries: [],
            urls: [],
            clarification: MISSING_WEATHER_LOCATION,
            requiredSourceCount: 1,
          })
        )
      )
      .mockResolvedValueOnce(
        new AIMessage(
          JSON.stringify({
            answerMode: "weather",
            weather: {
              location: KAOHSIUNG_FENGSHAN,
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

    expect(planned.plan?.question).toBe(question);
    expect(planned.plan?.answerMode).toBe("weather");
    expect(planned.plan?.weather?.location).toBe(KAOHSIUNG_FENGSHAN);
    expect(
      deepResearcherWeatherTestInternals.routeAfterPlan({
        ...state,
        plan: planned.plan,
      } as Parameters<typeof deepResearcherWeatherTestInternals.routeAfterPlan>[0])
    ).toBe("targeted_tools");

    const toolResult = await deepResearcherWeatherTestInternals.targetedTools(
      {
        ...state,
        plan: planned.plan,
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
            answerMode: "weather",
            weather: {
              location: BEIJING_CITY,
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

    expect(planned.plan?.question).toBe(question);
    expect(planned.plan?.answerMode).toBe("weather");
    expect(planned.plan?.weather?.location).toBe(BEIJING_CITY);
    expect(
      deepResearcherWeatherTestInternals.routeAfterPlan({
        ...state,
        plan: planned.plan,
      } as Parameters<typeof deepResearcherWeatherTestInternals.routeAfterPlan>[0])
    ).toBe("targeted_tools");

    const toolResult = await deepResearcherWeatherTestInternals.targetedTools(
      {
        ...state,
        plan: planned.plan,
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
          question,
          answerMode: "weather",
          rationale: "Weather request for a user-provided Latin-script location.",
          queries: [],
          urls: [],
          weather: {
            location: MUNCHEN,
          },
          requiredSourceCount: 1,
        })
      )
    );
    vi.spyOn(llmGateway, "createChatModel").mockReturnValue({ invoke });

    const state = makePlannerState([new HumanMessage(question)]);
    const planned = await deepResearcherWeatherTestInternals.planResearch(state, {});

    expect(planned.plan?.question).toBe(question);
    expect(planned.plan?.answerMode).toBe("weather");
    expect(planned.plan?.weather?.location).toBe(MUNCHEN);
    expect(
      deepResearcherWeatherTestInternals.routeAfterPlan({
        ...state,
        plan: planned.plan,
      } as Parameters<typeof deepResearcherWeatherTestInternals.routeAfterPlan>[0])
    ).toBe("targeted_tools");

    const toolResult = await deepResearcherWeatherTestInternals.targetedTools(
      {
        ...state,
        plan: planned.plan,
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
            question: "\u5317\u4eac\u5e02\u73fe\u5728\u5e7e\u5ea6\uFF1F",
            answerMode: "weather",
            rationale: "Weather request for Beijing.",
            queries: [],
            urls: [],
            weather: {
              location: "\u5317\u4eac\u5e02",
            },
            requiredSourceCount: 1,
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
      reasoning_model: "gemini-2.5-flash",
    } as unknown) as Parameters<typeof deepResearcherWeatherTestInternals.planResearch>[0];

    const planned = await deepResearcherWeatherTestInternals.planResearch(state, {});
    expect(planned.plan?.weather?.location).toBe("\u5317\u4eac\u5e02");

    const toolResult = await deepResearcherWeatherTestInternals.targetedTools(
      {
        ...state,
        plan: planned.plan,
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
            question: "\u9ad8\u96c4\u9cf3\u5c71\u4eca\u5929\u6703\u4e0b\u96e8\u55ce\uFF1F",
            answerMode: "weather",
            rationale: "Weather request for Fengshan in Kaohsiung.",
            queries: [],
            urls: [],
            weather: {
              location: "\u9ad8\u96c4\u9cf3\u5c71",
            },
            requiredSourceCount: 1,
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
      reasoning_model: "gemini-2.5-flash",
    } as unknown) as Parameters<typeof deepResearcherWeatherTestInternals.planResearch>[0];

    const planned = await deepResearcherWeatherTestInternals.planResearch(state, {});
    expect(planned.plan?.weather?.location).toBe("\u9ad8\u96c4\u9cf3\u5c71");

    const toolResult = await deepResearcherWeatherTestInternals.targetedTools(
      {
        ...state,
        plan: planned.plan,
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
      ({ reasoning_model: "gemini-2.5-flash" } as unknown) as Parameters<
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
            question,
            answerMode: "clarify",
            rationale: "Planner failed to extract the weather location.",
            queries: [],
            urls: [],
            clarification: MISSING_WEATHER_LOCATION,
            requiredSourceCount: 1,
          })
        )
      )
      .mockResolvedValueOnce(
        new AIMessage(
          JSON.stringify({
            answerMode: "weather",
            weather: {
              location: BEIJING_CITY,
              apiKey: "sk-secret-value",
            },
          })
        )
      );
    vi.spyOn(llmGateway, "createChatModel").mockReturnValue({ invoke });

    const state = makePlannerState([new HumanMessage(question)]);
    const planned = await deepResearcherWeatherTestInternals.planResearch(state, {});

    expect(planned.plan?.answerMode).toBe("weather");
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
      ({ reasoning_model: "gemini-2.5-flash" } as unknown) as Parameters<
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
});
