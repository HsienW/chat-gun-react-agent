type AuditPayload = Record<string, unknown>;

export interface AuditLogger {
  record(eventName: string, payload: AuditPayload): Promise<void>;
}

class ConsoleAuditLogger implements AuditLogger {
  async record(eventName: string, payload: AuditPayload): Promise<void> {
    console.info(`[audit] ${eventName}`, payload);
  }
}

export const auditLogger: AuditLogger = new ConsoleAuditLogger();

export async function recordMetric(
  name: string,
  payload: AuditPayload = {}
): Promise<void> {
  console.info(`[metric] ${name}`, payload);
}
