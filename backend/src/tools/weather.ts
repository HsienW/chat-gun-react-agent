import { tool } from "@langchain/core/tools";
import type { RunnableConfig } from "@langchain/core/runnables";
import { z } from "zod";

import {
  createErrorEnvelope,
  parseErrorEnvelope,
  serializeErrorEnvelope,
} from "../platform/errors.js";
import { auditLogger, recordMetric } from "../platform/observability.js";
import { configureNetwork } from "../platform/network.js";

import { OpenMeteoGeocodingProvider } from "./geocoding/open-meteo-provider.js";
import { resolveLocation, DEFAULT_RESOLVER_OPTIONS } from "./geocoding/location-resolver.js";
import { buildLocationQuery, validateLocationInput } from "./geocoding/location-normalizer.js";
import type {
  LocationCandidate,
  LocationQuery,
  ResolutionStrategy,
  WeatherToolResult,
} from "./weather-types.js";

configureNetwork();

type ForecastResponse = {
  latitude: number;
  longitude: number;
  timezone: string;
  current?: Record<string, number | string>;
  current_units?: Record<string, string>;
};

type WeatherConfig = {
  structuredResultEnabled: boolean;
  locationMaxChars: number;
  geocodingMaxQueries: number;
  geocodingMaxCandidates: number;
  geocodingMinScore: number;
  geocodingAmbiguityDelta: number;
  geocodingTimeoutMs: number;
  forecastTimeoutMs: number;
  forceGeocodingError: boolean;
  forceForecastError: boolean;
};

function readPositiveNumberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function isProductionRuntime(): boolean {
  const values = [process.env.NODE_ENV, process.env.APP_ENV].filter(Boolean);
  return values.some((value) => /^(production|prod)$/i.test(String(value)));
}

function readNonProductionBooleanEnv(name: string): boolean {
  return !isProductionRuntime() && (process.env[name] ?? "").toLowerCase() === "true";
}

export function getWeatherConfig(): WeatherConfig {
  return {
    structuredResultEnabled: (process.env.WEATHER_STRUCTURED_RESULT_ENABLED ?? "true") === "true",
    locationMaxChars: readPositiveNumberEnv("WEATHER_LOCATION_MAX_CHARS", 160),
    geocodingMaxQueries: readPositiveNumberEnv("WEATHER_GEOCODING_MAX_QUERIES", 6),
    geocodingMaxCandidates: readPositiveNumberEnv("WEATHER_GEOCODING_MAX_CANDIDATES", 10),
    geocodingMinScore: readPositiveNumberEnv("WEATHER_GEOCODING_MIN_SCORE", 35),
    geocodingAmbiguityDelta: readPositiveNumberEnv("WEATHER_GEOCODING_AMBIGUITY_DELTA", 8),
    geocodingTimeoutMs: readPositiveNumberEnv("WEATHER_GEOCODING_TIMEOUT_MS", 5_000),
    forecastTimeoutMs: readPositiveNumberEnv("WEATHER_FORECAST_TIMEOUT_MS", 8_000),
    forceGeocodingError: readNonProductionBooleanEnv("WEATHER_TEST_FORCE_GEOCODING_ERROR"),
    forceForecastError: readNonProductionBooleanEnv("WEATHER_TEST_FORCE_FORECAST_ERROR"),
  };
}

function getRunnableSignal(config: RunnableConfig | undefined): AbortSignal | undefined {
  const maybeSignal = (config as { signal?: unknown } | undefined)?.signal;
  return maybeSignal instanceof AbortSignal ? maybeSignal : undefined;
}

function isCancelError(message: string): boolean {
  return message === "weather_fetch_cancelled" || message === "weather_geocoding_cancelled";
}

function isTimeoutError(message: string): boolean {
  return message === "weather_fetch_timeout" || message === "weather_geocoding_timeout" || message.includes("timeout");
}

export function describeWeatherCode(code: number | undefined): string {
  switch (code) {
    case 0:
      return "clear sky";
    case 1:
    case 2:
    case 3:
      return "mainly clear, partly cloudy, or overcast";
    case 45:
    case 48:
      return "fog";
    case 51:
    case 53:
    case 55:
      return "drizzle";
    case 56:
    case 57:
      return "freezing drizzle";
    case 61:
    case 63:
    case 65:
      return "rain";
    case 66:
    case 67:
      return "freezing rain";
    case 71:
    case 73:
    case 75:
      return "snowfall";
    case 77:
      return "snow grains";
    case 80:
    case 81:
    case 82:
      return "rain showers";
    case 85:
    case 86:
      return "snow showers";
    case 95:
      return "thunderstorm";
    case 96:
    case 99:
      return "thunderstorm with hail";
    default:
      return "unknown weather condition";
  }
}

export function describeWindDirection(degrees: number | undefined): string {
  if (degrees === undefined || Number.isNaN(degrees)) {
    return "unknown";
  }

  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const index = Math.round((((degrees % 360) + 360) % 360) / 45) % 8;
  return directions[index];
}

/**
 * Fetch JSON with real AbortSignal support — Task 4.10
 * Uses AbortController with timeout, not just Promise.race.
 */
async function fetchJsonWithTimeout<T>(url: URL, timeoutMs: number, externalSignal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // Merge external signal
  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timeoutId);
      throw new Error("weather_fetch_cancelled");
    }
    externalSignal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeoutId);
        controller.abort();
      },
      { once: true }
    );
  }

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "chat-gun-react-agent/0.1",
      },
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      if (externalSignal?.aborted) {
        throw new Error("weather_fetch_cancelled");
      }
      throw new Error("weather_fetch_timeout");
    }
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("fetch failed") || message.includes("aborted")) {
      // Proxy hint goes only to audit log, NOT to user-facing error message — M2 fix
      const proxyConfigured = Boolean(process.env.HTTPS_PROXY || process.env.HTTP_PROXY);
      if (proxyConfigured) {
        console.warn("[weather] Proxy configured but request failed for", url.hostname);
      }
      throw new Error(
        `Weather provider network request failed for ${url.hostname}.`
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Retry a fetch once for temporary errors — Task 4.11, 4.12
 */
async function fetchWithRetry<T>(url: URL, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  const maxAttempts = 2; // Initial + 1 retry
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fetchJsonWithTimeout<T>(url, timeoutMs, signal);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const message = lastError.message;

      // Only retry temporary/provider errors — Task 4.12
      const isRetryable =
        message.includes("429") ||
        message.includes("502") ||
        message.includes("503") ||
        message.includes("504") ||
        message === "weather_fetch_timeout" ||
        message === "weather_geocoding_timeout" ||
        message.includes("fetch failed") ||
        message.includes("econnrefused") ||
        message.includes("econnreset");

      if (isCancelError(message) || !isRetryable || attempt >= maxAttempts) {
        throw lastError;
      }

      // Bounded backoff: 250ms + jitter
      await new Promise((resolve) =>
        setTimeout(resolve, 250 + Math.random() * 250)
      );
      await recordMetric("weather.provider.retry", {
        url: url.hostname,
        attempt,
        error: message,
      });
    }
  }

  throw lastError ?? new Error("Retry exhausted");
}

function numberValue(
  current: Record<string, number | string>,
  key: string
): number | undefined {
  const value = current[key];
  return typeof value === "number" ? value : undefined;
}

function formatFallbackText(candidate: LocationCandidate): string {
  return [candidate.name, candidate.admin2, candidate.admin1, candidate.country]
    .filter(Boolean)
    .join(", ");
}

/**
 * Build the structured WeatherToolResult for a successful forecast — Task 4.3, 4.9
 */
function buildSuccessResult(
  query: LocationQuery,
  candidate: LocationCandidate,
  forecast: ForecastResponse,
  sourceUrl: string
): WeatherToolResult {
  const current = forecast.current ?? {};
  const units = forecast.current_units ?? {};
  const weatherCode = numberValue(current, "weather_code");
  const windDirection = numberValue(current, "wind_direction_10m");
  const displayName = formatFallbackText(candidate);

  return {
    schemaVersion: "1.0",
    tool: "current_weather",
    status: "success",
    requestedLocation: query,
    resolvedLocation: candidate,
    observedAt: String(current.time ?? ""),
    timezone: forecast.timezone,
    current: {
      conditionCode: weatherCode,
      conditionText: describeWeatherCode(weatherCode),
      temperature: numberValue(current, "temperature_2m"),
      apparentTemperature: numberValue(current, "apparent_temperature"),
      relativeHumidity: numberValue(current, "relative_humidity_2m"),
      precipitation: numberValue(current, "precipitation"),
      rain: numberValue(current, "rain"),
      cloudCover: numberValue(current, "cloud_cover"),
      pressureMsl: numberValue(current, "pressure_msl"),
      windSpeed: numberValue(current, "wind_speed_10m"),
      windDirectionDegrees: windDirection,
      windDirectionText: describeWindDirection(windDirection),
      windGusts: numberValue(current, "wind_gusts_10m"),
    },
    units: units as Record<string, string>,
    provider: "Open-Meteo",
    sourceUrl,
    summary: [
      `Current weather for ${displayName}: ${current.temperature_2m ?? "?"}${units.temperature_2m ?? ""}, ${describeWeatherCode(weatherCode)}.`,
      `Observed at ${String(current.time ?? "")}.`,
    ].join(" "),
  };
}

/**
 * Build a legacy text output from structured result — for backward compatibility
 * during the WEATHER_STRUCTURED_RESULT_ENABLED transition period.
 */
function formatLegacyText(result: WeatherToolResult): string {
  if (result.status === "success") {
    const { current, resolvedLocation } = result;
    const displayName = formatFallbackText(resolvedLocation);
    const lines = [
      "Provider: Open-Meteo current weather API",
      "Data scope: latest current weather observation, not a full-day forecast.",
      `Resolved location: ${displayName} (${resolvedLocation.latitude}, ${resolvedLocation.longitude})`,
      `Observation time: ${result.observedAt}, timezone: ${result.timezone}`,
      `Condition: ${current.conditionText} (code ${current.conditionCode ?? "unknown"})`,
      `Temperature: ${current.temperature ?? "?"}${result.units.temperature_2m ?? ""}`,
    ];
    if (current.apparentTemperature !== undefined) {
      lines.push(`Feels like: ${current.apparentTemperature}${result.units.apparent_temperature ?? ""}`);
    }
    if (current.relativeHumidity !== undefined) {
      lines.push(`Humidity: ${current.relativeHumidity}${result.units.relative_humidity_2m ?? ""}`);
    }
    if (current.precipitation !== undefined) {
      lines.push(`Precipitation: ${current.precipitation}${result.units.precipitation ?? ""}`);
    }
    if (current.rain !== undefined) {
      lines.push(`Rain: ${current.rain}${result.units.rain ?? ""}`);
    }
    if (current.cloudCover !== undefined) {
      lines.push(`Cloud cover: ${current.cloudCover}${result.units.cloud_cover ?? ""}`);
    }
    lines.push(`Wind: ${current.windSpeed ?? "?"}${result.units.wind_speed_10m ?? ""}, direction ${current.windDirectionText} (${current.windDirectionDegrees ?? "unknown"}${result.units.wind_direction_10m ?? ""})`);
    if (current.windGusts !== undefined) {
      lines.push(`Wind gusts: ${current.windGusts}${result.units.wind_gusts_10m ?? ""}`);
    }
    if (current.pressureMsl !== undefined) {
      lines.push(`Pressure: ${current.pressureMsl}${result.units.pressure_msl ?? ""}`);
    }
    lines.push(`Source URL: ${result.sourceUrl}`);
    return lines.join("\n");
  }

  if (result.status === "needs_clarification") {
    return result.summary;
  }

  if (result.status === "not_found") {
    return result.summary;
  }

  // error
  return result.summary;
}

export const weatherTool = tool(
  async ({ location, country, region, resolutionStrategy, raw }, config?: RunnableConfig) => {
    const startTime = Date.now();
    const weatherConfig = getWeatherConfig();
    const runSignal = getRunnableSignal(config);
    const geocodingProvider = new OpenMeteoGeocodingProvider(weatherConfig.geocodingTimeoutMs);
    const strategy: ResolutionStrategy | undefined =
      resolutionStrategy === "llm_repair" ? "llm_repair" : undefined;

    // Validate input
    const validationError = validateLocationInput(location, weatherConfig.locationMaxChars);
    if (validationError) {
      const result: WeatherToolResult = {
        schemaVersion: "1.0",
        tool: "current_weather",
        status: "error",
        requestedLocation: { raw: location ?? "", location: location ?? "" },
        code: "weather_invalid_input",
        retryable: false,
        message: validationError,
        summary: "Invalid location input. Please provide a valid city or place name.",
      };
      await auditLogger.record("weather.location.resolve.start", {
        error: "invalid_input",
        location,
      });
      return weatherConfig.structuredResultEnabled
        ? JSON.stringify(result)
        : formatLegacyText(result);
    }

    // Build the query
    const query = {
      ...buildLocationQuery(location, country, region),
      raw: typeof raw === "string" && raw.trim() ? raw : location,
    };
    await auditLogger.record("weather.location.resolve.start", {
      raw: query.raw,
      location: query.location,
      country: query.country,
    });

    if (weatherConfig.forceGeocodingError) {
      const result: WeatherToolResult = {
        schemaVersion: "1.0",
        tool: "current_weather",
        status: "error",
        requestedLocation: query,
        code: "weather_geocoding_provider_error",
        retryable: true,
        message: "Forced geocoding provider error for non-production manual verification.",
        summary: "Weather geocoding service is temporarily unavailable.",
      };
      await recordMetric("weather.location.resolve.failure.count", { count: 1 });
      await auditLogger.record("weather.location.resolve.failure", {
        raw: query.raw,
        code: "weather_geocoding_provider_error",
        forced: true,
        durationMs: Date.now() - startTime,
      });
      return weatherConfig.structuredResultEnabled
        ? JSON.stringify(result)
        : formatLegacyText(result);
    }

    // Resolve location through the geocoding pipeline
    let resolutionResult;
    try {
      resolutionResult = await resolveLocation(query, geocodingProvider, {
        ...DEFAULT_RESOLVER_OPTIONS,
        minScore: weatherConfig.geocodingMinScore,
        ambiguityDelta: weatherConfig.geocodingAmbiguityDelta,
        maxCandidates: weatherConfig.geocodingMaxCandidates,
        maxQueries: weatherConfig.geocodingMaxQueries,
        signal: runSignal,
        strategy,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const result: WeatherToolResult = {
        schemaVersion: "1.0",
        tool: "current_weather",
        status: "error",
        requestedLocation: query,
        code: isCancelError(errorMessage)
          ? "weather_cancelled"
          : isTimeoutError(errorMessage)
            ? "weather_timeout"
            : "weather_geocoding_provider_error",
        retryable: !isCancelError(errorMessage) && isTimeoutError(errorMessage),
        message: errorMessage,
        summary: isCancelError(errorMessage)
          ? "Weather lookup was cancelled."
          : "Weather service temporarily unavailable. Please try again.",
      };
      await recordMetric("weather.location.resolve.failure.count", { count: 1 });
      return weatherConfig.structuredResultEnabled
        ? JSON.stringify(result)
        : formatLegacyText(result);
    }

    // Handle non-resolved statuses
    if (resolutionResult.status === "ambiguous") {
      const candidates = resolutionResult.candidates.slice(0, 5).map((c) => ({
        name: c.name,
        displayName: c.displayName,
        country: c.country,
        countryCode: c.countryCode,
        admin1: c.admin1,
        admin2: c.admin2,
      }));
      const result: WeatherToolResult = {
        schemaVersion: "1.0",
        tool: "current_weather",
        status: "needs_clarification",
        requestedLocation: query,
        candidates,
        message: `Location "${query.location}" is ambiguous. Please provide a more specific location with country or region.`,
        summary: `Location "${query.location}" matches multiple candidates. Please specify a country or region.`,
      };
      await recordMetric("weather.location.resolve.ambiguous.count", { count: 1 });
      await auditLogger.record("weather.location.resolve.ambiguous", {
        raw: query.raw,
        candidateCount: candidates.length,
        durationMs: Date.now() - startTime,
      });
      return weatherConfig.structuredResultEnabled
        ? JSON.stringify(result)
        : `Location "${query.location}" is ambiguous. Candidates: ${candidates.map((c) => c.displayName).join("; ")}`;
    }

    if (resolutionResult.status === "not_found") {
      const result: WeatherToolResult = {
        schemaVersion: "1.0",
        tool: "current_weather",
        status: "not_found",
        requestedLocation: query,
        code: "weather_location_not_found",
        message: `Could not find location "${query.location}". Please provide a more specific location.`,
        summary: `Could not find "${query.location}". Please provide a more specific location.`,
        attemptedQueries: resolutionResult.attemptedQueries,
      };
      await recordMetric("weather.location.resolve.not_found.count", { count: 1 });
      await auditLogger.record("weather.location.resolve.not_found", {
        raw: query.raw,
        attemptedQueries: resolutionResult.attemptedQueries,
        durationMs: Date.now() - startTime,
      });
      return weatherConfig.structuredResultEnabled
        ? JSON.stringify(result)
        : `Location not found: ${query.location}. Please provide a more specific location.`;
    }

    if (resolutionResult.status === "provider_error") {
      const result: WeatherToolResult = {
        schemaVersion: "1.0",
        tool: "current_weather",
        status: "error",
        requestedLocation: query,
        code: resolutionResult.code === "weather_geocoding_cancelled"
          ? "weather_cancelled"
          : resolutionResult.code === "weather_geocoding_timeout"
            ? "weather_timeout"
            : "weather_geocoding_provider_error",
        retryable: resolutionResult.retryable,
        message: `Geocoding provider error: ${resolutionResult.code}`,
        summary: resolutionResult.code === "weather_geocoding_cancelled"
          ? "Weather lookup was cancelled."
          : "Weather service temporarily unavailable. Please try again.",
      };
      await recordMetric("weather.location.resolve.failure.count", { count: 1 });
      await auditLogger.record("weather.location.resolve.failure", {
        raw: query.raw,
        code: resolutionResult.code,
        durationMs: Date.now() - startTime,
      });
      return weatherConfig.structuredResultEnabled
        ? JSON.stringify(result)
        : "Weather geocoding service is temporarily unavailable. Please try again later.";
    }

    // Resolved — fetch forecast
    const place = resolutionResult.candidate;
    if (weatherConfig.forceForecastError) {
      const result: WeatherToolResult = {
        schemaVersion: "1.0",
        tool: "current_weather",
        status: "error",
        requestedLocation: query,
        code: "weather_forecast_provider_error",
        retryable: true,
        message: "Forced forecast provider error for non-production manual verification.",
        summary: "Weather forecast service is temporarily unavailable.",
      };
      await recordMetric("weather.provider.forecast.failure.count", { count: 1 });
      await auditLogger.record("weather.provider.forecast.failure", {
        raw: query.raw,
        error: "weather_forecast_provider_error",
        forced: true,
        durationMs: Date.now() - startTime,
      });
      return weatherConfig.structuredResultEnabled
        ? JSON.stringify(result)
        : formatLegacyText(result);
    }

    const forecastUrl = new URL("https://api.open-meteo.com/v1/forecast");
    forecastUrl.searchParams.set("latitude", String(place.latitude));
    forecastUrl.searchParams.set("longitude", String(place.longitude));
    forecastUrl.searchParams.set(
      "current",
      [
        "temperature_2m",
        "relative_humidity_2m",
        "apparent_temperature",
        "is_day",
        "precipitation",
        "rain",
        "weather_code",
        "cloud_cover",
        "pressure_msl",
        "wind_speed_10m",
        "wind_direction_10m",
        "wind_gusts_10m",
      ].join(",")
    );
    forecastUrl.searchParams.set("timezone", place.timezone ?? "auto");

    try {
      const forecast = await fetchWithRetry<ForecastResponse>(
        forecastUrl,
        weatherConfig.forecastTimeoutMs,
        runSignal
      );
      const current = forecast.current;

      if (!current) {
        const result: WeatherToolResult = {
          schemaVersion: "1.0",
          tool: "current_weather",
          status: "error",
          requestedLocation: query,
          code: "weather_forecast_provider_error",
          retryable: false,
          message: "Open-Meteo did not return current weather data.",
          summary: "Weather service did not return data for this location.",
        };
        return weatherConfig.structuredResultEnabled
          ? JSON.stringify(result)
          : "Weather forecast API did not return current weather data.";
      }

      const result = buildSuccessResult(query, place, forecast, forecastUrl.toString());

      await recordMetric("weather.location.resolve.success.count", { count: 1 });
      await recordMetric("weather.provider.forecast.duration_ms", {
        durationMs: Date.now() - startTime,
      });
      await auditLogger.record("weather.location.resolve.success", {
        raw: query.raw,
        provider: place.provider,
        strategy: resolutionResult.strategy,
        candidateCount: 1,
        durationMs: Date.now() - startTime,
      });

      return weatherConfig.structuredResultEnabled
        ? JSON.stringify(result)
        : formatLegacyText(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const result: WeatherToolResult = {
        schemaVersion: "1.0",
        tool: "current_weather",
        status: "error",
        requestedLocation: query,
        code: isCancelError(errorMessage)
          ? "weather_cancelled"
          : isTimeoutError(errorMessage)
          ? "weather_timeout"
          : "weather_forecast_provider_error",
        retryable: !isCancelError(errorMessage) && (isTimeoutError(errorMessage) || errorMessage.includes("fetch failed")),
        message: errorMessage,
        summary: isCancelError(errorMessage)
          ? "Weather lookup was cancelled."
          : "Weather forecast service is temporarily unavailable.",
      };
      await recordMetric("weather.provider.forecast.failure.count", { count: 1 });
      await auditLogger.record("weather.provider.forecast.failure", {
        raw: query.raw,
        error: errorMessage,
        durationMs: Date.now() - startTime,
      });
      return weatherConfig.structuredResultEnabled
        ? JSON.stringify(result)
        : "Weather forecast service is temporarily unavailable.";
    }
  },
  {
    name: "current_weather",
    description:
      "Get real-time current weather for a city or location using Open-Meteo. Use this for current weather, temperature, humidity, rain, wind, or forecast questions. Provide country or region when the location is ambiguous. The tool does not contain built-in city aliases; pass the most geocoding-friendly place name you can infer.",
    schema: z.object({
      location: z.string().min(1).describe("City or location name."),
      country: z
        .string()
        .optional()
        .describe("Optional country hint, for example 'Taiwan', 'Japan', or 'United States'."),
      region: z
        .string()
        .optional()
        .describe("Optional state, province, or administrative region hint, for example 'New York'."),
      resolutionStrategy: z
        .enum(["llm_repair"])
        .optional()
        .describe("Internal marker for one-time LLM repair; callers should normally omit this."),
      raw: z
        .string()
        .optional()
        .describe("Internal original user location text preserved across one-time repair."),
    }),
  }
);
