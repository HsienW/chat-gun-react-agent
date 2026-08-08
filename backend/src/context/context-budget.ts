export enum ContextPriority {
  P0 = 0,
  P1 = 1,
  P2 = 2,
  P3 = 3,
  P4 = 4,
  P5 = 5,
}

export interface ContextItem {
  priority: ContextPriority;
  label: string;
  content: string;
}

export interface ContextBlock extends ContextItem {
  estimatedTokens: number;
}

export interface ContextBudgetConfig {
  totalTokenBudget: number;
  priorityReserves: Record<ContextPriority, number>;
}

export interface ContextBudgetConfigOverrides {
  totalTokenBudget?: number;
  priorityReserves?: Partial<Record<ContextPriority, number>>;
}

export interface AllocationResult {
  includedBlocks: ContextBlock[];
  trimmedBlocks: ContextBlock[];
  usedTokens: number;
  remainingTokens: number;
  exceeded: boolean;
}

export const DEFAULT_CONTEXT_TOKEN_BUDGET = 128_000;

// Advisory reserves document the intended distribution. Allocation remains
// priority-first, as the OpenSpec explicitly defines these as non-binding.
const DEFAULT_PRIORITY_RESERVES: Record<ContextPriority, number> = {
  [ContextPriority.P0]: 0,
  [ContextPriority.P1]: 32_000,
  [ContextPriority.P2]: 24_000,
  [ContextPriority.P3]: 16_000,
  [ContextPriority.P4]: 40_000,
  [ContextPriority.P5]: 16_000,
};

export function estimateTokens(content: string): number {
  return Math.ceil(Buffer.byteLength(content, "utf8") / 4);
}

export function createDefaultBudgetConfig(
  overrides: ContextBudgetConfigOverrides = {}
): ContextBudgetConfig {
  return {
    totalTokenBudget:
      overrides.totalTokenBudget ?? DEFAULT_CONTEXT_TOKEN_BUDGET,
    priorityReserves: {
      ...DEFAULT_PRIORITY_RESERVES,
      ...overrides.priorityReserves,
    },
  };
}

export function prepareBlocks(items: readonly ContextItem[]): ContextBlock[] {
  return items.map((item) => ({
    ...item,
    estimatedTokens: estimateTokens(item.content),
  }));
}

export function allocateBudget(
  blocks: readonly ContextBlock[],
  config: ContextBudgetConfig
): AllocationResult {
  const sortedBlocks = [...blocks].sort(
    (left, right) => left.priority - right.priority
  );
  const includedBlocks: ContextBlock[] = [];
  const trimmedBlocks: ContextBlock[] = [];
  let usedTokens = 0;
  let p0Tokens = 0;
  let blockingPriority: ContextPriority | undefined;

  for (const block of sortedBlocks) {
    if (block.priority === ContextPriority.P0) {
      includedBlocks.push(block);
      p0Tokens += block.estimatedTokens;
      continue;
    }

    if (
      blockingPriority !== undefined &&
      block.priority > blockingPriority
    ) {
      trimmedBlocks.push(block);
      continue;
    }

    if (usedTokens + block.estimatedTokens <= config.totalTokenBudget) {
      includedBlocks.push(block);
      usedTokens += block.estimatedTokens;
    } else {
      trimmedBlocks.push(block);
      blockingPriority ??= block.priority;
    }
  }

  return {
    includedBlocks,
    trimmedBlocks,
    usedTokens,
    remainingTokens: Math.max(0, config.totalTokenBudget - usedTokens),
    exceeded: p0Tokens > config.totalTokenBudget,
  };
}
