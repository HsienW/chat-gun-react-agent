import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { getEnv } from "../platform/env.js";

type GeocodingResult = {
  name: string;
  country?: string;
  country_code?: string;
  admin1?: string;
  admin2?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
  population?: number;
};

type GeocodingResponse = {
  results?: GeocodingResult[];
};

type ForecastResponse = {
  latitude: number;
  longitude: number;
  timezone: string;
  current?: Record<string, number | string>;
  current_units?: Record<string, string>;
};

type LocationAlias = {
  query: string;
  country?: string;
  region?: string;
};

type LocationResolutionInput = {
  location: string;
  country?: string;
  region?: string;
};

type ResolvedLocationQuery = Required<Pick<LocationResolutionInput, "location">> &
  Pick<LocationResolutionInput, "country" | "region">;

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeComparable(value: string | undefined): string {
  return normalizeKey(value ?? "")
    .replaceAll("臺", "台")
    .replaceAll("台湾", "台灣");
}

function loadConfiguredAliases(): Record<string, LocationAlias> {
  const raw = getEnv("WEATHER_LOCATION_ALIASES_JSON");
  if (!raw.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).flatMap(([key, value]) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          return [];
        }

        const alias = value as Partial<LocationAlias>;
        if (typeof alias.query !== "string" || !alias.query.trim()) {
          return [];
        }

        return [
          [
            normalizeKey(key),
            {
              query: alias.query.trim(),
              country: typeof alias.country === "string" ? alias.country : undefined,
              region: typeof alias.region === "string" ? alias.region : undefined,
            },
          ],
        ];
      })
    );
  } catch {
    return {};
  }
}

function getConfiguredAlias(location: string): LocationAlias | undefined {
  return loadConfiguredAliases()[normalizeKey(location)];
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    const key = normalizeKey(trimmed);
    if (!trimmed || seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(trimmed);
  }
  return output;
}

function buildLocationQueries(input: LocationResolutionInput): ResolvedLocationQuery[] {
  const configuredAlias = getConfiguredAlias(input.location);
  const base: LocationResolutionInput = configuredAlias
    ? {
        location: configuredAlias.query,
        country: input.country ?? configuredAlias.country,
        region: input.region ?? configuredAlias.region,
      }
    : input;

  const variants = unique([
    base.location,
    base.country ? `${base.location} ${base.country}` : "",
    base.country ? `${base.location}, ${base.country}` : "",
    base.region ? `${base.location} ${base.region}` : "",
    base.region ? `${base.location}, ${base.region}` : "",
    base.location.replaceAll("臺", "台"),
    base.location.replaceAll("台", "臺"),
    base.location.replace(/[市縣县區区]$/u, ""),
  ]);

  return variants.map((location) => ({
    location,
    country: base.country,
    region: base.region,
  }));
}

function matchesText(value: string | undefined, expected: string | undefined): boolean {
  if (!expected) {
    return false;
  }
  return normalizeComparable(value).includes(normalizeComparable(expected));
}

function countryMatches(candidate: GeocodingResult, expectedCountry: string | undefined): boolean {
  if (!expectedCountry) {
    return false;
  }

  const expected = normalizeComparable(expectedCountry);
  const countryCode = normalizeComparable(candidate.country_code);

  if (expected.length === 2 && expected === countryCode) {
    return true;
  }

  if (matchesText(candidate.country, expectedCountry)) {
    return true;
  }

  const candidateCountryCode = candidate.country_code;
  if (!candidateCountryCode) {
    return false;
  }

  const displayNames = ["en", "zh-Hant", "zh-Hans"].flatMap((locale) => {
    const displayName = new Intl.DisplayNames([locale], { type: "region" });
    const name = displayName.of(candidateCountryCode);
    return name ? [name] : [];
  });

  return displayNames.some((name) => normalizeComparable(name) === expected);
}

function scoreCandidate(candidate: GeocodingResult, input: ResolvedLocationQuery): number {
  const normalizedQuery = normalizeComparable(input.location);
  let score = 0;

  if (normalizeComparable(candidate.name) === normalizedQuery) {
    score += 40;
  } else if (matchesText(candidate.name, input.location)) {
    score += 20;
  }

  if (countryMatches(candidate, input.country)) {
    score += 35;
  }

  if (matchesText(candidate.admin1, input.region) || matchesText(candidate.admin2, input.region)) {
    score += 25;
  }

  if (candidate.population !== undefined) {
    score += Math.min(Math.log10(Math.max(candidate.population, 1)), 8);
  }

  return score;
}

function formatCandidate(candidate: GeocodingResult): string {
  return [candidate.name, candidate.admin2, candidate.admin1, candidate.country]
    .filter(Boolean)
    .join(", ");
}

function chooseBestCandidate(
  candidates: Array<{ candidate: GeocodingResult; query: ResolvedLocationQuery }>,
  originalInput: LocationResolutionInput
): GeocodingResult {
  const countryFilteredCandidates = originalInput.country
    ? candidates.filter((entry) => countryMatches(entry.candidate, originalInput.country))
    : candidates;

  if (originalInput.country && countryFilteredCandidates.length === 0) {
    const options = candidates
      .slice(0, 5)
      .map((entry) => formatCandidate(entry.candidate))
      .join("; ");
    throw new Error(
      `No geocoding result matched country "${originalInput.country}" for location "${originalInput.location}". Try an English place name or provide a more specific region. Candidates: ${options}`
    );
  }

  const scored = countryFilteredCandidates
    .map((entry) => ({
      candidate: entry.candidate,
      score: scoreCandidate(entry.candidate, entry.query),
    }))
    .sort((left, right) => right.score - left.score);
  const best = scored[0];
  const second = scored[1];
  const hasContext = Boolean(originalInput.country || originalInput.region);

  if (!best) {
    throw new Error(`Location not found: ${originalInput.location}`);
  }

  if (!hasContext && second && best.score - second.score < 8) {
    const options = scored
      .slice(0, 5)
      .map((entry) => formatCandidate(entry.candidate))
      .join("; ");
    throw new Error(
      `Location "${originalInput.location}" is ambiguous. Please provide country or region. Candidates: ${options}`
    );
  }

  return best.candidate;
}

function describeWeatherCode(code: number | undefined): string {
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

function describeWindDirection(degrees: number | undefined): string {
  if (degrees === undefined || Number.isNaN(degrees)) {
    return "unknown";
  }

  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const index = Math.round((((degrees % 360) + 360) % 360) / 45) % 8;
  return directions[index];
}

async function fetchJson<T>(url: URL): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

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
  } finally {
    clearTimeout(timeout);
  }
}

async function geocodeLocation(query: ResolvedLocationQuery): Promise<GeocodingResult[]> {
  const geocodingUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
  geocodingUrl.searchParams.set("name", query.location);
  geocodingUrl.searchParams.set("count", "5");
  geocodingUrl.searchParams.set("language", "zh");
  geocodingUrl.searchParams.set("format", "json");

  const geocoding = await fetchJson<GeocodingResponse>(geocodingUrl);
  return geocoding.results ?? [];
}

async function resolveLocation(input: LocationResolutionInput): Promise<GeocodingResult> {
  const queries = buildLocationQueries(input);
  const candidates: Array<{ candidate: GeocodingResult; query: ResolvedLocationQuery }> = [];
  const seen = new Set<string>();

  for (const query of queries) {
    const results = await geocodeLocation(query);
    for (const candidate of results) {
      const key = `${candidate.latitude}:${candidate.longitude}:${candidate.name}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      candidates.push({ candidate, query });
    }
  }

  return chooseBestCandidate(candidates, input);
}

function numberValue(
  current: Record<string, number | string>,
  key: string
): number | undefined {
  const value = current[key];
  return typeof value === "number" ? value : undefined;
}

export const weatherTool = tool(
  async ({ location, country, region }) => {
    try {
      const place = await resolveLocation({ location, country, region });
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

      const forecast = await fetchJson<ForecastResponse>(forecastUrl);
      const current = forecast.current;

      if (!current) {
        throw new Error("Open-Meteo did not return current weather data.");
      }

      const units = forecast.current_units ?? {};
      const weatherCode = numberValue(current, "weather_code");
      const windDirection = numberValue(current, "wind_direction_10m");
      const sourceUrl = forecastUrl.toString();
      const displayName = formatCandidate(place);

      return [
        "Provider: Open-Meteo current weather API",
        "Data scope: latest current weather observation, not a full-day forecast.",
        `Resolved location: ${displayName} (${forecast.latitude}, ${forecast.longitude})`,
        `Observation time: ${String(current.time)}, timezone: ${forecast.timezone}`,
        `Condition: ${describeWeatherCode(weatherCode)} (code ${weatherCode ?? "unknown"})`,
        `Temperature: ${current.temperature_2m}${units.temperature_2m ?? ""}`,
        `Feels like: ${current.apparent_temperature}${units.apparent_temperature ?? ""}`,
        `Humidity: ${current.relative_humidity_2m}${units.relative_humidity_2m ?? ""}`,
        `Precipitation: ${current.precipitation}${units.precipitation ?? ""}`,
        `Rain: ${current.rain}${units.rain ?? ""}`,
        `Cloud cover: ${current.cloud_cover}${units.cloud_cover ?? ""}`,
        `Wind: ${current.wind_speed_10m}${units.wind_speed_10m ?? ""}, direction ${describeWindDirection(windDirection)} (${windDirection ?? "unknown"}${units.wind_direction_10m ?? ""})`,
        `Wind gusts: ${current.wind_gusts_10m}${units.wind_gusts_10m ?? ""}`,
        `Pressure: ${current.pressure_msl}${units.pressure_msl ?? ""}`,
        `Source URL: ${sourceUrl}`,
      ].join("\n");
    } catch (error) {
      return `Error: current_weather failed - ${
        error instanceof Error ? error.message : String(error)
      }`;
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
    }),
  }
);
