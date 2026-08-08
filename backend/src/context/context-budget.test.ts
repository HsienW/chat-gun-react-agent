import { describe, expect, it } from "vitest";

import {
  ContextPriority,
  allocateBudget,
  createDefaultBudgetConfig,
  estimateTokens,
  prepareBlocks,
  type ContextBlock,
  type ContextItem,
} from "./context-budget.js";

function createBlock(
  priority: ContextPriority,
  label: string,
  estimatedTokens: number
): ContextBlock {
  return { priority, label, content: label, estimatedTokens };
}

describe("estimateTokens", () => {
  it("estimates English text from UTF-8 bytes", () => {
    expect(estimateTokens("Hello World")).toBe(3);
  });

  it("estimates Traditional Chinese text from UTF-8 bytes", () => {
    expect(estimateTokens("繁體中文測試")).toBe(5);
  });

  it("returns zero for empty content", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("counts mixed text and emoji by encoded byte length", () => {
    const content = "A🙂中";

    expect(estimateTokens(content)).toBe(
      Math.ceil(Buffer.byteLength(content, "utf8") / 4)
    );
  });
});

describe("ContextPriority", () => {
  it("defines P0 through P5 in allocation order", () => {
    expect([
      ContextPriority.P0,
      ContextPriority.P1,
      ContextPriority.P2,
      ContextPriority.P3,
      ContextPriority.P4,
      ContextPriority.P5,
    ]).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe("prepareBlocks", () => {
  it("adds an estimate to every context item", () => {
    const items: ContextItem[] = [
      { priority: ContextPriority.P1, label: "task", content: "Hello World" },
    ];

    expect(prepareBlocks(items)).toEqual([
      { ...items[0], estimatedTokens: 3 },
    ]);
  });

  it("does not let lower-priority content bypass an oversized higher priority", () => {
    const p1 = createBlock(ContextPriority.P1, "task", 4);
    const p5 = createBlock(ContextPriority.P5, "tool", 1);

    const allocation = allocateBudget(
      [p5, p1],
      createDefaultBudgetConfig({ totalTokenBudget: 3 })
    );

    expect(allocation.includedBlocks).toEqual([]);
    expect(allocation.trimmedBlocks).toEqual([p1, p5]);
  });
});

describe("createDefaultBudgetConfig", () => {
  it("uses a default total budget of 128000 tokens", () => {
    expect(createDefaultBudgetConfig().totalTokenBudget).toBe(128_000);
  });

  it("defines a documented reserve for every priority", () => {
    const reserves = createDefaultBudgetConfig().priorityReserves;

    for (const priority of Object.values(ContextPriority).filter(
      (value): value is ContextPriority => typeof value === "number"
    )) {
      expect(reserves[priority]).toBeGreaterThanOrEqual(0);
    }
  });

  it("merges total and individual reserve overrides", () => {
    const config = createDefaultBudgetConfig({
      totalTokenBudget: 4_096,
      priorityReserves: { [ContextPriority.P1]: 1_024 },
    });

    expect(config.totalTokenBudget).toBe(4_096);
    expect(config.priorityReserves[ContextPriority.P1]).toBe(1_024);
    expect(config.priorityReserves[ContextPriority.P2]).toBeGreaterThanOrEqual(0);
  });
});

describe("allocateBudget", () => {
  it("includes every block when the budget is sufficient", () => {
    const blocks = [
      createBlock(ContextPriority.P0, "system", 2),
      createBlock(ContextPriority.P1, "task", 3),
    ];

    const allocation = allocateBudget(blocks, createDefaultBudgetConfig({
      totalTokenBudget: 3,
    }));

    expect(allocation.includedBlocks).toEqual(blocks);
    expect(allocation.trimmedBlocks).toEqual([]);
    expect(allocation.exceeded).toBe(false);
  });

  it("sorts blocks by priority while preserving order within a priority", () => {
    const p5 = createBlock(ContextPriority.P5, "tool", 1);
    const p1First = createBlock(ContextPriority.P1, "task-a", 1);
    const p1Second = createBlock(ContextPriority.P1, "task-b", 1);

    const allocation = allocateBudget(
      [p5, p1First, p1Second],
      createDefaultBudgetConfig({ totalTokenBudget: 3 })
    );

    expect(allocation.includedBlocks).toEqual([p1First, p1Second, p5]);
  });

  it("trims lower-priority blocks that do not fit", () => {
    const p1 = createBlock(ContextPriority.P1, "task", 3);
    const p5 = createBlock(ContextPriority.P5, "tool", 2);

    const allocation = allocateBudget(
      [p5, p1],
      createDefaultBudgetConfig({ totalTokenBudget: 3 })
    );

    expect(allocation.includedBlocks).toEqual([p1]);
    expect(allocation.trimmedBlocks).toEqual([p5]);
    expect(allocation.exceeded).toBe(false);
  });

  it("does not charge P0 blocks against the configurable budget", () => {
    const p0 = createBlock(ContextPriority.P0, "system", 100);
    const p1 = createBlock(ContextPriority.P1, "task", 3);

    const allocation = allocateBudget(
      [p0, p1],
      createDefaultBudgetConfig({ totalTokenBudget: 3 })
    );

    expect(allocation.usedTokens).toBe(3);
    expect(allocation.remainingTokens).toBe(0);
  });

  it("reports exceeded when P0 alone is larger than the total budget", () => {
    const p0 = createBlock(ContextPriority.P0, "system", 4);

    const allocation = allocateBudget(
      [p0],
      createDefaultBudgetConfig({ totalTokenBudget: 3 })
    );

    expect(allocation.includedBlocks).toEqual([p0]);
    expect(allocation.exceeded).toBe(true);
  });

  it("returns an empty allocation for an empty block list", () => {
    expect(
      allocateBudget([], createDefaultBudgetConfig({ totalTokenBudget: 3 }))
    ).toEqual({
      includedBlocks: [],
      trimmedBlocks: [],
      usedTokens: 0,
      remainingTokens: 3,
      exceeded: false,
    });
  });
});
