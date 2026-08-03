import { describe, expect, it, vi } from "vitest";

import type { CompensationAction } from "./compensation-action.js";
import { CompensationRegistryImpl } from "./compensation-registry.js";

function createAction(actionId: string): CompensationAction {
  return {
    actionId,
    description: `Compensate ${actionId}`,
    execute: vi.fn(async () => ({ status: "compensated" as const })),
    isReversible: true,
  };
}

describe("CompensationRegistryImpl", () => {
  it("registers actions for a step and appends duplicate registrations", () => {
    const registry = new CompensationRegistryImpl();
    const firstAction = createAction("action-1");
    const secondAction = createAction("action-2");

    registry.register("step-type", firstAction);
    registry.register("step-type", secondAction);
    registry.register("step-type", firstAction);

    expect(registry.getActions("step-type")).toEqual([
      firstAction,
      secondAction,
      firstAction,
    ]);
    expect(registry.hasActions("step-type")).toBe(true);
  });

  it("deregisters an action by actionId and clears an empty registration", () => {
    const registry = new CompensationRegistryImpl();
    registry.register("step-type", createAction("action-1"));

    registry.deregister("step-type", "action-1");

    expect(registry.getActions("step-type")).toEqual([]);
    expect(registry.hasActions("step-type")).toBe(false);
  });

  it("leaves registrations unchanged when deregistering an unknown action", () => {
    const registry = new CompensationRegistryImpl();
    const action = createAction("action-1");
    registry.register("step-type", action);

    registry.deregister("step-type", "missing-action");
    registry.deregister("missing-step", "missing-action");

    expect(registry.getActions("step-type")).toEqual([action]);
  });

  it("returns a defensive copy of registered actions", () => {
    const registry = new CompensationRegistryImpl();
    const action = createAction("action-1");
    registry.register("step-type", action);

    const returnedActions = registry.getActions("step-type");
    returnedActions.length = 0;

    expect(registry.getActions("step-type")).toEqual([action]);
  });

  it("returns an empty array and false for an unregistered step", () => {
    const registry = new CompensationRegistryImpl();

    expect(registry.getActions("missing-step")).toEqual([]);
    expect(registry.hasActions("missing-step")).toBe(false);
  });
});
