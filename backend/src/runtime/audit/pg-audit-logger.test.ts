import { afterEach, describe, expect, it, vi } from "vitest";

import { PgAuditLogger } from "./pg-audit-logger.js";
import type { Queryable } from "../persistence/rows.js";

interface AuditRow extends Record<string, unknown> {
  event_id: string;
  task_id: string | null;
  step_id: string | null;
  tool_execution_id: string | null;
  actor_type: string;
  actor_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  decision: string;
  reason_code: string | null;
  payload: unknown;
  before_state_ref: string | null;
  after_state_ref: string | null;
  created_at: string;
}

class FakeAuditDb implements Queryable {
  readonly rows: AuditRow[] = [];

  async query<TResult extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<{ rows: TResult[]; rowCount: number | null }> {
    if (text.includes("INSERT INTO audit_events")) {
      this.rows.push({
        event_id: String(values[0]),
        task_id: values[1] === null ? null : String(values[1]),
        step_id: values[2] === null ? null : String(values[2]),
        tool_execution_id: values[3] === null ? null : String(values[3]),
        actor_type: String(values[4]),
        actor_id: String(values[5]),
        action: String(values[6]),
        resource_type: String(values[7]),
        resource_id: String(values[8]),
        decision: String(values[9]),
        reason_code: values[10] === null ? null : String(values[10]),
        payload: values[11],
        before_state_ref: values[12] === null ? null : String(values[12]),
        after_state_ref: values[13] === null ? null : String(values[13]),
        created_at: String(values[14]),
      });
      return { rows: [], rowCount: 1 };
    }

    if (text.includes("SELECT") && text.includes("audit_events")) {
      const taskId = values[0];
      const rows = taskId === undefined
        ? this.rows
        : this.rows.filter((row) => row.task_id === taskId);
      return { rows: rows as unknown as TResult[], rowCount: rows.length };
    }

    throw new Error(`Unexpected query: ${text}`);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PgAuditLogger", () => {
  it("writes redacted events and queries a task audit trail", async () => {
    const db = new FakeAuditDb();
    const logger = new PgAuditLogger(db);

    await logger.record("tool.invoke.start", {
      toolName: "current_weather",
      taskId: "task-abc",
      inputChars: 100,
      apiKey: "do-not-persist",
    });
    await logger.record("tool.invoke.start", {
      toolName: "current_weather",
      taskId: "task-other",
    });

    await expect(logger.getEvents({ taskId: "task-abc" })).resolves.toMatchObject([
      {
        taskId: "task-abc",
        action: "tool.invoke.start",
        resourceType: "tool",
        resourceId: "current_weather",
        payload: {
          toolName: "current_weather",
          taskId: "task-abc",
          inputChars: 100,
        },
      },
    ]);
  });

  it("warns and does not reject when persistence fails", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const db: Queryable = {
      query: async () => {
        throw new Error("database unavailable");
      },
    };
    const logger = new PgAuditLogger(db);

    await expect(logger.record("tool.invoke.start", { toolName: "weather" })).resolves.toBeUndefined();
    expect(warning).toHaveBeenCalledOnce();
  });
});
