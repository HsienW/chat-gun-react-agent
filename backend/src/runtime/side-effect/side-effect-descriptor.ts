import type {
  BusinessEffectKey,
  TrustedScope,
} from "./identity.js";

export type { TrustedScope } from "./identity.js";

export const CACHE_STATES = [
  "reusable",
  "expired",
  "invalidated",
  "authorization_mismatch",
  "version_mismatch",
] as const;

export type CacheState = (typeof CACHE_STATES)[number];

export interface ResultReference {
  resultHash: string;
  payloadRef: string;
  externalSystemNamespace?: string;
  externalOperationId?: string;
}

export interface ResultReferencePolicy<TResult> {
  toResultRef(result: TResult): ResultReference;
  resolveResultRef(payloadRef: string): Promise<TResult | null>;
  isReusable(
    cacheState: CacheState,
    scope: TrustedScope,
    toolVersion: string
  ): boolean;
}

export interface ReconciliationInput {
  toolExecutionId: string;
  externalOperationId?: string;
  businessEffectKey: BusinessEffectKey;
}

export type ReconciliationResult<TResult> =
  | { state: "committed"; result?: TResult }
  | { state: "not_committed" }
  | { state: "unknown"; reason?: string };

export interface SideEffectReconciler<TResult = unknown> {
  reconcile(input: ReconciliationInput): Promise<ReconciliationResult<TResult>>;
}

export interface SideEffectToolDescriptor<TInput, TResult> {
  toolName: string;
  toolVersion: string;
  deriveBusinessEffectKey(input: TInput, scope: TrustedScope): string;
  reconcile?: SideEffectReconciler<TResult>;
  resultReferencePolicy: ResultReferencePolicy<TResult>;
}
