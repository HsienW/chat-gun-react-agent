import {
  DEFAULT_CONTEXT_TOKEN_BUDGET,
  ContextPriority,
  allocateBudget,
  createDefaultBudgetConfig,
  prepareBlocks,
  type ContextBlock,
  type ContextBudgetConfigOverrides,
  type ContextItem,
} from "./context-budget.js";

export interface AssembledContext {
  text: string;
  blocks: ContextBlock[];
  totalTokens: number;
  truncatedBlocks: number;
  exceeded: boolean;
}

export interface ContextAssemblerConfig extends ContextBudgetConfigOverrides {
  totalTokenBudget: number;
  sectionHeaders?: Partial<Record<ContextPriority, string>>;
  blockSeparator?: string;
}

export interface ContextAssembler {
  assemble(blocks: readonly ContextBlock[]): AssembledContext;
}

const DEFAULT_BLOCK_SEPARATOR = "\n\n";

export function assembleContext(
  blocks: readonly ContextBlock[],
  config: ContextAssemblerConfig
): AssembledContext {
  const allocation = allocateBudget(blocks, createDefaultBudgetConfig(config));
  const renderedBlocks = allocation.includedBlocks.map((block) =>
    renderBlock(block, config.sectionHeaders)
  );

  return {
    text: renderedBlocks.join(config.blockSeparator ?? DEFAULT_BLOCK_SEPARATOR),
    blocks: allocation.includedBlocks,
    totalTokens: allocation.includedBlocks.reduce(
      (total, block) => total + block.estimatedTokens,
      0
    ),
    truncatedBlocks: allocation.trimmedBlocks.length,
    exceeded: allocation.exceeded,
  };
}

export function createContextAssembler(
  config: ContextAssemblerConfig
): ContextAssembler {
  return {
    assemble: (blocks) => assembleContext(blocks, config),
  };
}

export function assembleFromItems(
  items: readonly ContextItem[],
  config: ContextAssemblerConfig = {
    totalTokenBudget: DEFAULT_CONTEXT_TOKEN_BUDGET,
  }
): AssembledContext {
  return assembleContext(prepareBlocks(items), config);
}

function renderBlock(
  block: ContextBlock,
  sectionHeaders?: Partial<Record<ContextPriority, string>>
): string {
  const heading = sectionHeaders?.[block.priority] ?? block.label;
  return heading.length > 0 ? `${heading}\n${block.content}` : block.content;
}
