export type BffErrorEnvelope = {
  error: {
    source: "bff";
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

export type BffAbortReason =
  | {
      code: "bff_timeout";
      stage: "langgraph_upstream_proxy" | "langgraph_stream_proxy";
      requestId: string;
    }
  | {
      code: "client_disconnected";
      stage: "request_body" | "langgraph_stream_proxy";
      requestId: string;
    }
  | {
      code: "client_cancelled";
      stage: "langgraph_stream_proxy";
      requestId: string;
    }
  | {
      code: "upstream_error";
      stage: "langgraph_upstream_proxy";
      requestId: string;
    }
  | {
      code: "upstream_stream_error";
      stage: "langgraph_stream_proxy";
      requestId: string;
    };

type ErrorCause = {
  name?: string;
  code?: string;
  message?: string;
};

const NETWORK_ERROR_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "ECONNRESET"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

export function isBffAbortReason(value: unknown): value is BffAbortReason {
  if (!isRecord(value)) return false;
  if (typeof value.code !== "string" || typeof value.stage !== "string") return false;
  if (typeof value.requestId !== "string") return false;
  return [
    "bff_timeout",
    "client_disconnected",
    "client_cancelled",
    "upstream_error",
    "upstream_stream_error",
  ].includes(value.code);
}

export function createBffAbortError(
  reason: BffAbortReason,
  cause?: unknown
): Error {
  const error = new Error(reason.code, { cause });
  error.name = "AbortError";
  Object.defineProperty(error, "cause", {
    configurable: true,
    enumerable: false,
    value: reason,
  });
  return error;
}

function getStructuredCause(error: Error): ErrorCause | undefined {
  const cause = error.cause as
    | { name?: string; code?: string; message?: string }
    | undefined;

  return cause && !isBffAbortReason(cause)
    ? {
        name: cause.name,
        code: cause.code,
        message: cause.message,
      }
    : undefined;
}

function getAbortReasonFromError(error: unknown): BffAbortReason | undefined {
  if (isBffAbortReason(error)) return error;
  if (error instanceof Error && isBffAbortReason(error.cause)) {
    return error.cause;
  }
  return undefined;
}

function getCause(error: Error): BffErrorEnvelope["error"]["cause"] | undefined {
  const abortReason = getAbortReasonFromError(error);
  if (abortReason) {
    return {
      code: abortReason.code,
      message: abortReason.stage,
    };
  }

  return getStructuredCause(error);
}

function inferCode(error: unknown, abortReason?: BffAbortReason): string {
  const structuredAbortReason = abortReason ?? getAbortReasonFromError(error);
  if (structuredAbortReason) return structuredAbortReason.code;

  if (error instanceof Error) {
    const cause = getStructuredCause(error);
    const causeCode = cause?.code?.toUpperCase();
    if (causeCode && NETWORK_ERROR_CODES.has(causeCode)) {
      return "upstream_network_error";
    }
  }

  return "upstream_error";
}

export function createBffErrorEnvelope(
  error: unknown,
  input: {
    stage: string;
    provider?: string;
    message?: string;
    details?: Record<string, unknown>;
    abortReason?: BffAbortReason;
  }
): BffErrorEnvelope {
  const rawMessage =
    error instanceof Error
      ? error.message
      : isBffAbortReason(error)
        ? error.code
        : String(error);
  const abortReason = input.abortReason ?? getAbortReasonFromError(error);
  const details = abortReason
    ? {
        ...input.details,
        requestId: input.details?.requestId ?? abortReason.requestId,
        abortReasonCode: abortReason.code,
      }
    : input.details;

  return {
    error: {
      source: "bff",
      stage: input.stage,
      provider: input.provider,
      code: inferCode(error, abortReason),
      message: input.message ?? rawMessage,
      rawMessage,
      details,
      cause: error instanceof Error ? getCause(error) : undefined,
    },
  };
}
