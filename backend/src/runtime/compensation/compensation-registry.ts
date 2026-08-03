import type { CompensationAction } from "./compensation-action.js";

export interface CompensationRegistry {
  register(stepName: string, action: CompensationAction): void;
  deregister(stepName: string, actionId: string): void;
  getActions(stepName: string): CompensationAction[];
  hasActions(stepName: string): boolean;
}

export class CompensationRegistryImpl implements CompensationRegistry {
  private readonly actionsByStepName = new Map<string, CompensationAction[]>();

  register(stepName: string, action: CompensationAction): void {
    const registeredActions = this.actionsByStepName.get(stepName) ?? [];
    this.actionsByStepName.set(stepName, [...registeredActions, action]);
  }

  deregister(stepName: string, actionId: string): void {
    const registeredActions = this.actionsByStepName.get(stepName);
    if (!registeredActions) {
      return;
    }

    const remainingActions = registeredActions.filter(
      (action) => action.actionId !== actionId
    );
    if (remainingActions.length === 0) {
      this.actionsByStepName.delete(stepName);
      return;
    }

    this.actionsByStepName.set(stepName, remainingActions);
  }

  getActions(stepName: string): CompensationAction[] {
    return [...(this.actionsByStepName.get(stepName) ?? [])];
  }

  hasActions(stepName: string): boolean {
    return (this.actionsByStepName.get(stepName)?.length ?? 0) > 0;
  }
}
