import type { TaskEvent } from "../types.js";

import { mapEventRow, type EventRow, type Queryable } from "./rows.js";

export interface EventRepository {
  append(event: TaskEvent): Promise<TaskEvent>;
  findByTaskId(taskId: string): Promise<TaskEvent[]>;
  streamByTaskId(taskId: string): AsyncIterable<TaskEvent>;
}

export class PgEventRepository implements EventRepository {
  constructor(private readonly db: Queryable) {}

  async append(event: TaskEvent): Promise<TaskEvent> {
    const result = await this.db.query<EventRow>(
      `INSERT INTO task_events (event_id, task_id, step_id, event_type, payload, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING event_id, task_id, step_id, event_type, payload, created_at`,
      [
        event.eventId,
        event.taskId,
        event.stepId,
        event.eventType,
        event.payload,
        event.createdAt,
      ]
    );

    return mapEventRow(requireSingleRow(result.rows, event.eventId));
  }

  async findByTaskId(taskId: string): Promise<TaskEvent[]> {
    const result = await this.db.query<EventRow>(
      `SELECT event_id, task_id, step_id, event_type, payload, created_at
       FROM task_events
       WHERE task_id = $1
       ORDER BY created_at, event_id`,
      [taskId]
    );

    return result.rows.map(mapEventRow);
  }

  async *streamByTaskId(taskId: string): AsyncIterable<TaskEvent> {
    yield* await this.findByTaskId(taskId);
  }
}

function requireSingleRow(rows: EventRow[], eventId: string): EventRow {
  const row = rows[0];
  if (!row) {
    throw new Error(`Task event not found: ${eventId}`);
  }
  return row;
}
