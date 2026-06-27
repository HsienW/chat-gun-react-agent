import { describe, expect, it } from "vitest";

import { MapboxGeocodingProvider } from "./mapbox-provider.js";
import { OpenMeteoGeocodingProvider } from "./open-meteo-provider.js";
import { createConfiguredGeocodingProvider } from "./provider-factory.js";

describe("createConfiguredGeocodingProvider", () => {
  it("uses Mapbox for the production path", () => {
    const provider = createConfiguredGeocodingProvider({
      NODE_ENV: "production",
      MAPBOX_ACCESS_TOKEN: "token",
    });

    expect(provider).toBeInstanceOf(MapboxGeocodingProvider);
  });

  it("allows the Open-Meteo geocoder only as an explicit non-production fixture", () => {
    const provider = createConfiguredGeocodingProvider({
      NODE_ENV: "test",
      WEATHER_TEST_GEOCODING_PROVIDER: "open-meteo",
    });

    expect(provider).toBeInstanceOf(OpenMeteoGeocodingProvider);
  });

  it("does not allow the test override in production", () => {
    expect(() =>
      createConfiguredGeocodingProvider({
        NODE_ENV: "production",
        WEATHER_TEST_GEOCODING_PROVIDER: "open-meteo",
      })
    ).toThrow("MAPBOX_ACCESS_TOKEN");
  });
});
