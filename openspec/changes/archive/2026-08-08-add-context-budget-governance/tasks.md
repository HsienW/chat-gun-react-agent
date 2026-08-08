# Tasks：add-context-budget-governance

## Task 1：建立 Token 估算器

- [x] 新增 `backend/src/context/context-budget.ts`
  - `ContextPriority` enum（P0–P5）
  - `ContextBlock`, `ContextBudgetConfig`, `AllocationResult` interfaces
  - `estimateTokens(content)` — UTF-8 bytes / 4
  - `createDefaultBudgetConfig(overrides?)` — 預設 128000 total
  - `allocateBudget(blocks, config)` — priority-based 預算分配
  - `prepareBlocks(items)` — 便利 helper
- [x] 新增 `backend/src/context/context-budget.test.ts`（16 tests）

驗證：`npm run lint && npm run test` ✓

## Task 2：建立 Priority-based Assembler

- [x] 新增 `backend/src/context/context-assembler.ts`
  - `AssembledContext`, `ContextAssemblerConfig` interfaces
  - `ContextAssembler` interface + `createContextAssembler(config)`
  - `assembleContext(blocks, config)` — 核心組裝邏輯
  - `assembleFromItems(items, config?)` — 便利 wrapper
  - 可客製 `sectionHeaders` 與 `blockSeparator`
- [x] 新增 `backend/src/context/context-assembler.test.ts`（9 tests）

驗證：`npm run lint && npm run test` ✓

## Task 3：建立 Compression Strategy

- [x] 新增 `backend/src/context/compression-strategy.ts`
  - `CompressionStrategy` interface
  - `DefaultCompressionStrategy`（四階段管線）
    1. Compress Tool Results（P5 → max 2000 chars）
    2. Compress Conversation（P4 → max 500 chars/msg）
    3. Drop Low-Relevance（P5 first, then P4 if needed）
    4. Keep Critical（P0/P1 never touched）
  - `registerCompressionStrategy` / `getCompressionStrategy`
  - `compressBlocks` convenience
- [x] 新增 `backend/src/context/compression-strategy.test.ts`（9 tests）

驗證：`npm run lint && npm run test` ✓

## Task 4：Barrel Export 與 Config Key

- [x] 新增 `backend/src/context/index.ts` — barrel export
- [x] 修改 `backend/src/state.ts` — 標記 `buildConversationContext` `@deprecated`
- [x] 修改 `backend/src/platform/runtime-config.ts` — 新增 `contextBudgetTotal` 欄位與 `AGENT_CONTEXT_BUDGET_TOTAL` env key
- [x] 修改 `backend/src/platform/im-context-pack.ts` — 新增 `estimateContentTokens` helper

驗證：`npm run lint && npm run build` ✓

## Task 5：既有 Agent 回歸驗證

- [x] 執行既有測試：`npm run test` — 403 passed、28 skipped
- [x] 執行 lint：`npm run lint` — 通過
- [x] 執行 build：`npm run build` — 通過

## 尚未處理事項

- 既有 agent（chatbot、math-agent、mcp-agent）仍使用 `buildConversationContext`，尚未遷移至新框架
- `deep-researcher.ts` 內部的 context 組裝（`buildImAgentContextPack`）未替換為 ContextAssembler
- 建議後續 issue 逐步遷移各 agent 至新框架
