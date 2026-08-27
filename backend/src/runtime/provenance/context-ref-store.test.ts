import { describe, expect, it, vi } from "vitest";

import type { AuthorizationDecision } from "../authorization/authorization.js";
import type { PrincipalContext } from "../authorization/principal.js";
import type { RuntimeScope } from "../authorization/scope.js";
import type { Queryable } from "../persistence/rows.js";
import type { ContextRef } from "./context-ref.js";
import {
  PgContextRefStore,
  type Authorizer,
} from "./context-ref-store.js";

function createFakeQuery(
  handler: (
    text: string,
    values: readonly unknown[]
  ) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>
): Queryable["query"] {
  return async <TResult extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = []
  ) => {
    const result = await handler(text, values);
    return { rows: result.rows as TResult[], rowCount: result.rowCount };
  };
}

const principal: PrincipalContext = {
  principalId: "principal-1",
  principalType: "user",
  tenantId: "tenant-1",
  roles: ["reader"],
  scopes: ["context:read"],
  authSource: "trusted_gateway",
  authenticatedAt: "2026-08-27T00:00:00.000Z",
};

const scope: RuntimeScope = {
  scopeId: "scope-1",
  scopeType: "team",
  tenantId: "tenant-1",
};

function contextRef(overrides: Partial<ContextRef> = {}): ContextRef {
  return {
    contextRefId: "context-ref-1",
    source: {
      resourceType: "recommendation_card",
      resourceId: "card-1",
      tenantId: "tenant-1",
    },
    target: {
      resourceType: "tool_execution",
      resourceId: "tool-execution-1",
      tenantId: "tenant-1",
    },
    relationType: "derived_from",
    createdAt: "2026-08-27T00:00:00.000Z",
    ...overrides,
  };
}

function contextRefRow(overrides: Record<string, unknown> = {}) {
  return {
    context_ref_id: "context-ref-1",
    source_type: "recommendation_card",
    source_id: "card-1",
    source_tenant_id: "tenant-1",
    source_owner_scope_id: null,
    target_type: "tool_execution",
    target_id: "tool-execution-1",
    target_tenant_id: "tenant-1",
    target_owner_scope_id: null,
    relation_type: "derived_from",
    created_at: "2026-08-27T00:00:00.000Z",
    ...overrides,
  };
}

function decision(effect: AuthorizationDecision["effect"]): AuthorizationDecision {
  return {
    decisionId: "auth-decision-1",
    effect,
    reasonCode: effect === "allow" ? "POLICY_ALLOWED" : "CROSS_TENANT_DENIED",
    createdAt: "2026-08-27T00:00:00.000Z",
  };
}

describe("PgContextRefStore", () => {
  it("records same-tenant context refs without recursive traversal behavior", async () => {
    let insertValues: readonly unknown[] = [];
    const db: Queryable = {
      query: createFakeQuery(async (text, values) => {
        expect(text).toContain("INSERT INTO context_refs");
        insertValues = values;
        return { rows: [contextRefRow()], rowCount: 1 };
      }),
    };
    const store = new PgContextRefStore(db);

    await expect(
      store.record({ contextRef: contextRef() })
    ).resolves.toMatchObject({
      contextRefId: "context-ref-1",
      relationType: "derived_from",
    });
    expect(insertValues).toEqual([
      "context-ref-1",
      "recommendation_card",
      "card-1",
      "tenant-1",
      null,
      "tool_execution",
      "tool-execution-1",
      "tenant-1",
      null,
      "derived_from",
      "2026-08-27T00:00:00.000Z",
    ]);
  });

  it("denies cross-tenant writes unless target read authorization allows", async () => {
    const db: Queryable = {
      query: createFakeQuery(async () => {
        throw new Error("write should not run");
      }),
    };
    const authorizer: Authorizer = {
      authorize: vi.fn(async () => decision("deny")),
    };
    const store = new PgContextRefStore(db, authorizer);

    await expect(
      store.record({
        contextRef: contextRef({
          target: { ...contextRef().target, tenantId: "tenant-2" },
        }),
        principal,
        scope,
      })
    ).rejects.toThrow("cross-tenant context reference denied");
  });

  it("allows cross-tenant writes after target read authorization allows", async () => {
    let insertValues: readonly unknown[] = [];
    const db: Queryable = {
      query: createFakeQuery(async (_text, values) => {
        insertValues = values;
        return {
          rows: [contextRefRow({ target_tenant_id: "tenant-2" })],
          rowCount: 1,
        };
      }),
    };
    const authorizer: Authorizer = {
      authorize: vi.fn(async () => decision("allow")),
    };
    const store = new PgContextRefStore(db, authorizer);

    await expect(
      store.record({
        contextRef: contextRef({
          target: { ...contextRef().target, tenantId: "tenant-2" },
        }),
        principal,
        scope,
      })
    ).resolves.toMatchObject({ target: { tenantId: "tenant-2" } });
    expect(authorizer.authorize).toHaveBeenCalledWith({
      principal,
      scope,
      action: "read",
      resource: { ...contextRef().target, tenantId: "tenant-2" },
    });
    expect(insertValues[7]).toBe("tenant-2");
  });

  it("queries only one-hop source or target matches with relation and limit", async () => {
    let selectText = "";
    let selectValues: readonly unknown[] = [];
    const db: Queryable = {
      query: createFakeQuery(async (text, values) => {
        selectText = text;
        selectValues = values;
        return { rows: [contextRefRow()], rowCount: 1 };
      }),
    };
    const store = new PgContextRefStore(db);

    await expect(
      store.findRelatedOneHop(contextRef().source, {
        relationType: "derived_from",
        limit: 3,
      })
    ).resolves.toHaveLength(1);
    expect(selectText).toContain("FROM context_refs");
    expect(selectText).toContain("source_type = $1");
    expect(selectText).toContain("target_type = $1");
    expect(selectText).not.toContain("WITH RECURSIVE");
    expect(selectValues).toEqual([
      "recommendation_card",
      "card-1",
      "tenant-1",
      null,
      "derived_from",
      3,
    ]);
  });
});
