import { describe, expect, it } from "vitest";

import {
  createReplayKey,
  createRequestDedupKey,
  createToolExecutionAttemptIdentity,
  hashBusinessEffectKey,
} from "./identity.js";

const logicalIdentity = {
  runId: "run-1",
  stepId: "step-1",
  logicalToolCallId: "tool-call-1",
  callIndex: 0,
  toolName: "side_effect_tool",
  toolVersion: "1",
};

describe("side-effect identity", () => {
  it("keeps replayKey stable across checkpoint resume and physical retry", () => {
    const firstInvocation = { ...logicalIdentity, attempt: 1 };
    const resumedInvocation = { ...logicalIdentity, attempt: 2 };

    expect(createReplayKey(firstInvocation)).toBe(
      createReplayKey(resumedInvocation)
    );
  });

  it("changes replayKey when a logical identity component changes", () => {
    expect(createReplayKey(logicalIdentity)).not.toBe(
      createReplayKey({ ...logicalIdentity, callIndex: 1 })
    );
  });

  it("creates a unique physical attempt id without changing replayKey", () => {
    const replayKey = createReplayKey(logicalIdentity);
    const first = createToolExecutionAttemptIdentity({
      toolExecutionId: "execution-1",
      executionAttempt: 1,
    });
    const second = createToolExecutionAttemptIdentity({
      toolExecutionId: "execution-1",
      executionAttempt: 2,
    });

    expect(first.toolExecutionAttemptId).not.toBe(
      second.toolExecutionAttemptId
    );
    expect(first.executionAttempt).toBe(1);
    expect(second.executionAttempt).toBe(2);
    expect(createReplayKey(logicalIdentity)).toBe(replayKey);
  });

  it("creates opaque business-effect and trusted request-dedup keys", () => {
    expect(hashBusinessEffectKey("customer:alice@example.test")).toMatch(
      /^[a-f0-9]{64}$/
    );
    expect(
      createRequestDedupKey({
        tenantId: "tenant-1",
        principalId: "principal-1",
        routeNamespace: "/api/langgraph/runs",
        clientKey: "client-key",
      })
    ).toMatch(/^[a-f0-9]{64}$/);
  });
});
