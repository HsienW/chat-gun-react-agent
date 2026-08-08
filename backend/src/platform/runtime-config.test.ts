import { afterEach, describe, expect, it, vi } from "vitest";

import { getAgentRuntimeConfig } from "./runtime-config.js";

describe("getAgentRuntimeConfig context budget", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults contextBudgetTotal to 128000", () => {
    vi.stubEnv("AGENT_CONTEXT_BUDGET_TOTAL", "");

    expect(getAgentRuntimeConfig().contextBudgetTotal).toBe(128_000);
  });

  it("reads a positive integer from AGENT_CONTEXT_BUDGET_TOTAL", () => {
    vi.stubEnv("AGENT_CONTEXT_BUDGET_TOTAL", "64000");

    expect(getAgentRuntimeConfig().contextBudgetTotal).toBe(64_000);
  });

  it("falls back for an invalid context budget", () => {
    vi.stubEnv("AGENT_CONTEXT_BUDGET_TOTAL", "not-a-number");

    expect(getAgentRuntimeConfig().contextBudgetTotal).toBe(128_000);
  });
});
