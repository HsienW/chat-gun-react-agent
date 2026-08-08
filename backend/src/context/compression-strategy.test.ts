import { describe, expect, it } from "vitest";

import {
  ContextPriority,
  estimateTokens,
  type ContextBlock,
} from "./context-budget.js";
import {
  DefaultCompressionStrategy,
  compressBlocks,
  getCompressionStrategy,
  registerCompressionStrategy,
  type CompressionStrategy,
} from "./compression-strategy.js";

function createBlock(
  priority: ContextPriority,
  label: string,
  content: string
): ContextBlock {
  return { priority, label, content, estimatedTokens: estimateTokens(content) };
}

describe("DefaultCompressionStrategy", () => {
  it("returns the original block list when it is within budget", () => {
    const blocks = [createBlock(ContextPriority.P1, "Task", "short")];

    expect(new DefaultCompressionStrategy().compress(blocks, 10)).toBe(blocks);
  });

  it("truncates oversized P5 tool output to at most 2000 characters", () => {
    const original = createBlock(ContextPriority.P5, "Tool", "x".repeat(2_500));

    const [compressed] = new DefaultCompressionStrategy().compress(
      [original],
      550
    );

    expect(compressed?.content.length).toBeLessThanOrEqual(2_000);
    expect(compressed?.content).toContain("[truncated]");
    expect(original.content).toHaveLength(2_500);
  });

  it("truncates oversized P4 conversation to at most 500 characters", () => {
    const original = createBlock(
      ContextPriority.P4,
      "Conversation",
      "x".repeat(600)
    );

    const [compressed] = new DefaultCompressionStrategy().compress(
      [original],
      130
    );

    expect(compressed?.content.length).toBeLessThanOrEqual(500);
    expect(compressed?.content).toContain("[truncated]");
  });

  it("recalculates token estimates after truncation", () => {
    const original = createBlock(ContextPriority.P5, "Tool", "中".repeat(2_500));

    const [compressed] = new DefaultCompressionStrategy().compress(
      [original],
      1_500
    );

    expect(compressed?.estimatedTokens).toBe(
      estimateTokens(compressed?.content ?? "")
    );
  });

  it("drops every P5 block when truncation is insufficient", () => {
    const blocks = [
      createBlock(ContextPriority.P2, "Resource", "x".repeat(600)),
      createBlock(ContextPriority.P5, "Tool", "x".repeat(100)),
    ];

    const compressed = new DefaultCompressionStrategy().compress(blocks, 160);

    expect(compressed.map((block) => block.priority)).toEqual([
      ContextPriority.P2,
    ]);
  });

  it("drops P4 blocks when removing P5 is still insufficient", () => {
    const blocks = [
      createBlock(ContextPriority.P2, "Resource", "x".repeat(600)),
      createBlock(ContextPriority.P4, "Conversation", "x".repeat(100)),
    ];

    const compressed = new DefaultCompressionStrategy().compress(blocks, 140);

    expect(compressed.map((block) => block.priority)).toEqual([
      ContextPriority.P2,
    ]);
  });

  it("never changes or drops P0 and P1 blocks", () => {
    const p0 = createBlock(ContextPriority.P0, "System", "x".repeat(600));
    const p1 = createBlock(ContextPriority.P1, "Task", "y".repeat(600));

    const compressed = new DefaultCompressionStrategy().compress([p0, p1], 1);

    expect(compressed).toEqual([p0, p1]);
  });
});

describe("compression strategy registry", () => {
  it("registers and resolves a custom strategy", () => {
    const customStrategy: CompressionStrategy = {
      name: "keep-first-for-test",
      compress: (blocks) => blocks.slice(0, 1),
    };

    registerCompressionStrategy(customStrategy);

    expect(getCompressionStrategy(customStrategy.name)).toBe(customStrategy);
    expect(
      compressBlocks(
        [
          createBlock(ContextPriority.P1, "A", "one"),
          createBlock(ContextPriority.P2, "B", "two"),
        ],
        1,
        customStrategy.name
      )
    ).toHaveLength(1);
  });

  it("falls back to the default strategy for an unknown name", () => {
    expect(getCompressionStrategy("missing-strategy")).toBeInstanceOf(
      DefaultCompressionStrategy
    );
  });
});
