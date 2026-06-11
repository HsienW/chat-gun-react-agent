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
