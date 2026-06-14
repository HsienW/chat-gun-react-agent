// Location normalizer — Task 2.2, 2.3, 2.4
// Performs input validation, Unicode NFKC normalization, whitespace cleanup,
// and builds query variants for geocoding provider queries.

import { GeocodingQueryVariant, LocationQuery } from "../weather-types.js";

const DEFAULT_MAX_CHARS = 160;

export type NormalizationOptions = {
  maxChars?: number;
};

/**
 * Validate a raw location string. Returns an error message or null if valid.
 * Task 2.2
 */
export function validateLocationInput(
  raw: string | undefined | null,
  maxChars: number = DEFAULT_MAX_CHARS
): string | null {
  if (!raw || typeof raw !== "string") {
    return "Location input must be a non-empty string.";
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return "Location input must not be empty after trimming.";
  }

  if (trimmed.length > maxChars) {
    return `Location input exceeds maximum length of ${maxChars} characters.`;
  }

  // Reject control characters (except common whitespace)
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(trimmed)) {
    return "Location input contains invalid control characters.";
  }

  return null;
}

/**
 * Normalize a location string — Task 2.3, 2.4
 * - Trim whitespace
 * - Unicode NFKC normalization
 * - Collapse multiple whitespace
 * - Remove invisible control characters
 *
 * Does NOT translate or replace city names.
 */
export function normalizeLocation(raw: string): string {
  return raw
    .trim()
    .normalize("NFKC")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Build a clean LocationQuery from raw user input — Task 2.4
 * Preserves `raw` as the original text.
 */
export function buildLocationQuery(
  raw: string,
  country?: string,
  region?: string
): LocationQuery {
  return {
    raw: raw,
    location: normalizeLocation(raw),
    country: country ? normalizeLocation(country) : undefined,
    region: region ? normalizeLocation(region) : undefined,
  };
}

/**
 * Build query variants for geocoding — Task 2.5, 2.6
 *
 * Order:
 * 1. Normalized location (original)
 * 2. location + country
 * 3. location + region
 * 4. location + region + country
 * 5-7. Same variants with language-coded queries
 *
 * Limited to MAX_QUERIES variants, deduplicated.
 */
export function buildQueryVariants(
  query: LocationQuery,
  maxVariants: number = 6
): string[] {
  return [...new Set(buildGeocodingQueryVariants(query, maxVariants).map((variant) => variant.text))];
}

/**
 * Build provider-ready geocoding query variants with language fallback.
 */
export function buildGeocodingQueryVariants(
  query: LocationQuery,
  maxVariants: number = 6
): GeocodingQueryVariant[] {
  const variants: string[] = [];
  const seen = new Set<string>();

  function add(text: string): void {
    const trimmed = text.trim();
    if (trimmed && !seen.has(trimmed.toLowerCase()) && variants.length < maxVariants) {
      seen.add(trimmed.toLowerCase());
      variants.push(trimmed);
    }
  }

  // 1. Location only
  add(query.location);

  // 2. Location + country
  if (query.country) {
    add(`${query.location}, ${query.country}`);
    add(`${query.location} ${query.country}`);
  }

  // 3. Location + region
  if (query.region) {
    add(`${query.location}, ${query.region}`);
    add(`${query.location} ${query.region}`);
  }

  // 4. Location + region + country
  if (query.region && query.country) {
    add(`${query.location}, ${query.region}, ${query.country}`);
  }

  const providerVariants: GeocodingQueryVariant[] = [];
  const providerSeen = new Set<string>();
  const languages: Array<string | undefined> = [undefined, "zh", "en"];

  for (const text of variants) {
    for (const language of languages) {
      const key = `${text.toLowerCase()}|${language ?? ""}`;
      if (providerSeen.has(key) || providerVariants.length >= maxVariants) {
        continue;
      }
      providerSeen.add(key);
      providerVariants.push({
        text,
        language,
        strategy: language ? "locale_fallback" : query.country || query.region ? "contextual" : "original",
      });
    }
  }

  return providerVariants;
}
