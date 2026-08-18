import type { Queryable } from "../persistence/rows.js";
import type { ResourceRef } from "./resource-ref.js";
import type { PermissionGrant } from "./grants.js";

export interface StoredPermissionGrant extends PermissionGrant {
  revokedAt?: string;
}

export interface FindMatchingGrantInput {
  resource: ResourceRef;
  granteeScopeId: string;
  granteeTenantId: string;
  action: string;
}

export interface GrantStore {
  create(grant: PermissionGrant): Promise<StoredPermissionGrant>;
  revoke(
    grantId: string,
    revokedAt: string
  ): Promise<StoredPermissionGrant | null>;
  findMatching(
    input: FindMatchingGrantInput
  ): Promise<StoredPermissionGrant | null>;
}

interface PermissionGrantRow extends Record<string, unknown> {
  grant_id: unknown;
  resource_type: unknown;
  resource_id: unknown;
  resource_tenant_id: unknown;
  resource_owner_scope_id: unknown;
  grantee_scope_id: unknown;
  grantee_tenant_id: unknown;
  actions: unknown;
  granted_by_principal_id: unknown;
  granted_by_scope_id: unknown;
  can_delegate: unknown;
  created_at: unknown;
  expires_at: unknown;
  revoked_at: unknown;
}

const GRANT_COLUMNS = `
  grant_id, resource_type, resource_id, resource_tenant_id,
  resource_owner_scope_id, grantee_scope_id, grantee_tenant_id, actions,
  granted_by_principal_id, granted_by_scope_id, can_delegate,
  created_at, expires_at, revoked_at
`;

function requiredString(value: unknown, column: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid ${column} returned from permission_grants`);
  }
  return value;
}

function optionalString(value: unknown, column: string): string | undefined {
  if (value === null) return undefined;
  return requiredString(value, column);
}

function isoString(value: unknown, column: string): string {
  if (!(typeof value === "string" || value instanceof Date)) {
    throw new Error(`Invalid ${column} returned from permission_grants`);
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${column} returned from permission_grants`);
  }
  return date.toISOString();
}

function optionalIsoString(
  value: unknown,
  column: string
): string | undefined {
  return value === null ? undefined : isoString(value, column);
}

function stringArray(value: unknown, column: string): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((item): item is string => typeof item === "string")
  ) {
    throw new Error(`Invalid ${column} returned from permission_grants`);
  }
  return [...value];
}

function mapGrantRow(row: PermissionGrantRow): StoredPermissionGrant {
  if (typeof row.can_delegate !== "boolean") {
    throw new Error("Invalid can_delegate returned from permission_grants");
  }

  const ownerScopeId = optionalString(
    row.resource_owner_scope_id,
    "resource_owner_scope_id"
  );
  const expiresAt = optionalIsoString(row.expires_at, "expires_at");
  const revokedAt = optionalIsoString(row.revoked_at, "revoked_at");

  return {
    grantId: requiredString(row.grant_id, "grant_id"),
    resource: {
      resourceType: requiredString(row.resource_type, "resource_type"),
      resourceId: requiredString(row.resource_id, "resource_id"),
      tenantId: requiredString(row.resource_tenant_id, "resource_tenant_id"),
      ...(ownerScopeId === undefined ? {} : { ownerScopeId }),
    },
    granteeScopeId: requiredString(row.grantee_scope_id, "grantee_scope_id"),
    granteeTenantId: requiredString(
      row.grantee_tenant_id,
      "grantee_tenant_id"
    ),
    actions: stringArray(row.actions, "actions"),
    grantedByPrincipalId: requiredString(
      row.granted_by_principal_id,
      "granted_by_principal_id"
    ),
    grantedByScopeId: requiredString(
      row.granted_by_scope_id,
      "granted_by_scope_id"
    ),
    canDelegate: row.can_delegate,
    createdAt: isoString(row.created_at, "created_at"),
    ...(expiresAt === undefined ? {} : { expiresAt }),
    ...(revokedAt === undefined ? {} : { revokedAt }),
  };
}

export class PgGrantStore implements GrantStore {
  constructor(private readonly db: Queryable) {}

  async create(grant: PermissionGrant): Promise<StoredPermissionGrant> {
    const result = await this.db.query<PermissionGrantRow>(
      `INSERT INTO permission_grants (
         grant_id, resource_type, resource_id, resource_tenant_id,
         resource_owner_scope_id, grantee_scope_id, grantee_tenant_id, actions,
         granted_by_principal_id, granted_by_scope_id, can_delegate,
         created_at, expires_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
       )
       RETURNING ${GRANT_COLUMNS}`,
      [
        grant.grantId,
        grant.resource.resourceType,
        grant.resource.resourceId,
        grant.resource.tenantId,
        grant.resource.ownerScopeId ?? null,
        grant.granteeScopeId,
        grant.granteeTenantId,
        grant.actions,
        grant.grantedByPrincipalId,
        grant.grantedByScopeId,
        grant.canDelegate,
        grant.createdAt,
        grant.expiresAt ?? null,
      ]
    );
    const row = result.rows[0];
    if (!row) throw new Error("Permission grant insert returned no row");
    return mapGrantRow(row);
  }

  async revoke(
    grantId: string,
    revokedAt: string
  ): Promise<StoredPermissionGrant | null> {
    const result = await this.db.query<PermissionGrantRow>(
      `UPDATE permission_grants
       SET revoked_at = $2
       WHERE grant_id = $1 AND revoked_at IS NULL
       RETURNING ${GRANT_COLUMNS}`,
      [grantId, revokedAt]
    );
    const row = result.rows[0];
    return row ? mapGrantRow(row) : null;
  }

  async findMatching(
    input: FindMatchingGrantInput
  ): Promise<StoredPermissionGrant | null> {
    const result = await this.db.query<PermissionGrantRow>(
      `SELECT ${GRANT_COLUMNS}
       FROM permission_grants
       WHERE resource_type = $1
         AND resource_id = $2
         AND resource_tenant_id = $3
         AND resource_owner_scope_id IS NOT DISTINCT FROM $4
         AND grantee_scope_id = $5
         AND grantee_tenant_id = $6
         AND $7 = ANY(actions)
         AND revoked_at IS NULL
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY created_at DESC
       LIMIT 1`,
      [
        input.resource.resourceType,
        input.resource.resourceId,
        input.resource.tenantId,
        input.resource.ownerScopeId ?? null,
        input.granteeScopeId,
        input.granteeTenantId,
        input.action,
      ]
    );
    const row = result.rows[0];
    return row ? mapGrantRow(row) : null;
  }
}
