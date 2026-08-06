import { FRONTEND_ERROR_MESSAGES } from '@/lib/error-messages';

export interface ErrorEnvelope {
  error: {
    source: string;
    stage: string;
    provider?: string;
    code: string;
    message: string;
    rawMessage?: string;
    details?: Record<string, unknown>;
    cause?: {
      name?: string;
      code?: string;
      message?: string;
    };
  };
}

export interface RateLimitErrorResponse {
  error: string;
  retryAfter: number;
}

function parseJsonValue(value: unknown): unknown {
  const candidate = value instanceof Error ? value.message : value;
  if (typeof candidate !== 'string') return candidate;

  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    return undefined;
  }
}

export function parseRateLimitError(
  value: unknown
): RateLimitErrorResponse | undefined {
  const parsed = parseJsonValue(value);
  if (!parsed || typeof parsed !== 'object') return undefined;
  if (!('error' in parsed) || !('retryAfter' in parsed)) return undefined;

  const error = parsed.error;
  const retryAfter = parsed.retryAfter;
  if (
    typeof error !== 'string' ||
    typeof retryAfter !== 'number' ||
    !Number.isFinite(retryAfter) ||
    retryAfter <= 0
  ) {
    return undefined;
  }

  return {
    error,
    retryAfter: Math.ceil(retryAfter),
  };
}

export function parseErrorEnvelope(value: unknown): ErrorEnvelope | undefined {
  const parsed =
    typeof value === 'string'
      ? (() => {
          try {
            return JSON.parse(value) as unknown;
          } catch {
            return undefined;
          }
        })()
      : value;

  if (!parsed || typeof parsed !== 'object' || !('error' in parsed)) {
    return undefined;
  }

  const envelope = parsed as Partial<ErrorEnvelope>;
  const error = envelope.error;
  if (
    error &&
    typeof error.source === 'string' &&
    typeof error.stage === 'string' &&
    typeof error.code === 'string' &&
    typeof error.message === 'string'
  ) {
    return envelope as ErrorEnvelope;
  }

  return undefined;
}

export function formatErrorEnvelope(envelope: ErrorEnvelope): string {
  const { error } = envelope;
  const labels = FRONTEND_ERROR_MESSAGES.errorEnvelope;
  return [
    `${labels.source}: ${error.source}`,
    `${labels.stage}: ${error.stage}`,
    error.provider ? `${labels.provider}: ${error.provider}` : undefined,
    `${labels.code}: ${error.code}`,
    `${labels.message}: ${error.message}`,
    error.rawMessage ? `${labels.raw}: ${error.rawMessage}` : undefined,
    error.details ? `${labels.details}:\n${JSON.stringify(error.details, null, 2)}` : undefined,
    error.cause ? `${labels.cause}:\n${JSON.stringify(error.cause, null, 2)}` : undefined,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}
