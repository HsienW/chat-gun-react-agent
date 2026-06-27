import { describe, expect, it, vi } from "vitest";

import {
  MapboxGeocodingProvider,
  validateMapboxForwardQuery,
} from "./mapbox-provider.js";

const mapboxResponse = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      id: "dXJuOm1ieHBsYzpEYWxpYW8",
      geometry: {
        type: "Point",
        coordinates: [120.395, 22.584],
      },
      properties: {
        mapbox_id: "dXJuOm1ieHBsYzpEYWxpYW8",
        feature_type: "place",
        name: "大寮區",
        full_address: "大寮區, 高雄市, 台灣",
        context: {
          country: {
            name: "台灣",
            country_code: "TW",
          },
          region: {
            name: "高雄市",
            region_code: "TW-KHH",
          },
          district: {
            name: "大寮區",
          },
        },
      },
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("MapboxGeocodingProvider", () => {
  it("sends the complete Unicode location in Temporary mode without permanent=true", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(jsonResponse(mapboxResponse));
    const provider = new MapboxGeocodingProvider({
      accessToken: "test-token",
      storageMode: "temporary",
      worldview: "us",
      fetchImplementation,
    });

    const candidates = await provider.search({
      text: "台灣高雄大寮",
      language: "zh-TW",
      limit: 5,
    });

    const requestUrl = new URL(fetchImplementation.mock.calls[0][0] as string);
    expect(requestUrl.searchParams.get("q")).toBe("台灣高雄大寮");
    expect(requestUrl.searchParams.get("permanent")).toBeNull();
    expect(requestUrl.searchParams.get("worldview")).toBe("us");
    expect(candidates).toEqual([
      expect.objectContaining({
        provider: "mapbox",
        providerId: "dXJuOm1ieHBsYzpEYWxpYW8",
        name: "大寮區",
        displayName: "大寮區, 高雄市, 台灣",
        country: "台灣",
        countryCode: "TW",
        admin1: "高雄市",
        admin2: "大寮區",
        latitude: 22.584,
        longitude: 120.395,
      }),
    ]);
  });

  it("adds permanent=true only in Permanent mode", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(jsonResponse(mapboxResponse));
    const provider = new MapboxGeocodingProvider({
      accessToken: "test-token",
      storageMode: "permanent",
      fetchImplementation,
    });

    await provider.search({ text: "Daliao", limit: 1 });

    const requestUrl = new URL(fetchImplementation.mock.calls[0][0] as string);
    expect(requestUrl.searchParams.get("permanent")).toBe("true");
  });

  it("rejects a malformed provider response instead of trusting coordinates", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(
      jsonResponse({
        ...mapboxResponse,
        features: [
          {
            ...mapboxResponse.features[0],
            geometry: { type: "Point", coordinates: [500, 200] },
          },
        ],
      })
    );
    const provider = new MapboxGeocodingProvider({
      accessToken: "test-token",
      storageMode: "temporary",
      fetchImplementation,
    });

    await expect(provider.search({ text: "台灣高雄大寮", limit: 1 })).rejects.toMatchObject({
      code: "weather_geocoding_invalid_response",
      retryable: false,
    });
  });
});

describe("validateMapboxForwardQuery", () => {
  it.each([
    "Taipei;Taiwan",
    "word ".repeat(21).trim(),
    "x".repeat(257),
  ])("rejects a query outside Mapbox v6 constraints", (query) => {
    expect(() => validateMapboxForwardQuery(query)).toThrowError(
      expect.objectContaining({
        code: "weather_invalid_input",
      })
    );
  });
});
