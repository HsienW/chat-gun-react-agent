import {
  ContextPriority,
  estimateTokens,
  type ContextBlock,
} from "./context-budget.js";

export interface CompressionStrategy {
  readonly name: string;
  compress(blocks: ContextBlock[], budget: number): ContextBlock[];
}

const DEFAULT_STRATEGY_NAME = "default";
const TOOL_RESULT_MAX_CHARACTERS = 2_000;
const CONVERSATION_MAX_CHARACTERS = 500;
const TRUNCATION_MARKER = "\n[truncated]";

export class DefaultCompressionStrategy implements CompressionStrategy {
  readonly name = DEFAULT_STRATEGY_NAME;

  compress(blocks: ContextBlock[], budget: number): ContextBlock[] {
    if (isWithinBudget(blocks, budget)) {
      return blocks;
    }

    const compressedToolResults = truncatePriorityBlocks(
      blocks,
      ContextPriority.P5,
      TOOL_RESULT_MAX_CHARACTERS
    );
    if (isWithinBudget(compressedToolResults, budget)) {
      return compressedToolResults;
    }

    const compressedConversation = truncatePriorityBlocks(
      compressedToolResults,
      ContextPriority.P4,
      CONVERSATION_MAX_CHARACTERS
    );
    if (isWithinBudget(compressedConversation, budget)) {
      return compressedConversation;
    }

    const withoutToolResults = compressedConversation.filter(
      (block) => block.priority !== ContextPriority.P5
    );
    if (isWithinBudget(withoutToolResults, budget)) {
      return withoutToolResults;
    }

    return withoutToolResults.filter(
      (block) => block.priority !== ContextPriority.P4
    );
  }
}

const defaultCompressionStrategy = new DefaultCompressionStrategy();
const compressionStrategies = new Map<string, CompressionStrategy>([
  [defaultCompressionStrategy.name, defaultCompressionStrategy],
]);

export function registerCompressionStrategy(
  strategy: CompressionStrategy
): void {
  compressionStrategies.set(strategy.name, strategy);
}

export function getCompressionStrategy(name: string): CompressionStrategy {
  return compressionStrategies.get(name) ?? defaultCompressionStrategy;
}

export function compressBlocks(
  blocks: ContextBlock[],
  budget: number,
  strategyName = DEFAULT_STRATEGY_NAME
): ContextBlock[] {
  return getCompressionStrategy(strategyName).compress(blocks, budget);
}

function isWithinBudget(blocks: readonly ContextBlock[], budget: number): boolean {
  return (
    blocks.reduce((total, block) => total + block.estimatedTokens, 0) <= budget
  );
}

function truncatePriorityBlocks(
  blocks: readonly ContextBlock[],
  priority: ContextPriority,
  maxCharacters: number
): ContextBlock[] {
  return blocks.map((block) => {
    if (block.priority !== priority || block.content.length <= maxCharacters) {
      return block;
    }

    const content = `${block.content.slice(
      0,
      maxCharacters - TRUNCATION_MARKER.length
    )}${TRUNCATION_MARKER}`;
    return {
      ...block,
      content,
      estimatedTokens: estimateTokens(content),
    };
  });
}
