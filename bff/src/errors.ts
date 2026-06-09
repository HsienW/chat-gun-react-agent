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

function getCause(error: Error): BffErrorEnvelope["error"]["cause"] | undefined {
  const cause = error.cause as
    | { name?: string; code?: string; message?: string }
    | undefined;

  return cause
    ? {
        name: cause.name,
        code: cause.code,
        message: cause.message,
      }
    : undefined;
}

function inferCode(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "AbortError") return "upstream_timeout";
    const cause = getCause(error);
    if (cause?.code) return String(cause.code).toLowerCase();
    if (/fetch failed|connect|network|timeout/i.test(error.message)) {
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
  }
): BffErrorEnvelope {
  const rawMessage = error instanceof Error ? error.message : String(error);

  return {
    error: {
      source: "bff",
      stage: input.stage,
      provider: input.provider,
      code: inferCode(error),
      message: input.message ?? rawMessage,
      rawMessage,
      details: input.details,
      cause: error instanceof Error ? getCause(error) : undefined,
    },
  };
}
