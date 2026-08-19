import { randomUUID } from "node:crypto";

import type { Queryable } from "../persistence/rows.js";
import {
  CACHE_STATES,
  type CacheState,
  type ResultReferencePolicy,
} from "./side-effect-descriptor.js";
import type { TrustedScope } from "./identity.js";
import { isScopeCompatible } from "../authorization/scope.js";

export interface ResultReferenceRecord {
  resultRefId: string;
  toolExecutionId: string;
  scope: TrustedScope;
  toolVersion: string;
  cacheState: CacheState;
  resultHash: string;
  payloadRef: string;
  externalSystemNamespace?: string;
  externalOperationId?: string;
}

export interface SaveResultReferenceInput<TResult> {
  toolExecutionId: string;
  result: TResult;
  policy: ResultReferencePolicy<TResult>;
  scope: TrustedScope;
  toolVersion: string;
}

export interface ResolveResultReferenceInput<TResult> {
  resultRefId: string;
  policy: ResultReferencePolicy<TResult>;
  scope: TrustedScope;
  toolVersion: string;
}

export interface ResultReferenceStore {
  save<TResult>(input: SaveResultReferenceInput<TResult>): Promise<ResultReferenceRecord>;
  resolve<TResult>(input: ResolveResultReferenceInput<TResult>): Promise<TResult | null>;
}

interface ResultReferenceRow extends Record<string, unknown> {
  result_ref_id: string;
  tool_execution_id: string;
  scope_id: string;
  tenant_id: string;
  principal_id: string;
  tool_version: string;
  cache_state: string;
  result_hash: string;
  payload_ref: string;
}

const RESULT_REFERENCE_COLUMNS = `
  result_ref_id, tool_execution_id, scope_id, tenant_id, principal_id,
  tool_version, cache_state, result_hash, payload_ref, created_at, updated_at
`;

function isCacheState(value: string): value is CacheState {
  return CACHE_STATES.includes(value as CacheState);
}

function mapResultReference(row: ResultReferenceRow): ResultReferenceRecord {
  if (!isCacheState(row.cache_state)) {
    throw new Error(`Unknown result reference cache state: ${row.cache_state}`);
  }
  return {
    resultRefId: row.result_ref_id,
    toolExecutionId: row.tool_execution_id,
    scope: {
      scopeId: row.scope_id,
      tenantId: row.tenant_id,
      principalId: row.principal_id,
    },
    toolVersion: row.tool_version,
    cacheState: row.cache_state,
    resultHash: row.result_hash,
    payloadRef: row.payload_ref,
  };
}

export class PgResultReferenceStore implements ResultReferenceStore {
  constructor(private readonly db: Queryable) {}

  async save<TResult>(
    input: SaveResultReferenceInput<TResult>
  ): Promise<ResultReferenceRecord> {
    const resultReference = input.policy.toResultRef(input.result);
    const hasExternalSystemNamespace =
      resultReference.externalSystemNamespace !== undefined;
    const hasExternalOperationId = resultReference.externalOperationId !== undefined;
    if (hasExternalSystemNamespace !== hasExternalOperationId) {
      throw new Error(
        "Result reference external system namespace and operation ID must be provided together"
      );
    }
    const resultRefId = randomUUID();
    const inserted = await this.db.query<ResultReferenceRow>(
      `INSERT INTO result_references (
         result_ref_id, tool_execution_id, scope_id, tenant_id, principal_id,
         tool_version, cache_state, result_hash, payload_ref
       ) VALUES ($1, $2, $3, $4, $5, $6, 'reusable', $7, $8)
       RETURNING ${RESULT_REFERENCE_COLUMNS}`,
      [
        resultRefId,
        input.toolExecutionId,
        input.scope.scopeId,
        input.scope.tenantId,
        input.scope.principalId,
        input.toolVersion,
        resultReference.resultHash,
        resultReference.payloadRef,
      ]
    );
    const row = inserted.rows[0];
    if (!row) throw new Error("Result reference insert returned no row");
    return {
      ...mapResultReference(row),
      ...(resultReference.externalSystemNamespace
        ? { externalSystemNamespace: resultReference.externalSystemNamespace }
        : {}),
      ...(resultReference.externalOperationId
        ? { externalOperationId: resultReference.externalOperationId }
        : {}),
    };
  }

  async resolve<TResult>(
    input: ResolveResultReferenceInput<TResult>
  ): Promise<TResult | null> {
    const selected = await this.db.query<ResultReferenceRow>(
      `SELECT ${RESULT_REFERENCE_COLUMNS}
       FROM result_references WHERE result_ref_id = $1`,
      [input.resultRefId]
    );
    const row = selected.rows[0];
    if (!row) return null;
    const record = mapResultReference(row);

    if (
      !isScopeCompatible(
        input.scope,
        { principalId: input.scope.principalId },
        record.scope
      )
    ) {
      await this.markCacheState(record.resultRefId, "authorization_mismatch");
      return null;
    }
    if (record.toolVersion !== input.toolVersion) {
      await this.markCacheState(record.resultRefId, "version_mismatch");
      return null;
    }
    if (
      record.cacheState !== "reusable" ||
      !input.policy.isReusable(record.cacheState, input.scope, input.toolVersion)
    ) {
      return null;
    }
    return input.policy.resolveResultRef(record.payloadRef);
  }

  private async markCacheState(
    resultRefId: string,
    cacheState: "authorization_mismatch" | "version_mismatch"
  ): Promise<void> {
    await this.db.query(
      `UPDATE result_references
       SET cache_state = $2, updated_at = NOW()
       WHERE result_ref_id = $1 AND cache_state = 'reusable'`,
      [resultRefId, cacheState]
    );
  }
}
