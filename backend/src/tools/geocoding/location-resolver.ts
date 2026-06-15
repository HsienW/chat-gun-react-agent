// Location Resolver — Task 3.4, 3.5, 3.6, 3.7, 3.8, 3.9
// Orchestrates location resolution: takes a LocationQuery, runs query variants
// through a GeocodingProvider, deduplicates, scores, and returns a deterministic result.

import {
  GeocodingProvider,
  LocationCandidate,
  LocationQuery,
  LocationResolutionResult,
  ResolutionStrategy,
} from "../weather-types.js";
import { buildGeocodingQueryVariants } from "./location-normalizer.js";

export type ResolverOptions = {
  /** Minimum score for a candidate to be considered "found" */
  minScore: number;
  /** Score difference below which ambiguity is declared */
  ambiguityDelta: number;
  /** Maximum number of candidates to return in ambiguous results */
  maxCandidates: number;
  /** Maximum number of query variants to try */
  maxQueries: number;
  /** External cancellation signal propagated from the agent run */
  signal?: AbortSignal;
  /** Override result strategy, used for one-time LLM repair attempts */
  strategy?: ResolutionStrategy;
};

export const DEFAULT_RESOLVER_OPTIONS: ResolverOptions = {
  minScore: 35,
  ambiguityDelta: 8,
  maxCandidates: 5,
  maxQueries: 6,
};

/**
 * Resolve a location query using a geocoding provider.
 * Task 3.7 — returns one of four statuses.
 */
export async function resolveLocation(
  query: LocationQuery,
  provider: GeocodingProvider,
  options: ResolverOptions = DEFAULT_RESOLVER_OPTIONS
): Promise<LocationResolutionResult> {
  const variants = buildGeocodingQueryVariants(query, options.maxQueries);
  const allCandidates: Array<{
    candidate: LocationCandidate;
    queryText: string;
    strategy: ResolutionStrategy;
  }> = [];
  const seenKeys = new Set<string>();

  for (const variant of variants) {
    try {
      const results = await provider.search({
        text: variant.text,
        language: variant.language,
        limit: options.maxCandidates,
        signal: options.signal,
      });

      for (const candidate of results) {
        const keys = dedupKeys(candidate);
        if (keys.some((key) => seenKeys.has(key))) {
          continue;
        }
        for (const key of keys) {
          seenKeys.add(key);
        }
        allCandidates.push({
          candidate,
          queryText: variant.text,
          strategy: options.strategy ?? variant.strategy,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message === "weather_geocoding_cancelled") {
        return {
          status: "provider_error",
          query,
          provider: "open-meteo",
          code: "weather_geocoding_cancelled",
          retryable: false,
        };
      }

      // If provider fails on the first variant, return provider_error
      if (allCandidates.length === 0) {
        if (message === "weather_geocoding_timeout") {
          return {
            status: "provider_error",
            query,
            provider: "open-meteo",
            code: "weather_geocoding_timeout",
            retryable: true,
          };
        }

        if (message === "weather_geocoding_cancelled") {
          return {
            status: "provider_error",
            query,
            provider: "open-meteo",
            code: "weather_geocoding_cancelled",
            retryable: false,
          };
        }

        return {
          status: "provider_error",
          query,
          provider: "open-meteo",
          code: "weather_geocoding_provider_error",
          retryable: isRetryableError(message),
        };
      }
      // If we already have some candidates, continue with what we have
    }
  }

  if (allCandidates.length === 0) {
    return {
      status: "not_found",
      query,
      attemptedQueries: variants.map((variant) => variant.text),
    };
  }

  return scoreAndResolve(query, allCandidates, variants.map((variant) => variant.text), options);
}

/**
 * Score and resolve candidates — Task 3.5, 3.6, 3.9
 */
function scoreAndResolve(
  query: LocationQuery,
  candidates: Array<{
    candidate: LocationCandidate;
    queryText: string;
    strategy: ResolutionStrategy;
  }>,
  attemptedQueries: string[],
  options: ResolverOptions
): LocationResolutionResult {
  const scored = candidates
    .map((entry) => ({
      candidate: entry.candidate,
      score: scoreCandidate(entry.candidate, query),
      strategy: entry.strategy,
    }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];

  if (!best || best.score < options.minScore) {
    return {
      status: "not_found",
      query,
      attemptedQueries,
    };
  }

  const second = scored[1];
  const hasContext = Boolean(query.country || query.region);

  // Check for ambiguity: if scores are close and we lack context
  if (
    !hasContext &&
    second &&
    best.score - second.score < options.ambiguityDelta &&
    !hasDominantProminence(query, best.candidate, second.candidate)
  ) {
    // Check if the top candidates are in different countries (indicating ambiguity)
    const differentCountries = scored
      .slice(0, options.maxCandidates)
      .some((s) => s.candidate.countryCode !== best.candidate.countryCode);

    return {
      status: "ambiguous",
      query,
      candidates: scored
        .slice(0, options.maxCandidates)
        .map((s) => s.candidate),
      reason: differentCountries ? "score_too_close" : "missing_country_or_region",
      attemptedQueries,
    };
  }

  // Resolved
  return {
    status: "resolved",
    query,
    candidate: best.candidate,
    confidence: Math.min(100, best.score),
    strategy: options.strategy ?? best.strategy,
    attemptedQueries,
  };
}

/**
 * Generate a dedup key for a candidate — Task 3.4
 * Uses provider + rounded coordinates + normalized name.
 */
function dedupKeys(candidate: LocationCandidate): string[] {
  const lat = Math.round(candidate.latitude * 100) / 100;
  const lng = Math.round(candidate.longitude * 100) / 100;
  const displayName = normalizeComparable(candidate.displayName);
  return [
    `${candidate.provider}:coords:${lat}:${lng}`,
    `${candidate.provider}:display:${displayName}`,
  ];
}

/**
 * Score a single candidate against the query — Task 3.5 (pure function)
 *
 * Factors:
 * - Exact name match: +40
 * - Name contains query: +20
 * - Country code or name match: +35
 * - Admin1/Admin2 matches region: +25
 * - Population (log-scaled, minor tie-breaker): up to +8
 *
 * The population score must not override country/region context (Task 3.9).
 */
export function scoreCandidate(
  candidate: LocationCandidate,
  query: LocationQuery
): number {
  const normalizedLocation = normalizeComparable(query.location);
  let score = 0;

  // Name matching
  const candidateName = normalizeComparable(candidate.name);
  if (candidateName === normalizedLocation) {
    score += 40;
  } else if (candidateName.includes(normalizedLocation) || normalizedLocation.includes(candidateName)) {
    score += 20;
  }

  // Country matching
  if (query.country && countryMatches(candidate, query.country)) {
    score += 35;
  }

  // Region matching
  if (query.region && regionMatches(candidate, query.region)) {
    score += 25;
  }

  // Population as minor tie-breaker (max 8 points)
  if (candidate.population !== undefined && candidate.population > 0) {
    score += Math.min(Math.log10(candidate.population), 8);
  }

  return score;
}

function normalizeComparable(value: string): string {
  return value.normalize("NFKC").toLowerCase().trim();
}

function isExactNameMatch(candidate: LocationCandidate, query: LocationQuery): boolean {
  return normalizeComparable(candidate.name) === normalizeComparable(query.location);
}

function isShortCjkQuery(value: string): boolean {
  const normalized = value.normalize("NFKC").trim();
  return normalized.length <= 2 && /^[\p{Script=Han}]+$/u.test(normalized);
}

function hasDominantProminence(
  query: LocationQuery,
  best: LocationCandidate,
  second: LocationCandidate
): boolean {
  if (!isExactNameMatch(best, query)) {
    return false;
  }

  if (isShortCjkQuery(query.location) && isExactNameMatch(second, query)) {
    return false;
  }

  const bestPopulation = best.population ?? 0;
  const secondPopulation = second.population ?? 0;
  if (bestPopulation < 500_000) {
    return false;
  }

  if (secondPopulation <= 0) {
    return bestPopulation >= 1_000_000;
  }

  const ratio = bestPopulation / secondPopulation;
  const difference = bestPopulation - secondPopulation;
  return ratio >= 8 || (ratio >= 4 && difference >= 1_000_000);
}

/**
 * Check if a candidate's country matches the expected country.
 * Supports 2-letter country codes and full names in multiple locales.
 */
export function countryMatches(candidate: LocationCandidate, expectedCountry: string): boolean {
  const expected = expectedCountry.normalize("NFKC").toLowerCase().trim();

  // Direct country code match
  if (candidate.countryCode?.toLowerCase() === expected) {
    return true;
  }

  // Country name match
  if (candidate.country?.normalize("NFKC").toLowerCase().includes(expected)) {
    return true;
  }

  // Try locale-based display name matching
  if (candidate.countryCode) {
    for (const locale of ["en", "zh-Hant", "zh-Hans"]) {
      try {
        const displayName = new Intl.DisplayNames([locale], { type: "region" });
        const name = displayName.of(candidate.countryCode.toUpperCase());
        if (name?.normalize("NFKC").toLowerCase() === expected) {
          return true;
        }
      } catch {
        // ignore unsupported locales
      }
    }
  }

  return false;
}

/**
 * Check if a candidate's admin1 or admin2 matches the expected region.
 * Exported for testing.
 */
export function regionMatches(candidate: LocationCandidate, expectedRegion: string): boolean {
  const expected = expectedRegion.normalize("NFKC").toLowerCase().trim();

  const admin1 = candidate.admin1?.normalize("NFKC").toLowerCase();
  const admin2 = candidate.admin2?.normalize("NFKC").toLowerCase();

  // Guard against empty strings — empty string matches everything via .includes("")
  if (admin1) {
    if (admin1.includes(expected) || expected.includes(admin1)) {
      return true;
    }
  }
  if (admin2) {
    if (admin2.includes(expected) || expected.includes(admin2)) {
      return true;
    }
  }

  return false;
}

/**
 * Determine if a provider error is retryable — Task 4.11
 */
function isRetryableError(message: string): boolean {
  const retryablePatterns = [
    "429", "502", "503", "504",
    "network", "timeout", "dns",
    "econnrefused", "econnreset", "enotfound",
    "fetch failed",
  ];
  const lower = message.toLowerCase();
  return retryablePatterns.some((pattern) => lower.includes(pattern));
}
