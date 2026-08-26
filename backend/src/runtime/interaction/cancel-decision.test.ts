import { describe, expect, it, vi } from "vitest";

import {
  PgCancellationLedgerReader,
  decideCancellation,
  type CancellationDecisionDependencies,
  type CancellationLedgerEntry,
} from "./cancel-decision.js";
import type { PrincipalContext } from "../authorization/principal.js";
import type { RuntimeScope } from "../authorization/scope.js";
import type { Queryable } from "../persistence/rows.js";

const principal: PrincipalContext = {
  principalId: "principal-1",
  principalType: "user",
  tenantId: "tenant-1",
  roles: ["member"],
  scopes: ["conversation:write"],
  authSource: "trusted_gateway",
  authenticatedAt: "2026-08-20T00:00:00.000Z",
};

const scope: RuntimeScope = {
  scopeId: "scope-1",
  scopeType: "conversation",
  tenantId: "tenant-1",
  ownerPrincipalId: "principal-1",
};

function createEntry(
  overrides: Partial<CancellationLedgerEntry> = {}
): CancellationLedgerEntry {
  return {
    toolExecutionId: "tool-execution-1",
    toolName: "send_message",
    stepId: "step-1",
    executionStatus: "committed",
    effectCommitState: "committed",
    isReversible: true,
    ...overrides,
  };
}

function createDependencies(entries: CancellationLedgerEntry[]) {
  const getRunEntries = vi.fn<CancellationDecisionDependencies["ledger"]["getRunEntries"]>(
    async () => entries
  );
  const compensate = vi.fn<CancellationDecisionDependencies["compensate"]>(
    async () => ({ status: "compensated" })
  );
  const reconcile = vi.fn<CancellationDecisionDependencies["reconcile"]>(
    async () => ({ phase: "read_only" })
  );
  const authorizeCorrective = vi.fn<
    CancellationDecisionDependencies["authorizeCorrective"]
  >(async () => ({
    decisionId: "decision-1",
    effect: "allow",
    reasonCode: "POLICY_ALLOWED",
    createdAt: "2026-08-20T00:00:00.000Z",
  }));

  return {
    ledger: { getRunEntries },
    compensate,
    reconcile,
    authorizeCorrective,
  };
}

class FakeCancellationDb implements Queryable {
  readonly calls: Array<{ text: string; values: readonly unknown[] }> = [];

  async query<TResult extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = []
  ): Promise<{ rows: TResult[]; rowCount: number | null }> {
    this.calls.push({ text, values });
    const rows = [
      {
        tool_execution_id: "tool-execution-1",
        tool_name: "reserve_table",
        step_id: "step-1",
        execution_status: "committed",
        effect_commit_state: "committed",
      },
    ];
    return { rows: rows as unknown as TResult[], rowCount: rows.length };
  }
}

describe("PgCancellationLedgerReader", () => {
  it("reads X8.6 tool executions and business effect commit state", async () => {
    const database = new FakeCancellationDb();
    const reader = new PgCancellationLedgerReader(
      database,
      ({ toolName }) => toolName === "reserve_table"
    );

    await expect(reader.getRunEntries("run-1")).resolves.toEqual([
      expect.objectContaining({
        toolExecutionId: "tool-execution-1",
        effectCommitState: "committed",
        isReversible: true,
      }),
    ]);
    expect(database.calls[0]?.text).toContain("FROM tool_executions");
    expect(database.calls[0]?.text).toContain("LEFT JOIN business_effects");
    expect(database.calls[0]?.values).toEqual(["run-1"]);
  });
});

describe("decideCancellation", () => {
  it("allows interrupt or supersede for a read-only run", async () => {
    const dependencies = createDependencies([]);

    await expect(
      decideCancellation(
        { runId: "run-1", taskId: "task-1", principal, scope },
        dependencies
      )
    ).resolves.toEqual({
      phase: "read_only",
      path: "interrupt_or_supersede",
    });
    expect(dependencies.compensate).not.toHaveBeenCalled();
    expect(dependencies.reconcile).not.toHaveBeenCalled();
  });

  it("compensates reversible committed effects before supersede", async () => {
    const dependencies = createDependencies([createEntry()]);

    await expect(
      decideCancellation(
        { runId: "run-1", taskId: "task-1", principal, scope },
        dependencies
      )
    ).resolves.toEqual({
      phase: "reversible_committed",
      path: "compensated_then_supersede",
    });
    expect(dependencies.compensate).toHaveBeenCalledWith({
      runId: "run-1",
      taskId: "task-1",
      reason: "user_cancelled",
    });
  });

  it("never fakes rollback for an irreversible committed effect", async () => {
    const dependencies = createDependencies([
      createEntry({ isReversible: false }),
    ]);

    const decision = await decideCancellation(
      { runId: "run-1", taskId: "task-1", principal, scope },
      dependencies
    );

    expect(decision).toEqual({
      phase: "irreversible_committed",
      path: "corrective_authorized",
      authorizationDecisionId: "decision-1",
    });
    expect(JSON.stringify(decision)).not.toContain("rollback");
    expect(dependencies.compensate).not.toHaveBeenCalled();
    expect(dependencies.authorizeCorrective).toHaveBeenCalledWith({
      runId: "run-1",
      taskId: "task-1",
      principal,
      scope,
      action: "interaction.corrective",
    });
  });

  it("requires manual intervention when corrective authorization is not allowed", async () => {
    const dependencies = createDependencies([
      createEntry({ isReversible: false }),
    ]);
    dependencies.authorizeCorrective.mockResolvedValue({
      decisionId: "decision-denied",
      effect: "deny",
      reasonCode: "ACTION_NOT_ALLOWED",
      createdAt: "2026-08-20T00:00:00.000Z",
    });

    await expect(
      decideCancellation(
        { runId: "run-1", taskId: "task-1", principal, scope },
        dependencies
      )
    ).resolves.toEqual({
      phase: "irreversible_committed",
      path: "manual_intervention_required",
      authorizationDecisionId: "decision-denied",
    });
  });

  it("reconciles an unknown outcome before selecting the cancellation path", async () => {
    const dependencies = createDependencies([
      createEntry({
        executionStatus: "unknown",
        effectCommitState: "unknown",
      }),
    ]);
    dependencies.reconcile.mockResolvedValue({
      phase: "reversible_committed",
    });

    await expect(
      decideCancellation(
        { runId: "run-1", taskId: "task-1", principal, scope },
        dependencies
      )
    ).resolves.toEqual({
      phase: "reversible_committed",
      path: "compensated_then_supersede",
      reconciled: true,
    });
    expect(dependencies.reconcile).toHaveBeenCalledOnce();
    expect(dependencies.reconcile.mock.invocationCallOrder[0]).toBeLessThan(
      dependencies.compensate.mock.invocationCallOrder[0] ?? Infinity
    );
  });

  it("defers unresolved unknown outcomes to manual intervention", async () => {
    const dependencies = createDependencies([
      createEntry({
        executionStatus: "executing",
        effectCommitState: "prepared",
      }),
    ]);
    dependencies.reconcile.mockResolvedValue({ phase: "unknown" });

    await expect(
      decideCancellation(
        { runId: "run-1", taskId: "task-1", principal, scope },
        dependencies
      )
    ).resolves.toEqual({
      phase: "unknown",
      path: "manual_intervention_required",
      reconciled: true,
    });
    expect(dependencies.compensate).not.toHaveBeenCalled();
  });
});
