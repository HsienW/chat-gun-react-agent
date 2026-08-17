import { describe, expect, it } from "vitest";

import { decideReconciliationAction } from "./reconciler.js";

describe("decideReconciliationAction", () => {
  it("commits a reconciled committed result", () => {
    expect(decideReconciliationAction({ state: "committed" }, false)).toBe(
      "commit"
    );
  });

  it("retries not_committed only while retry budget remains", () => {
    expect(decideReconciliationAction({ state: "not_committed" }, true)).toBe(
      "retry"
    );
    expect(decideReconciliationAction({ state: "not_committed" }, false)).toBe(
      "defer"
    );
  });

  it("always defers an unknown reconciliation result", () => {
    expect(decideReconciliationAction({ state: "unknown" }, true)).toBe(
      "defer"
    );
  });
});
