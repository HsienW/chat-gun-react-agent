import type { ReconciliationResult } from "./side-effect-descriptor.js";

export type ReconciliationAction = "commit" | "retry" | "defer";

export function decideReconciliationAction<TResult>(
  result: ReconciliationResult<TResult>,
  canRetry: boolean
): ReconciliationAction {
  if (result.state === "committed") return "commit";
  if (result.state === "not_committed" && canRetry) return "retry";
  return "defer";
}
