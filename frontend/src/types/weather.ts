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
  | WeatherErrorResult
  | WeatherForecastResult;

export type WeatherCapability = 'current' | 'hourly' | 'daily';

export type WeatherTimeRange = {
  kind: 'now' | 'today' | 'tonight' | 'tomorrow' | 'weekend' | 'date_range';
  startDate?: string;
  endDate?: string;
  timezone?: string;
  granularity?: 'hourly' | 'daily';
};

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
  attemptedQueries?: string[];
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

export type WeatherForecastResult =
  | WeatherForecastSuccessResult
  | WeatherForecastClarificationResult
  | WeatherForecastNotFoundResult
  | WeatherForecastErrorResult;

export type WeatherForecastSuccessResult = {
  schemaVersion: string;
  tool: string;
  status: 'success';
  requestedLocation: LocationQuery;
  resolvedLocation: LocationCandidate;
  weatherCapability: Exclude<WeatherCapability, 'current'>;
  timeRange: WeatherTimeRange;
  generatedAt: string;
  timezone: string;
  daily?: WeatherDailyForecastEntry[];
  hourly?: WeatherHourlyForecastEntry[];
  units: Record<string, string>;
  provider: string;
  sourceUrl: string;
  summary: string;
};

export type WeatherDailyForecastEntry = {
  date: string;
  conditionCode?: number;
  conditionText?: string;
  temperatureMax?: number;
  temperatureMin?: number;
  precipitationProbabilityMax?: number;
  precipitationSum?: number;
};

export type WeatherHourlyForecastEntry = {
  time: string;
  conditionCode?: number;
  conditionText?: string;
  temperature?: number;
  precipitationProbability?: number;
  precipitation?: number;
};

export type WeatherForecastClarificationResult = Omit<WeatherClarificationResult, 'schemaVersion' | 'tool'> & {
  schemaVersion: string;
  tool: string;
};

export type WeatherForecastNotFoundResult = Omit<WeatherNotFoundResult, 'schemaVersion' | 'tool'> & {
  schemaVersion: string;
  tool: string;
};

export type WeatherForecastErrorResult = Omit<WeatherErrorResult, 'schemaVersion' | 'tool'> & {
  schemaVersion: string;
  tool: string;
};

// Weather display status for the Tool Panel
export type WeatherDisplayStatus =
  | 'running'
  | 'success'
  | 'needs_clarification'
  | 'not_found'
  | 'error'
  | 'timeout'
  | 'cancelled'
  | 'unknown';

export function isWeatherToolName(toolName: string): boolean {
  return toolName === 'current_weather' || toolName === 'weather_forecast';
}

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
      typeof parsed.tool === 'string' &&
      isWeatherToolName(parsed.tool) &&
      typeof parsed.status === 'string'
    ) {
      // Validate based on status (forward-compatible: unknown schemaVersions still parse)
      const status = parsed.status;
      if (parsed.tool === 'current_weather' && status === 'success' && parsed.current && parsed.resolvedLocation) {
        return parsed as unknown as WeatherSuccessResult;
      }
      if (parsed.tool === 'weather_forecast' && status === 'success' && parsed.resolvedLocation && (parsed.daily || parsed.hourly)) {
        return parsed as unknown as WeatherForecastSuccessResult;
      }
      if (status === 'needs_clarification' && parsed.candidates) {
        return parsed as unknown as WeatherClarificationResult;
      }
      if (status === 'not_found' && typeof parsed.code === 'string') {
        return parsed as unknown as WeatherNotFoundResult;
      }
      if (status === 'error' && typeof parsed.code === 'string' && typeof parsed.retryable === 'boolean') {
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
        if ('code' in result && result.code === 'weather_timeout') {
          return 'timeout';
        }
        if ('code' in result && result.code === 'weather_cancelled') {
          return 'cancelled';
        }
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
