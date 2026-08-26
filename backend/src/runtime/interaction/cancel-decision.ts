import type { AuthorizationDecision } from "../authorization/authorization.js";
import type { PrincipalContext } from "../authorization/principal.js";
import type { RuntimeScope } from "../authorization/scope.js";
import type { Queryable } from "../persistence/rows.js";
import {
  TOOL_EXECUTION_STATUSES,
  type BusinessEffectCommitState,
  type ToolExecutionStatus,
} from "../side-effect/business-effect-ledger.js";

export type CancellationPhase =
  | "read_only"
  | "reversible_committed"
  | "irreversible_committed"
  | "unknown";

export interface CancellationLedgerEntry {
  toolExecutionId: string;
  toolName: string;
  stepId: string;
  executionStatus: ToolExecutionStatus;
  effectCommitState?: BusinessEffectCommitState;
  isReversible: boolean;
}

export interface CancellationLedgerReader {
  getRunEntries(runId: string): Promise<CancellationLedgerEntry[]>;
}

interface CancellationLedgerRow extends Record<string, unknown> {
  tool_execution_id: string;
  tool_name: string;
  step_id: string;
  execution_status: string;
  effect_commit_state: string | null;
}

const BUSINESS_EFFECT_COMMIT_STATES = [
  "prepared",
  "committed",
  "compensated",
  "unknown",
] as const;

function isToolExecutionStatus(value: string): value is ToolExecutionStatus {
  return TOOL_EXECUTION_STATUSES.some((status) => status === value);
}

function isBusinessEffectCommitState(
  value: string
): value is BusinessEffectCommitState {
  return BUSINESS_EFFECT_COMMIT_STATES.some((state) => state === value);
}

export class PgCancellationLedgerReader implements CancellationLedgerReader {
  constructor(
    private readonly db: Queryable,
    private readonly isReversibleExecution: (input: {
      toolName: string;
      stepId: string;
    }) => boolean
  ) {}

  async getRunEntries(runId: string): Promise<CancellationLedgerEntry[]> {
    const result = await this.db.query<CancellationLedgerRow>(
      `SELECT te.tool_execution_id,
              te.tool_name,
              te.step_id,
              te.status AS execution_status,
              be.commit_state AS effect_commit_state
       FROM tool_executions te
       LEFT JOIN business_effects be
         ON be.business_effect_id = te.business_effect_id
       WHERE te.run_id = $1
       ORDER BY te.created_at, te.tool_execution_id`,
      [runId]
    );

    return result.rows.map((row) => {
      if (!isToolExecutionStatus(row.execution_status)) {
        throw new Error(
          `Unknown tool execution status: ${row.execution_status}`
        );
      }
      if (
        row.effect_commit_state !== null &&
        !isBusinessEffectCommitState(row.effect_commit_state)
      ) {
        throw new Error(
          `Unknown business effect state: ${row.effect_commit_state}`
        );
      }

      return {
        toolExecutionId: row.tool_execution_id,
        toolName: row.tool_name,
        stepId: row.step_id,
        executionStatus: row.execution_status,
        ...(row.effect_commit_state
          ? { effectCommitState: row.effect_commit_state }
          : {}),
        isReversible: this.isReversibleExecution({
          toolName: row.tool_name,
          stepId: row.step_id,
        }),
      };
    });
  }
}

export function deriveCancellationPhase(
  entries: readonly CancellationLedgerEntry[]
): CancellationPhase {
  if (entries.length === 0) return "read_only";

  const hasUnknownOutcome = entries.some(
    (entry) =>
      entry.executionStatus === "executing" ||
      entry.executionStatus === "unknown" ||
      entry.effectCommitState === "unknown" ||
      (entry.executionStatus === "committed" &&
        entry.effectCommitState !== "committed")
  );
  if (hasUnknownOutcome) return "unknown";

  const committedEntries = entries.filter(
    (entry) =>
      entry.executionStatus === "committed" &&
      entry.effectCommitState === "committed"
  );
  if (committedEntries.length === 0) return "read_only";
  if (committedEntries.some((entry) => !entry.isReversible)) {
    return "irreversible_committed";
  }
  return "reversible_committed";
}

export interface CancellationRequestContext {
  runId: string;
  taskId: string;
  principal: PrincipalContext;
  scope: RuntimeScope;
}

export interface CancellationDecisionDependencies {
  ledger: CancellationLedgerReader;
  compensate(input: {
    runId: string;
    taskId: string;
    reason: "user_cancelled";
  }): Promise<{ status: "compensated" | "failed" }>;
  reconcile(input: {
    runId: string;
    taskId: string;
    entries: readonly CancellationLedgerEntry[];
  }): Promise<{ phase: CancellationPhase }>;
  authorizeCorrective(input: {
    runId: string;
    taskId: string;
    principal: PrincipalContext;
    scope: RuntimeScope;
    action: "interaction.corrective";
  }): Promise<AuthorizationDecision>;
}

export type CancellationDecision =
  | { phase: "read_only"; path: "interrupt_or_supersede"; reconciled?: true }
  | {
      phase: "reversible_committed";
      path: "compensated_then_supersede";
      reconciled?: true;
    }
  | {
      phase: "reversible_committed" | "irreversible_committed" | "unknown";
      path: "manual_intervention_required";
      authorizationDecisionId?: string;
      reconciled?: true;
    }
  | {
      phase: "irreversible_committed";
      path: "corrective_authorized";
      authorizationDecisionId: string;
      reconciled?: true;
    };

async function decideKnownPhase(
  phase: Exclude<CancellationPhase, "unknown">,
  context: CancellationRequestContext,
  dependencies: CancellationDecisionDependencies,
  reconciled: boolean
): Promise<CancellationDecision> {
  const reconciliationMarker = reconciled ? { reconciled: true as const } : {};
  if (phase === "read_only") {
    return {
      phase,
      path: "interrupt_or_supersede",
      ...reconciliationMarker,
    };
  }

  if (phase === "reversible_committed") {
    const compensation = await dependencies.compensate({
      runId: context.runId,
      taskId: context.taskId,
      reason: "user_cancelled",
    });
    return compensation.status === "compensated"
      ? {
          phase,
          path: "compensated_then_supersede",
          ...reconciliationMarker,
        }
      : {
          phase,
          path: "manual_intervention_required",
          ...reconciliationMarker,
        };
  }

  const authorizationDecision = await dependencies.authorizeCorrective({
    runId: context.runId,
    taskId: context.taskId,
    principal: context.principal,
    scope: context.scope,
    action: "interaction.corrective",
  });
  return authorizationDecision.effect === "allow"
    ? {
        phase,
        path: "corrective_authorized",
        authorizationDecisionId: authorizationDecision.decisionId,
        ...reconciliationMarker,
      }
    : {
        phase,
        path: "manual_intervention_required",
        authorizationDecisionId: authorizationDecision.decisionId,
        ...reconciliationMarker,
      };
}

export async function decideCancellation(
  context: CancellationRequestContext,
  dependencies: CancellationDecisionDependencies
): Promise<CancellationDecision> {
  const entries = await dependencies.ledger.getRunEntries(context.runId);
  const phase = deriveCancellationPhase(entries);
  if (phase !== "unknown") {
    return decideKnownPhase(phase, context, dependencies, false);
  }

  const reconciliation = await dependencies.reconcile({
    runId: context.runId,
    taskId: context.taskId,
    entries,
  });
  if (reconciliation.phase === "unknown") {
    return {
      phase: "unknown",
      path: "manual_intervention_required",
      reconciled: true,
    };
  }
  return decideKnownPhase(
    reconciliation.phase,
    context,
    dependencies,
    true
  );
}
