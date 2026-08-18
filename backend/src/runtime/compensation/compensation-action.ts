export interface CompensationAction<TContext = unknown> {
  actionId: string;
  description: string;
  execute: (context: TContext) => Promise<CompensationActionResult>;
  isReversible: boolean;
}

export interface CompensationActionResult {
  status: "compensated" | "failed";
  error?: CompensationError;
}

export interface CompensationError {
  message: string;
  code?: string;
  detail?: unknown;
}

export interface CompensationPlan {
  taskId: string;
  failureStepId: string;
  failureReason: string;
  completedSteps: CompensationStepEntry[];
  irreversibleSteps: string[];
}

export interface CompensationStepEntry {
  stepId: string;
  stepName: string;
  actions: CompensationAction[];
}

export interface CompensationResult {
  taskId: string;
  totalActions: number;
  succeeded: number;
  failed: number;
  skippedIrreversible: number;
  overallStatus:
    | "all_compensated"
    | "partial_failure"
    | "manual_intervention_required"
    | "no_actions_needed";
  failures: CompensationFailureEntry[];
  skippedIrreversibleActions: SkippedIrreversibleEntry[];
}

export interface CompensationFailureEntry {
  stepId: string;
  actionId: string;
  error: CompensationError;
}

export interface SkippedIrreversibleEntry {
  stepId: string;
  actionId: string;
  reason: "irreversible_requires_manual_intervention";
}

export interface CompensateOptions {
  reason?: "terminal_failed" | "user_cancelled" | "partially_failed";
  context?: Record<string, unknown>;
}
