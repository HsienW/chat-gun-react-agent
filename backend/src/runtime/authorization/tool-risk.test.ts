import { describe, expect, it } from "vitest";

import type { AgentTask } from "../types.js";
import type { AuthorizationDecision } from "./authorization.js";
import {
  AuthorizationHitlBridge,
  ToolRiskRegistry,
  classifyToolAction,
  type ToolRiskPolicy,
  type ToolRiskTier,
} from "./tool-risk.js";

function createPolicy(
  riskTier: ToolRiskTier,
  requireConfirmation = false
): ToolRiskPolicy {
  return {
    toolName: `test-${riskTier}`,
    riskTier,
    actions: ["task:read"],
    requireConfirmation,
    resourceRefResolver: (_input, scope) => ({
      resourceType: "task",
      resourceId: "task-1",
      tenantId: scope.tenantId,
    }),
  };
}

function createTask(): AgentTask {
  return {
    taskId: "task-1",
    taskType: "tool-execution",
    status: "running",
    steps: [
      {
        stepId: "step-1",
        stepName: "dispatch",
        status: "running",
        attempt: 1,
        maxAttempts: 1,
        createdAt: "2026-08-18T00:00:00.000Z",
        updatedAt: "2026-08-18T00:00:00.000Z",
      },
    ],
    metadata: {},
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z",
  };
}

function confirmationDecision(): AuthorizationDecision {
  return {
    decisionId: "decision-1",
    effect: "require_confirmation",
    reasonCode: "REQUIRES_CONFIRMATION",
    matchedPolicy: "task-write-policy-v1",
    createdAt: "2026-08-18T00:00:00.000Z",
  };
}

describe("classifyToolAction", () => {
  it.each([
    ["read", "allow", false],
    ["write", "allow", false],
    ["sensitive", "require_confirmation", true],
    ["communication", "require_confirmation", true],
  ] as const)(
    "classifies %s tier without hard-coded tool names",
    (riskTier, effect, requiresConfirmation) => {
      expect(classifyToolAction(createPolicy(riskTier), "task:read")).toEqual({
        effect,
        riskTier,
        requiresAuthorization: true,
        requiresConfirmation,
        reasonCode:
          effect === "allow" ? "TOOL_ACTION_AUTHORIZED" : "REQUIRES_CONFIRMATION",
      });
    }
  );

  it("denies an action not declared by the tool policy", () => {
    expect(classifyToolAction(createPolicy("read"), "task:update")).toEqual({
      effect: "deny",
      riskTier: "read",
      requiresAuthorization: true,
      requiresConfirmation: false,
      reasonCode: "TOOL_ACTION_NOT_DECLARED",
    });
  });
});

describe("ToolRiskRegistry", () => {
  it("uses the configured read default for an unregistered tool", () => {
    const registry = new ToolRiskRegistry([], {
      unregisteredToolDefault: "read",
    });

    expect(registry.classify("future-tool", "catalog:read")).toMatchObject({
      effect: "allow",
      riskTier: "read",
      requiresAuthorization: false,
      reasonCode: "UNREGISTERED_TOOL_READ_DEFAULT",
    });
  });

  it("uses the configured deny default for an unregistered tool", () => {
    const registry = new ToolRiskRegistry([], {
      unregisteredToolDefault: "deny",
    });

    expect(registry.classify("future-tool", "catalog:read")).toMatchObject({
      effect: "deny",
      requiresAuthorization: false,
      reasonCode: "UNREGISTERED_TOOL_DENIED",
    });
  });
});

describe("AuthorizationHitlBridge", () => {
  const bridge = new AuthorizationHitlBridge();

  it("enters the existing task and step waiting_confirmation state", () => {
    const pending = bridge.enter({
      decision: confirmationDecision(),
      task: createTask(),
      stepId: "step-1",
      timeoutMs: 60_000,
      now: new Date("2026-08-18T01:00:00.000Z"),
    });

    expect(pending.task.status).toBe("waiting_confirmation");
    expect(pending.task.steps[0]?.status).toBe("waiting_confirmation");
    expect(pending.event).toMatchObject({
      eventType: "waiting_confirmation",
      taskId: "task-1",
      stepId: "step-1",
    });
    expect(pending.expiresAt).toBe("2026-08-18T01:01:00.000Z");
  });

  it.each([
    ["cancelled", "CONFIRMATION_CANCELLED"],
    ["timeout", "CONFIRMATION_TIMEOUT"],
  ] as const)("fails closed when confirmation is %s", (resolution, reasonCode) => {
    const pending = bridge.enter({
      decision: confirmationDecision(),
      task: createTask(),
      stepId: "step-1",
      timeoutMs: 60_000,
      now: new Date("2026-08-18T01:00:00.000Z"),
    });

    const resolved = bridge.resolve(pending, {
      resolution,
      resolvedAt: new Date("2026-08-18T01:00:30.000Z"),
    });

    expect(resolved.decision).toMatchObject({ effect: "deny", reasonCode });
    expect(resolved.task.status).toBe("cancelled");
    expect(resolved.event.eventType).toBe("task_cancelled");
  });

  it("treats a late approval as timeout deny", () => {
    const pending = bridge.enter({
      decision: confirmationDecision(),
      task: createTask(),
      timeoutMs: 60_000,
      now: new Date("2026-08-18T01:00:00.000Z"),
    });

    const resolved = bridge.resolve(pending, {
      resolution: "approved",
      resolvedAt: new Date("2026-08-18T01:01:01.000Z"),
    });

    expect(resolved.decision).toMatchObject({
      effect: "deny",
      reasonCode: "CONFIRMATION_TIMEOUT",
    });
  });
});
