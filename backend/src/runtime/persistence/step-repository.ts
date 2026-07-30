import type { AgentStep, StepError, StepStatus } from "../types.js";

import { mapStepRow, type Queryable, type StepRow } from "./rows.js";

export type PersistedAgentStep<TStep extends string = string> = AgentStep<TStep> & {
  taskId: string;
};

export interface StepRepository {
  create(step: PersistedAgentStep): Promise<AgentStep>;
  findById(stepId: string): Promise<AgentStep | null>;
  findByTaskId(taskId: string): Promise<AgentStep[]>;
  updateStatus(
    stepId: string,
    status: StepStatus,
    opts?: { error?: StepError; output?: unknown }
  ): Promise<AgentStep>;
}

export class PgStepRepository implements StepRepository {
  constructor(private readonly db: Queryable) {}

  async create(step: PersistedAgentStep): Promise<AgentStep> {
    const result = await this.db.query<StepRow>(
      `INSERT INTO task_steps (
         step_id, task_id, step_name, status, attempt, max_attempts, input, output,
         error_code, error_message, error_details, started_at, completed_at, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING step_id, task_id, step_name, status, attempt, max_attempts, input, output,
                 error_code, error_message, error_details, started_at, completed_at, created_at, updated_at`,
      [
        step.stepId,
        step.taskId,
        step.stepName,
        step.status,
        step.attempt,
        step.maxAttempts,
        step.input,
        step.output,
        step.error?.code,
        step.error?.message,
        step.error?.details,
        step.startedAt,
        step.completedAt,
        step.createdAt,
        step.updatedAt,
      ]
    );

    return mapStepRow(requireSingleRow(result.rows, step.stepId));
  }

  async findById(stepId: string): Promise<AgentStep | null> {
    const result = await this.db.query<StepRow>(
      `SELECT step_id, task_id, step_name, status, attempt, max_attempts, input, output,
              error_code, error_message, error_details, started_at, completed_at, created_at, updated_at
       FROM task_steps
       WHERE step_id = $1`,
      [stepId]
    );

    return result.rows[0] ? mapStepRow(result.rows[0]) : null;
  }

  async findByTaskId(taskId: string): Promise<AgentStep[]> {
    const result = await this.db.query<StepRow>(
      `SELECT step_id, task_id, step_name, status, attempt, max_attempts, input, output,
              error_code, error_message, error_details, started_at, completed_at, created_at, updated_at
       FROM task_steps
       WHERE task_id = $1
       ORDER BY created_at, step_id`,
      [taskId]
    );

    return result.rows.map(mapStepRow);
  }

  async updateStatus(
    stepId: string,
    status: StepStatus,
    opts: { error?: StepError; output?: unknown } = {}
  ): Promise<AgentStep> {
    const result = await this.db.query<StepRow>(
      `UPDATE task_steps
       SET status = $2,
           output = COALESCE($3, output),
           error_code = COALESCE($4, error_code),
           error_message = COALESCE($5, error_message),
           error_details = COALESCE($6, error_details),
           started_at = CASE WHEN $2 = 'running' AND started_at IS NULL THEN NOW() ELSE started_at END,
           completed_at = CASE WHEN $2 IN ('succeeded', 'terminal_failed', 'compensated', 'skipped') THEN NOW() ELSE completed_at END,
           updated_at = NOW()
       WHERE step_id = $1
       RETURNING step_id, task_id, step_name, status, attempt, max_attempts, input, output,
                 error_code, error_message, error_details, started_at, completed_at, created_at, updated_at`,
      [stepId, status, opts.output, opts.error?.code, opts.error?.message, opts.error?.details]
    );

    return mapStepRow(requireSingleRow(result.rows, stepId));
  }
}

function requireSingleRow(rows: StepRow[], stepId: string): StepRow {
  const row = rows[0];
  if (!row) {
    throw new Error(`Step not found: ${stepId}`);
  }
  return row;
}
