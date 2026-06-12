// Frontend WeatherToolResult types — Task 6.1
// Replicates the backend types for frontend consumption with runtime parser.

export type LocationCandidate = {
  provider?: string;
  name: string;
  displayName: string;
  country?: string;
  countryCode?: string;
  admin1?: string;
  admin2?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
  population?: number;
};

export type LocationQuery = {
  raw: string;
  location: string;
  country?: string;
  region?: string;
};

// Weather current data fields (only what's needed for display)
export type WeatherCurrentData = {
  conditionCode?: number;
  conditionText?: string;
  temperature?: number;
  apparentTemperature?: number;
  relativeHumidity?: number;
  precipitation?: number;
  rain?: number;
  cloudCover?: number;
  pressureMsl?: number;
  windSpeed?: number;
  windDirectionDegrees?: number;
  windDirectionText?: string;
  windGusts?: number;
};

// Discriminated union matching backend WeatherToolResult
export type WeatherToolResult =
  | WeatherSuccessResult
  | WeatherClarificationResult
  | WeatherNotFoundResult
  | WeatherErrorResult;

export type WeatherSuccessResult = {
  schemaVersion: string;
  tool: string;
  status: 'success';
  requestedLocation: LocationQuery;
  resolvedLocation: LocationCandidate;
  observedAt: string;
  timezone: string;
  current: WeatherCurrentData;
  units: Record<string, string>;
  provider: string;
  sourceUrl: string;
  summary: string;
};

export type WeatherClarificationResult = {
  schemaVersion: string;
  tool: string;
  status: 'needs_clarification';
  requestedLocation: LocationQuery;
  candidates: Array<{
    name: string;
    displayName: string;
    country?: string;
    countryCode?: string;
    admin1?: string;
    admin2?: string;
  }>;
  message: string;
  summary: string;
};

export type WeatherNotFoundResult = {
  schemaVersion: string;
  tool: string;
  status: 'not_found';
  requestedLocation: LocationQuery;
  code: string;
  message: string;
  summary: string;
};

export type WeatherErrorResult = {
  schemaVersion: string;
  tool: string;
  status: 'error';
  requestedLocation: LocationQuery;
  code: string;
  retryable: boolean;
  message: string;
  summary: string;
};

// Weather display status for the Tool Panel
export type WeatherDisplayStatus = 'running' | 'success' | 'needs_clarification' | 'not_found' | 'error' | 'unknown';

/**
 * Parse raw tool content into WeatherToolResult — Task 6.1
 * Tries JSON.parse first, then checks schemaVersion/tool/status fields.
 * Returns undefined for non-JSON content.
 */
export function parseWeatherToolResult(content: string): WeatherToolResult | undefined {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.schemaVersion === 'string' &&
      parsed.tool === 'current_weather' &&
      typeof parsed.status === 'string'
    ) {
      // Validate based on status (forward-compatible: unknown schemaVersions still parse)
      const status = parsed.status;
      if (status === 'success' && parsed.current && parsed.resolvedLocation) {
        return parsed as unknown as WeatherSuccessResult;
      }
      if (status === 'needs_clarification' && parsed.candidates) {
        return parsed as unknown as WeatherClarificationResult;
      }
      if (status === 'not_found') {
        return parsed as unknown as WeatherNotFoundResult;
      }
      if (status === 'error') {
        return parsed as unknown as WeatherErrorResult;
      }
      // Forward-compat: unknown schemaVersion or unknown status
      // Return as unknown fallback (still a valid structured result)
      if (parsed.summary || status) {
        console.warn('Unknown weather tool result schema/status', {
          schemaVersion: parsed.schemaVersion,
          status,
        });
        return parsed as unknown as WeatherToolResult;
      }
    }
  } catch {
    // Not JSON, not a structured result
  }
  return undefined;
}

/**
 * Get display status from a WeatherToolResult — Task 6.2
 */
export function getWeatherDisplayStatus(result?: WeatherToolResult): WeatherDisplayStatus {
  if (!result) {
    return 'running';
  }
  // For runtime-determined status (forward-compat results have unknown status)
  if ('status' in result) {
    switch ((result as { status: string }).status) {
      case 'success':
        return 'success';
      case 'needs_clarification':
        return 'needs_clarification';
      case 'not_found':
        return 'not_found';
      case 'error':
        return 'error';
      default:
        return 'unknown';
    }
  }
  return 'running';
}

/**
 * Get a safe summary from a WeatherToolResult — Task 6.7
 */
export function getWeatherSummary(result?: WeatherToolResult): string {
  if (!result) {
    return 'Waiting for weather data...';
  }
  if ('summary' in result && typeof result.summary === 'string') {
    return result.summary;
  }
  // Fallback: safe JSON
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return 'Weather result (could not parse)';
  }
}

/**
 * Get error code from a WeatherToolResult for display
 */
export function getWeatherErrorLabel(result?: WeatherToolResult): string | undefined {
  if (!result || result.status !== 'error') {
    return undefined;
  }
  const errorLabels: Record<string, string> = {
    weather_invalid_input: 'Invalid Location',
    weather_geocoding_provider_error: 'Location Service Error',
    weather_forecast_provider_error: 'Weather Service Error',
    weather_timeout: 'Timeout',
    weather_cancelled: 'Cancelled',
    weather_unknown_error: 'Unknown Error',
  };
  return errorLabels[result.code] ?? 'Error';
}
