import { z } from "zod";

const planningBaseShape = {
  schemaVersion: z.literal(2),
  question: z.string().min(1),
  rationale: z.string(),
};

const weatherTimeRangeSchema = z
  .object({
    kind: z.enum(["now", "today", "tonight", "tomorrow", "weekend", "date_range"]),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    timezone: z.string().optional(),
    granularity: z.enum(["hourly", "daily"]).optional(),
  })
  .strict();

const directPlanningSchema = z
  .object({
    ...planningBaseShape,
    kind: z.literal("direct"),
  })
  .strict();

const weatherPlanningSchema = z
  .object({
    ...planningBaseShape,
    kind: z.literal("weather"),
    weather: z
      .object({
        rawLocation: z.string().trim().min(1).max(160),
        country: z.string().trim().min(1).max(128).optional(),
        region: z.string().trim().min(1).max(128).optional(),
        weatherCapability: z.enum(["current", "hourly", "daily"]),
        timeRange: weatherTimeRangeSchema.optional(),
        units: z.literal("metric"),
        locale: z.string().trim().min(1).max(64).optional(),
      })
      .strict(),
  })
  .strict();

const calculationPlanningSchema = z
  .object({
    ...planningBaseShape,
    kind: z.literal("calculation"),
    calculation: z
      .object({
        expression: z.string().trim().min(1),
      })
      .strict(),
  })
  .strict();

const researchPlanningSchema = z
  .object({
    ...planningBaseShape,
    kind: z.literal("research"),
    queries: z.array(z.string().trim().min(1)).min(1).max(5),
    urls: z.array(z.string().url()).max(5),
    freshness: z.enum(["pd", "pw", "pm", "py"]).optional(),
    requiredSourceCount: z.number().int().min(1).max(8),
  })
  .strict();

const missingLocationPlanningSchema = z
  .object({
    ...planningBaseShape,
    kind: z.literal("missing_location"),
    clarification: z.string().trim().min(1),
  })
  .strict();

const clarificationPlanningSchema = z
  .object({
    ...planningBaseShape,
    kind: z.literal("clarify"),
    reason: z.enum(["missing_calculation", "insufficient_context"]),
    clarification: z.string().trim().min(1),
  })
  .strict();

const extractionErrorPlanningSchema = z
  .object({
    ...planningBaseShape,
    kind: z.literal("extraction_error"),
    errorCode: z.enum([
      "planner_parse_error",
      "planner_schema_rejected",
      "planner_invoke_error",
      "planner_model_refusal",
      "planner_capability_unsupported",
    ]),
    retryable: z.boolean(),
  })
  .strict();

export const planningResultV2Schema = z.discriminatedUnion("kind", [
  directPlanningSchema,
  weatherPlanningSchema,
  calculationPlanningSchema,
  researchPlanningSchema,
  missingLocationPlanningSchema,
  clarificationPlanningSchema,
  extractionErrorPlanningSchema,
]);

export type PlanningResultV2 = z.infer<typeof planningResultV2Schema>;
export type PlanningResultV2Route = "synthesize" | "targeted_tools" | "search_web";

export function parsePlanningResultV2(value: unknown): PlanningResultV2 {
  return planningResultV2Schema.parse(value);
}

export function safeParsePlanningResultV2(value: unknown) {
  return planningResultV2Schema.safeParse(value);
}

export function routePlanningResultV2(
  planningResult: Pick<PlanningResultV2, "kind">
): PlanningResultV2Route {
  switch (planningResult.kind) {
    case "weather":
    case "calculation":
      return "targeted_tools";
    case "research":
      return "search_web";
    case "direct":
    case "missing_location":
    case "clarify":
    case "extraction_error":
      return "synthesize";
  }
}
