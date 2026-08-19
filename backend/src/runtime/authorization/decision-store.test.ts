import { describe, expect, it, vi } from "vitest";

import type { Queryable } from "../persistence/rows.js";
import type {
  AuthorizationDecision,
  AuthorizationRequest,
} from "./authorization.js";
import {
  DefaultContextRedactor,
  PgDecisionStore,
  type ContextRedactor,
} from "./decision-store.js";

function createFakeQuery(
  handler: (
    text: string,
    values: readonly unknown[]
  ) => Promise<{
    rows: Record<string, unknown>[];
    rowCount: number | null;
  }>
): Queryable["query"] {
  return async <TResult extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = []
  ) => {
    const result = await handler(text, values);
    return { rows: result.rows as TResult[], rowCount: result.rowCount };
  };
}

const request: AuthorizationRequest = {
  principal: {
    principalId: "principal-1",
    principalType: "user",
    tenantId: "tenant-1",
    roles: ["editor"],
    scopes: ["task:write"],
    authSource: "trusted_gateway",
    authenticatedAt: "2026-08-18T00:00:00.000Z",
  },
  scope: {
    scopeId: "scope-1",
    scopeType: "team",
    tenantId: "tenant-1",
  },
  action: "task:update",
  resource: {
    resourceType: "task",
    resourceId: "task-1",
    tenantId: "tenant-1",
    ownerScopeId: "scope-1",
  },
  context: {
    amount: 1500,
    risk: "high",
    environment: "production",
    requestId: "request-1",
    apiKey: "do-not-store",
    credential: "do-not-store",
    email: "person@example.com",
    freeform: "unclassified text",
  },
};

const decision: AuthorizationDecision = {
  decisionId: "decision-1",
  effect: "require_confirmation",
  reasonCode: "REQUIRES_CONFIRMATION",
  matchedPolicy: "task-write-policy-v1",
  matchedGrantId: "grant-1",
  createdAt: "2026-08-18T01:00:00.000Z",
};

function decisionRow(overrides: Record<string, unknown> = {}) {
  return {
    decision_id: "decision-1",
    principal_id: "principal-1",
    principal_type: "user",
    tenant_id: "tenant-1",
    scope_id: "scope-1",
    action: "task:update",
    resource_type: "task",
    resource_id: "task-1",
    effect: "require_confirmation",
    reason_code: "REQUIRES_CONFIRMATION",
    matched_policy: "task-write-policy-v1",
    matched_grant_id: "grant-1",
    policy_version: "v1",
    task_id: "task-1",
    step_id: "step-1",
    tool_execution_id: "execution-1",
    context_summary: {
      amount: 1500,
      risk: "high",
      environment: "production",
      requestId: "request-1",
    },
    created_at: "2026-08-18T01:00:00.000Z",
    ...overrides,
  };
}

describe("DefaultContextRedactor", () => {
  it("keeps only allowlisted summary fields and blocks secrets and PII", () => {
    const redactor = new DefaultContextRedactor();

    expect(redactor.redact(request.context ?? {})).toEqual({
      amount: 1500,
      risk: "high",
      environment: "production",
      requestId: "request-1",
    });
  });
});

describe("PgDecisionStore", () => {
  it("redacts context before recording a permission decision", async () => {
    let insertValues: readonly unknown[] = [];
    const redact = vi.fn<ContextRedactor["redact"]>(() => ({
      risk: "high",
    }));
    const db: Queryable = {
      query: createFakeQuery(async (text, values) => {
        expect(text).toContain("INSERT INTO permission_decisions");
        insertValues = values;
        return { rows: [], rowCount: 1 };
      }),
    };
    const recordAuthorizationDecision = vi.fn(async () => undefined);
    const store = new PgDecisionStore(
      db,
      { redact },
      { recordAuthorizationDecision }
    );

    await store.record({
      request,
      decision,
      policyVersion: "v1",
      taskId: "task-1",
      stepId: "step-1",
      toolExecutionId: "execution-1",
    });

    expect(redact).toHaveBeenCalledOnce();
    expect(redact).toHaveBeenCalledWith(request.context);
    expect(insertValues).toEqual([
      "decision-1",
      "principal-1",
      "user",
      "tenant-1",
      "scope-1",
      "task:update",
      "task",
      "task-1",
      "require_confirmation",
      "REQUIRES_CONFIRMATION",
      "task-write-policy-v1",
      "grant-1",
      "v1",
      "task-1",
      "step-1",
      "execution-1",
      { risk: "high" },
      "2026-08-18T01:00:00.000Z",
    ]);
    expect(JSON.stringify(insertValues)).not.toContain("do-not-store");
    expect(JSON.stringify(insertValues)).not.toContain("person@example.com");
    expect(recordAuthorizationDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        decision,
        request: expect.objectContaining({
          action: request.action,
          context: { risk: "high" },
        }),
      }),
      { risk: "high" }
    );
    expect(JSON.stringify(recordAuthorizationDecision.mock.calls)).not.toContain(
      "do-not-store"
    );
  });

  it("finds recorded decisions by toolExecutionId", async () => {
    let selectValues: readonly unknown[] = [];
    const db: Queryable = {
      query: createFakeQuery(async (text, values) => {
        expect(text).toContain("tool_execution_id = $1");
        selectValues = values;
        return { rows: [decisionRow()], rowCount: 1 };
      }),
    };
    const store = new PgDecisionStore(db, new DefaultContextRedactor());

    await expect(
      store.findByToolExecutionId("execution-1")
    ).resolves.toMatchObject({
      decision,
      principalId: "principal-1",
      principalType: "user",
      tenantId: "tenant-1",
      scopeId: "scope-1",
      action: "task:update",
      resource: { resourceType: "task", resourceId: "task-1" },
      policyVersion: "v1",
      taskId: "task-1",
      stepId: "step-1",
      toolExecutionId: "execution-1",
      contextSummary: {
        amount: 1500,
        risk: "high",
        environment: "production",
        requestId: "request-1",
      },
    });
    expect(selectValues).toEqual(["execution-1"]);
  });
});
