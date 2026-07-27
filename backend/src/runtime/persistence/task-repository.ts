import type { AgentTask, TaskStatus } from "../types.js";

import { mapStepRow, mapTaskRow, type Queryable, type StepRow, type TaskRow } from "./rows.js";

export interface TaskRepository {
  create(task: AgentTask): Promise<AgentTask>;
  findById(taskId: string): Promise<AgentTask | null>;
  updateStatus(taskId: string, status: TaskStatus): Promise<AgentTask>;
  update(taskId: string, patch: Partial<Pick<AgentTask, "taskType" | "status" | "metadata">>): Promise<AgentTask>;
}

export class PgTaskRepository implements TaskRepository {
  constructor(private readonly db: Queryable) {}

  async create(task: AgentTask): Promise<AgentTask> {
    const result = await this.db.query<TaskRow>(
      `INSERT INTO agent_tasks (task_id, task_type, status, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING task_id, task_type, status, metadata, created_at, updated_at`,
      [task.taskId, task.taskType, task.status, task.metadata, task.createdAt, task.updatedAt]
    );

    return mapTaskRow(requireSingleRow(result.rows, task.taskId));
  }

  async findById(taskId: string): Promise<AgentTask | null> {
    const taskResult = await this.db.query<TaskRow>(
      `SELECT task_id, task_type, status, metadata, created_at, updated_at
       FROM agent_tasks
       WHERE task_id = $1`,
      [taskId]
    );

    if (taskResult.rows.length === 0) {
      return null;
    }

    const stepResult = await this.db.query<StepRow>(
      `SELECT step_id, task_id, step_name, status, attempt, max_attempts, input, output,
              error_code, error_message, error_details, started_at, completed_at, created_at, updated_at
       FROM task_steps
       WHERE task_id = $1
       ORDER BY created_at, step_id`,
      [taskId]
    );

    return mapTaskRow(taskResult.rows[0], stepResult.rows.map(mapStepRow));
  }

  async updateStatus(taskId: string, status: TaskStatus): Promise<AgentTask> {
    const result = await this.db.query<TaskRow>(
      `UPDATE agent_tasks
       SET status = $2, updated_at = NOW()
       WHERE task_id = $1
       RETURNING task_id, task_type, status, metadata, created_at, updated_at`,
      [taskId, status]
    );

    return mapTaskRow(requireSingleRow(result.rows, taskId));
  }

  async update(
    taskId: string,
    patch: Partial<Pick<AgentTask, "taskType" | "status" | "metadata">>
  ): Promise<AgentTask> {
    const result = await this.db.query<TaskRow>(
      `UPDATE agent_tasks
       SET task_type = COALESCE($2, task_type),
           status = COALESCE($3, status),
           metadata = COALESCE($4, metadata),
           updated_at = NOW()
       WHERE task_id = $1
       RETURNING task_id, task_type, status, metadata, created_at, updated_at`,
      [taskId, patch.taskType, patch.status, patch.metadata]
    );

    return mapTaskRow(requireSingleRow(result.rows, taskId));
  }
}

function requireSingleRow(rows: TaskRow[], taskId: string): TaskRow {
  const row = rows[0];
  if (!row) {
    throw new Error(`Task not found: ${taskId}`);
  }
  return row;
}
