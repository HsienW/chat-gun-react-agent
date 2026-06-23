import { getEnv } from "./env.js";
import { getAgentRuntimeConfig } from "./runtime-config.js";

export type FallbackAnswerMode = "weather" | "calculation" | "research" | "clarify";

export type FallbackRoutingDecision = {
  answerMode: FallbackAnswerMode;
  rationale: string;
  queries: string[];
  weather?: {
    location: string;
  };
  calculation?: {
    expression: string;
  };
  clarification?: string;
  requiredSourceCount: number;
};

type KeywordMatcher = {
  weather: string[];
  calculation: string[];
};

const DEFAULT_KEYWORDS: KeywordMatcher = {
  weather: [
    "weather",
    "temperature",
    "forecast",
    "rain",
    "\u5929\u6c23",
    "\u6c23\u6eab",
    "\u6eab\u5ea6",
    "\u964d\u96e8",
    "\u4e0b\u96e8",
    "\u6fd5\u5ea6",
    "\u98a8\u901f",
    "\u98b1\u98a8",
  ],
  calculation: [
    "calculate",
    "calculator",
    "\u8a08\u7b97",
    "\u7b49\u65bc",
    "\u591a\u5c11",
  ],
};

const CALCULATION_EXPRESSION_PATTERN = /^[\d\s+\-*/().,%^=]+$/;

function readKeywordList(envName: string, fallback: string[]): string[] {
  const configured = getEnv(envName);
  if (!configured.trim()) {
    return fallback;
  }

  return configured
    .split(",")
    .map((keyword) => keyword.trim())
    .filter(Boolean);
}

function getKeywordMatcher(): KeywordMatcher {
  return {
    weather: readKeywordList("AGENT_WEATHER_KEYWORDS", DEFAULT_KEYWORDS.weather),
    calculation: readKeywordList("AGENT_CALCULATION_KEYWORDS", DEFAULT_KEYWORDS.calculation),
  };
}

function includesAnyKeyword(text: string, keywords: string[]): boolean {
  const normalizedText = text.toLowerCase();
  return keywords.some((keyword) => normalizedText.includes(keyword.toLowerCase()));
}

function stripConfiguredKeywords(text: string, keywords: string[]): string {
  return keywords.reduce((current, keyword) => {
    return current.replace(new RegExp(escapeRegExp(keyword), "gi"), " ");
  }, text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeCalculationExpression(question: string, calculationKeywords: string[]): string {
  const withoutKeywords = stripConfiguredKeywords(question, calculationKeywords);
  return withoutKeywords
    .replace(/[\uFF1F?]/g, "")
    .replace(/\uFF05/g, "%")
    .replace(/\u00D7/g, "*")
    .replace(/\u00F7/g, "/")
    .trim();
}

export function createPlannerFailureRoutingDecision(
  question: string,
  plannerFailureReason?: string
): FallbackRoutingDecision {
  const config = getAgentRuntimeConfig();
  const keywords = getKeywordMatcher();
  const rationaleSuffix = plannerFailureReason
    ? ` Planner failed: ${plannerFailureReason}`
    : "";

  if (includesAnyKeyword(question, keywords.weather)) {
    return {
      answerMode: "clarify",
      rationale: `Planner unavailable; weather intent detected but location extraction requires planner or user clarification.${rationaleSuffix}`,
      queries: [],
      clarification:
        "\u8acb\u63d0\u4f9b\u8981\u67e5\u8a62\u5929\u6c23\u7684\u57ce\u5e02\u6216\u5730\u5340\u3002",
      requiredSourceCount: 1,
    };
  }

  if (includesAnyKeyword(question, keywords.calculation)) {
    const expression = normalizeCalculationExpression(question, keywords.calculation);
    if (CALCULATION_EXPRESSION_PATTERN.test(expression)) {
      return {
        answerMode: "calculation",
        rationale: `Planner unavailable; routing by configured calculation intent policy.${rationaleSuffix}`,
        queries: [],
        calculation: { expression },
        requiredSourceCount: 1,
      };
    }
  }

  return {
    answerMode: "research",
    rationale: `Planner unavailable; routing to web research so external evidence is still collected.${rationaleSuffix}`,
    queries: [question],
    requiredSourceCount: config.fallbackRequiredSourceCount,
  };
}
