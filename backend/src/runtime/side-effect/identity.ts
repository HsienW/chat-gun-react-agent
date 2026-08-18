import { createHash, randomUUID } from "node:crypto";

type BrandedString<TBrand extends string> = string & {
  readonly __brand: TBrand;
};

export type ReplayKey = BrandedString<"ReplayKey">;
export type ToolExecutionAttemptId = BrandedString<"ToolExecutionAttemptId">;
export type BusinessEffectKey = BrandedString<"BusinessEffectKey">;
export type RequestDedupKey = BrandedString<"RequestDedupKey">;

export interface TrustedScope {
  scopeId: string;
  tenantId: string;
  principalId: string;
}

export interface ReplayIdentityInput {
  runId: string;
  stepId: string;
  logicalToolCallId?: string;
  toolCallId?: string;
  callIndex: number;
  toolName: string;
  toolVersion: string;
  /** Logical call generation. Checkpoint resume must preserve this value. */
  attempt?: number;
}

export interface ToolExecutionAttemptIdentity {
  toolExecutionAttemptId: ToolExecutionAttemptId;
  toolExecutionId: string;
  executionAttempt: number;
}

export interface RequestDedupIdentityInput {
  tenantId: string;
  principalId: string;
  routeNamespace: string;
  clientKey: string;
}

function assertNonEmpty(value: string, fieldName: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${fieldName} must not be empty`);
  }
}

function hashTuple(values: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify(values)).digest("hex");
}

export function createReplayKey(input: ReplayIdentityInput): ReplayKey {
  const logicalToolCallId = input.logicalToolCallId ?? input.toolCallId;
  if (!logicalToolCallId) {
    throw new Error("logicalToolCallId or toolCallId is required");
  }
  if (!Number.isSafeInteger(input.callIndex) || input.callIndex < 0) {
    throw new Error("callIndex must be a non-negative safe integer");
  }

  const components = [
    input.runId,
    input.stepId,
    logicalToolCallId,
    String(input.callIndex),
    input.toolName,
    input.toolVersion,
  ] as const;
  components.forEach((value, index) =>
    assertNonEmpty(value, `replay identity component ${index}`)
  );

  return hashTuple(components) as ReplayKey;
}

export function createToolExecutionAttemptIdentity(input: {
  toolExecutionId: string;
  executionAttempt: number;
}): ToolExecutionAttemptIdentity {
  assertNonEmpty(input.toolExecutionId, "toolExecutionId");
  if (
    !Number.isSafeInteger(input.executionAttempt) ||
    input.executionAttempt < 1
  ) {
    throw new Error("executionAttempt must be a positive safe integer");
  }

  return {
    toolExecutionAttemptId: randomUUID() as ToolExecutionAttemptId,
    toolExecutionId: input.toolExecutionId,
    executionAttempt: input.executionAttempt,
  };
}

export function hashBusinessEffectKey(rawKey: string): BusinessEffectKey {
  assertNonEmpty(rawKey, "businessEffectKey");
  return hashTuple([rawKey]) as BusinessEffectKey;
}

export function createRequestDedupKey(
  input: RequestDedupIdentityInput
): RequestDedupKey {
  const components = [
    input.tenantId,
    input.principalId,
    input.routeNamespace,
    input.clientKey,
  ] as const;
  components.forEach((value, index) =>
    assertNonEmpty(value, `request dedup identity component ${index}`)
  );
  return hashTuple(components) as RequestDedupKey;
}
