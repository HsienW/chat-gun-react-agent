import type { GeocodingProvider } from "../weather-types.js";
import { parseMapboxGeocodingConfig } from "./mapbox-config.js";
import { MapboxGeocodingProvider } from "./mapbox-provider.js";
import { OpenMeteoGeocodingProvider } from "./open-meteo-provider.js";

function isProductionEnvironment(
  environment: Record<string, string | undefined>
): boolean {
  return [environment.NODE_ENV, environment.APP_ENV].some((value) =>
    /^(production|prod)$/i.test(value ?? "")
  );
}

export function createConfiguredGeocodingProvider(
  environment: Record<string, string | undefined> = process.env
): GeocodingProvider {
  if (
    !isProductionEnvironment(environment) &&
    environment.WEATHER_TEST_GEOCODING_PROVIDER === "open-meteo"
  ) {
    const timeoutMs = Number(environment.WEATHER_GEOCODING_TIMEOUT_MS);
    return new OpenMeteoGeocodingProvider(
      Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 5_000
    );
  }

  const config = parseMapboxGeocodingConfig(environment);
  return new MapboxGeocodingProvider({
    accessToken: config.accessToken,
    storageMode: config.storageMode,
    worldview: config.worldview,
    timeoutMs: config.timeoutMs,
  });
}
