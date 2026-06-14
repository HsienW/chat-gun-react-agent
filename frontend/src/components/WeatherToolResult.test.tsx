import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WeatherToolResultCard } from './WeatherToolResult';
import { ToolMessageDisplay } from './ToolMessageDisplay';
import { parseWeatherToolResult, type WeatherToolResult } from '@/types/weather';
import type { ToolCall, ToolMessage } from '@/types/tools';

// Build a success result fixture — Task 1.5
function createSuccessResult(overrides?: Partial<WeatherToolResult>): WeatherToolResult {
  return {
    schemaVersion: '1.0',
    tool: 'current_weather',
    status: 'success',
    requestedLocation: { raw: 'Tokyo', location: 'Tokyo' },
    resolvedLocation: {
      provider: 'open-meteo',
      name: 'Tokyo',
      displayName: 'Tokyo, Japan',
      countryCode: 'JP',
      latitude: 35.676,
      longitude: 139.65,
      timezone: 'Asia/Tokyo',
    },
    observedAt: '2024-06-01T12:00',
    timezone: 'Asia/Tokyo',
    current: {
      conditionText: 'clear sky',
      temperature: 22,
      apparentTemperature: 20,
      relativeHumidity: 65,
      windSpeed: 10,
      windDirectionText: 'N',
    },
    units: {
      temperature_2m: '°C',
      wind_speed_10m: 'km/h',
    },
    provider: 'Open-Meteo',
    sourceUrl: 'https://api.open-meteo.com/v1/forecast?latitude=35.676&longitude=139.65',
    summary: 'Current weather for Tokyo: 22°C, clear sky.',
    ...overrides,
  } as WeatherToolResult;
}

describe('WeatherToolResultCard', () => {
  // Task 6.9 — Component tests

  it('should render success status correctly', () => {
    const result = createSuccessResult();
    const json = JSON.stringify(result);
    render(<WeatherToolResultCard content={json} />);
    expect(screen.getByText('完成')).toBeTruthy();
    expect(screen.getByText('Tokyo')).toBeTruthy();
    expect(screen.getByText(/22/)).toBeTruthy();  // temperature
  });

  it('should render needs_clarification with candidates (Task 6.3, 6.4)', () => {
    const result: WeatherToolResult = {
      schemaVersion: '1.0',
      tool: 'current_weather',
      status: 'needs_clarification',
      requestedLocation: { raw: 'Springfield', location: 'Springfield' },
      candidates: [
        { name: 'Springfield', displayName: 'Springfield, Illinois', country: 'United States', admin1: 'Illinois' },
        { name: 'Springfield', displayName: 'Springfield, Missouri', country: 'United States', admin1: 'Missouri' },
      ],
      message: 'Which Springfield?',
      summary: 'Ambiguous location',
    };
    const json = JSON.stringify(result);
    render(<WeatherToolResultCard content={json} />);
    expect(screen.getByText('需補充地點')).toBeTruthy();
    expect(screen.getByText('Springfield, Illinois')).toBeTruthy();
    expect(screen.getByText('Springfield, Missouri')).toBeTruthy();
  });

  it('should render not_found status', () => {
    const result: WeatherToolResult = {
      schemaVersion: '1.0',
      tool: 'current_weather',
      status: 'not_found',
      requestedLocation: { raw: 'Xyzzy', location: 'xyzzy' },
      code: 'weather_location_not_found',
      message: 'Not found',
      summary: 'Could not find location',
    };
    const json = JSON.stringify(result);
    render(<WeatherToolResultCard content={json} />);
    expect(screen.getByText('找不到地點')).toBeTruthy();
  });

  it('should render error status', () => {
    const result: WeatherToolResult = {
      schemaVersion: '1.0',
      tool: 'current_weather',
      status: 'error',
      requestedLocation: { raw: 'Tokyo', location: 'Tokyo' },
      code: 'weather_timeout',
      retryable: true,
      message: 'Timeout',
      summary: 'Weather service timed out',
    };
    const json = JSON.stringify(result);
    render(<WeatherToolResultCard content={json} />);
    expect(screen.getByText('Timeout')).toBeTruthy();
  });

  it('should handle unknown status gracefully without crash (Task 6.6)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const content = '{"schemaVersion":"99.0","tool":"current_weather","status":"unknown_future_status","summary":"fallback summary text"}';
    render(<WeatherToolResultCard content={content} />);
    // Should show summary without crashing
    expect(screen.getByText(/fallback/)).toBeTruthy();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('should handle non-JSON content gracefully without crash (Task 6.7)', () => {
    const content = 'Some legacy text output from weather tool';
    render(<WeatherToolResultCard content={content} />);
    // Should not crash, show "Waiting for weather data..." fallback
    expect(screen.getByText('Waiting for weather data...')).toBeTruthy();
  });

  it('should not display latitude/longitude in normal mode (Task 6.5)', () => {
    const result = createSuccessResult();
    const json = JSON.stringify(result);
    render(<WeatherToolResultCard content={json} />);
    expect(screen.queryByText(/35\.676/)).toBeNull();
    expect(screen.queryByText(/139\.65/)).toBeNull();
  });

  // Task 6.8 — terminal state: once result exists, no "running" shown
  it('should not show "running" when result is terminal (success)', () => {
    const result = createSuccessResult();
    const json = JSON.stringify(result);
    render(<WeatherToolResultCard content={json} />);
    expect(screen.queryByText('執行中')).toBeNull();
  });

  it('should not show API Key, Stack Trace, or Proxy Credential (Task 6.8/9.15)', () => {
    const result: WeatherToolResult = {
      schemaVersion: '1.0',
      tool: 'current_weather',
      status: 'error',
      requestedLocation: { raw: 'Tokyo', location: 'Tokyo' },
      code: 'weather_forecast_provider_error',
      retryable: false,
      message: 'Provider error',
      summary: 'Weather service unavailable',
    };
    const json = JSON.stringify(result);
    // Verify the result doesn't contain sensitive fields
    expect(json).not.toContain('api_key');
    expect(json).not.toContain('API_KEY');
    expect(json).not.toContain('proxy');
    expect(json).not.toContain('stack_trace');
  });

  it('should render cancelled weather as terminal error without running state (Task 9.14)', () => {
    const result: WeatherToolResult = {
      schemaVersion: '1.0',
      tool: 'current_weather',
      status: 'error',
      requestedLocation: { raw: 'Tokyo', location: 'Tokyo' },
      code: 'weather_cancelled',
      retryable: false,
      message: 'weather_fetch_cancelled',
      summary: 'Weather lookup was cancelled.',
    };

    render(<WeatherToolResultCard content={JSON.stringify(result)} />);

    expect(screen.getByText('Weather lookup was cancelled.')).toBeTruthy();
    expect(screen.queryByText('Waiting for weather data...')).toBeNull();
  });

  it('should not render sensitive provider details from hidden error message fields (Task 9.15)', () => {
    const result: WeatherToolResult = {
      schemaVersion: '1.0',
      tool: 'current_weather',
      status: 'error',
      requestedLocation: { raw: 'Tokyo', location: 'Tokyo' },
      code: 'weather_forecast_provider_error',
      retryable: false,
      message: 'Stack Trace: boom API_KEY=secret HTTPS_PROXY=http://secret',
      summary: 'Weather service unavailable',
    };

    render(<WeatherToolResultCard content={JSON.stringify(result)} />);

    expect(screen.getByText('Weather service unavailable')).toBeTruthy();
    expect(screen.queryByText(/API_KEY/)).toBeNull();
    expect(screen.queryByText(/HTTPS_PROXY/)).toBeNull();
    expect(screen.queryByText(/Stack Trace/)).toBeNull();
  });

  it('should warn when parsing unknown structured weather status', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = parseWeatherToolResult(
      '{"schemaVersion":"1.0","tool":"current_weather","status":"future_status","summary":"future result"}'
    );

    expect(result).toBeTruthy();
    expect(warn).toHaveBeenCalledWith(
      'Unknown weather tool result schema/status',
      expect.objectContaining({ status: 'future_status' })
    );
    warn.mockRestore();
  });

  it('should show unknown badge for unknown structured weather status in ToolMessageDisplay', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const toolCall: ToolCall = {
      id: 'call-weather',
      name: 'current_weather',
      args: {},
      type: 'tool_call',
    };
    const toolMessage: ToolMessage = {
      id: 'tool-weather',
      type: 'tool',
      tool_call_id: 'call-weather',
      name: 'current_weather',
      content:
        '{"schemaVersion":"1.0","tool":"current_weather","status":"future_status","summary":"future result"}',
    };

    render(
      <ToolMessageDisplay
        toolCall={toolCall}
        toolMessage={toolMessage}
        isExpanded={false}
        onToggle={() => undefined}
      />
    );

    expect(screen.getByText('未知結果')).toBeTruthy();
    warn.mockRestore();
  });
});
