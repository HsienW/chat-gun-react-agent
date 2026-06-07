import { tool } from "@langchain/core/tools";
import { z } from "zod";

type GeocodingResult = {
  name: string;
  country?: string;
  admin1?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
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

const LOCATION_ALIASES: Record<string, GeocodingResult> = {
  kaohsiung: {
    name: "Kaohsiung",
    country: "Taiwan",
    admin1: "Kaohsiung",
    latitude: 22.6273,
    longitude: 120.3014,
    timezone: "Asia/Taipei",
  },
  "高雄": {
    name: "Kaohsiung",
    country: "Taiwan",
    admin1: "Kaohsiung",
    latitude: 22.6273,
    longitude: 120.3014,
    timezone: "Asia/Taipei",
  },
  "高雄市": {
    name: "Kaohsiung",
    country: "Taiwan",
    admin1: "Kaohsiung",
    latitude: 22.6273,
    longitude: 120.3014,
    timezone: "Asia/Taipei",
  },
};

function normalizeLocationKey(location: string): string {
  return location.trim().toLowerCase().replace(/\s+/g, " ");
}

function describeWeatherCode(code: number | undefined): string {
  switch (code) {
    case 0:
      return "晴朗";
    case 1:
    case 2:
    case 3:
      return "晴時多雲或多雲";
    case 45:
    case 48:
      return "有霧";
    case 51:
    case 53:
    case 55:
      return "毛毛雨";
    case 56:
    case 57:
      return "凍毛毛雨";
    case 61:
    case 63:
    case 65:
      return "降雨";
    case 66:
    case 67:
      return "凍雨";
    case 71:
    case 73:
    case 75:
      return "降雪";
    case 77:
      return "雪粒";
    case 80:
    case 81:
    case 82:
      return "陣雨";
    case 85:
    case 86:
      return "陣雪";
    case 95:
      return "雷雨";
    case 96:
    case 99:
      return "雷雨伴隨冰雹";
    default:
      return "未知天氣狀態";
  }
}

function describeWindDirection(degrees: number | undefined): string {
  if (degrees === undefined || Number.isNaN(degrees)) {
    return "未知";
  }

  const directions = ["北", "東北", "東", "東南", "南", "西南", "西", "西北"];
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

async function resolveLocation(location: string): Promise<GeocodingResult> {
  const normalized = normalizeLocationKey(location);
  const alias = LOCATION_ALIASES[normalized];

  if (alias) {
    return alias;
  }

  const geocodingUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
  geocodingUrl.searchParams.set("name", location);
  geocodingUrl.searchParams.set("count", "1");
  geocodingUrl.searchParams.set("language", "zh");
  geocodingUrl.searchParams.set("format", "json");

  const geocoding = await fetchJson<GeocodingResponse>(geocodingUrl);
  const firstResult = geocoding.results?.[0];

  if (!firstResult) {
    throw new Error(`找不到地點：${location}`);
  }

  return firstResult;
}

function numberValue(
  current: Record<string, number | string>,
  key: string
): number | undefined {
  const value = current[key];
  return typeof value === "number" ? value : undefined;
}

export const weatherTool = tool(
  async ({ location }) => {
    try {
      const place = await resolveLocation(location);
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
        throw new Error("Open-Meteo 回傳缺少 current weather 資料");
      }

      const units = forecast.current_units ?? {};
      const weatherCode = numberValue(current, "weather_code");
      const windDirection = numberValue(current, "wind_direction_10m");
      const sourceUrl = forecastUrl.toString();
      const displayName = [place.name, place.admin1, place.country]
        .filter(Boolean)
        .join(", ");

      return [
        `資料來源：Open-Meteo current weather API`,
        `查詢地點：${displayName} (${forecast.latitude}, ${forecast.longitude})`,
        `觀測時間：${String(current.time)}，時區：${forecast.timezone}`,
        `天氣狀態：${describeWeatherCode(weatherCode)} (code ${weatherCode ?? "unknown"})`,
        `氣溫：${current.temperature_2m}${units.temperature_2m ?? ""}`,
        `體感溫度：${current.apparent_temperature}${units.apparent_temperature ?? ""}`,
        `相對濕度：${current.relative_humidity_2m}${units.relative_humidity_2m ?? ""}`,
        `降水量：${current.precipitation}${units.precipitation ?? ""}`,
        `雲量：${current.cloud_cover}${units.cloud_cover ?? ""}`,
        `風速：${current.wind_speed_10m}${units.wind_speed_10m ?? ""}，風向：${describeWindDirection(windDirection)} (${windDirection ?? "unknown"}${units.wind_direction_10m ?? ""})`,
        `陣風：${current.wind_gusts_10m}${units.wind_gusts_10m ?? ""}`,
        `氣壓：${current.pressure_msl}${units.pressure_msl ?? ""}`,
        `Source URL: ${sourceUrl}`,
      ].join("\n");
    } catch (error) {
      return `Error: 無法取得即時天氣資料 - ${
        error instanceof Error ? error.message : String(error)
      }`;
    }
  },
  {
    name: "current_weather",
    description:
      "Get real-time current weather for a city or location using Open-Meteo. Use this for questions about current weather, temperature, humidity, rain, wind, or forecasts such as '高雄天氣如何'.",
    schema: z.object({
      location: z
        .string()
        .min(1)
        .describe("City or location name, for example '高雄', 'Kaohsiung', or 'Tokyo'."),
    }),
  }
);
