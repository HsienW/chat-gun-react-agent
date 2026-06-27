import { describe, expect, it } from "vitest";

import {
  parsePlanningResultV2,
  routePlanningResultV2,
  safeParsePlanningResultV2,
} from "./planning-result-v2.js";

const planningBase = {
  schemaVersion: 2 as const,
  question: "台灣高雄大寮天氣如何？",
  rationale: "The user asked for current weather.",
};

describe("PlanningResultV2", () => {
  it.each([
    { ...planningBase, kind: "direct" },
    {
      ...planningBase,
      kind: "weather",
      weather: {
        rawLocation: "台灣高雄大寮",
        weatherCapability: "current",
        units: "metric",
      },
    },
    {
      ...planningBase,
      kind: "calculation",
      calculation: { expression: "1 + 1" },
    },
    {
      ...planningBase,
      kind: "research",
      queries: ["Mapbox Geocoding v6 documentation"],
      urls: [],
      requiredSourceCount: 1,
    },
    {
      ...planningBase,
      kind: "missing_location",
      clarification: "請提供要查詢天氣的地點。",
    },
    {
      ...planningBase,
      kind: "clarify",
      reason: "insufficient_context",
      clarification: "請補充要研究的問題。",
    },
    {
      ...planningBase,
      kind: "extraction_error",
      errorCode: "planner_schema_rejected",
      retryable: false,
    },
  ])("accepts the $kind planning branch", (planningResult) => {
    expect(parsePlanningResultV2(planningResult)).toEqual(planningResult);
  });

  it("preserves a complete Unicode administrative location as rawLocation", () => {
    const parsed = parsePlanningResultV2({
      ...planningBase,
      kind: "weather",
      weather: {
        rawLocation: "亞洲台灣高雄大寮",
        weatherCapability: "current",
        units: "metric",
      },
    });

    expect(parsed.kind).toBe("weather");
    if (parsed.kind === "weather") {
      expect(parsed.weather.rawLocation).toBe("亞洲台灣高雄大寮");
    }
  });

  it.each(["location", "queryName", "queryNameHint"])(
    "rejects the legacy weather field %s",
    (legacyField) => {
      const parsed = safeParsePlanningResultV2({
        ...planningBase,
        kind: "weather",
        weather: {
          rawLocation: "台灣高雄大寮",
          weatherCapability: "current",
          units: "metric",
          [legacyField]: "Daliao",
        },
      });

      expect(parsed.success).toBe(false);
    }
  );

  it.each([
    "translatedLocation",
    "providerId",
    "latitude",
    "longitude",
  ])("rejects the provider-oriented weather field %s", (providerField) => {
    const parsed = safeParsePlanningResultV2({
      ...planningBase,
      kind: "weather",
      weather: {
        rawLocation: "高雄大寮",
        weatherCapability: "current",
        units: "metric",
        [providerField]: providerField === "latitude" ? 22.585 : "provider-value",
      },
    });

    expect(parsed.success).toBe(false);
  });

  it("does not coerce extraction failure into missing_location", () => {
    const parsed = parsePlanningResultV2({
      ...planningBase,
      kind: "extraction_error",
      errorCode: "planner_parse_error",
      retryable: true,
    });

    expect(parsed.kind).toBe("extraction_error");
  });

  it("rejects research plans without a query", () => {
    const parsed = safeParsePlanningResultV2({
      ...planningBase,
      kind: "research",
      queries: [],
      urls: [],
      requiredSourceCount: 1,
    });

    expect(parsed.success).toBe(false);
  });

  it.each([
    ["direct", "synthesize"],
    ["weather", "targeted_tools"],
    ["calculation", "targeted_tools"],
    ["research", "search_web"],
    ["missing_location", "synthesize"],
    ["clarify", "synthesize"],
    ["extraction_error", "synthesize"],
  ] as const)("routes %s using only the discriminant", (kind, expectedRoute) => {
    expect(routePlanningResultV2({ kind })).toBe(expectedRoute);
  });
});
