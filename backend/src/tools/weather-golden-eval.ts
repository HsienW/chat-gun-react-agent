import type { WeatherToolResult } from "./weather-types.js";

export type WeatherGoldenEvalMode = "deterministic" | "mock_integration" | "live_smoke";

export type WeatherGoldenCapabilityCategory =
  | "current_observation"
  | "daily_forecast"
  | "hourly_forecast"
  | "ambiguous_location"
  | "missing_location"
  | "provider_error"
  | "timeout"
  | "cancelled"
  | "planner_error"
  | "synthesis_error"
  | "clarification"
  | "relationship";

export type WeatherGoldenEvalClassification = "pass" | "fail" | "known_gap" | "skipped";

export type WeatherGoldenEvalCase = {
  id: string;
  mode: WeatherGoldenEvalMode;
  capabilityCategory: WeatherGoldenCapabilityCategory;
  input: {
    prompt: string;
    toolInput?: {
      location: string;
      queryName?: string;
      country?: string;
      region?: string;
    };
  };
  expected: {
    status?: WeatherToolResult["status"];
    code?: string;
    classification?: Extract<WeatherGoldenEvalClassification, "known_gap">;
    owner?: "Phase 2" | "Phase 3";
    summary: string;
  };
  diagnosticTags: string[];
};

export type WeatherGoldenObservedOutcome = {
  status?: string;
  code?: string;
  summary?: string;
};

export type WeatherGoldenEvalResult = {
  caseId: string;
  mode: WeatherGoldenEvalMode;
  classification: WeatherGoldenEvalClassification;
  expectedSummary: string;
  observedSummary: string;
  owner?: "Phase 2" | "Phase 3";
};

export type WeatherGoldenEvalSummary = {
  total: number;
  pass: number;
  fail: number;
  knownGap: number;
  skipped: number;
};

export const WEATHER_GOLDEN_BASELINE_REPORT_PATH =
  "openspec/changes/archive/2026-06-23-weather-golden-eval/baseline-report.md";

export const WEATHER_GOLDEN_EVAL_CASES: WeatherGoldenEvalCase[] = [
  {
    id: "WGE-CURRENT-CJK-TAIPEI",
    mode: "mock_integration",
    capabilityCategory: "current_observation",
    input: {
      prompt: "台北現在幾度？",
      toolInput: { location: "台北", queryName: "Taipei" },
    },
    expected: {
      status: "success",
      summary: "CJK location resolves through provider-backed queryName and returns current observation.",
    },
    diagnosticTags: ["cjk", "queryName", "current", "temperature"],
  },
  {
    id: "WGE-CURRENT-EN-TOKYO",
    mode: "mock_integration",
    capabilityCategory: "current_observation",
    input: {
      prompt: "Tokyo weather now",
      toolInput: { location: "Tokyo" },
    },
    expected: {
      status: "success",
      summary: "English location resolves and returns current observation.",
    },
    diagnosticTags: ["english", "current"],
  },
  {
    id: "WGE-CURRENT-MIXED-SINGAPORE",
    mode: "mock_integration",
    capabilityCategory: "current_observation",
    input: {
      prompt: "新加坡 weather",
      toolInput: { location: "新加坡", queryName: "Singapore" },
    },
    expected: {
      status: "success",
      summary: "Mixed Chinese-Latin weather request resolves through provider-backed queryName.",
    },
    diagnosticTags: ["mixed-language", "queryName", "current"],
  },
  {
    id: "WGE-CURRENT-UNICODE-SAO-PAULO",
    mode: "mock_integration",
    capabilityCategory: "current_observation",
    input: {
      prompt: "São Paulo weather",
      toolInput: { location: "São Paulo" },
    },
    expected: {
      status: "success",
      summary: "Unicode Latin place name with diacritics resolves and returns current observation.",
    },
    diagnosticTags: ["unicode", "diacritics", "current"],
  },
  {
    id: "WGE-AMBIGUOUS-SPRINGFIELD",
    mode: "mock_integration",
    capabilityCategory: "ambiguous_location",
    input: {
      prompt: "Springfield weather",
      toolInput: { location: "Springfield" },
    },
    expected: {
      status: "needs_clarification",
      summary: "Ambiguous same-name location returns clarification candidates instead of auto-selecting.",
    },
    diagnosticTags: ["ambiguous", "needs_clarification"],
  },
  {
    id: "WGE-MISSING-LOCATION",
    mode: "deterministic",
    capabilityCategory: "missing_location",
    input: {
      prompt: "現在天氣如何？",
    },
    expected: {
      status: "error",
      code: "weather_invalid_input",
      summary: "Missing usable location is represented as invalid tool input or planner clarification.",
    },
    diagnosticTags: ["missing-location", "invalid-input"],
  },
  {
    id: "WGE-NOT-FOUND",
    mode: "mock_integration",
    capabilityCategory: "missing_location",
    input: {
      prompt: "Definitely Missing Place weather",
      toolInput: { location: "Definitely Missing Place" },
    },
    expected: {
      status: "not_found",
      code: "weather_location_not_found",
      summary: "Provider returns no candidates and the tool does not fabricate coordinates.",
    },
    diagnosticTags: ["not_found", "provider-empty"],
  },
  {
    id: "WGE-PROVIDER-ERROR",
    mode: "mock_integration",
    capabilityCategory: "provider_error",
    input: {
      prompt: "Tokyo weather while geocoding is unavailable",
      toolInput: { location: "Tokyo" },
    },
    expected: {
      status: "error",
      code: "weather_geocoding_provider_error",
      summary: "Geocoding provider error remains distinct from not_found.",
    },
    diagnosticTags: ["provider-error", "geocoding"],
  },
  {
    id: "WGE-TIMEOUT",
    mode: "mock_integration",
    capabilityCategory: "timeout",
    input: {
      prompt: "Tokyo weather while provider times out",
      toolInput: { location: "Tokyo" },
    },
    expected: {
      status: "error",
      code: "weather_timeout",
      summary: "Provider timeout remains distinct from generic provider error.",
    },
    diagnosticTags: ["timeout", "terminal"],
  },
  {
    id: "WGE-CANCELLED",
    mode: "mock_integration",
    capabilityCategory: "cancelled",
    input: {
      prompt: "Tokyo weather cancelled by user",
      toolInput: { location: "Tokyo" },
    },
    expected: {
      status: "error",
      code: "weather_cancelled",
      summary: "User cancellation remains distinct from timeout and success.",
    },
    diagnosticTags: ["cancelled", "terminal"],
  },
  {
    id: "WGE-MALFORMED-PLANNER-OUTPUT",
    mode: "deterministic",
    capabilityCategory: "planner_error",
    input: {
      prompt: "Planner returns non-JSON for a weather request",
    },
    expected: {
      status: "error",
      code: "weather_planner_parse_failed",
      summary: "Malformed Planner output is recorded as a structured planning failure.",
    },
    diagnosticTags: ["planner", "malformed-output", "structured-validation"],
  },
  {
    id: "WGE-SYNTHESIS-FAILURE-AFTER-TOOL-SUCCESS",
    mode: "deterministic",
    capabilityCategory: "synthesis_error",
    input: {
      prompt: "Tool succeeds but synthesis fails before final answer",
    },
    expected: {
      status: "error",
      code: "weather_synthesis_failed",
      summary: "Synthesis failure after successful weather tool execution is recorded as a terminal failure.",
    },
    diagnosticTags: ["synthesis", "terminal", "tool-success"],
  },
  {
    id: "WGE-FORECAST-TOMORROW",
    mode: "deterministic",
    capabilityCategory: "daily_forecast",
    input: {
      prompt: "明天會下雨嗎？",
    },
    expected: {
      status: "success",
      summary: "Tomorrow forecast request is routed to daily weather_forecast capability.",
    },
    diagnosticTags: ["forecast", "tomorrow", "daily"],
  },
  {
    id: "WGE-FORECAST-TONIGHT",
    mode: "deterministic",
    capabilityCategory: "hourly_forecast",
    input: {
      prompt: "今晚會變冷嗎？",
    },
    expected: {
      status: "success",
      summary: "Tonight forecast request is routed to hourly weather_forecast capability.",
    },
    diagnosticTags: ["forecast", "tonight", "hourly"],
  },
  {
    id: "WGE-FORECAST-WEEKEND",
    mode: "deterministic",
    capabilityCategory: "daily_forecast",
    input: {
      prompt: "週末天氣如何？",
    },
    expected: {
      status: "success",
      summary: "Weekend forecast request is routed to daily weather_forecast capability.",
    },
    diagnosticTags: ["forecast", "weekend", "daily"],
  },
  {
    id: "WGE-MULTITURN-CANDIDATE-KNOWN-GAP",
    mode: "deterministic",
    capabilityCategory: "clarification",
    input: {
      prompt: "第三個",
    },
    expected: {
      status: "success",
      summary: "Candidate follow-up selection is handled by the Phase 3 clarification workflow.",
    },
    diagnosticTags: ["multi-turn", "candidate-selection", "clarification"],
  },
  {
    id: "clarification-candidate-index",
    mode: "deterministic",
    capabilityCategory: "clarification",
    input: {
      prompt: "Springfield weather, choose option 1",
    },
    expected: {
      status: "success",
      summary: "Clarification resume can select a provider-backed candidate by index.",
    },
    diagnosticTags: ["clarification", "candidate-index", "resume"],
  },
  {
    id: "clarification-region-supplement",
    mode: "deterministic",
    capabilityCategory: "clarification",
    input: {
      prompt: "Springfield weather, I mean Illinois",
    },
    expected: {
      status: "success",
      summary: "Clarification resume can filter ambiguous candidates by supplied region.",
    },
    diagnosticTags: ["clarification", "region-filter", "resume"],
  },
  {
    id: "clarification-location-change",
    mode: "deterministic",
    capabilityCategory: "clarification",
    input: {
      prompt: "Springfield weather, actually Tokyo",
    },
    expected: {
      status: "success",
      summary: "Clarification resume can switch to a newly supplied location.",
    },
    diagnosticTags: ["clarification", "new-location", "resume"],
  },
  {
    id: "clarification-cancel",
    mode: "deterministic",
    capabilityCategory: "clarification",
    input: {
      prompt: "Springfield weather, cancel",
    },
    expected: {
      status: "error",
      code: "weather_cancelled",
      summary: "Clarification resume can terminate as a user cancellation.",
    },
    diagnosticTags: ["clarification", "cancel", "terminal"],
  },
  {
    id: "clarification-unrecognizable-reply",
    mode: "deterministic",
    capabilityCategory: "clarification",
    input: {
      prompt: "Springfield weather, not enough information",
    },
    expected: {
      status: "needs_clarification",
      summary: "Unrecognizable clarification replies re-enter clarification without becoming not_found.",
    },
    diagnosticTags: ["clarification", "unrecognized", "retry"],
  },
  {
    id: "clarification-ambiguous-forecast",
    mode: "mock_integration",
    capabilityCategory: "clarification",
    input: {
      prompt: "Springfield forecast tomorrow",
    },
    expected: {
      status: "success",
      summary: "Ambiguous forecast requests can clarify location and resume weather_forecast.",
    },
    diagnosticTags: ["clarification", "forecast", "ambiguous-location"],
  },
  {
    id: "WGE-RELATION-TAIPEI-VARIANTS",
    mode: "deterministic",
    capabilityCategory: "relationship",
    input: {
      prompt: "台北 and 臺北 should resolve to compatible entities",
    },
    expected: {
      status: "success",
      summary: "Taipei Traditional/Simplified variants should remain geographically compatible.",
    },
    diagnosticTags: ["relationship", "cjk-variant"],
  },
  {
    id: "WGE-LIVE-TAIPEI-OPT-IN",
    mode: "live_smoke",
    capabilityCategory: "current_observation",
    input: {
      prompt: "台北現在天氣如何？",
      toolInput: { location: "台北", queryName: "Taipei" },
    },
    expected: {
      status: "success",
      summary: "Opt-in live smoke confirms real Open-Meteo can resolve Taipei.",
    },
    diagnosticTags: ["live-smoke", "opt-in", "cjk"],
  },
];

export function evaluateWeatherGoldenCase(
  testCase: WeatherGoldenEvalCase,
  observed: WeatherGoldenObservedOutcome | WeatherToolResult | undefined,
  options: { liveSmokeEnabled?: boolean } = {}
): WeatherGoldenEvalResult {
  if (testCase.mode === "live_smoke" && !options.liveSmokeEnabled) {
    return {
      caseId: testCase.id,
      mode: testCase.mode,
      classification: "skipped",
      expectedSummary: testCase.expected.summary,
      observedSummary: "Live smoke not enabled; set OPEN_METEO_LIVE_SMOKE=true to execute.",
    };
  }

  if (testCase.expected.classification === "known_gap") {
    return {
      caseId: testCase.id,
      mode: testCase.mode,
      classification: "known_gap",
      expectedSummary: testCase.expected.summary,
      observedSummary: observed?.summary ?? "Known current capability boundary recorded without runtime fix.",
      owner: testCase.expected.owner,
    };
  }

  if (!observed) {
    return {
      caseId: testCase.id,
      mode: testCase.mode,
      classification: "fail",
      expectedSummary: testCase.expected.summary,
      observedSummary: "No observed outcome was provided.",
    };
  }

  const statusMatches = observed.status === testCase.expected.status;
  const observedCode = getObservedCode(observed);
  const codeMatches = testCase.expected.code === undefined || observedCode === testCase.expected.code;

  return {
    caseId: testCase.id,
    mode: testCase.mode,
    classification: statusMatches && codeMatches ? "pass" : "fail",
    expectedSummary: testCase.expected.summary,
    observedSummary: summarizeObservedOutcome(observed),
  };
}

export function summarizeWeatherGoldenEvalResults(
  results: WeatherGoldenEvalResult[]
): WeatherGoldenEvalSummary {
  return results.reduce<WeatherGoldenEvalSummary>(
    (summary, result) => {
      summary.total += 1;
      if (result.classification === "pass") {
        summary.pass += 1;
      } else if (result.classification === "fail") {
        summary.fail += 1;
      } else if (result.classification === "known_gap") {
        summary.knownGap += 1;
      } else {
        summary.skipped += 1;
      }
      return summary;
    },
    { total: 0, pass: 0, fail: 0, knownGap: 0, skipped: 0 }
  );
}

export function sanitizeWeatherGoldenDiagnostics(value: unknown): unknown {
  return sanitizeDiagnosticValue(value, 0);
}

export function formatWeatherGoldenBaselineReport(results: WeatherGoldenEvalResult[]): string {
  const summary = summarizeWeatherGoldenEvalResults(results);
  const lines = [
    "# Weather Golden Eval Baseline Report",
    "",
    "## Summary",
    "",
    `- Total cases: ${summary.total}`,
    `- Pass: ${summary.pass}`,
    `- Fail: ${summary.fail}`,
    `- Known gaps: ${summary.knownGap}`,
    `- Skipped: ${summary.skipped}`,
    "",
    "## Case Results",
    "",
    "| Case | Mode | Classification | Owner | Observed |",
    "| --- | --- | --- | --- | --- |",
    ...results.map((result) =>
      [
        result.caseId,
        result.mode,
        result.classification,
        result.owner ?? "",
        escapeTableCell(result.observedSummary),
      ].join(" | ")
    ),
    "",
  ];

  return lines.join("\n");
}

function summarizeObservedOutcome(observed: WeatherGoldenObservedOutcome | WeatherToolResult): string {
  const observedCode = getObservedCode(observed);
  const code = observedCode ? ` code=${observedCode}` : "";
  const summary = observed.summary ? ` summary=${observed.summary}` : "";
  return `status=${observed.status ?? "unknown"}${code}${summary}`;
}

function getObservedCode(observed: WeatherGoldenObservedOutcome | WeatherToolResult): string | undefined {
  return "code" in observed ? observed.code : undefined;
}

function sanitizeDiagnosticValue(value: unknown, depth: number): unknown {
  if (depth > 4) {
    return "[truncated]";
  }

  if (typeof value === "string") {
    return sanitizeString(value);
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => sanitizeDiagnosticValue(entry, depth + 1));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
        key,
        isSensitiveDiagnosticKey(key) ? "[redacted]" : sanitizeDiagnosticValue(nestedValue, depth + 1),
      ])
    );
  }

  return value;
}

function sanitizeString(value: string): string {
  if (/\b(sk-|Bearer\s+|api[_-]?key|authorization|credential|secret|token)\b/i.test(value)) {
    return "[redacted]";
  }
  return value.length > 500 ? `${value.slice(0, 500)}...[truncated]` : value;
}

function isSensitiveDiagnosticKey(key: string): boolean {
  return /api[_-]?key|authorization|credential|password|prompt|secret|token|rawProviderBody/i.test(key);
}

function escapeTableCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}
