import { z } from "zod";

import type {
  GeocodingProvider,
  GeocodingSearchQuery,
  LocationCandidate,
} from "../weather-types.js";

const MAPBOX_FORWARD_GEOCODING_URL =
  "https://api.mapbox.com/search/geocode/v6/forward";
const MAPBOX_QUERY_MAX_CHARS = 256;
const MAPBOX_QUERY_MAX_TERMS = 20;
const MAPBOX_RESULT_MAX_LIMIT = 10;

const mapboxStorageModeSchema = z.enum(["temporary", "permanent"]);
const mapboxWorldviewSchema = z.enum(["ar", "cn", "in", "jp", "ma", "rs", "ru", "tr", "us"]);

const mapboxContextEntrySchema = z
  .object({
    name: z.string().optional(),
    country_code: z.string().optional(),
    region_code: z.string().optional(),
  })
  .passthrough();

const mapboxFeatureSchema = z
  .object({
    id: z.string().optional(),
    geometry: z
      .object({
        type: z.literal("Point"),
        coordinates: z.tuple([
          z.number().finite().min(-180).max(180),
          z.number().finite().min(-90).max(90),
        ]),
      })
      .passthrough(),
    properties: z
      .object({
        mapbox_id: z.string().optional(),
        feature_type: z.string(),
        name: z.string().min(1),
        name_preferred: z.string().optional(),
        full_address: z.string().optional(),
        place_formatted: z.string().optional(),
        context: z
          .object({
            country: mapboxContextEntrySchema.optional(),
            region: mapboxContextEntrySchema.optional(),
            district: mapboxContextEntrySchema.optional(),
            place: mapboxContextEntrySchema.optional(),
            locality: mapboxContextEntrySchema.optional(),
            neighborhood: mapboxContextEntrySchema.optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();

const mapboxResponseSchema = z
  .object({
    type: z.literal("FeatureCollection"),
    features: z.array(mapboxFeatureSchema),
  })
  .passthrough();

export type MapboxStorageMode = z.infer<typeof mapboxStorageModeSchema>;
export type MapboxWorldview = z.infer<typeof mapboxWorldviewSchema>;

export class MapboxGeocodingError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly statusCode?: number;

  constructor(
    code: string,
    message: string,
    options: { retryable: boolean; statusCode?: number; cause?: unknown }
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "MapboxGeocodingError";
    this.code = code;
    this.retryable = options.retryable;
    this.statusCode = options.statusCode;
  }
}

type MapboxGeocodingProviderOptions = {
  accessToken: string;
  storageMode?: MapboxStorageMode;
  worldview?: MapboxWorldview;
  timeoutMs?: number;
  fetchImplementation?: typeof fetch;
};

export function validateMapboxForwardQuery(query: string): string {
  const normalizedQuery = query.trim();
  const termCount = normalizedQuery.match(/[\p{L}\p{N}]+/gu)?.length ?? 0;
  if (
    normalizedQuery.length === 0 ||
    normalizedQuery.length > MAPBOX_QUERY_MAX_CHARS ||
    termCount > MAPBOX_QUERY_MAX_TERMS ||
    normalizedQuery.includes(";")
  ) {
    throw new MapboxGeocodingError(
      "weather_invalid_input",
      "The location query does not satisfy Mapbox forward-geocoding constraints.",
      { retryable: false }
    );
  }
  return normalizedQuery;
}

export class MapboxGeocodingProvider implements GeocodingProvider {
  readonly name = "mapbox";

  private readonly accessToken: string;
  private readonly storageMode: MapboxStorageMode;
  private readonly worldview?: MapboxWorldview;
  private readonly timeoutMs: number;
  private readonly fetchImplementation: typeof fetch;

  constructor(options: MapboxGeocodingProviderOptions) {
    const accessToken = options.accessToken.trim();
    if (!accessToken) {
      throw new MapboxGeocodingError(
        "weather_geocoding_configuration_error",
        "MAPBOX_ACCESS_TOKEN is required.",
        { retryable: false }
      );
    }
    this.accessToken = accessToken;
    this.storageMode = mapboxStorageModeSchema.parse(options.storageMode ?? "temporary");
    this.worldview =
      options.worldview === undefined
        ? undefined
        : mapboxWorldviewSchema.parse(options.worldview);
    this.timeoutMs = Math.max(1, options.timeoutMs ?? 5_000);
    this.fetchImplementation = options.fetchImplementation ?? fetch;
  }

  async search(query: GeocodingSearchQuery): Promise<LocationCandidate[]> {
    const requestUrl = this.buildRequestUrl(query);
    const requestAbort = this.createRequestAbort(query.signal);

    try {
      const response = await this.fetchImplementation(requestUrl.toString(), {
        signal: requestAbort.signal,
      });
      if (!response.ok) {
        throw this.createHttpError(response.status);
      }

      const providerBody: unknown = await response.json();
      const parsedBody = mapboxResponseSchema.safeParse(providerBody);
      if (!parsedBody.success) {
        throw new MapboxGeocodingError(
          "weather_geocoding_invalid_response",
          "Mapbox returned a response that failed runtime validation.",
          { retryable: false, cause: parsedBody.error }
        );
      }

      return parsedBody.data.features.map((feature) => this.toCandidate(feature));
    } catch (error) {
      if (error instanceof MapboxGeocodingError) {
        throw error;
      }
      if (requestAbort.didTimeout()) {
        throw new MapboxGeocodingError(
          "weather_geocoding_timeout",
          "Mapbox geocoding timed out.",
          { retryable: true, cause: error }
        );
      }
      if (query.signal?.aborted || this.isAbortError(error)) {
        throw new MapboxGeocodingError(
          "weather_geocoding_cancelled",
          "Mapbox geocoding was cancelled.",
          { retryable: false, cause: error }
        );
      }
      throw new MapboxGeocodingError(
        "weather_geocoding_provider_error",
        "Mapbox geocoding failed.",
        { retryable: true, cause: error }
      );
    } finally {
      requestAbort.cleanup();
    }
  }

  private buildRequestUrl(query: GeocodingSearchQuery): URL {
    const requestUrl = new URL(MAPBOX_FORWARD_GEOCODING_URL);
    requestUrl.searchParams.set("q", validateMapboxForwardQuery(query.text));
    requestUrl.searchParams.set(
      "limit",
      String(Math.max(1, Math.min(Math.trunc(query.limit), MAPBOX_RESULT_MAX_LIMIT)))
    );
    requestUrl.searchParams.set("access_token", this.accessToken);
    if (query.language) {
      requestUrl.searchParams.set("language", query.language);
    }
    if (this.worldview) {
      requestUrl.searchParams.set("worldview", this.worldview);
    }
    if (this.storageMode === "permanent") {
      requestUrl.searchParams.set("permanent", "true");
    }
    return requestUrl;
  }

  private toCandidate(
    feature: z.infer<typeof mapboxFeatureSchema>
  ): LocationCandidate {
    const [longitude, latitude] = feature.geometry.coordinates;
    const context = feature.properties.context;
    const name = feature.properties.name_preferred ?? feature.properties.name;
    return {
      provider: this.name,
      providerId: feature.properties.mapbox_id ?? feature.id,
      name,
      displayName:
        feature.properties.full_address ??
        [name, feature.properties.place_formatted].filter(Boolean).join(", "),
      country: context?.country?.name,
      countryCode: context?.country?.country_code,
      admin1: context?.region?.name,
      admin2:
        context?.district?.name ??
        context?.place?.name ??
        context?.locality?.name,
      latitude,
      longitude,
    };
  }

  private createHttpError(statusCode: number): MapboxGeocodingError {
    const isRetryable =
      statusCode === 429 ||
      statusCode === 502 ||
      statusCode === 503 ||
      statusCode === 504;
    const code =
      statusCode === 401 || statusCode === 403
        ? "weather_geocoding_configuration_error"
        : "weather_geocoding_provider_error";
    return new MapboxGeocodingError(code, `Mapbox returned HTTP ${statusCode}.`, {
      retryable: isRetryable,
      statusCode,
    });
  }

  private createRequestAbort(externalSignal?: AbortSignal): {
    signal: AbortSignal;
    cleanup: () => void;
    didTimeout: () => boolean;
  } {
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    const onExternalAbort = () => controller.abort();

    if (externalSignal?.aborted) {
      controller.abort();
    } else {
      externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
    }

    return {
      signal: controller.signal,
      didTimeout: () => timedOut,
      cleanup: () => {
        clearTimeout(timeoutId);
        externalSignal?.removeEventListener("abort", onExternalAbort);
      },
    };
  }

  private isAbortError(error: unknown): boolean {
    return (
      (error instanceof DOMException && error.name === "AbortError") ||
      (error instanceof Error && error.name === "AbortError")
    );
  }
}
