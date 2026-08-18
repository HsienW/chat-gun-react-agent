import {
  createResumedEvent,
  createTaskCancelledEvent,
  createWaitingConfirmationEvent,
} from "../events.js";
import { transitionTask, transitionTaskStep } from "../state-machine.js";
import type { AgentTask, TaskEvent } from "../types.js";
import type {
  AuthorizationDecision,
  AuthorizationEffect,
  AuthorizationReasonCode,
} from "./authorization.js";
import type { ResourceRef } from "./resource-ref.js";
import type { RuntimeScope } from "./scope.js";

export const TOOL_RISK_TIERS = [
  "read",
  "write",
  "sensitive",
  "communication",
] as const;

export type ToolRiskTier = (typeof TOOL_RISK_TIERS)[number];

export interface ToolRiskPolicy {
  toolName: string;
  riskTier: ToolRiskTier;
  actions: readonly string[];
  requireConfirmation: boolean;
  resourceRefResolver: (input: unknown, scope: RuntimeScope) => ResourceRef;
}

export const TOOL_RISK_REASON_CODES = [
  "TOOL_ACTION_AUTHORIZED",
  "TOOL_ACTION_NOT_DECLARED",
  "REQUIRES_CONFIRMATION",
  "UNREGISTERED_TOOL_READ_DEFAULT",
  "UNREGISTERED_TOOL_DENIED",
] as const;

export type ToolRiskReasonCode = (typeof TOOL_RISK_REASON_CODES)[number];

export interface ToolActionClassification {
  effect: AuthorizationEffect;
  riskTier: ToolRiskTier;
  requiresAuthorization: boolean;
  requiresConfirmation: boolean;
  reasonCode: ToolRiskReasonCode;
}

export function classifyToolAction(
  policy: ToolRiskPolicy,
  action: string
): ToolActionClassification {
  if (!policy.actions.includes(action)) {
    return {
      effect: "deny",
      riskTier: policy.riskTier,
      requiresAuthorization: true,
      requiresConfirmation: false,
      reasonCode: "TOOL_ACTION_NOT_DECLARED",
    };
  }

  const requiresConfirmation =
    policy.requireConfirmation ||
    policy.riskTier === "sensitive" ||
    policy.riskTier === "communication";
  return {
    effect: requiresConfirmation ? "require_confirmation" : "allow",
    riskTier: policy.riskTier,
    requiresAuthorization: true,
    requiresConfirmation,
    reasonCode: requiresConfirmation
      ? "REQUIRES_CONFIRMATION"
      : "TOOL_ACTION_AUTHORIZED",
  };
}

export interface ToolRiskRegistryConfig {
  unregisteredToolDefault: "read" | "deny";
}

export class ToolRiskRegistry {
  private readonly policies = new Map<string, ToolRiskPolicy>();

  constructor(
    policies: readonly ToolRiskPolicy[],
    private readonly config: ToolRiskRegistryConfig
  ) {
    for (const policy of policies) {
      if (this.policies.has(policy.toolName)) {
        throw new Error(`Duplicate ToolRiskPolicy: ${policy.toolName}`);
      }
      this.policies.set(policy.toolName, policy);
    }
  }

  get(toolName: string): ToolRiskPolicy | null {
    return this.policies.get(toolName) ?? null;
  }

  classify(toolName: string, action: string): ToolActionClassification {
    const policy = this.get(toolName);
    if (policy !== null) return classifyToolAction(policy, action);

    if (this.config.unregisteredToolDefault === "deny") {
      return {
        effect: "deny",
        riskTier: "read",
        requiresAuthorization: false,
        requiresConfirmation: false,
        reasonCode: "UNREGISTERED_TOOL_DENIED",
      };
    }

    return {
      effect: "allow",
      riskTier: "read",
      requiresAuthorization: false,
      requiresConfirmation: false,
      reasonCode: "UNREGISTERED_TOOL_READ_DEFAULT",
    };
  }
}

export interface EnterAuthorizationHitlInput {
  decision: AuthorizationDecision;
  task: AgentTask;
  stepId?: string;
  timeoutMs: number;
  now?: Date;
}

export interface PendingAuthorizationConfirmation {
  decision: AuthorizationDecision;
  task: AgentTask;
  event: TaskEvent;
  expiresAt: string;
}

export type ConfirmationResolution = "approved" | "cancelled" | "timeout";

export interface ResolveAuthorizationHitlInput {
  resolution: ConfirmationResolution;
  resolvedAt?: Date;
}

export interface ResolvedAuthorizationConfirmation {
  decision: AuthorizationDecision;
  task: AgentTask;
  event: TaskEvent;
}

function transitionTaskOrThrow(task: AgentTask, status: "waiting_confirmation" | "running" | "cancelled"): AgentTask {
  const result = transitionTask(task, status);
  if (!result.valid) throw new Error(result.reason);
  return result.next;
}

function updatedDecision(
  decision: AuthorizationDecision,
  effect: AuthorizationEffect,
  reasonCode: AuthorizationReasonCode
): AuthorizationDecision {
  return { ...decision, effect, reasonCode };
}

export class AuthorizationHitlBridge {
  enter(input: EnterAuthorizationHitlInput): PendingAuthorizationConfirmation {
    if (input.decision.effect !== "require_confirmation") {
      throw new Error("HITL requires a require_confirmation decision");
    }
    if (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0) {
      throw new Error("HITL timeoutMs must be a positive finite number");
    }

    const now = input.now ?? new Date();
    if (Number.isNaN(now.getTime())) {
      throw new Error("HITL now must be a valid date");
    }

    let waitingTask = input.task;
    if (input.stepId !== undefined) {
      const stepResult = transitionTaskStep(
        waitingTask,
        input.stepId,
        "waiting_confirmation"
      );
      if (!stepResult.valid) throw new Error(stepResult.reason);
      waitingTask = stepResult.next;
    }
    waitingTask = transitionTaskOrThrow(waitingTask, "waiting_confirmation");

    const waitingStep = input.stepId
      ? waitingTask.steps.find((step) => step.stepId === input.stepId)
      : undefined;
    return {
      decision: input.decision,
      task: waitingTask,
      event: createWaitingConfirmationEvent(waitingTask, waitingStep),
      expiresAt: new Date(now.getTime() + input.timeoutMs).toISOString(),
    };
  }

  resolve(
    pending: PendingAuthorizationConfirmation,
    input: ResolveAuthorizationHitlInput
  ): ResolvedAuthorizationConfirmation {
    const resolvedAt = input.resolvedAt ?? new Date();
    const resolvedAtEpochMs = resolvedAt.getTime();
    const expiresAtEpochMs = Date.parse(pending.expiresAt);
    const timedOut =
      !Number.isFinite(resolvedAtEpochMs) ||
      !Number.isFinite(expiresAtEpochMs) ||
      resolvedAtEpochMs >= expiresAtEpochMs ||
      input.resolution === "timeout";

    if (input.resolution === "approved" && !timedOut) {
      const task = transitionTaskOrThrow(pending.task, "running");
      return {
        decision: updatedDecision(
          pending.decision,
          "allow",
          "CONFIRMATION_APPROVED"
        ),
        task,
        event: createResumedEvent(task),
      };
    }

    const task = transitionTaskOrThrow(pending.task, "cancelled");
    return {
      decision: updatedDecision(
        pending.decision,
        "deny",
        timedOut ? "CONFIRMATION_TIMEOUT" : "CONFIRMATION_CANCELLED"
      ),
      task,
      event: createTaskCancelledEvent(task),
    };
  }
}
