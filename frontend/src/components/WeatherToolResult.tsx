// WeatherToolResult component — Task 6.2, 6.3, 6.4, 6.5, 6.6, 6.7
// Renders structured weather tool results in the chat UI.

import {
  parseWeatherToolResult,
  getWeatherDisplayStatus,
  getWeatherSummary,
  getWeatherErrorLabel,
} from '@/types/weather';
import { useState, type KeyboardEvent } from 'react';
import { MapPin, AlertTriangle, SearchX, Clock, CheckCircle, HelpCircle, CloudSun, Send, XCircle } from 'lucide-react';
import type { WeatherForecastSuccessResult, WeatherSuccessResult, WeatherToolResult } from '@/types/weather';

interface WeatherToolResultCardProps {
  content: string;
  isResuming?: boolean;
  onClarificationReply?: (replyText: string) => void;
  onClarificationCancel?: () => void;
}

/**
 * Weather tool status badge colors and labels
 */
const STATUS_CONFIG: Record<string, { label: string; className: string; icon: React.ReactNode }> = {
  running: {
    label: '執行中',
    className: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
    icon: <Clock className="h-3 w-3 mr-1" />,
  },
  success: {
    label: '完成',
    className: 'bg-green-500/10 text-green-500 border-green-500/20',
    icon: <CheckCircle className="h-3 w-3 mr-1" />,
  },
  needs_clarification: {
    label: '需補充地點',
    className: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    icon: <HelpCircle className="h-3 w-3 mr-1" />,
  },
  not_found: {
    label: '找不到地點',
    className: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    icon: <SearchX className="h-3 w-3 mr-1" />,
  },
  error: {
    label: '錯誤',
    className: 'bg-red-500/10 text-red-400 border-red-500/20',
    icon: <AlertTriangle className="h-3 w-3 mr-1" />,
  },
  timeout: {
    label: '逾時',
    className: 'bg-red-500/10 text-red-400 border-red-500/20',
    icon: <Clock className="h-3 w-3 mr-1" />,
  },
  cancelled: {
    label: '已取消',
    className: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
    icon: <AlertTriangle className="h-3 w-3 mr-1" />,
  },
  unknown: {
    label: '完成',
    className: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
    icon: <CloudSun className="h-3 w-3 mr-1" />,
  },
};

function isCurrentWeatherSuccess(result: WeatherToolResult | undefined): result is WeatherSuccessResult {
  return result?.status === 'success' && result.tool === 'current_weather';
}

function isForecastWeatherSuccess(result: WeatherToolResult | undefined): result is WeatherForecastSuccessResult {
  return result?.status === 'success' && result.tool === 'weather_forecast';
}

export function WeatherToolResultCard({
  content,
  isResuming = false,
  onClarificationReply,
  onClarificationCancel,
}: WeatherToolResultCardProps) {
  const result = parseWeatherToolResult(content);
  const displayStatus = getWeatherDisplayStatus(result);
  const config = STATUS_CONFIG[displayStatus] ?? STATUS_CONFIG.unknown;
  const summary = getWeatherSummary(result);

  // Render based on status
  return (
    <div className="border border-border bg-card/70 rounded-lg overflow-hidden my-2">
      {/* Status header */}
      <div className="px-4 py-2 flex items-center gap-2 border-b border-border bg-[#1a1a1a]/50">
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${config.className}`}>
          {config.icon}
          {config.label}
        </span>
      </div>

      {/* Content based on status */}
      <div className="px-4 py-3 space-y-2">
        {/* Task 6.5: Success — show weather data */}
        {displayStatus === 'success' && isCurrentWeatherSuccess(result) && (
          <WeatherSuccessDisplay result={result} />
        )}

        {displayStatus === 'success' && isForecastWeatherSuccess(result) && (
          <WeatherForecastSuccessDisplay result={result} />
        )}

        {/* Task 6.3, 6.4: Clarification — show candidates */}
        {displayStatus === 'needs_clarification' && result?.status === 'needs_clarification' && (
          onClarificationReply ? (
            <WeatherClarificationInteractive
              result={result}
              isResuming={isResuming}
              onReply={onClarificationReply}
              onCancel={onClarificationCancel}
            />
          ) : (
            <WeatherClarificationDisplay result={result} />
          )
        )}

        {/* Unknown status or schema — safe fallback (Task 6.6, 6.7) */}
        {(displayStatus === 'unknown' || !result) && (
          <div className="text-xs text-muted-foreground whitespace-pre-wrap break-words">
            {summary}
          </div>
        )}

        {/* Error display */}
        {(displayStatus === 'error' || displayStatus === 'timeout' || displayStatus === 'cancelled') && result?.status === 'error' && (
          <WeatherErrorDisplay result={result} />
        )}

        {/* not_found display */}
        {displayStatus === 'not_found' && result?.status === 'not_found' && (
          <div className="text-xs text-muted-foreground">
            {result.summary}
          </div>
        )}

        {/* Running state */}
        {displayStatus === 'running' && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3 w-3 animate-pulse" />
            <span>查詢天氣中...</span>
          </div>
        )}
      </div>
    </div>
  );
}

function WeatherSuccessDisplay({ result }: { result: WeatherSuccessResult }) {
  const { current, resolvedLocation, observedAt, timezone, sourceUrl } = result;
  const units = result.units ?? {};

  const displayName = [resolvedLocation.name, resolvedLocation.admin2, resolvedLocation.admin1, resolvedLocation.country]
    .filter(Boolean)
    .join(', ');

  // Task 6.5: no lat/lng in normal mode
  const dataRows: Array<{ label: string; value: string }> = [];
  if (current.temperature !== undefined) {
    dataRows.push({ label: 'Temperature', value: `${current.temperature}${units.temperature_2m ?? ''}` });
  }
  if (current.apparentTemperature !== undefined) {
    dataRows.push({ label: 'Feels like', value: `${current.apparentTemperature}${units.apparent_temperature ?? ''}` });
  }
  if (current.relativeHumidity !== undefined) {
    dataRows.push({ label: 'Humidity', value: `${current.relativeHumidity}${units.relative_humidity_2m ?? ''}` });
  }
  if (current.conditionText) {
    dataRows.push({ label: 'Condition', value: current.conditionText });
  }
  if (current.windSpeed !== undefined) {
    dataRows.push({ label: 'Wind', value: `${current.windSpeed}${units.wind_speed_10m ?? ''} ${current.windDirectionText ?? ''}` });
  }
  if (current.windGusts !== undefined) {
    dataRows.push({ label: 'Gusts', value: `${current.windGusts}${units.wind_gusts_10m ?? ''}` });
  }
  if (current.precipitation !== undefined) {
    dataRows.push({ label: 'Precipitation', value: `${current.precipitation}${units.precipitation ?? ''}` });
  }
  if (current.rain !== undefined) {
    dataRows.push({ label: 'Rain', value: `${current.rain}${units.rain ?? ''}` });
  }
  if (current.cloudCover !== undefined) {
    dataRows.push({ label: 'Cloud cover', value: `${current.cloudCover}${units.cloud_cover ?? '%'}` });
  }
  if (current.pressureMsl !== undefined) {
    dataRows.push({ label: 'Pressure', value: `${current.pressureMsl}${units.pressure_msl ?? ''}` });
  }

  return (
    <div className="space-y-2">
      {/* Location header */}
      <div className="flex items-center gap-1.5 text-sm font-medium">
        <MapPin className="h-3.5 w-3.5 text-primary" />
        <span>{displayName}</span>
      </div>

      {/* Observation time */}
      {observedAt && (
        <div className="text-xs text-muted-foreground">
          {observedAt}{timezone ? ` (${timezone})` : ''}
        </div>
      )}

      {/* Weather data grid */}
      <div className="grid grid-cols-2 gap-1.5 mt-2">
        {dataRows.map((row) => (
          <div key={row.label} className="flex items-center justify-between text-xs px-2 py-1 rounded bg-[#2B1C17]/40">
            <span className="text-muted-foreground">{row.label}</span>
            <span className="font-medium">{row.value}</span>
          </div>
        ))}
      </div>

      {/* Source link */}
      {sourceUrl && (
        <div className="text-[10px] text-muted-foreground/60 mt-1">
          Source: Open-Meteo
        </div>
      )}
    </div>
  );
}

function WeatherForecastSuccessDisplay({ result }: { result: WeatherForecastSuccessResult }) {
  const { resolvedLocation, timezone } = result;
  const units = result.units ?? {};
  const displayName = [resolvedLocation.name, resolvedLocation.admin2, resolvedLocation.admin1, resolvedLocation.country]
    .filter(Boolean)
    .join(', ');
  const dailyEntries = result.daily?.slice(0, 7) ?? [];
  const hourlyEntries = result.hourly?.slice(0, 8) ?? [];

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-sm font-medium">
        <MapPin className="h-3.5 w-3.5 text-primary" />
        <span>{displayName}</span>
      </div>

      <div className="text-xs text-muted-foreground">
        {result.timeRange.kind}{timezone ? ` (${timezone})` : ''}
      </div>

      {dailyEntries.length > 0 && (
        <div className="space-y-1.5 mt-2">
          {dailyEntries.map((entry) => (
            <div key={entry.date} className="text-xs px-2 py-1.5 rounded bg-[#2B1C17]/40">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{entry.date}</span>
                <span>{entry.conditionText ?? 'Unknown'}</span>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground mt-1">
                {(entry.temperatureMin !== undefined || entry.temperatureMax !== undefined) && (
                  <span>
                    {entry.temperatureMin ?? '?'}-{entry.temperatureMax ?? '?'}{units.temperature_2m_max ?? units.temperature_2m_min ?? ''}
                  </span>
                )}
                {entry.precipitationProbabilityMax !== undefined && (
                  <span>Rain {entry.precipitationProbabilityMax}{units.precipitation_probability_max ?? '%'}</span>
                )}
                {entry.precipitationSum !== undefined && (
                  <span>{entry.precipitationSum}{units.precipitation_sum ?? 'mm'}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {hourlyEntries.length > 0 && (
        <div className="space-y-1.5 mt-2">
          {hourlyEntries.map((entry) => (
            <div key={entry.time} className="text-xs px-2 py-1.5 rounded bg-[#2B1C17]/40">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{entry.time}</span>
                <span>{entry.conditionText ?? 'Unknown'}</span>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground mt-1">
                {entry.temperature !== undefined && (
                  <span>{entry.temperature}{units.temperature_2m ?? ''}</span>
                )}
                {entry.precipitationProbability !== undefined && (
                  <span>Rain {entry.precipitationProbability}{units.precipitation_probability ?? '%'}</span>
                )}
                {entry.precipitation !== undefined && (
                  <span>{entry.precipitation}{units.precipitation ?? 'mm'}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="text-[10px] text-muted-foreground/60 mt-1">
        Source: Open-Meteo
      </div>
    </div>
  );
}

export function WeatherClarificationInteractive({
  result,
  isResuming,
  onReply,
  onCancel,
}: {
  result: NonNullable<ReturnType<typeof parseWeatherToolResult>> & { status: 'needs_clarification' };
  isResuming: boolean;
  onReply: (replyText: string) => void;
  onCancel?: () => void;
}) {
  const candidates = result.candidates.slice(0, 5);
  const [replyText, setReplyText] = useState('');
  const trimmedReply = replyText.trim();
  const canSubmit = Boolean(trimmedReply) && !isResuming;

  const submitReply = () => {
    if (!canSubmit) return;
    onReply(trimmedReply);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      submitReply();
    }
  };

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">
        {result.message || result.summary}
      </div>

      {candidates.length > 0 ? (
        <div className="space-y-1.5">
          {candidates.map((candidate, index) => {
            const isSelected = replyText === candidate.displayName;
            return (
              <button
                key={`${candidate.name}-${candidate.countryCode ?? 'unknown'}-${index}`}
                type="button"
                disabled={isResuming}
                onClick={() => setReplyText(candidate.displayName)}
                className={`w-full text-left text-xs px-2 py-2 rounded border transition-colors ${
                  isSelected
                    ? 'bg-blue-500/15 border-blue-400/50'
                    : 'bg-[#2B1C17]/40 border-[#5A4036]/30 hover:border-blue-400/40 focus:border-blue-400/50'
                } disabled:opacity-60 disabled:cursor-not-allowed`}
              >
                <div className="flex items-start gap-2">
                  <MapPin className="h-3 w-3 mt-0.5 text-primary flex-shrink-0" />
                  <div className="min-w-0">
                    <div className="font-medium break-words">{candidate.displayName}</div>
                    <div className="text-muted-foreground/70 break-words">
                      {[candidate.country, candidate.admin1, candidate.admin2]
                        .filter(Boolean)
                        .join(', ')}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">
          Please enter a more specific location.
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={replyText}
          disabled={isResuming}
          onChange={(event) => setReplyText(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter a more specific location"
          className="min-w-0 flex-1 rounded border border-[#5A4036]/60 bg-[#1a1a1a]/70 px-3 py-2 text-xs text-[#F8F1E7] outline-none focus:border-blue-400/60 disabled:opacity-60"
        />
        <button
          type="button"
          disabled={!canSubmit}
          onClick={submitReply}
          className="inline-flex items-center justify-center gap-1.5 rounded border border-blue-400/40 bg-blue-500/15 px-3 py-2 text-xs text-blue-100 transition-colors hover:bg-blue-500/25 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send className="h-3 w-3" />
          Submit
        </button>
        <button
          type="button"
          disabled={isResuming}
          onClick={onCancel}
          className="inline-flex items-center justify-center gap-1.5 rounded border border-[#5A4036]/60 bg-[#2B1C17]/40 px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-[#F8F1E7] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <XCircle className="h-3 w-3" />
          Cancel
        </button>
      </div>
    </div>
  );
}

function WeatherClarificationDisplay({ result }: { result: NonNullable<ReturnType<typeof parseWeatherToolResult>> & { status: 'needs_clarification' } }) {
  const candidates = result.candidates.slice(0, 5);

  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground">
        {result.message || result.summary}
      </div>

      {/* Candidates list — Task 6.3, 6.4 */}
      {candidates.length > 0 && (
        <div className="space-y-1 mt-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-medium">
            Possible matches:
          </div>
          {candidates.map((candidate, index) => (
            <div
              key={`${candidate.name}-${candidate.countryCode}-${index}`}
              className="flex items-start gap-2 text-xs px-2 py-1.5 rounded bg-[#2B1C17]/40 border border-[#5A4036]/30"
            >
              <MapPin className="h-3 w-3 mt-0.5 text-primary flex-shrink-0" />
              <div>
                <div className="font-medium">{candidate.displayName}</div>
                <div className="text-muted-foreground/70">
                  {[candidate.country, candidate.admin1, candidate.admin2]
                    .filter(Boolean)
                    .join(', ')}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="text-[10px] text-muted-foreground/60 mt-1">
        Please specify a country or region and ask again.
      </div>
    </div>
  );
}

function WeatherErrorDisplay({ result }: { result: NonNullable<ReturnType<typeof parseWeatherToolResult>> & { status: 'error' } }) {
  const errorLabel = getWeatherErrorLabel(result) ?? 'Error';

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-xs text-red-400">
        <AlertTriangle className="h-3 w-3" />
        <span className="font-medium">{errorLabel}</span>
      </div>
      <div className="text-xs text-muted-foreground">
        {result.summary}
      </div>
      {/* Do NOT show stack trace, API key, or proxy credential — Task 6.8 */}
    </div>
  );
}
