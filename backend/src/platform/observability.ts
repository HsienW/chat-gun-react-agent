type AuditPayload = Record<string, unknown>;

export interface AuditLogger {
  record(eventName: string, payload: AuditPayload): Promise<void>;
}

class ConsoleAuditLogger implements AuditLogger {
  async record(eventName: string, payload: AuditPayload): Promise<void> {
    console.info(`[audit] ${eventName}`, JSON.stringify(payload));
  }
}

export const auditLogger: AuditLogger = new ConsoleAuditLogger();

export async function recordMetric(
  name: string,
  payload: AuditPayload = {}
): Promise<void> {
  console.info(`[metric] ${name}`, JSON.stringify(payload));
}

// Weather-specific audit helper — Task 7.1, 7.2
// Records location resolution events without sensitive data — Task 7.3
export async function recordWeatherAuditEvent(
  eventName: string,
  payload: {
    raw?: string;
    provider?: string;
    strategy?: string;
    candidateCount?: number;
    attemptCount?: number;
    durationMs?: number;
    resultStatus?: string;
    errorCode?: string;
    retryable?: boolean;
    repaired?: boolean;
  }
): Promise<void> {
  // Do not record API Key, Proxy Credential, full Prompt, or full Conversation — Task 7.3
  const safePayload: AuditPayload = {};

  if (payload.raw) {
    // Use truncated hash in production; full value for debug environments
    safePayload.raw = payload.raw.length > 80 ? payload.raw.slice(0, 80) + "..." : payload.raw;
  }
  if (payload.provider) safePayload.provider = payload.provider;
  if (payload.strategy) safePayload.strategy = payload.strategy;
  if (payload.candidateCount !== undefined) safePayload.candidateCount = payload.candidateCount;
  if (payload.attemptCount !== undefined) safePayload.attemptCount = payload.attemptCount;
  if (payload.durationMs !== undefined) safePayload.durationMs = payload.durationMs;
  if (payload.resultStatus) safePayload.resultStatus = payload.resultStatus;
  if (payload.errorCode) safePayload.errorCode = payload.errorCode;
  if (payload.retryable !== undefined) safePayload.retryable = payload.retryable;
  if (payload.repaired !== undefined) safePayload.repaired = payload.repaired;

  await auditLogger.record(eventName, safePayload);
}

// Weather metric helper — Task 7.2
export async function recordWeatherMetric(
  name: string,
  value: number,
  labels: Record<string, string | number> = {}
): Promise<void> {
  await recordMetric(`weather.${name}`, {
    value,
    ...labels,
  });
}
