import { describe, expect, it } from "vitest";

import {
  createDecisionRecord,
  createEvidenceRef,
} from "./index.js";

describe("provenance public surface", () => {
  it("keeps correlation fields and tool execution references without raw content", () => {
    const decision = createDecisionRecord({
      decisionId: "decision-1",
      requestId: "request-1",
      threadId: "thread-1",
      runId: "run-1",
      taskId: "task-1",
      stepId: "step-1",
      decisionType: "routing",
      outcome: "selected",
      reasonCode: "POLICY_MATCH",
    });
    const evidence = createEvidenceRef({
      evidenceRefId: "evidence-1",
      decisionId: decision.decisionId,
      resource: {
        resourceType: "tool_execution",
        resourceId: "tool-execution-1",
        tenantId: "tenant-1",
      },
      role: "tool_result",
    });

    expect(decision).toMatchObject({
      requestId: "request-1",
      threadId: "thread-1",
      runId: "run-1",
      taskId: "task-1",
      stepId: "step-1",
    });
    expect(evidence.resource.resourceType).toBe("tool_execution");
    expect(decision).not.toHaveProperty("rawPrompt");
    expect(evidence).not.toHaveProperty("rawToolOutput");
  });
});
