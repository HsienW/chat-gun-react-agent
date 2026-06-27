import { describe, expect, it } from "vitest";

import { deepResearcherQueryContractTestInternals } from "./deep-researcher.js";
import type { PlanningResultV2 } from "./planning-result-v2.js";

type ContractState = Parameters<
  typeof deepResearcherQueryContractTestInternals.routeAfterPlan
>[0];

function stateWithPlanningResult(
  planningResult: PlanningResultV2
): ContractState {
  return {
    planningResult,
    contextPack: undefined,
    initial_search_query_count: 2,
    max_research_loops: 5,
    reasoning_model: "",
    messages: [],
    searchResults: [],
    rankedSources: [],
    fetchedSources: [],
    extractedSources: [],
    verification: undefined,
    uploadError: undefined,
    imageObservations: [],
    weatherExecution: undefined,
    selectedWeatherCandidate: undefined,
    clarification: undefined,
  };
}

const planningBase = {
  schemaVersion: 2 as const,
  question: "Explain TypeScript",
  rationale: "route test",
};

describe("deep researcher PlanningResultV2 workflow contract", () => {
  it("captures structured output parse failures without exposing raw parser exceptions", () => {
    const result =
      deepResearcherQueryContractTestInternals.parseJsonObjectWithDiagnostics("{not-json");

    expect(result).toEqual({
      failureCode: "parse_failed",
      responseContentLength: 9,
    });
  });

  it("routes production state using the validated V2 discriminant", () => {
    expect(
      deepResearcherQueryContractTestInternals.routeAfterPlan(
        stateWithPlanningResult({
          ...planningBase,
          kind: "research",
          queries: ["TypeScript"],
          urls: [],
          requiredSourceCount: 1,
        })
      )
    ).toBe("search_web");

    expect(
      deepResearcherQueryContractTestInternals.routeAfterPlan(
        stateWithPlanningResult({
          ...planningBase,
          kind: "calculation",
          calculation: { expression: "2+2" },
        })
      )
    ).toBe("targeted_tools");

    expect(
      deepResearcherQueryContractTestInternals.routeAfterPlan(
        stateWithPlanningResult({
          ...planningBase,
          kind: "clarify",
          reason: "insufficient_context",
          clarification: "Need detail.",
        })
      )
    ).toBe("synthesize");
  });

  it("routes a complete raw weather location to targeted tools", () => {
    const state = stateWithPlanningResult({
      ...planningBase,
      question: "高雄大寮今天會下雨嗎",
      kind: "weather",
      weather: {
        rawLocation: "高雄大寮",
        weatherCapability: "daily",
        timeRange: {
          kind: "today",
          granularity: "daily",
        },
        units: "metric",
      },
    });

    expect(deepResearcherQueryContractTestInternals.routeAfterPlan(state)).toBe(
      "targeted_tools"
    );
  });
});
