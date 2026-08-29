import type { Queryable } from "../persistence/rows.js";
import {
  createDecisionRecord,
  type DecisionRecord,
} from "./decision-record.js";

const DECISION_RECORD_COLUMNS = `
  decision_id, request_id, thread_id, run_id, task_id, step_id,
  decision_type, outcome, reason_code, confidence, policy_version, created_at
`;

interface DecisionRecordRow extends Record<string, unknown> {
  decision_id: unknown;
  request_id: unknown;
  thread_id: unknown;
  run_id: unknown;
  task_id: unknown;
  step_id: unknown;
  decision_type: unknown;
  outcome: unknown;
  reason_code: unknown;
  confidence: unknown;
  policy_version: unknown;
  created_at: unknown;
}

export interface DecisionRecordStore {
  record(record: DecisionRecord): Promise<DecisionRecord>;
  findByDecisionId(decisionId: string): Promise<DecisionRecord | null>;
  findByTaskId(taskId: string): Promise<DecisionRecord[]>;
  findByStepId(stepId: string): Promise<DecisionRecord[]>;
}

function requiredString(value: unknown, column: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid ${column} returned from decision_records`);
  }
  return value;
}

function optionalString(value: unknown, column: string): string | undefined {
  return value === null ? undefined : requiredString(value, column);
}

function optionalNumber(value: unknown, column: string): number | undefined {
  if (value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid ${column} returned from decision_records`);
  }
  return value;
}

function isoString(value: unknown, column: string): string {
  if (!(typeof value === "string" || value instanceof Date)) {
    throw new Error(`Invalid ${column} returned from decision_records`);
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${column} returned from decision_records`);
  }
  return date.toISOString();
}

function mapDecisionRecordRow(row: DecisionRecordRow): DecisionRecord {
  const requestId = optionalString(row.request_id, "request_id");
  const threadId = optionalString(row.thread_id, "thread_id");
  const runId = optionalString(row.run_id, "run_id");
  const taskId = optionalString(row.task_id, "task_id");
  const stepId = optionalString(row.step_id, "step_id");
  const confidence = optionalNumber(row.confidence, "confidence");
  const policyVersion = optionalString(row.policy_version, "policy_version");

  return createDecisionRecord({
    decisionId: requiredString(row.decision_id, "decision_id"),
    ...(requestId === undefined ? {} : { requestId }),
    ...(threadId === undefined ? {} : { threadId }),
    ...(runId === undefined ? {} : { runId }),
    ...(taskId === undefined ? {} : { taskId }),
    ...(stepId === undefined ? {} : { stepId }),
    decisionType: requiredString(row.decision_type, "decision_type"),
    outcome: requiredString(row.outcome, "outcome"),
    reasonCode: requiredString(row.reason_code, "reason_code"),
    ...(confidence === undefined ? {} : { confidence }),
    ...(policyVersion === undefined ? {} : { policyVersion }),
    createdAt: isoString(row.created_at, "created_at"),
  });
}

export class PgDecisionRecordStore implements DecisionRecordStore {
  constructor(private readonly db: Queryable) {}

  async record(record: DecisionRecord): Promise<DecisionRecord> {
    const validatedRecord = createDecisionRecord(record);
    const result = await this.db.query<DecisionRecordRow>(
      `INSERT INTO decision_records (
         decision_id, request_id, thread_id, run_id, task_id, step_id,
         decision_type, outcome, reason_code, confidence, policy_version,
         created_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
       )
       RETURNING ${DECISION_RECORD_COLUMNS}`,
      [
        validatedRecord.decisionId,
        validatedRecord.requestId ?? null,
        validatedRecord.threadId ?? null,
        validatedRecord.runId ?? null,
        validatedRecord.taskId ?? null,
        validatedRecord.stepId ?? null,
        validatedRecord.decisionType,
        validatedRecord.outcome,
        validatedRecord.reasonCode,
        validatedRecord.confidence ?? null,
        validatedRecord.policyVersion ?? null,
        validatedRecord.createdAt,
      ]
    );
    const row = result.rows[0];
    if (!row) throw new Error("Decision record insert returned no row");
    return mapDecisionRecordRow(row);
  }

  async findByDecisionId(decisionId: string): Promise<DecisionRecord | null> {
    const result = await this.db.query<DecisionRecordRow>(
      `SELECT ${DECISION_RECORD_COLUMNS}
       FROM decision_records
       WHERE decision_id = $1
       LIMIT 1`,
      [decisionId]
    );
    const row = result.rows[0];
    return row ? mapDecisionRecordRow(row) : null;
  }

  async findByTaskId(taskId: string): Promise<DecisionRecord[]> {
    const result = await this.db.query<DecisionRecordRow>(
      `SELECT ${DECISION_RECORD_COLUMNS}
       FROM decision_records
       WHERE task_id = $1
       ORDER BY created_at DESC`,
      [taskId]
    );
    return result.rows.map(mapDecisionRecordRow);
  }

  async findByStepId(stepId: string): Promise<DecisionRecord[]> {
    const result = await this.db.query<DecisionRecordRow>(
      `SELECT ${DECISION_RECORD_COLUMNS}
       FROM decision_records
       WHERE step_id = $1
       ORDER BY created_at DESC`,
      [stepId]
    );
    return result.rows.map(mapDecisionRecordRow);
  }
}
