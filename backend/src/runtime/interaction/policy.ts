export const INTERACTION_STRATEGIES = [
  "reject",
  "enqueue",
  "interrupt",
  "supersede",
  "rollback",
] as const;

export type InteractionStrategy = (typeof INTERACTION_STRATEGIES)[number];

export const CLARIFICATION_REPLY_MODES = [
  "resume_same_task",
  "new_task",
] as const;

export type ClarificationReplyMode =
  (typeof CLARIFICATION_REPLY_MODES)[number];

export const CANCELLATION_MODES = [
  "cancel_if_read_only",
  "compensate_if_needed",
  "finish_committed_effect_then_correct",
] as const;

export type CancellationMode = (typeof CANCELLATION_MODES)[number];

export interface InteractionPolicy {
  strategy: InteractionStrategy;
  clarificationReplyMode: ClarificationReplyMode;
  cancellationMode: CancellationMode;
  allowIntentRevision: boolean;
}

export interface LoadedInteractionPolicy {
  configured: boolean;
  policy: InteractionPolicy;
}

export const DEFAULT_INTERACTION_POLICY: Readonly<InteractionPolicy> =
  Object.freeze({
    strategy: "enqueue",
    clarificationReplyMode: "new_task",
    cancellationMode: "cancel_if_read_only",
    allowIntentRevision: false,
  });

export class InteractionPolicyConfigError extends Error {
  constructor() {
    super("Invalid interaction policy configuration");
    this.name = "InteractionPolicyConfigError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isInteractionStrategy(value: unknown): value is InteractionStrategy {
  return typeof value === "string" &&
    INTERACTION_STRATEGIES.some((strategy) => strategy === value);
}

function isClarificationReplyMode(
  value: unknown
): value is ClarificationReplyMode {
  return typeof value === "string" &&
    CLARIFICATION_REPLY_MODES.some((mode) => mode === value);
}

function isCancellationMode(value: unknown): value is CancellationMode {
  return typeof value === "string" &&
    CANCELLATION_MODES.some((mode) => mode === value);
}

function parseInteractionPolicy(value: unknown): InteractionPolicy {
  if (!isRecord(value)) throw new InteractionPolicyConfigError();

  const allowedKeys = new Set([
    "strategy",
    "clarificationReplyMode",
    "cancellationMode",
    "allowIntentRevision",
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new InteractionPolicyConfigError();
  }

  if (
    !isInteractionStrategy(value.strategy) ||
    !isClarificationReplyMode(value.clarificationReplyMode) ||
    !isCancellationMode(value.cancellationMode) ||
    typeof value.allowIntentRevision !== "boolean"
  ) {
    throw new InteractionPolicyConfigError();
  }

  return {
    strategy: value.strategy,
    clarificationReplyMode: value.clarificationReplyMode,
    cancellationMode: value.cancellationMode,
    allowIntentRevision: value.allowIntentRevision,
  };
}

export function loadInteractionPolicy(
  rawPolicy: string | undefined
): LoadedInteractionPolicy {
  if (rawPolicy === undefined || rawPolicy.trim() === "") {
    return { configured: false, policy: DEFAULT_INTERACTION_POLICY };
  }

  try {
    return {
      configured: true,
      policy: parseInteractionPolicy(JSON.parse(rawPolicy)),
    };
  } catch (error) {
    if (error instanceof InteractionPolicyConfigError) throw error;
    throw new InteractionPolicyConfigError();
  }
}
