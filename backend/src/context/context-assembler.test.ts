import { describe, expect, it } from "vitest";

import { ContextPriority, type ContextBlock } from "./context-budget.js";
import {
  assembleContext,
  assembleFromItems,
  createContextAssembler,
} from "./context-assembler.js";

function createBlock(
  priority: ContextPriority,
  label: string,
  content: string,
  estimatedTokens = 1
): ContextBlock {
  return { priority, label, content, estimatedTokens };
}

describe("assembleContext", () => {
  it("assembles system rules and current task context", () => {
    const assembled = assembleContext(
      [
        createBlock(ContextPriority.P0, "System", "Keep data safe"),
        createBlock(ContextPriority.P1, "Task", "Answer the user"),
      ],
      { totalTokenBudget: 10 }
    );

    expect(assembled.text).toContain("Keep data safe");
    expect(assembled.text).toContain("Answer the user");
    expect(assembled.totalTokens).toBeGreaterThan(0);
    expect(assembled.truncatedBlocks).toBe(0);
  });

  it("orders output from P0 to P5", () => {
    const assembled = assembleContext(
      [
        createBlock(ContextPriority.P5, "Tool", "raw output"),
        createBlock(ContextPriority.P1, "Task", "current task"),
      ],
      { totalTokenBudget: 10 }
    );

    expect(assembled.text.indexOf("current task")).toBeLessThan(
      assembled.text.indexOf("raw output")
    );
  });

  it("reports blocks removed by budget allocation", () => {
    const assembled = assembleContext(
      [
        createBlock(ContextPriority.P1, "Task", "current task", 2),
        createBlock(ContextPriority.P5, "Tool", "raw output", 2),
      ],
      { totalTokenBudget: 2 }
    );

    expect(assembled.blocks).toHaveLength(1);
    expect(assembled.truncatedBlocks).toBe(1);
    expect(assembled.text).not.toContain("raw output");
  });

  it("uses custom section headers by priority", () => {
    const assembled = assembleContext(
      [createBlock(ContextPriority.P0, "System", "Keep data safe")],
      {
        totalTokenBudget: 10,
        sectionHeaders: {
          [ContextPriority.P0]: "## System Instructions",
        },
      }
    );

    expect(assembled.text).toContain("## System Instructions");
  });

  it("uses block labels when no custom section header exists", () => {
    const assembled = assembleContext(
      [createBlock(ContextPriority.P1, "Current Task", "Answer")],
      { totalTokenBudget: 10 }
    );

    expect(assembled.text).toBe("Current Task\nAnswer");
  });

  it("joins rendered blocks with a custom separator", () => {
    const assembled = assembleContext(
      [
        createBlock(ContextPriority.P1, "A", "one"),
        createBlock(ContextPriority.P2, "B", "two"),
      ],
      { totalTokenBudget: 10, blockSeparator: "\n---\n" }
    );

    expect(assembled.text).toContain("one\n---\nB");
  });

  it("returns an empty result for an empty block list", () => {
    expect(assembleContext([], { totalTokenBudget: 10 })).toEqual({
      text: "",
      blocks: [],
      totalTokens: 0,
      truncatedBlocks: 0,
      exceeded: false,
    });
  });

  it("assembles raw items with estimated token counts", () => {
    const assembled = assembleFromItems([
      { priority: ContextPriority.P1, label: "Task", content: "Hello World" },
    ]);

    expect(assembled.blocks[0]?.estimatedTokens).toBe(3);
    expect(assembled.totalTokens).toBe(3);
  });

  it("creates a reusable assembler without mutating source blocks", () => {
    const block = createBlock(ContextPriority.P1, "Task", "Answer");
    const source = [block];
    const assembler = createContextAssembler({ totalTokenBudget: 10 });

    const assembled = assembler.assemble(source);

    expect(source).toEqual([block]);
    expect(assembled.blocks).not.toBe(source);
  });
});
