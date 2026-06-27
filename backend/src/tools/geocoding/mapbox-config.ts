import { z } from "zod";

import type {
  MapboxStorageMode,
  MapboxWorldview,
} from "./mapbox-provider.js";

const positiveIntegerFromEnvironment = (fallback: number) =>
  z.preprocess(
    (value) => (value === undefined || value === "" ? fallback : Number(value)),
    z.number().int().positive()
  );

const optionalWorldviewFromEnvironment = z.preprocess(
  (value) => (typeof value === "string" && value.trim() ? value.trim() : undefined),
  z.enum(["ar", "cn", "in", "jp", "ma", "rs", "ru", "tr", "us"]).optional()
);

const mapboxEnvironmentSchema = z
  .object({
    MAPBOX_ACCESS_TOKEN: z.string().trim().min(1),
    MAPBOX_GEOCODING_STORAGE_MODE: z
      .enum(["temporary", "permanent"])
      .default("temporary"),
    MAPBOX_WORLDVIEW: optionalWorldviewFromEnvironment,
    WEATHER_GEOCODING_TIMEOUT_MS: positiveIntegerFromEnvironment(5_000),
    WEATHER_GEOCODING_TOTAL_BUDGET_MS: positiveIntegerFromEnvironment(8_000),
    WEATHER_GEOCODING_MAX_QUERIES: positiveIntegerFromEnvironment(3),
    WEATHER_GEOCODING_MAX_ATTEMPTS: positiveIntegerFromEnvironment(4),
    WEATHER_GEOCODING_RATE_LIMIT_PER_INSTANCE_PER_MINUTE:
      positiveIntegerFromEnvironment(100),
    WEATHER_GEOCODING_MAX_CONCURRENCY: positiveIntegerFromEnvironment(10),
    WEATHER_GEOCODING_QUEUE_MAX: positiveIntegerFromEnvironment(100),
    WEATHER_GEOCODING_CIRCUIT_FAILURE_THRESHOLD:
      positiveIntegerFromEnvironment(5),
    WEATHER_GEOCODING_CIRCUIT_COOLDOWN_MS:
      positiveIntegerFromEnvironment(60_000),
  })
  .passthrough();

export type MapboxGeocodingConfig = {
  accessToken: string;
  storageMode: MapboxStorageMode;
  worldview?: MapboxWorldview;
  timeoutMs: number;
  totalBudgetMs: number;
  maxQueries: number;
  maxAttempts: number;
  rateLimitPerInstancePerMinute: number;
  maxConcurrency: number;
  queueMax: number;
  circuitFailureThreshold: number;
  circuitCooldownMs: number;
};

export class MapboxConfigurationError extends Error {
  readonly code = "weather_geocoding_configuration_error";

  constructor(message: string) {
    super(message);
    this.name = "MapboxConfigurationError";
  }
}

export function parseMapboxGeocodingConfig(
  environment: Record<string, string | undefined>
): MapboxGeocodingConfig {
  const parsed = mapboxEnvironmentSchema.safeParse(environment);
  if (!parsed.success) {
    const fields = [
      ...new Set(
        parsed.error.issues.map((issue) =>
          issue.path.length ? issue.path.join(".") : "Mapbox geocoding configuration"
        )
      ),
    ];
    throw new MapboxConfigurationError(
      `Invalid Mapbox geocoding configuration: ${fields.join(", ")}`
    );
  }

  return {
    accessToken: parsed.data.MAPBOX_ACCESS_TOKEN,
    storageMode: parsed.data.MAPBOX_GEOCODING_STORAGE_MODE,
    worldview: parsed.data.MAPBOX_WORLDVIEW,
    timeoutMs: parsed.data.WEATHER_GEOCODING_TIMEOUT_MS,
    totalBudgetMs: parsed.data.WEATHER_GEOCODING_TOTAL_BUDGET_MS,
    maxQueries: parsed.data.WEATHER_GEOCODING_MAX_QUERIES,
    maxAttempts: parsed.data.WEATHER_GEOCODING_MAX_ATTEMPTS,
    rateLimitPerInstancePerMinute:
      parsed.data.WEATHER_GEOCODING_RATE_LIMIT_PER_INSTANCE_PER_MINUTE,
    maxConcurrency: parsed.data.WEATHER_GEOCODING_MAX_CONCURRENCY,
    queueMax: parsed.data.WEATHER_GEOCODING_QUEUE_MAX,
    circuitFailureThreshold:
      parsed.data.WEATHER_GEOCODING_CIRCUIT_FAILURE_THRESHOLD,
    circuitCooldownMs:
      parsed.data.WEATHER_GEOCODING_CIRCUIT_COOLDOWN_MS,
  };
}
