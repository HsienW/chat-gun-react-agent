export interface ExpectedToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface EvaluationItem {
  id: string;
  input: unknown;
  expectedOutput?: {
    toolCalls?: ExpectedToolCall[];
    summary?: string;
    status?: string;
    code?: string;
  };
  goldenTrace?: string;
  metadata?: Record<string, unknown>;
}

export interface EvaluationDataset {
  name: string;
  version: string;
  items: EvaluationItem[];
}

export interface ActualToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface AgentRunResult {
  response: string;
  toolCalls: ActualToolCall[];
  traceId?: string;
  tokenCostUsd?: number;
  metadata?: Record<string, unknown>;
}

export type MetricStatus = "COMPLETED" | "FAILED";

export interface MetricScore {
  name: string;
  value: number;
  reason?: string;
  status: MetricStatus;
  deterministic: boolean;
  failureType?: "JUDGE_FAILED";
}

export interface EvaluationMetric {
  readonly name: string;
  readonly deterministic: boolean;
  evaluate(
    item: EvaluationItem,
    result: AgentRunResult
  ): MetricScore | Promise<MetricScore>;
}
