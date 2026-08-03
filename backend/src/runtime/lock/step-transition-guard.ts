import type { StepTransitionOptions } from "../state-machine.js";
import { transitionStep } from "../state-machine.js";
import type { AgentStep, StepStatus } from "../types.js";
import {
  mapStepRow,
  type Queryable,
  type StepRow,
} from "../persistence/rows.js";

import { createStepLock, type StepLock } from "./step-lock.js";

export const DEFAULT_LOCK_TTL_MS = 30_000;

const SELECT_STEP_SQL = `SELECT step_id, task_id, step_name, status, attempt, max_attempts,
                                input, output, error_code, error_message, error_details,
                                started_at, completed_at, created_at, updated_at
                         FROM task_steps
                         WHERE step_id = $1`;

const CAS_STEP_STATUS_SQL = `UPDATE task_steps
                             SET status = $2,
                                 output = COALESCE($3, output),
                                 error_code = COALESCE($4, error_code),
                                 error_message = COALESCE($5, error_message),
                                 error_details = COALESCE($6, error_details),
                                 started_at = CASE
                                   WHEN $2 = 'running' AND started_at IS NULL
                                   THEN NOW()
                                   ELSE started_at
                                 END,
                                 completed_at = CASE
                                   WHEN $2 IN ('succeeded', 'terminal_failed', 'compensated', 'skipped')
                                   THEN NOW()
                                   ELSE completed_at
                                 END,
                                 updated_at = NOW()
                             WHERE step_id = $1 AND status = $7
                             RETURNING step_id, task_id, step_name, status, attempt, max_attempts,
                                       input, output, error_code, error_message, error_details,
                                       started_at, completed_at, created_at, updated_at`;

export type TransitionGuardResult =
  | { outcome: "success"; step: AgentStep }
  | { outcome: "lock_contention"; currentOwner?: string }
  | { outcome: "cas_mismatch"; currentStatus: StepStatus }
  | { outcome: "invalid_transition"; reason: string };

export interface StepTransitionGuard {
  transition(
    stepId: string,
    from: StepStatus,
    to: StepStatus,
    owner: string,
    opts?: StepTransitionOptions
  ): Promise<TransitionGuardResult>;
}

interface CurrentOwnerReader {
  getCurrentOwner(stepId: string): Promise<string | undefined>;
}

export class DefaultStepTransitionGuard implements StepTransitionGuard {
  private readonly db: Queryable;
  private readonly lock: StepLock;
  private readonly lockTtlMs: number;

  constructor(opts: {
    db: Queryable;
    lock?: StepLock;
    lockTtlMs?: number;
  }) {
    this.db = opts.db;
    this.lock = opts.lock ?? createStepLock();
    this.lockTtlMs = opts.lockTtlMs ?? DEFAULT_LOCK_TTL_MS;
    validateLockTtl(this.lockTtlMs);
  }

  async transition(
    stepId: string,
    from: StepStatus,
    to: StepStatus,
    owner: string,
    opts: StepTransitionOptions = {}
  ): Promise<TransitionGuardResult> {
    const currentStep = await this.findStep(stepId);
    if (!currentStep) {
      return {
        outcome: "invalid_transition",
        reason: `step not found: ${stepId}`,
      };
    }

    const transition = transitionStep(currentStep, to, opts);
    if (!transition.valid) {
      return { outcome: "invalid_transition", reason: transition.reason };
    }

    let isLockAcquired: boolean;
    try {
      isLockAcquired = await this.lock.acquire(stepId, owner, this.lockTtlMs);
    } catch {
      return { outcome: "lock_contention" };
    }

    if (!isLockAcquired) {
      const currentOwner = await readCurrentOwner(this.lock, stepId);
      return currentOwner
        ? { outcome: "lock_contention", currentOwner }
        : { outcome: "lock_contention" };
    }

    try {
      const casResult = await this.db.query<StepRow>(CAS_STEP_STATUS_SQL, [
        stepId,
        to,
        opts.output,
        opts.error?.code,
        opts.error?.message,
        opts.error?.details,
        from,
      ]);
      const updatedRow = casResult.rows[0];
      if (updatedRow) {
        return { outcome: "success", step: mapStepRow(updatedRow) };
      }

      const latestStep = await this.findStep(stepId);
      if (!latestStep) {
        return {
          outcome: "invalid_transition",
          reason: `step not found: ${stepId}`,
        };
      }
      return {
        outcome: "cas_mismatch",
        currentStatus: latestStep.status,
      };
    } finally {
      await this.lock.release(stepId, owner);
    }
  }

  private async findStep(stepId: string): Promise<AgentStep | null> {
    const result = await this.db.query<StepRow>(SELECT_STEP_SQL, [stepId]);
    return result.rows[0] ? mapStepRow(result.rows[0]) : null;
  }
}

function hasCurrentOwnerReader(
  lock: StepLock
): lock is StepLock & CurrentOwnerReader {
  return (
    "getCurrentOwner" in lock && typeof lock.getCurrentOwner === "function"
  );
}

async function readCurrentOwner(
  lock: StepLock,
  stepId: string
): Promise<string | undefined> {
  if (!hasCurrentOwnerReader(lock)) {
    return undefined;
  }

  try {
    return await lock.getCurrentOwner(stepId);
  } catch {
    return undefined;
  }
}

function validateLockTtl(ttlMs: number): void {
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new Error("Lock TTL must be a positive integer");
  }
}
