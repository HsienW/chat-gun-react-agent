# Design：add-context-budget-governance

## 架構概述

```text
backend/src/context/
├── context-budget.ts           # Token 估算器 + 預算分配
├── context-assembler.ts        # Priority-based assembler
├── compression-strategy.ts     # 壓縮策略框架
├── index.ts                    # Barrel export
├── context-budget.test.ts
├── context-assembler.test.ts
└── compression-strategy.test.ts
```

## 責任邊界

### `context-budget.ts` — Token 估算與預算

- `estimateTokens(content)`：UTF-8 字節數 / 4 估算 token
- `ContextPriority` enum：P0（系統規則）～ P5（低價值 Tool 輸出）
- `ContextBudgetConfig`：`totalTokenBudget` + `priorityReserves`
- `allocateBudget(blocks, config)`：依優先級分配預算，P0 永遠保留

### `context-assembler.ts` — Priority-based 組裝器

- `ContextBlock`：單一 context 區塊（priority + label + content + estimatedTokens）
- `AssembledContext`：組裝結果（text + blocks + stats）
- `createContextAssembler(config)`：建立組裝器
- 組裝策略：依 priority 排序 → 分配預算 → 拼接文字

### `compression-strategy.ts` — 壓縮策略框架

- `CompressionStrategy` interface：`name` + `compress(blocks, budget)`
- `DefaultCompressionStrategy`：四階段管線
  1. 壓縮 Tool Results（P5 截斷到 2000 字元）
  2. 壓縮對話歷史（P4 截斷到 500 字元/訊息）
  3. 丟棄低關聯內容（先 P5 全刪，再 P4）
  4. 保留關鍵證據（P0/P1 永遠不動）
- `registerCompressionStrategy` / `getCompressionStrategy`：可插拔策略註冊

## 資料流

```text
Raw Messages / Tool Results
  → prepareBlocks() → ContextBlock[] (with estimatedTokens)
  → CompressionStrategy.compress() → compressed ContextBlock[]
  → ContextAssembler.assemble() → AssembledContext (text + stats)
  → Injected into Prompt Template
```

## 替代方案與決策

| 決策 | 選項 A | 選項 B | 選擇 |
|------|--------|--------|------|
| Token 估算 | tiktoken 精確計算 | UTF-8 bytes / 4 簡易估算 | B — 不需要模型特定依賴，與既有程式一致 |
| 模組位置 | 放在 `platform/` | 放在 `context/` | B — 獨立關注點，遵循 Backend AGENTS.md 模組邊界 |
| 壓縮策略 | 硬編碼在 assembler 內 | 可插拔 strategy interface | B — 支援不同 agent 自訂策略 |
| 既有程式 | 強制改寫所有 agent | Deprecated 標記 + 向後相容 | B — 漸進遷移，不破壞現有功能 |
