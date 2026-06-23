// Mock Geocoding Provider for testing — Task 1.4
// Provides deterministic candidate sets without external API calls.

import { GeocodingProvider, GeocodingSearchQuery, LocationCandidate } from "../weather-types.js";

/**
 * Mock geocoding provider for unit tests.
 * Returns predetermined candidates based on preset data.
 */
export class MockGeocodingProvider implements GeocodingProvider {
  readonly name = "mock";
  private candidatesByText: Map<string, LocationCandidate[]>;
  private shouldFail: boolean = false;
  private failureMessage: string = "";
  readonly calls: GeocodingSearchQuery[] = [];

  constructor() {
    this.candidatesByText = new Map();
    this.setPresetData();
  }

  setFailure(shouldFail: boolean, message: string = "Provider error"): void {
    this.shouldFail = shouldFail;
    this.failureMessage = message;
  }

  async search(query: GeocodingSearchQuery): Promise<LocationCandidate[]> {
    this.calls.push(query);

    if (this.shouldFail) {
      throw new Error(this.failureMessage);
    }

    if (query.signal?.aborted) {
      throw new Error("weather_geocoding_cancelled");
    }

    // Find matching preset data
    const normalizedText = query.text.toLowerCase().trim();
    for (const [key, candidates] of this.candidatesByText) {
      if (normalizedText.includes(key)) {
        return candidates;
      }
    }

    // Fuzzy match: check if any key is part of the query
    for (const [key, candidates] of this.candidatesByText) {
      if (key.includes(normalizedText) || normalizedText.includes(key)) {
        return candidates;
      }
    }

    return [];
  }

  private setPresetData(): void {
    // Taipei (台北/臺北)
    this.candidatesByText.set("taipei", [
      {
        provider: "open-meteo",
        name: "Taipei",
        displayName: "Taipei, Taiwan",
        country: "臺灣",
        countryCode: "TW",
        admin1: "Taipei City",
        latitude: 25.033,
        longitude: 121.565,
        timezone: "Asia/Taipei",
        population: 7_000_000,
      },
    ]);

    // Kaohsiung (高雄)
    this.candidatesByText.set("kaohsiung", [
      {
        provider: "open-meteo",
        name: "Kaohsiung",
        displayName: "Kaohsiung, Taiwan",
        country: "臺灣",
        countryCode: "TW",
        admin1: "Kaohsiung City",
        latitude: 22.627,
        longitude: 120.301,
        timezone: "Asia/Taipei",
        population: 2_700_000,
      },
    ]);

    // Fengshan (鳳山) — Kaohsiung district
    this.candidatesByText.set("fengshan", [
      {
        provider: "open-meteo",
        name: "Fengshan",
        displayName: "Fengshan District, Kaohsiung, Taiwan",
        country: "臺灣",
        countryCode: "TW",
        admin1: "Kaohsiung City",
        admin2: "Fengshan District",
        latitude: 22.624,
        longitude: 120.355,
        timezone: "Asia/Taipei",
        population: 350_000,
      },
    ]);

    // Beijing (北京)
    this.candidatesByText.set("beijing", [
      {
        provider: "open-meteo",
        name: "Beijing",
        displayName: "Beijing, China",
        country: "中国",
        countryCode: "CN",
        admin1: "Beijing",
        latitude: 39.904,
        longitude: 116.407,
        timezone: "Asia/Shanghai",
        population: 21_000_000,
      },
    ]);

    // Singapore
    this.candidatesByText.set("singapore", [
      {
        provider: "open-meteo",
        name: "Singapore",
        displayName: "Singapore",
        country: "Singapore",
        countryCode: "SG",
        latitude: 1.352,
        longitude: 103.82,
        timezone: "Asia/Singapore",
        population: 5_600_000,
      },
    ]);

    // Tokyo
    this.candidatesByText.set("tokyo", [
      {
        provider: "open-meteo",
        name: "Tokyo",
        displayName: "Tokyo, Japan",
        country: "日本",
        countryCode: "JP",
        admin1: "Tokyo",
        latitude: 35.676,
        longitude: 139.65,
        timezone: "Asia/Tokyo",
        population: 14_000_000,
      },
    ]);

    // São Paulo
    this.candidatesByText.set("são paulo", [
      {
        provider: "open-meteo",
        name: "São Paulo",
        displayName: "São Paulo, Brazil",
        country: "Brasil",
        countryCode: "BR",
        admin1: "São Paulo",
        latitude: -23.55,
        longitude: -46.633,
        timezone: "America/Sao_Paulo",
        population: 12_000_000,
      },
    ]);

    // München (Munich)
    this.candidatesByText.set("münchen", [
      {
        provider: "open-meteo",
        name: "München",
        displayName: "München, Germany",
        country: "Deutschland",
        countryCode: "DE",
        admin1: "Bavaria",
        latitude: 48.137,
        longitude: 11.575,
        timezone: "Europe/Berlin",
        population: 1_500_000,
      },
    ]);

    // Springfield — multiple candidates across states (Task 3.12)
    this.candidatesByText.set("springfield", [
      {
        provider: "open-meteo",
        name: "Springfield",
        displayName: "Springfield, Illinois",
        country: "United States",
        countryCode: "US",
        admin1: "Illinois",
        latitude: 39.781,
        longitude: -89.65,
        timezone: "America/Chicago",
        population: 114_000,
      },
      {
        provider: "open-meteo",
        name: "Springfield",
        displayName: "Springfield, Missouri",
        country: "United States",
        countryCode: "US",
        admin1: "Missouri",
        latitude: 37.215,
        longitude: -93.298,
        timezone: "America/Chicago",
        population: 168_000,
      },
      {
        provider: "open-meteo",
        name: "Springfield",
        displayName: "Springfield, Massachusetts",
        country: "United States",
        countryCode: "US",
        admin1: "Massachusetts",
        latitude: 42.101,
        longitude: -72.59,
        timezone: "America/New_York",
        population: 155_000,
      },
      {
        provider: "open-meteo",
        name: "Springfield",
        displayName: "Springfield, Ohio",
        country: "United States",
        countryCode: "US",
        admin1: "Ohio",
        latitude: 39.925,
        longitude: -83.804,
        timezone: "America/New_York",
        population: 58_000,
      },
      {
        provider: "open-meteo",
        name: "Springfield",
        displayName: "Springfield, Oregon",
        country: "United States",
        countryCode: "US",
        admin1: "Oregon",
        latitude: 44.046,
        longitude: -123.022,
        timezone: "America/Los_Angeles",
        population: 60_000,
      },
    ]);

    // Zhongshan (中山) — multiple cities
    this.candidatesByText.set("zhongshan", [
      {
        provider: "open-meteo",
        name: "Zhongshan",
        displayName: "Zhongshan, Guangdong",
        country: "中国",
        countryCode: "CN",
        admin1: "Guangdong",
        latitude: 22.521,
        longitude: 113.378,
        timezone: "Asia/Shanghai",
        population: 4_400_000,
      },
      {
        provider: "open-meteo",
        name: "Zhongshan District",
        displayName: "Zhongshan District, Taipei, Taiwan",
        country: "臺灣",
        countryCode: "TW",
        admin1: "Taipei City",
        admin2: "Zhongshan District",
        latitude: 25.064,
        longitude: 121.533,
        timezone: "Asia/Taipei",
        population: 220_000,
      },
    ]);
  }
}
