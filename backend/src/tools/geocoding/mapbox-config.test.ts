import { describe, expect, it } from "vitest";

import { parseMapboxGeocodingConfig } from "./mapbox-config.js";

describe("parseMapboxGeocodingConfig", () => {
  it("uses production-safe defaults without inferring worldview", () => {
    const config = parseMapboxGeocodingConfig({
      MAPBOX_ACCESS_TOKEN: "token",
    });

    expect(config).toMatchObject({
      accessToken: "token",
      storageMode: "temporary",
      worldview: undefined,
      timeoutMs: 5_000,
      totalBudgetMs: 8_000,
      maxQueries: 3,
      maxAttempts: 4,
      rateLimitPerInstancePerMinute: 100,
      maxConcurrency: 10,
      queueMax: 100,
      circuitFailureThreshold: 5,
      circuitCooldownMs: 60_000,
    });
  });

  it("accepts Permanent mode and a configured worldview", () => {
    const config = parseMapboxGeocodingConfig({
      MAPBOX_ACCESS_TOKEN: "token",
      MAPBOX_GEOCODING_STORAGE_MODE: "permanent",
      MAPBOX_WORLDVIEW: "jp",
    });

    expect(config.storageMode).toBe("permanent");
    expect(config.worldview).toBe("jp");
  });

  it.each([
    [{}, "MAPBOX_ACCESS_TOKEN"],
    [
      {
        MAPBOX_ACCESS_TOKEN: "token",
        MAPBOX_GEOCODING_STORAGE_MODE: "archive",
      },
      "MAPBOX_GEOCODING_STORAGE_MODE",
    ],
    [
      {
        MAPBOX_ACCESS_TOKEN: "token",
        MAPBOX_WORLDVIEW: "tw",
      },
      "MAPBOX_WORLDVIEW",
    ],
    [
      {
        MAPBOX_ACCESS_TOKEN: "token",
        WEATHER_GEOCODING_MAX_ATTEMPTS: "0",
      },
      "WEATHER_GEOCODING_MAX_ATTEMPTS",
    ],
  ])("rejects invalid configuration", (environment, expectedField) => {
    expect(() => parseMapboxGeocodingConfig(environment)).toThrow(expectedField);
  });
});
