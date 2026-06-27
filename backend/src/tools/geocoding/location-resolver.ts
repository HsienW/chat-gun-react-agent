// Location Resolver — Task 3.4, 3.5, 3.6, 3.7, 3.8, 3.9
// Orchestrates location resolution: takes a LocationQuery, runs query variants
// through a GeocodingProvider, deduplicates, scores, and returns a deterministic result.

import {
  GeocodingProvider,
  LocationCandidate,
  LocationQuery,
  LocationResolutionResult,
  ResolutionStrategy,
  GeocodingQueryVariant,
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

type CandidateEntry = {
  candidate: LocationCandidate;
  queryText: string;
  strategy: ResolutionStrategy;
};

type ScoredCandidate = {
  candidate: LocationCandidate;
  score: number;
  strategy: ResolutionStrategy;
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
  const attemptedQueries = variants.map(formatAttemptedQuery);
  const candidatesByKey = new Map<string, CandidateEntry>();

  for (const variant of variants) {
    try {
      const results = await provider.search({
        text: variant.text,
        language: variant.language,
        limit: options.maxCandidates,
        signal: options.signal,
      });

      for (const candidate of results) {
        const key = dedupKey(candidate);
        const existing = candidatesByKey.get(key);
        if (existing) {
          existing.candidate = mergeLocationCandidate(existing.candidate, candidate, query);
          continue;
        }
        candidatesByKey.set(key, {
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
          provider: provider.name,
          code: "weather_geocoding_cancelled",
          retryable: false,
        };
      }

      // If provider fails on the first variant, return provider_error
      if (candidatesByKey.size === 0) {
        if (message === "weather_geocoding_timeout") {
          return {
            status: "provider_error",
            query,
            provider: provider.name,
            code: "weather_geocoding_timeout",
            retryable: true,
          };
        }

        if (message === "weather_geocoding_cancelled") {
          return {
            status: "provider_error",
            query,
            provider: provider.name,
            code: "weather_geocoding_cancelled",
            retryable: false,
          };
        }

        return {
          status: "provider_error",
          query,
          provider: provider.name,
          code: "weather_geocoding_provider_error",
          retryable: isRetryableError(message),
        };
      }
      // If we already have some candidates, continue with what we have
    }
  }

  if (candidatesByKey.size === 0) {
    return {
      status: "not_found",
      query,
      attemptedQueries,
    };
  }

  return scoreAndResolve(query, Array.from(candidatesByKey.values()), attemptedQueries, options);
}

function formatAttemptedQuery(variant: GeocodingQueryVariant): string {
  return `${variant.text} [language=${variant.language ?? "default"}]`;
}

/**
 * Score and resolve candidates — Task 3.5, 3.6, 3.9
 */
function scoreAndResolve(
  query: LocationQuery,
  candidates: CandidateEntry[],
  attemptedQueries: string[],
  options: ResolverOptions
): LocationResolutionResult {
  const scored = candidates
    .map((entry) => ({
      candidate: entry.candidate,
      score: scoreCandidate(entry.candidate, {
        ...query,
        location: entry.queryText,
      }),
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
  if (
    !hasContext &&
    second &&
    hasLocationTextMatch(second.candidate, query.location) &&
    (isShortCjkQuery(query.raw) || isShortCjkQuery(query.location))
  ) {
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

  const dominant = !hasContext
    ? findDominantProminence(query, scored, options.minScore)
    : undefined;
  const canResolveDominant = Boolean(
    dominant && (!second || dominant === best || best.score - dominant.score < options.ambiguityDelta)
  );

  if (dominant && canResolveDominant) {
    return {
      status: "resolved",
      query,
      candidate: dominant.candidate,
      confidence: Math.min(100, dominant.score),
      strategy: options.strategy ?? dominant.strategy,
      attemptedQueries,
    };
  }

  // Check for ambiguity: if scores are close and we lack context
  if (
    !hasContext &&
    second &&
    best.score - second.score < options.ambiguityDelta
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
 * Uses provider + rounded coordinates so language fallbacks for the same place
 * can be merged instead of dropping richer metadata.
 */
function dedupKey(candidate: LocationCandidate): string {
  const lat = Math.round(candidate.latitude * 100) / 100;
  const lng = Math.round(candidate.longitude * 100) / 100;
  return `${candidate.provider}:coords:${lat}:${lng}`;
}

function mergeLocationCandidate(
  existing: LocationCandidate,
  incoming: LocationCandidate,
  query: LocationQuery
): LocationCandidate {
  const preferredText = shouldPreferCandidateText(incoming, existing, query)
    ? incoming
    : existing;
  const fallbackText = preferredText === existing ? incoming : existing;
  const existingPopulation = existing.population ?? 0;
  const incomingPopulation = incoming.population ?? 0;
  const population = Math.max(existingPopulation, incomingPopulation) || undefined;

  return {
    provider: existing.provider,
    providerId: existing.providerId ?? incoming.providerId,
    name: preferredText.name,
    displayName: preferredText.displayName,
    country: preferredText.country ?? fallbackText.country,
    countryCode: preferredText.countryCode ?? fallbackText.countryCode,
    admin1: preferredText.admin1 ?? fallbackText.admin1,
    admin2: preferredText.admin2 ?? fallbackText.admin2,
    latitude: existing.latitude,
    longitude: existing.longitude,
    timezone: existing.timezone ?? incoming.timezone,
    population,
  };
}

function shouldPreferCandidateText(
  incoming: LocationCandidate,
  existing: LocationCandidate,
  query: LocationQuery
): boolean {
  const incomingScore = candidateTextMatchScore(incoming, query);
  const existingScore = candidateTextMatchScore(existing, query);
  if (incomingScore !== existingScore) {
    return incomingScore > existingScore;
  }

  return candidateCompletenessScore(incoming) > candidateCompletenessScore(existing);
}

function candidateTextMatchScore(candidate: LocationCandidate, query: LocationQuery): number {
  const normalizedLocation = normalizeComparable(query.location);
  const candidateName = normalizeComparable(candidate.name);
  const displayName = normalizeComparable(candidate.displayName);
  const displayParts = displayName
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  let score = 0;

  if (candidateName === normalizedLocation) {
    score += 6;
  } else if (candidateName.includes(normalizedLocation) || normalizedLocation.includes(candidateName)) {
    score += 3;
  }

  if (displayParts.includes(normalizedLocation)) {
    score += 5;
  } else if (displayName.includes(normalizedLocation)) {
    score += 2;
  }

  return score;
}

function candidateCompletenessScore(candidate: LocationCandidate): number {
  return [
    candidate.displayName,
    candidate.country,
    candidate.countryCode,
    candidate.admin1,
    candidate.admin2,
    candidate.timezone,
    candidate.population,
    candidate.providerId,
  ].filter((value) => value !== undefined && value !== "").length;
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

  score += candidateLocationCoverageScore(candidate, normalizedLocation);

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

function comparableTokens(value: string): string[] {
  return normalizeComparable(value)
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function candidateLocationCoverageScore(
  candidate: LocationCandidate,
  normalizedLocation: string
): number {
  const candidateText = [
    candidate.name,
    candidate.displayName,
    candidate.country,
    candidate.countryCode,
    candidate.admin1,
    candidate.admin2,
  ]
    .filter((value): value is string => Boolean(value))
    .map(normalizeComparable)
    .join(" ");

  if (hasLatinScript(normalizedLocation)) {
    const locationTokens = comparableTokens(normalizedLocation);
    return locationTokens.length >= 2 &&
      locationTokens.every((token) => candidateText.includes(token))
      ? 15
      : 0;
  }

  const normalizedHanLocation = normalizedLocation.replace(/[^\p{Script=Han}\p{N}]+/gu, "");
  if (normalizedHanLocation.length < 2) {
    return 0;
  }

  const normalizedHanCandidate = candidateText.replace(/[^\p{Script=Han}\p{N}]+/gu, "");
  const bigrams = Array.from(
    { length: normalizedHanLocation.length - 1 },
    (_, index) => normalizedHanLocation.slice(index, index + 2)
  );
  const matchedBigrams = bigrams.filter((bigram) =>
    normalizedHanCandidate.includes(bigram)
  ).length;

  return matchedBigrams / bigrams.length >= 0.6 ? 35 : 0;
}

function isExactNameMatch(candidate: LocationCandidate, query: LocationQuery): boolean {
  return normalizeComparable(candidate.name) === normalizeComparable(query.location);
}

function hasLatinScript(value: string): boolean {
  return /\p{Script=Latin}/u.test(value.normalize("NFKC"));
}

function hasClearDisplayNameMatch(candidate: LocationCandidate, query: LocationQuery): boolean {
  const displayParts = normalizeComparable(candidate.displayName)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return displayParts.includes(normalizeComparable(query.location));
}

function hasLocationTextMatch(
  candidate: LocationCandidate,
  location: string
): boolean {
  const normalizedLocation = normalizeComparable(location);
  const candidateName = normalizeComparable(candidate.name);
  const displayName = normalizeComparable(candidate.displayName);
  return candidateName.includes(normalizedLocation) ||
    displayName.includes(normalizedLocation);
}

function isShortCjkQuery(value: string): boolean {
  const normalized = value.normalize("NFKC").trim();
  return normalized.length <= 2 && /^[\p{Script=Han}]+$/u.test(normalized);
}

function findDominantProminence(
  query: LocationQuery,
  scored: ScoredCandidate[],
  minScore: number
): ScoredCandidate | undefined {
  if (query.country || query.region) {
    return undefined;
  }

  if (!hasLatinScript(query.location)) {
    return undefined;
  }

  if (isShortCjkQuery(query.raw) || isShortCjkQuery(query.location)) {
    return undefined;
  }

  const candidates = scored
    .filter((entry) => entry.score >= minScore)
    .filter((entry) => isExactNameMatch(entry.candidate, query) || hasClearDisplayNameMatch(entry.candidate, query))
    .filter((entry) => (entry.candidate.population ?? 0) >= 500_000)
    .sort((a, b) => (b.candidate.population ?? 0) - (a.candidate.population ?? 0));

  for (const candidate of candidates) {
    const candidatePopulation = candidate.candidate.population ?? 0;
    const nextLargestPopulation = scored
      .filter((entry) => entry !== candidate)
      .reduce((max, entry) => Math.max(max, entry.candidate.population ?? 0), 0);

    if (nextLargestPopulation <= 0) {
      if (candidatePopulation >= 1_000_000) {
        return candidate;
      }
      continue;
    }

    const ratio = candidatePopulation / nextLargestPopulation;
    const difference = candidatePopulation - nextLargestPopulation;
    if (ratio >= 5 && difference >= 500_000) {
      return candidate;
    }
  }

  return undefined;
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
