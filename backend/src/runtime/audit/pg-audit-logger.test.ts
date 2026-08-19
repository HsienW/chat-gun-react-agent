import { afterEach, describe, expect, it, vi } from "vitest";

import { PgAuditLogger } from "./pg-audit-logger.js";
import type { Queryable } from "../persistence/rows.js";
import type { SpanManager } from "../../platform/tracing/span-manager.js";

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

  it("persists side-effect correlation without a raw business effect key", async () => {
    const db = new FakeAuditDb();
    const logger = new PgAuditLogger(db);
    const businessEffectKeyHash = "a".repeat(64);

    await logger.record("tool.side_effect.committed", {
      resourceType: "tool_execution",
      resourceId: "execution-1",
      taskId: "task-1",
      stepId: "step-1",
      toolExecutionId: "execution-1",
      requestId: "request-1",
      threadId: "thread-1",
      runId: "run-1",
      replayKey: "b".repeat(64),
      businessEffectKey: businessEffectKeyHash,
      externalSystemNamespace: "payment",
      externalOperationId: "operation-1",
    });

    expect(db.rows[0]).toMatchObject({
      tool_execution_id: "execution-1",
      resource_type: "tool_execution",
      resource_id: "execution-1",
      payload: {
        requestId: "request-1",
        threadId: "thread-1",
        runId: "run-1",
        replayKey: "b".repeat(64),
        businessEffectKey: businessEffectKeyHash,
        externalSystemNamespace: "payment",
        externalOperationId: "operation-1",
      },
    });
    expect(JSON.stringify(db.rows[0])).not.toContain("customer@example.com");
  });

  it("writes authorization correlation with an opaque actor and no raw credential", async () => {
    const db = new FakeAuditDb();
    const setAttributes = vi.fn<SpanManager["setAttributes"]>();
    const spanManager = {
      setAttributes,
      getActiveSpan: vi.fn(() => ({}) as ReturnType<SpanManager["getActiveSpan"]>),
    } as Pick<SpanManager, "getActiveSpan" | "setAttributes">;
    const logger = new PgAuditLogger(db, true, spanManager);

    await logger.recordAuthorizationDecision({
      request: {
        principal: {
          principalId: "person@example.com",
          principalType: "user",
          tenantId: "tenant-1",
          roles: ["member"],
          scopes: ["scope-1"],
          authSource: "trusted_gateway",
          authenticatedAt: "2026-08-18T00:00:00.000Z",
        },
        scope: {
          scopeId: "scope-1",
          scopeType: "principal",
          tenantId: "tenant-1",
          ownerPrincipalId: "person@example.com",
        },
        action: "task:read",
        resource: {
          resourceType: "task",
          resourceId: "task-resource-1",
          tenantId: "tenant-1",
        },
        context: {
          environment: "test",
          authorization: "Bearer raw-secret",
          email: "person@example.com",
        },
      },
      decision: {
        decisionId: "decision-1",
        effect: "allow",
        reasonCode: "POLICY_ALLOWED",
        createdAt: "2026-08-18T00:00:00.000Z",
      },
      policyVersion: "runtime-authorization-v1",
      taskId: "task-1",
      stepId: "step-1",
      toolExecutionId: "execution-1",
    });

    const baseRequest = {
      principal: {
        principalId: "person@example.com",
        principalType: "user" as const,
        tenantId: "tenant-1",
        roles: ["member"],
        scopes: ["scope-1"],
        authSource: "trusted_gateway" as const,
        authenticatedAt: "2026-08-18T00:00:00.000Z",
      },
      scope: {
        scopeId: "scope-1",
        scopeType: "principal" as const,
        tenantId: "tenant-1",
        ownerPrincipalId: "person@example.com",
      },
      action: "task:read",
      resource: {
        resourceType: "task",
        resourceId: "task-resource-1",
        tenantId: "tenant-1",
      },
      context: { authorization: "Bearer raw-secret" },
    };
    await logger.recordAuthorizationDecision({
      request: baseRequest,
      decision: {
        decisionId: "decision-deny",
        effect: "deny",
        reasonCode: "MISSING_ROLE_SCOPE_GRANT",
        createdAt: "2026-08-18T00:00:01.000Z",
      },
    });
    await logger.recordAuthorizationDecision({
      request: baseRequest,
      decision: {
        decisionId: "decision-confirm",
        effect: "require_confirmation",
        reasonCode: "REQUIRES_CONFIRMATION",
        createdAt: "2026-08-18T00:00:02.000Z",
      },
    });

    expect(db.rows[0]).toMatchObject({
      task_id: "task-1",
      step_id: "step-1",
      tool_execution_id: "execution-1",
      actor_type: "user",
      action: "authorization.decision",
      resource_type: "task",
      resource_id: "task-resource-1",
      decision: "allow",
      reason_code: "POLICY_ALLOWED",
      payload: expect.objectContaining({
        decisionId: "decision-1",
        scopeId: "scope-1",
        tenantId: "tenant-1",
      }),
    });
    expect(db.rows[0]?.actor_id).toMatch(/^principal_sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(db.rows[0])).not.toContain("person@example.com");
    expect(JSON.stringify(db.rows[0])).not.toContain("raw-secret");
    expect(setAttributes).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        "authorization.decision_id": "decision-1",
        "authorization.scope_id": "scope-1",
      })
    );
    expect(db.rows.map((row) => row.decision)).toEqual([
      "allow",
      "deny",
      "pending_confirmation",
    ]);
  });
});
