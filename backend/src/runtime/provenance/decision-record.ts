export interface DecisionRecord {
  decisionId: string;
  requestId?: string;
  threadId?: string;
  runId?: string;
  taskId?: string;
  stepId?: string;
  decisionType: string;
  outcome: string;
  reasonCode: string;
  confidence?: number;
  policyVersion?: string;
  createdAt: string;
}

export interface CreateDecisionRecordInput {
  decisionId: string;
  requestId?: string;
  threadId?: string;
  runId?: string;
  taskId?: string;
  stepId?: string;
  decisionType: string;
  outcome: string;
  reasonCode: string;
  confidence?: number;
  policyVersion?: string;
  createdAt?: string;
  now?: () => Date;
}

const MAX_OPEN_STRING_LENGTH = 128;

function requiredString(value: string, fieldName: string): string {
  if (value.trim().length === 0) {
    throw new Error(`${fieldName} is required`);
  }
  return value;
}

function optionalString(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.trim().length === 0 ? undefined : value;
}

function requiredOpenString(value: string, fieldName: string): string {
  const requiredValue = requiredString(value, fieldName);
  if (requiredValue.length > MAX_OPEN_STRING_LENGTH) {
    throw new Error(
      `${fieldName} must be at most ${MAX_OPEN_STRING_LENGTH} characters`
    );
  }
  return requiredValue;
}

function optionalOpenString(
  value: string | undefined,
  fieldName: string
): string | undefined {
  const optionalValue = optionalString(value);
  if (
    optionalValue !== undefined &&
    optionalValue.length > MAX_OPEN_STRING_LENGTH
  ) {
    throw new Error(
      `${fieldName} must be at most ${MAX_OPEN_STRING_LENGTH} characters`
    );
  }
  return optionalValue;
}

function validateConfidence(confidence: number | undefined): number | undefined {
  if (confidence === undefined) return undefined;
  if (
    !Number.isFinite(confidence) ||
    Object.is(confidence, -0) ||
    confidence < 0 ||
    confidence > 1
  ) {
    throw new Error("confidence must be a finite number between 0 and 1");
  }
  return confidence;
}

export function createDecisionRecord(
  input: CreateDecisionRecordInput
): DecisionRecord {
  const requestId = optionalString(input.requestId);
  const threadId = optionalString(input.threadId);
  const runId = optionalString(input.runId);
  const taskId = optionalString(input.taskId);
  const stepId = optionalString(input.stepId);
  const confidence = validateConfidence(input.confidence);
  const policyVersion = optionalOpenString(
    input.policyVersion,
    "policyVersion"
  );

  return {
    decisionId: requiredString(input.decisionId, "decisionId"),
    ...(requestId === undefined ? {} : { requestId }),
    ...(threadId === undefined ? {} : { threadId }),
    ...(runId === undefined ? {} : { runId }),
    ...(taskId === undefined ? {} : { taskId }),
    ...(stepId === undefined ? {} : { stepId }),
    decisionType: requiredOpenString(input.decisionType, "decisionType"),
    outcome: requiredOpenString(input.outcome, "outcome"),
    reasonCode: requiredOpenString(input.reasonCode, "reasonCode"),
    ...(confidence === undefined ? {} : { confidence }),
    ...(policyVersion === undefined ? {} : { policyVersion }),
    createdAt: input.createdAt ?? (input.now?.() ?? new Date()).toISOString(),
  };
}
