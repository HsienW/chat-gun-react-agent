export type DispatchState = "before" | "after" | "unknown";

export type GovernedToolOutcome<TResult> =
  | { type: "succeeded"; result: TResult }
  | { type: "rejected_before_dispatch"; errorCode: string }
  | { type: "failed_not_committed"; errorCode: string }
  | { type: "ambiguous_after_dispatch"; errorCode: string }
  | { type: "cancelled"; dispatchState: DispatchState };

export interface GovernedToolExecutor<TInput, TResult> {
  executeTyped(input: TInput, config?: unknown): Promise<GovernedToolOutcome<TResult>>;
}
