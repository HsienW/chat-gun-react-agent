import { describe, expect, it } from "vitest";

import type { Queryable } from "../persistence/rows.js";
import {
  PgGrantStore,
  type FindMatchingGrantInput,
} from "./grant-store.js";
import type { PermissionGrant } from "./grants.js";

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

function createGrant(overrides: Partial<PermissionGrant> = {}): PermissionGrant {
  return {
    grantId: "grant-1",
    resource: {
      resourceType: "task",
      resourceId: "task-1",
      tenantId: "tenant-1",
      ownerScopeId: "scope-owner",
    },
    granteeScopeId: "scope-grantee",
    granteeTenantId: "tenant-1",
    actions: ["task:read", "task:update"],
    grantedByPrincipalId: "principal-owner",
    grantedByScopeId: "scope-owner",
    canDelegate: false,
    createdAt: "2026-08-18T00:00:00.000Z",
    expiresAt: "2026-09-18T00:00:00.000Z",
    ...overrides,
  };
}

function grantRow(overrides: Record<string, unknown> = {}) {
  return {
    grant_id: "grant-1",
    resource_type: "task",
    resource_id: "task-1",
    resource_tenant_id: "tenant-1",
    resource_owner_scope_id: "scope-owner",
    grantee_scope_id: "scope-grantee",
    grantee_tenant_id: "tenant-1",
    actions: ["task:read", "task:update"],
    granted_by_principal_id: "principal-owner",
    granted_by_scope_id: "scope-owner",
    can_delegate: false,
    created_at: "2026-08-18T00:00:00.000Z",
    expires_at: "2026-09-18T00:00:00.000Z",
    revoked_at: null,
    ...overrides,
  };
}

function matchingInput(
  overrides: Partial<FindMatchingGrantInput> = {}
): FindMatchingGrantInput {
  return {
    resource: {
      resourceType: "task",
      resourceId: "task-1",
      tenantId: "tenant-1",
      ownerScopeId: "scope-owner",
    },
    granteeScopeId: "scope-grantee",
    granteeTenantId: "tenant-1",
    action: "task:read",
    ...overrides,
  };
}

describe("PgGrantStore", () => {
  it("creates a grant with explicit resource and grantee tenants", async () => {
    let insertValues: readonly unknown[] = [];
    const db: Queryable = {
      query: createFakeQuery(async (text, values) => {
        expect(text).toContain("INSERT INTO permission_grants");
        insertValues = values;
        return { rows: [grantRow()], rowCount: 1 };
      }),
    };
    const store = new PgGrantStore(db);

    await expect(store.create(createGrant())).resolves.toMatchObject({
      grantId: "grant-1",
      granteeTenantId: "tenant-1",
      expiresAt: "2026-09-18T00:00:00.000Z",
    });
    expect(insertValues).toEqual([
      "grant-1",
      "task",
      "task-1",
      "tenant-1",
      "scope-owner",
      "scope-grantee",
      "tenant-1",
      ["task:read", "task:update"],
      "principal-owner",
      "scope-owner",
      false,
      "2026-08-18T00:00:00.000Z",
      "2026-09-18T00:00:00.000Z",
    ]);
  });

  it("revokes additively without overwriting expiry or deleting history", async () => {
    let updateText = "";
    let updateValues: readonly unknown[] = [];
    const db: Queryable = {
      query: createFakeQuery(async (text, values) => {
        updateText = text;
        updateValues = values;
        return {
          rows: [grantRow({ revoked_at: "2026-08-19T00:00:00.000Z" })],
          rowCount: 1,
        };
      }),
    };
    const store = new PgGrantStore(db);

    await expect(
      store.revoke("grant-1", "2026-08-19T00:00:00.000Z")
    ).resolves.toMatchObject({
      grantId: "grant-1",
      expiresAt: "2026-09-18T00:00:00.000Z",
      revokedAt: "2026-08-19T00:00:00.000Z",
    });
    expect(updateText).toContain("UPDATE permission_grants");
    expect(updateText).toContain("SET revoked_at = $2");
    expect(updateText).toContain("revoked_at IS NULL");
    expect(updateText).not.toContain("DELETE FROM permission_grants");
    expect(updateText.slice(0, updateText.indexOf("WHERE"))).not.toContain(
      "expires_at ="
    );
    expect(updateValues).toEqual([
      "grant-1",
      "2026-08-19T00:00:00.000Z",
    ]);
  });

  it("finds only a matching resource, grantee tenant, scope, and action", async () => {
    let selectText = "";
    let selectValues: readonly unknown[] = [];
    const db: Queryable = {
      query: createFakeQuery(async (text, values) => {
        selectText = text;
        selectValues = values;
        return { rows: [grantRow()], rowCount: 1 };
      }),
    };
    const store = new PgGrantStore(db);

    await expect(store.findMatching(matchingInput())).resolves.toMatchObject({
      grantId: "grant-1",
      granteeScopeId: "scope-grantee",
      granteeTenantId: "tenant-1",
    });
    expect(selectText).toContain("resource_tenant_id = $3");
    expect(selectText).toContain("grantee_scope_id = $5");
    expect(selectText).toContain("grantee_tenant_id = $6");
    expect(selectText).toContain("$7 = ANY(actions)");
    expect(selectValues).toEqual([
      "task",
      "task-1",
      "tenant-1",
      "scope-owner",
      "scope-grantee",
      "tenant-1",
      "task:read",
    ]);
  });

  it("excludes revoked and expired grants in the database query", async () => {
    let selectText = "";
    const db: Queryable = {
      query: createFakeQuery(async (text) => {
        selectText = text;
        return { rows: [], rowCount: 0 };
      }),
    };
    const store = new PgGrantStore(db);

    await expect(store.findMatching(matchingInput())).resolves.toBeNull();
    expect(selectText).toContain("revoked_at IS NULL");
    expect(selectText).toContain(
      "expires_at IS NULL OR expires_at > NOW()"
    );
  });
});
