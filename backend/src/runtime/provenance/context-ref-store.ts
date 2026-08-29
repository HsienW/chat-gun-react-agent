import type {
  AuthorizationDecision,
  AuthorizationRequest,
} from "../authorization/authorization.js";
import type { PrincipalContext } from "../authorization/principal.js";
import type { ResourceRef } from "../authorization/resource-ref.js";
import type { RuntimeScope } from "../authorization/scope.js";
import type { Queryable } from "../persistence/rows.js";
import { createContextRef, type ContextRef } from "./context-ref.js";

const CONTEXT_REF_COLUMNS = `
  context_ref_id, source_type, source_id, source_tenant_id,
  source_owner_scope_id, target_type, target_id, target_tenant_id,
  target_owner_scope_id, relation_type, created_at
`;

interface ContextRefRow extends Record<string, unknown> {
  context_ref_id: unknown;
  source_type: unknown;
  source_id: unknown;
  source_tenant_id: unknown;
  source_owner_scope_id: unknown;
  target_type: unknown;
  target_id: unknown;
  target_tenant_id: unknown;
  target_owner_scope_id: unknown;
  relation_type: unknown;
  created_at: unknown;
}

export interface Authorizer {
  authorize(request: AuthorizationRequest): Promise<AuthorizationDecision>;
}

export interface RecordContextRefInput {
  contextRef: ContextRef;
  principal?: PrincipalContext;
  scope?: RuntimeScope;
}

export interface FindRelatedOneHopOptions {
  relationType?: string;
  limit?: number;
}

export interface ContextRefStore {
  record(input: RecordContextRefInput): Promise<ContextRef>;
  /**
   * Performs a raw one-hop persistence query without authorization checks.
   * Callers must enforce authorization, normally through
   * AuthorizedContextReferenceResolver.
   */
  findRelatedOneHop(
    resource: ResourceRef,
    options?: FindRelatedOneHopOptions
  ): Promise<ContextRef[]>;
}

function requiredString(value: unknown, column: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid ${column} returned from context_refs`);
  }
  return value;
}

function optionalString(value: unknown, column: string): string | undefined {
  return value === null ? undefined : requiredString(value, column);
}

function isoString(value: unknown, column: string): string {
  if (!(typeof value === "string" || value instanceof Date)) {
    throw new Error(`Invalid ${column} returned from context_refs`);
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${column} returned from context_refs`);
  }
  return date.toISOString();
}

function mapResource(
  row: ContextRefRow,
  prefix: "source" | "target"
): ResourceRef {
  const ownerScopeId = optionalString(
    row[`${prefix}_owner_scope_id`],
    `${prefix}_owner_scope_id`
  );
  return {
    resourceType: requiredString(row[`${prefix}_type`], `${prefix}_type`),
    resourceId: requiredString(row[`${prefix}_id`], `${prefix}_id`),
    tenantId: requiredString(row[`${prefix}_tenant_id`], `${prefix}_tenant_id`),
    ...(ownerScopeId === undefined ? {} : { ownerScopeId }),
  };
}

function mapContextRefRow(row: ContextRefRow): ContextRef {
  return createContextRef({
    contextRefId: requiredString(row.context_ref_id, "context_ref_id"),
    source: mapResource(row, "source"),
    target: mapResource(row, "target"),
    relationType: requiredString(row.relation_type, "relation_type"),
    createdAt: isoString(row.created_at, "created_at"),
  });
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return 50;
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error("limit must be a positive integer");
  }
  return limit;
}

function isCrossTenant(contextRef: ContextRef): boolean {
  return contextRef.source.tenantId !== contextRef.target.tenantId;
}

export class PgContextRefStore implements ContextRefStore {
  constructor(
    private readonly db: Queryable,
    private readonly authorizer?: Authorizer
  ) {}

  async record(input: RecordContextRefInput): Promise<ContextRef> {
    const contextRef = createContextRef(input.contextRef);
    if (isCrossTenant(contextRef)) {
      if (!this.authorizer || !input.principal || !input.scope) {
        throw new Error("cross-tenant context references require authorization");
      }
      const decision = await this.authorizer.authorize({
        principal: input.principal,
        scope: input.scope,
        action: "read",
        resource: contextRef.target,
      });
      if (decision.effect !== "allow") {
        throw new Error("cross-tenant context reference denied");
      }
    }

    const result = await this.db.query<ContextRefRow>(
      `INSERT INTO context_refs (
         context_ref_id, source_type, source_id, source_tenant_id,
         source_owner_scope_id, target_type, target_id, target_tenant_id,
         target_owner_scope_id, relation_type, created_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
       )
       RETURNING ${CONTEXT_REF_COLUMNS}`,
      [
        contextRef.contextRefId,
        contextRef.source.resourceType,
        contextRef.source.resourceId,
        contextRef.source.tenantId,
        contextRef.source.ownerScopeId ?? null,
        contextRef.target.resourceType,
        contextRef.target.resourceId,
        contextRef.target.tenantId,
        contextRef.target.ownerScopeId ?? null,
        contextRef.relationType,
        contextRef.createdAt,
      ]
    );
    const row = result.rows[0];
    if (!row) throw new Error("Context ref insert returned no row");
    return mapContextRefRow(row);
  }

  async findRelatedOneHop(
    resource: ResourceRef,
    options: FindRelatedOneHopOptions = {}
  ): Promise<ContextRef[]> {
    const limit = normalizeLimit(options.limit);
    const relationType = options.relationType;
    const result = await this.db.query<ContextRefRow>(
      `SELECT ${CONTEXT_REF_COLUMNS}
       FROM context_refs
       WHERE (
         (
           source_type = $1
           AND source_id = $2
           AND source_tenant_id = $3
           AND source_owner_scope_id IS NOT DISTINCT FROM $4
         )
         OR (
           target_type = $1
           AND target_id = $2
           AND target_tenant_id = $3
           AND target_owner_scope_id IS NOT DISTINCT FROM $4
         )
       )
         AND ($5::text IS NULL OR relation_type = $5)
       ORDER BY created_at DESC
       LIMIT $6`,
      [
        resource.resourceType,
        resource.resourceId,
        resource.tenantId,
        resource.ownerScopeId ?? null,
        relationType ?? null,
        limit,
      ]
    );
    return result.rows.map(mapContextRefRow);
  }
}
