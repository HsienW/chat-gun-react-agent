export type ErrorSource = "backend" | "bff" | "frontend" | "external";

export type ErrorEnvelope = {
  error: {
    source: ErrorSource;
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
};

export type ErrorEnvelopeInput = {
  source: ErrorSource;
  stage: string;
  provider?: string;
  code?: string;
  message?: string;
  rawMessage?: string;
  details?: Record<string, unknown>;
};

function getCause(error: Error): ErrorEnvelope["error"]["cause"] | undefined {
  const cause = error.cause as
    | { name?: string; code?: string; message?: string }
    | undefined;

  if (!cause) {
    return undefined;
  }

  return {
    name: cause.name,
    code: cause.code,
    message: cause.message,
  };
}

function parseStatusCode(message: string): number | undefined {
  const match = message.match(/\[(\d{3})\s+[^\]]+\]|\b(\d{3})\b/);
  const value = Number(match?.[1] ?? match?.[2]);
  return Number.isInteger(value) ? value : undefined;
}

function parseGeminiQuotaDetails(message: string): Record<string, unknown> {
  return {
    model: message.match(/model:\s*([^,\n]+)/i)?.[1],
    limit: message.match(/limit:\s*([^,\n]+)/i)?.[1],
    retryDelay: message.match(/retryDelay":"([^"]+)"/)?.[1],
    quotaMetric: message.match(/Quota exceeded for metric:\s*([^,\n]+)/i)?.[1],
  };
}

export function inferErrorCode(
  error: unknown,
  provider?: string
): { code: string; details?: Record<string, unknown> } {
  const message = error instanceof Error ? error.message : String(error);
  const statusCode = parseStatusCode(message);

  if (statusCode === 429) {
    return {
      code: "quota_or_rate_limit_exceeded",
      details:
        provider === "Gemini" ? parseGeminiQuotaDetails(message) : { statusCode },
    };
  }

  if (statusCode !== undefined && statusCode >= 400) {
    return { code: "provider_http_error", details: { statusCode } };
  }

  if (error instanceof Error) {
    const cause = getCause(error);
    if (cause?.code) {
      return { code: String(cause.code).toLowerCase() };
    }
    if (error.name === "AbortError") {
      return { code: "timeout" };
    }
  }

  if (/fetch failed|network|connect|timeout|aborted/i.test(message)) {
    return { code: "network_error" };
  }

  return { code: "unknown_error" };
}

export function createErrorEnvelope(
  error: unknown,
  input: ErrorEnvelopeInput
): ErrorEnvelope {
  const rawMessage = input.rawMessage ?? (error instanceof Error ? error.message : String(error));
  const inferred = inferErrorCode(error, input.provider);
  const details = {
    ...inferred.details,
    ...input.details,
  };

  return {
    error: {
      source: input.source,
      stage: input.stage,
      provider: input.provider,
      code: input.code ?? inferred.code,
      message: input.message ?? rawMessage,
      rawMessage,
      details: Object.keys(details).length > 0 ? details : undefined,
      cause: error instanceof Error ? getCause(error) : undefined,
    },
  };
}

export function serializeErrorEnvelope(envelope: ErrorEnvelope): string {
  return JSON.stringify(envelope, null, 2);
}

export function parseErrorEnvelope(value: unknown): ErrorEnvelope | undefined {
  const parsed =
    typeof value === "string"
      ? (() => {
          try {
            return JSON.parse(value) as unknown;
          } catch {
            return undefined;
          }
        })()
      : value;

  if (!parsed || typeof parsed !== "object" || !("error" in parsed)) {
    return undefined;
  }

  const envelope = parsed as Partial<ErrorEnvelope>;
  if (
    envelope.error &&
    typeof envelope.error === "object" &&
    typeof envelope.error.source === "string" &&
    typeof envelope.error.stage === "string" &&
    typeof envelope.error.code === "string" &&
    typeof envelope.error.message === "string"
  ) {
    return envelope as ErrorEnvelope;
  }

  return undefined;
}

export function formatErrorEnvelope(envelope: ErrorEnvelope): string {
  const { error } = envelope;
  const details = error.details
    ? `\nDetails: ${JSON.stringify(error.details, null, 2)}`
    : "";
  const cause = error.cause ? `\nCause: ${JSON.stringify(error.cause, null, 2)}` : "";
  const raw = error.rawMessage ? `\nRaw: ${error.rawMessage}` : "";

  return [
    `Source: ${error.source}`,
    `Stage: ${error.stage}`,
    error.provider ? `Provider: ${error.provider}` : undefined,
    `Code: ${error.code}`,
    `Message: ${error.message}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n")
    .concat(details, cause, raw);
}
