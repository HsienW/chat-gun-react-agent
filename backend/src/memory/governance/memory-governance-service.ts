import type {
  AuthorizationDecision,
  AuthorizationRequest,
  PrincipalContext,
  ResourceRef,
  RuntimeScope,
} from "../../runtime/authorization/index.js";
import type { ContextReferenceResolver } from "../../runtime/provenance/index.js";
import { createDecisionRecord } from "../../runtime/provenance/index.js";
import type { DecisionRecorder } from "./relation-classifier.js";
import { classifyMemoryRelation } from "./relation-classifier.js";
import type { MemorySearchFilter, MemoryStorePort } from "../store-port.js";
import type {
  LongTermMemoryRecord,
  MemoryCandidate,
  MemoryNamespace,
  MemoryRelation,
  MemoryRevisionSnapshot,
  MemoryType,
} from "../types.js";
import {
  MEMORY_TYPES,
  nextRevision,
  parseLongTermMemoryRecord,
  parseMemoryCandidate,
  parseMemoryIdentifier,
  parseRevision,
} from "../types.js";
import type { MemoryWritePolicyContext } from "./write-policy.js";
import { MemoryWritePolicy } from "./write-policy.js";

export interface MemoryAuthorizer {
  authorize(request: AuthorizationRequest): Promise<AuthorizationDecision>;
}

export interface MemoryRelevanceConfig {
  memoryTypeWeights: Readonly<Record<MemoryType, number>>;
  recencyHalfLifeMs: number;
  maxCandidates: number;
  maxTokens: number;
  recallTimeoutMs: number;
}

export type MemoryTelemetryKind =
  | "authorization_denied"
  | "recall_degraded"
  | "write_failed"
  | "revision_conflict"
  | "memory_committed"
  | "memory_deleted"
  | "provenance_failed";

export interface MemoryTelemetryEvent {
  kind: MemoryTelemetryKind;
  reason: string;
  namespace: MemoryNamespace;
  memoryId?: string;
  provenance?: LongTermMemoryRecord["provenance"];
  revision?: string;
}

export interface MemoryRecallItem {
  record: LongTermMemoryRecord;
  score: number;
  estimatedTokens: number;
}

export interface RecallMemoryInput {
  principal: PrincipalContext;
  scope: RuntimeScope;
  namespace: MemoryNamespace;
  budgetHint?: number;
  signal?: AbortSignal;
  at?: string;
}

export interface CommitMemoryInput {
  principal: PrincipalContext;
  scope: RuntimeScope;
  memoryId: string;
  candidate: MemoryCandidate;
  policyContext: MemoryWritePolicyContext;
  expectedRevision?: string;
  currentAuthoritativeValue?: unknown;
  signal?: AbortSignal;
}

export type CommitMemoryResult =
  | {
      status: "committed";
      record: LongTermMemoryRecord;
      relation: MemoryRelation;
    }
  | { status: "denied"; reason: string }
  | { status: "rejected"; reason: string }
  | { status: "duplicate"; reason: string }
  | { status: "conflict"; currentRevision?: string }
  | { status: "store_error"; retryable: true; idempotencyKey: string };

export interface DeleteMemoryInput {
  principal: PrincipalContext;
  scope: RuntimeScope;
  namespace: MemoryNamespace;
  memoryId: string;
  signal?: AbortSignal;
}

export type DeleteMemoryResult =
  | { status: "deleted" }
  | { status: "denied"; reason: string }
  | { status: "store_error" };

export interface RestoreMemoryInput extends DeleteMemoryInput {
  revision: string;
  idempotencyKey: string;
  policyContext: MemoryWritePolicyContext;
}

export interface PointInTimeQuery {
  revision?: string;
  validAt?: string;
  recordedAtOrBefore?: string;
}

export interface GetMemoryAtTimeInput extends DeleteMemoryInput {
  query: PointInTimeQuery;
}

export interface MemoryGovernanceServiceOptions {
  store: MemoryStorePort;
  authorizer: MemoryAuthorizer;
  writePolicy: MemoryWritePolicy;
  relevance: MemoryRelevanceConfig;
  referenceResolver?: ContextReferenceResolver;
  decisionRecorder?: DecisionRecorder;
  telemetry?: (event: MemoryTelemetryEvent) => void;
  now?: () => Date;
  estimateTokens?: (value: unknown) => number;
}

class RecallTimeoutError extends Error {
  constructor() {
    super("memory recall timed out");
    this.name = "RecallTimeoutError";
  }
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortReason(signal);
}

async function settleWithControl<T>(
  operation: Promise<T>,
  options: { signal?: AbortSignal; timeoutMs?: number }
): Promise<T> {
  throwIfAborted(options.signal);
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(abortReason(options.signal!)));
    const timer =
      options.timeoutMs === undefined
        ? undefined
        : setTimeout(
            () => finish(() => reject(new RecallTimeoutError())),
            options.timeoutMs
          );
    options.signal?.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error))
    );
  });
}

function resourceFor(record: Pick<LongTermMemoryRecord, "memoryId" | "namespace">): ResourceRef {
  return {
    resourceType: "memory",
    resourceId: record.memoryId,
    tenantId: record.namespace.tenantId,
    ownerScopeId: record.namespace.scopeId,
  };
}

function sameNamespace(left: MemoryNamespace, right: MemoryNamespace): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.principalId === right.principalId &&
    left.domain === right.domain &&
    left.scopeId === right.scopeId
  );
}

function namespaceMatchesTrustedIdentity(
  namespace: MemoryNamespace,
  principal: PrincipalContext,
  scope: RuntimeScope
): boolean {
  return (
    namespace.tenantId === principal.tenantId &&
    namespace.principalId === principal.principalId &&
    namespace.tenantId === scope.tenantId &&
    namespace.scopeId === scope.scopeId
  );
}

function snapshot(record: LongTermMemoryRecord): MemoryRevisionSnapshot {
  const { history, ...revision } = record;
  return revision;
}

function defaultTokenEstimate(value: unknown): number {
  const serialized = JSON.stringify(value);
  return Math.max(1, Math.ceil(Buffer.byteLength(serialized ?? "", "utf8") / 4));
}

function validatePositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer`);
  }
}

function validateRelevanceConfig(config: MemoryRelevanceConfig): void {
  const keys = Object.keys(config.memoryTypeWeights);
  if (
    keys.length !== MEMORY_TYPES.length ||
    keys.some((key) => !MEMORY_TYPES.includes(key as MemoryType))
  ) {
    throw new Error("memoryTypeWeights must define exactly every memory type");
  }
  for (const memoryType of MEMORY_TYPES) {
    const weight = config.memoryTypeWeights[memoryType];
    if (!Number.isFinite(weight) || weight < 0) {
      throw new Error(`memoryTypeWeights.${memoryType} must be finite and non-negative`);
    }
  }
  if (!Number.isFinite(config.recencyHalfLifeMs) || config.recencyHalfLifeMs <= 0) {
    throw new Error("recencyHalfLifeMs must be finite and positive");
  }
  validatePositiveInteger(config.maxCandidates, "maxCandidates");
  validatePositiveInteger(config.maxTokens, "maxTokens");
  validatePositiveInteger(config.recallTimeoutMs, "recallTimeoutMs");
}

function isActiveAt(record: LongTermMemoryRecord, at: number): boolean {
  if (record.expiresAt !== undefined && Date.parse(record.expiresAt) <= at) return false;
  if (record.validFrom !== undefined && Date.parse(record.validFrom) > at) return false;
  if (record.validUntil !== undefined && Date.parse(record.validUntil) <= at) return false;
  return true;
}

export class MemoryGovernanceService {
  private readonly store: MemoryStorePort;
  private readonly authorizer: MemoryAuthorizer;
  private readonly writePolicy: MemoryWritePolicy;
  private readonly relevance: MemoryRelevanceConfig;
  private readonly referenceResolver?: ContextReferenceResolver;
  private readonly decisionRecorder?: DecisionRecorder;
  private readonly telemetry: (event: MemoryTelemetryEvent) => void;
  private readonly now: () => Date;
  private readonly estimateTokens: (value: unknown) => number;

  constructor(options: MemoryGovernanceServiceOptions) {
    validateRelevanceConfig(options.relevance);
    this.store = options.store;
    this.authorizer = options.authorizer;
    this.writePolicy = options.writePolicy;
    this.relevance = options.relevance;
    this.referenceResolver = options.referenceResolver;
    this.decisionRecorder = options.decisionRecorder;
    this.telemetry = options.telemetry ?? (() => undefined);
    this.now = options.now ?? (() => new Date());
    this.estimateTokens = options.estimateTokens ?? defaultTokenEstimate;
  }

  async recall(input: RecallMemoryInput): Promise<MemoryRecallItem[]> {
    throwIfAborted(input.signal);
    if (!namespaceMatchesTrustedIdentity(input.namespace, input.principal, input.scope)) {
      this.telemetry({
        kind: "authorization_denied",
        reason: "identity_namespace_mismatch",
        namespace: input.namespace,
      });
      return [];
    }
    try {
      return await settleWithControl(this.recallInternal(input), {
        signal: input.signal,
        timeoutMs: this.relevance.recallTimeoutMs,
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      this.telemetry({
        kind: "recall_degraded",
        reason: error instanceof RecallTimeoutError ? "timeout" : "store_unavailable",
        namespace: input.namespace,
      });
      return [];
    }
  }

  private async recallInternal(input: RecallMemoryInput): Promise<MemoryRecallItem[]> {
    throwIfAborted(input.signal);
    const at = Date.parse(input.at ?? this.now().toISOString());
    if (!Number.isFinite(at)) throw new Error("recall at must be a valid timestamp");
    if (
      input.budgetHint !== undefined &&
      (!Number.isInteger(input.budgetHint) || input.budgetHint <= 0)
    ) {
      throw new Error("budgetHint must be a positive integer");
    }
    const records = await this.store.search(input.namespace, {
      limit: this.relevance.maxCandidates,
    });
    throwIfAborted(input.signal);
    const correctlyRouted = records.filter((record) => {
      const matches = sameNamespace(record.namespace, input.namespace);
      if (!matches) {
        this.telemetry({
          kind: "authorization_denied",
          reason: "record_namespace_mismatch",
          namespace: input.namespace,
          memoryId: record.memoryId,
          provenance: record.provenance,
          revision: record.revision,
        });
      }
      return matches;
    });
    const expanded = await this.expandOneHop(correctlyRouted, input);
    const authorized: LongTermMemoryRecord[] = [];

    for (const record of expanded.slice(0, this.relevance.maxCandidates)) {
      throwIfAborted(input.signal);
      const decision = await this.authorizer.authorize({
        principal: input.principal,
        scope: input.scope,
        action: "read",
        resource: resourceFor(record),
      });
      if (decision.effect !== "allow") {
        this.telemetry({
          kind: "authorization_denied",
          reason: decision.reasonCode,
          namespace: record.namespace,
          memoryId: record.memoryId,
          provenance: record.provenance,
          revision: record.revision,
        });
        continue;
      }
      if (isActiveAt(record, at)) authorized.push(record);
    }

    const scored = authorized
      .map((record) => {
        const age = Math.max(0, at - Date.parse(record.recordedAt));
        const decay = 0.5 ** (age / this.relevance.recencyHalfLifeMs);
        return {
          record,
          score:
            record.confidence *
            this.relevance.memoryTypeWeights[record.memoryType] *
            decay,
          estimatedTokens: this.estimateTokens(record.value),
        };
      })
      .sort(
        (left, right) =>
          right.score - left.score ||
          Date.parse(right.record.recordedAt) -
            Date.parse(left.record.recordedAt) ||
          left.record.memoryId.localeCompare(right.record.memoryId)
      );

    const tokenLimit = Math.min(
      this.relevance.maxTokens,
      input.budgetHint ?? this.relevance.maxTokens
    );
    const selected: MemoryRecallItem[] = [];
    let usedTokens = 0;
    for (const item of scored) {
      if (usedTokens + item.estimatedTokens > tokenLimit) continue;
      selected.push(item);
      usedTokens += item.estimatedTokens;
    }
    return selected;
  }

  private async expandOneHop(
    records: readonly LongTermMemoryRecord[],
    input: RecallMemoryInput
  ): Promise<LongTermMemoryRecord[]> {
    if (this.referenceResolver === undefined) return [...records];
    const expanded = [...records];
    const seen = new Set(records.map(({ memoryId }) => memoryId));
    for (const record of records) {
      if (expanded.length >= this.relevance.maxCandidates) break;
      const related = await this.referenceResolver.findRelated(
        resourceFor(record),
        input.principal,
        input.scope,
        { limit: this.relevance.maxCandidates - expanded.length }
      );
      for (const resource of related) {
        if (
          resource.resourceType !== "memory" ||
          resource.tenantId !== input.namespace.tenantId ||
          seen.has(resource.resourceId)
        ) {
          continue;
        }
        const relatedRecord = await this.store.get(input.namespace, resource.resourceId);
        if (relatedRecord !== undefined) {
          expanded.push(relatedRecord);
          seen.add(relatedRecord.memoryId);
        }
      }
    }
    return expanded;
  }

  async commit(input: CommitMemoryInput): Promise<CommitMemoryResult> {
    throwIfAborted(input.signal);
    const candidate = parseMemoryCandidate(input.candidate);
    const memoryId = parseMemoryIdentifier(input.memoryId);
    if (!namespaceMatchesTrustedIdentity(candidate.namespace, input.principal, input.scope)) {
      return { status: "denied", reason: "identity_namespace_mismatch" };
    }
    const initialPolicyResult = this.writePolicy.evaluate(
      candidate,
      input.policyContext
    );
    if (initialPolicyResult.status !== "accepted") return initialPolicyResult;
    const resource = resourceFor({ memoryId, namespace: candidate.namespace });
    const decision = await settleWithControl(
      this.authorizer.authorize({
        principal: input.principal,
        scope: input.scope,
        action: "write",
        resource,
      }),
      { signal: input.signal }
    );
    if (decision.effect !== "allow") {
      return { status: "denied", reason: decision.reasonCode };
    }

    try {
      const duplicateRecords = await settleWithControl(
        this.store.search(candidate.namespace, {
          idempotencyKey: candidate.idempotencyKey,
          limit: 1,
        }),
        { signal: input.signal }
      );
      const current = await settleWithControl(
        this.store.get(candidate.namespace, memoryId),
        { signal: input.signal }
      );
      const duplicate = this.writePolicy.findDuplicate(candidate, [
        ...duplicateRecords,
        ...(current === undefined ? [] : [current]),
      ]);
      if (duplicate !== undefined) return duplicate;
      if (
        current !== undefined &&
        input.expectedRevision !== undefined &&
        current.revision !== input.expectedRevision
      ) {
        return { status: "conflict", currentRevision: current.revision };
      }

      const recordedAt = this.now().toISOString();
      const relation =
        current === undefined
          ? "coexists"
          : classifyMemoryRelation(current, candidate, {
              ...(input.currentAuthoritativeValue === undefined
                ? {}
                : { currentAuthoritativeValue: input.currentAuthoritativeValue }),
            });
      const record = parseLongTermMemoryRecord({
        memoryId,
        namespace: candidate.namespace,
        memoryType: candidate.memoryType,
        value: candidate.value,
        provenance: candidate.provenance,
        confidence: candidate.confidence,
        revision: nextRevision(input.expectedRevision),
        ...(candidate.validFrom === undefined
          ? {}
          : { validFrom: candidate.validFrom }),
        ...(candidate.validUntil === undefined
          ? {}
          : { validUntil: candidate.validUntil }),
        recordedAt,
        createdAt: current?.createdAt ?? recordedAt,
        updatedAt: recordedAt,
        ...(candidate.expiresAt === undefined
          ? {}
          : { expiresAt: candidate.expiresAt }),
        idempotencyKey: candidate.idempotencyKey,
        ...(current === undefined
          ? {}
          : { history: [...(current.history ?? []), snapshot(current)] }),
      });
      this.writePolicy.assertSafeForStorage(record.value);
      const committed = await settleWithControl(
        this.store.putIfRevision(
          candidate.namespace,
          memoryId,
          record,
          input.expectedRevision
        ),
        { signal: input.signal }
      );
      if (!committed) {
        const latest = await this.store.get(candidate.namespace, memoryId);
        this.telemetry({
          kind: "revision_conflict",
          reason: "expected_revision_mismatch",
          namespace: candidate.namespace,
          memoryId,
          revision: latest?.revision,
        });
        return { status: "conflict", currentRevision: latest?.revision };
      }
      this.writePolicy.markCommitted(candidate.idempotencyKey);
      await this.recordRelationDecision(memoryId, record, relation);
      this.telemetry({
        kind: "memory_committed",
        reason: relation,
        namespace: record.namespace,
        memoryId: record.memoryId,
        provenance: record.provenance,
        revision: record.revision,
      });
      return { status: "committed", record, relation };
    } catch (error) {
      if (isAbortError(error)) throw error;
      this.telemetry({
        kind: "write_failed",
        reason: "store_unavailable",
        namespace: candidate.namespace,
        memoryId,
        provenance: candidate.provenance,
      });
      return {
        status: "store_error",
        retryable: true,
        idempotencyKey: candidate.idempotencyKey,
      };
    }
  }

  private async recordRelationDecision(
    memoryId: string,
    record: LongTermMemoryRecord,
    relation: MemoryRelation
  ): Promise<void> {
    if (
      this.decisionRecorder === undefined ||
      (relation !== "conflicts" && relation !== "supersedes")
    ) {
      return;
    }
    try {
      await this.decisionRecorder(
        createDecisionRecord({
          decisionId: `${memoryId}:${record.revision}`,
          decisionType: "memory_relation",
          outcome: relation,
          reasonCode: record.provenance.source,
          confidence: record.confidence,
          createdAt: record.recordedAt,
        })
      );
    } catch {
      this.telemetry({
        kind: "provenance_failed",
        reason: "decision_record_unavailable",
        namespace: record.namespace,
        memoryId: record.memoryId,
        provenance: record.provenance,
        revision: record.revision,
      });
    }
  }

  async delete(input: DeleteMemoryInput): Promise<DeleteMemoryResult> {
    throwIfAborted(input.signal);
    const memoryId = parseMemoryIdentifier(input.memoryId);
    if (!namespaceMatchesTrustedIdentity(input.namespace, input.principal, input.scope)) {
      return { status: "denied", reason: "identity_namespace_mismatch" };
    }
    const decision = await this.authorizer.authorize({
      principal: input.principal,
      scope: input.scope,
      action: "write",
      resource: resourceFor({ memoryId, namespace: input.namespace }),
    });
    if (decision.effect !== "allow") {
      return { status: "denied", reason: decision.reasonCode };
    }
    try {
      await settleWithControl(this.store.delete(input.namespace, memoryId), {
        signal: input.signal,
      });
      this.telemetry({
        kind: "memory_deleted",
        reason: "explicit_delete",
        namespace: input.namespace,
        memoryId,
      });
      return { status: "deleted" };
    } catch (error) {
      if (isAbortError(error)) throw error;
      return { status: "store_error" };
    }
  }

  async restore(input: RestoreMemoryInput): Promise<CommitMemoryResult> {
    parseMemoryIdentifier(input.memoryId);
    parseRevision(input.revision);
    const current = await this.readAuthorizedCurrent(input, "write");
    if (current === undefined) return { status: "rejected", reason: "not_found" };
    const selected = [snapshot(current), ...(current.history ?? [])].find(
      ({ revision }) => revision === input.revision
    );
    if (selected === undefined) {
      return { status: "rejected", reason: "revision_not_found" };
    }
    return this.commit({
      principal: input.principal,
      scope: input.scope,
      memoryId: input.memoryId,
      candidate: {
        namespace: input.namespace,
        memoryType: selected.memoryType,
        value: selected.value,
        provenance: {
          source: selected.provenance.source,
          sourceRef: `restore:${selected.revision}`,
        },
        confidence: selected.confidence,
        ...(selected.validFrom === undefined
          ? {}
          : { validFrom: selected.validFrom }),
        ...(selected.validUntil === undefined
          ? {}
          : { validUntil: selected.validUntil }),
        ...(selected.expiresAt === undefined
          ? {}
          : { expiresAt: selected.expiresAt }),
        idempotencyKey: input.idempotencyKey,
      },
      expectedRevision: current.revision,
      policyContext: input.policyContext,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
  }

  async getAtTime(
    input: GetMemoryAtTimeInput
  ): Promise<MemoryRevisionSnapshot | undefined> {
    parseMemoryIdentifier(input.memoryId);
    if (input.query.revision !== undefined) parseRevision(input.query.revision);
    for (const timestamp of [
      input.query.validAt,
      input.query.recordedAtOrBefore,
    ]) {
      if (timestamp !== undefined && !Number.isFinite(Date.parse(timestamp))) {
        throw new Error("point-in-time query contains an invalid timestamp");
      }
    }
    const current = await this.readAuthorizedCurrent(input, "read");
    if (current === undefined) return undefined;
    const candidates = [snapshot(current), ...(current.history ?? [])]
      .filter((revision) => this.matchesPointInTime(revision, input.query))
      .sort(
        (left, right) =>
          Date.parse(right.recordedAt) - Date.parse(left.recordedAt) ||
          Number(BigInt(right.revision.slice(1)) - BigInt(left.revision.slice(1)))
      );
    return candidates[0];
  }

  private async readAuthorizedCurrent(
    input: DeleteMemoryInput,
    action: "read" | "write"
  ): Promise<LongTermMemoryRecord | undefined> {
    throwIfAborted(input.signal);
    const memoryId = parseMemoryIdentifier(input.memoryId);
    if (!namespaceMatchesTrustedIdentity(input.namespace, input.principal, input.scope)) {
      return undefined;
    }
    const decision = await this.authorizer.authorize({
      principal: input.principal,
      scope: input.scope,
      action,
      resource: resourceFor({ memoryId, namespace: input.namespace }),
    });
    if (decision.effect !== "allow") return undefined;
    return settleWithControl(this.store.get(input.namespace, memoryId), {
      signal: input.signal,
    });
  }

  private matchesPointInTime(
    revision: MemoryRevisionSnapshot,
    query: PointInTimeQuery
  ): boolean {
    if (query.revision !== undefined && revision.revision !== query.revision) {
      return false;
    }
    const filter: MemorySearchFilter = {
      ...(query.validAt === undefined ? {} : { validAt: query.validAt }),
      ...(query.recordedAtOrBefore === undefined
        ? {}
        : { recordedAtOrBefore: query.recordedAtOrBefore }),
    };
    if (
      filter.recordedAtOrBefore !== undefined &&
      Date.parse(revision.recordedAt) > Date.parse(filter.recordedAtOrBefore)
    ) {
      return false;
    }
    if (filter.validAt !== undefined) {
      const at = Date.parse(filter.validAt);
      if (revision.validFrom !== undefined && Date.parse(revision.validFrom) > at) {
        return false;
      }
      if (revision.validUntil !== undefined && Date.parse(revision.validUntil) <= at) {
        return false;
      }
    }
    return true;
  }
}
