import type { Queryable } from "../persistence/rows.js";

export const ACTIVE_RUN_OWNERSHIP_STATUSES = [
  "active",
  "superseded",
  "completed",
  "cancelled",
] as const;

export type ActiveRunOwnershipStatus =
  (typeof ACTIVE_RUN_OWNERSHIP_STATUSES)[number];

export interface ActiveRunOwnership {
  threadId: string;
  scopeId: string;
  taskId: string;
  runId: string;
  status: ActiveRunOwnershipStatus;
  generation: number;
  supersededByRunId?: string;
  updatedAt: string;
}

export interface ActiveRunOwnershipRepository {
  findActive(
    threadId: string,
    scopeId: string
  ): Promise<ActiveRunOwnership | null>;
  claim(input: {
    threadId: string;
    scopeId: string;
    taskId: string;
    runId: string;
  }): Promise<ActiveRunOwnership>;
  supersede(input: {
    threadId: string;
    scopeId: string;
    expectedGeneration: number;
    replacementTaskId: string;
    replacementRunId: string;
  }): Promise<ActiveRunOwnership>;
  markTerminal(input: {
    threadId: string;
    scopeId: string;
    runId: string;
    status: "completed" | "cancelled";
  }): Promise<ActiveRunOwnership | null>;
}

export interface OwnershipDatabase extends Queryable {
  withTransaction<TResult>(
    operation: (transaction: Queryable) => Promise<TResult>
  ): Promise<TResult>;
}

interface OwnershipRow extends Record<string, unknown> {
  thread_id: string;
  scope_id: string;
  task_id: string;
  run_id: string;
  status: string;
  generation: number;
  superseded_by_run_id: string | null;
  updated_at: string | Date;
}

const OWNERSHIP_COLUMNS = `
  thread_id, scope_id, task_id, run_id, status, generation,
  superseded_by_run_id, updated_at
`;

export class ActiveRunOwnershipConflictError extends Error {
  constructor(threadId: string, scopeId: string, generation?: number) {
    super(
      generation === undefined
        ? `Active run ownership already exists: ${threadId}/${scopeId}`
        : `Active run ownership CAS failed: ${threadId}/${scopeId}@${generation}`
    );
    this.name = "ActiveRunOwnershipConflictError";
  }
}

function isOwnershipStatus(value: string): value is ActiveRunOwnershipStatus {
  return ACTIVE_RUN_OWNERSHIP_STATUSES.some((status) => status === value);
}

function mapOwnershipRow(row: OwnershipRow): ActiveRunOwnership {
  if (!isOwnershipStatus(row.status)) {
    throw new Error(`Unknown active run ownership status: ${row.status}`);
  }
  if (!Number.isSafeInteger(row.generation) || row.generation < 1) {
    throw new Error("Invalid active run ownership generation");
  }

  const updatedAt =
    row.updated_at instanceof Date
      ? row.updated_at.toISOString()
      : new Date(row.updated_at).toISOString();

  return {
    threadId: row.thread_id,
    scopeId: row.scope_id,
    taskId: row.task_id,
    runId: row.run_id,
    status: row.status,
    generation: row.generation,
    ...(row.superseded_by_run_id
      ? { supersededByRunId: row.superseded_by_run_id }
      : {}),
    updatedAt,
  };
}

function requireSingleRow(
  rows: OwnershipRow[],
  threadId: string,
  scopeId: string,
  generation?: number
): OwnershipRow {
  const row = rows[0];
  if (!row) {
    throw new ActiveRunOwnershipConflictError(threadId, scopeId, generation);
  }
  return row;
}

export class PgActiveRunOwnershipRepository implements ActiveRunOwnershipRepository {
  constructor(private readonly db: OwnershipDatabase) {}

  async findActive(
    threadId: string,
    scopeId: string
  ): Promise<ActiveRunOwnership | null> {
    const result = await this.db.query<OwnershipRow>(
      `SELECT ${OWNERSHIP_COLUMNS}
       FROM active_run_ownership
       WHERE thread_id = $1 AND scope_id = $2 AND status = 'active'`,
      [threadId, scopeId]
    );
    return result.rows[0] ? mapOwnershipRow(result.rows[0]) : null;
  }

  async claim(input: {
    threadId: string;
    scopeId: string;
    taskId: string;
    runId: string;
  }): Promise<ActiveRunOwnership> {
    const result = await this.db.query<OwnershipRow>(
      `INSERT INTO active_run_ownership (
         thread_id, scope_id, task_id, run_id, status, generation
       ) VALUES (
         $1, $2, $3, $4, 'active',
         (SELECT COALESCE(MAX(generation), 0) + 1
          FROM active_run_ownership
          WHERE thread_id = $1 AND scope_id = $2)
       )
       ON CONFLICT DO NOTHING
       RETURNING ${OWNERSHIP_COLUMNS}`,
      [input.threadId, input.scopeId, input.taskId, input.runId]
    );
    return mapOwnershipRow(
      requireSingleRow(result.rows, input.threadId, input.scopeId)
    );
  }

  async supersede(input: {
    threadId: string;
    scopeId: string;
    expectedGeneration: number;
    replacementTaskId: string;
    replacementRunId: string;
  }): Promise<ActiveRunOwnership> {
    return this.db.withTransaction(async (transaction) => {
      const superseded = await transaction.query<OwnershipRow>(
        `UPDATE active_run_ownership
         SET status = 'superseded', superseded_by_run_id = $4, updated_at = NOW()
         WHERE thread_id = $1 AND scope_id = $2
           AND generation = $3 AND status = 'active'
         RETURNING ${OWNERSHIP_COLUMNS}`,
        [
          input.threadId,
          input.scopeId,
          input.expectedGeneration,
          input.replacementRunId,
        ]
      );
      requireSingleRow(
        superseded.rows,
        input.threadId,
        input.scopeId,
        input.expectedGeneration
      );

      const nextGeneration = input.expectedGeneration + 1;
      const replacement = await transaction.query<OwnershipRow>(
        `INSERT INTO active_run_ownership (
           thread_id, scope_id, task_id, run_id, status, generation
         ) VALUES ($1, $2, $3, $4, 'active', $5)
         RETURNING ${OWNERSHIP_COLUMNS}`,
        [
          input.threadId,
          input.scopeId,
          input.replacementTaskId,
          input.replacementRunId,
          nextGeneration,
        ]
      );
      return mapOwnershipRow(
        requireSingleRow(
          replacement.rows,
          input.threadId,
          input.scopeId,
          nextGeneration
        )
      );
    });
  }

  async markTerminal(input: {
    threadId: string;
    scopeId: string;
    runId: string;
    status: "completed" | "cancelled";
  }): Promise<ActiveRunOwnership | null> {
    const result = await this.db.query<OwnershipRow>(
      `UPDATE active_run_ownership
       SET status = $4, updated_at = NOW()
       WHERE thread_id = $1 AND scope_id = $2
         AND run_id = $3 AND status = 'active'
       RETURNING ${OWNERSHIP_COLUMNS}`,
      [input.threadId, input.scopeId, input.runId, input.status]
    );
    return result.rows[0] ? mapOwnershipRow(result.rows[0]) : null;
  }
}
