# X7 — add-context-budget-governance：實作計劃

## 需求理解

目前 `backend/src/state.ts` 的 `buildConversationContext` 只取最後 10 則訊息，缺乏：
1. Token 預算定量控制
2. 結構化優先級組裝（系統規則 > 目前任務 > 歷史摘要 > 原始輸出）
3. 預算超標時的壓縮策略

X7 Issue 要求建立 Context Budget 與 Compression Strategy Framework，提供：
- Context Budget 計算器（Token 估算）
- Priority-based assembler（P0–P5 優先級）
- Compression strategy framework
- Pluggable Context assembly

## 目前可重現的問題

1. `buildConversationContext` 純以訊息數量為上限，可能超標模型 context window
2. `ImContextPack` 有 `maxTokens` 欄位但僅用於估算，沒有硬性裁剪
3. 長對話時可能將低價值歷史或大型 Tool Output 送進模型，浪費 Token
4. 壓縮策略分散在各 agent 內部（如 `formatEvidence`、`excerpt`），無法共用

## 問題所屬層級

Backend Context Assembly / Governance（非 BFF、非 Frontend）

## 受影響能力域

- Backend Context 組裝
- Token 預算治理
- 所有 Agent（chatbot、deep-researcher、math-agent、mcp-agent）

## 受影響套件與檔案

| 類型 | 檔案 |
|------|------|
| 新增 | `backend/src/context/context-budget.ts` — Token 估算器 |
| 新增 | `backend/src/context/context-assembler.ts` — Priority-based assembler |
| 新增 | `backend/src/context/compression-strategy.ts` — 壓縮策略框架 |
| 新增 | `backend/src/context/index.ts` — Barrel export |
| 新增 | `backend/src/context/context-budget.test.ts` |
| 新增 | `backend/src/context/context-assembler.test.ts` |
| 新增 | `backend/src/context/compression-strategy.test.ts` |
| 修改 | `backend/src/state.ts` — 標記 `buildConversationContext` deprecated（保留相容） |
| 修改 | `backend/src/prompts.ts` — 保留相容 |
| 修改 | `backend/src/platform/runtime-config.ts` — 新增 context budget 相關 config key |
| 參考 | `backend/src/platform/im-context-pack.ts` — 參考現有 token 估算邏輯 |
| 參考 | `backend/src/agents/deep-researcher.ts` — 參考 `formatEvidence`、`excerpt` |

## API、事件、狀態或 Schema 變化

### 新增介面（不破壞既有合約）

```typescript
// Priority level 定義
enum ContextPriority { P0 = 0, P1 = 1, P2 = 2, P3 = 3, P4 = 4, P5 = 5 }

// Context block 最小單位
interface ContextBlock {
  priority: ContextPriority;
  label: string;        // 用於 debug 與 audit
  content: string;
  estimatedTokens: number;
}

// Context Budget 設定
interface ContextBudgetConfig {
  totalTokenBudget: number;      // 整體上限
  priorityReserves: Map<ContextPriority, number>; // 每層保留量
}

// Assembler 輸出
interface AssembledContext {
  blocks: ContextBlock[];
  totalTokens: number;
  truncatedBlocks: number;
  droppedPriorities: ContextPriority[];
}

// Compression strategy
interface CompressionStrategy {
  name: string;
  compress(blocks: ContextBlock[], budget: ContextBudgetConfig): ContextBlock[];
}
```

## 相容性與安全風險

- **向後相容**：既有的 `buildConversationContext` 保留不刪，標記 `@deprecated`，引導新程式使用 context assembler
- **不改變 LangGraph State**：Context budget 是 agent node 內部的組裝層，不改變任何 State schema
- **不引入新依賴**：使用字元數 / 4 估算 token（與 `estimateContextPackTokens` 一致），不需要 tiktoken 或外部 tokenizer
- **不影響 BFF 或 Frontend**：純 backend 內部變更

## 測試與回歸計畫

1. Unit test：Context budget 計算器
   - Token 估算（英文、中文、混合）
   - Budget 分配（各 priority 保留量）
   - Budget 超標偵測

2. Unit test：Priority-based assembler
   - P0（system rules）永遠保留
   - P5（low-value tool output）最先被裁剪
   - 裁剪後總 token 不超過 budget
   - 空白輸入處理

3. Unit test：Compression strategy
   - Tool Output 壓縮（截斷到上限）
   - Conversation history 摘要壓縮
   - 低相關性內容裁剪
   - 自訂策略插入

4. Integration test：超長對話情境
   - 注入大量訊息 → context 不超過預算
   - 核心規則在降級後仍保留

5. 既有測試回歸
   - `cd backend && npm run lint && npm run test && npm run build`

## 尚未解決的規格問題

無。X7 Issue 已有明確 scope、priority table 與 acceptance criteria。

## 實作設計決策

### 1. 模組位置：`backend/src/context/`

理由：Context governance 是獨立關注點，不適合放在 `state.ts`（LangGraph State helper）、`platform/`（runtime infra）或 `runtime/`（task runtime）。遵循 `backend/AGENTS.md` 的模組邊界原則。

### 2. Token 估算策略：`Math.ceil(JSON.stringify(content).length / 4)`

理由：
- 與既有 `estimateContextPackTokens` 一致
- 中文字元在 UTF-8 中約 3 bytes，JSON.stringify 後約 4–8 bytes/char，除以 4 給出保守近似
- 不需要 tiktoken（避免引入重量級依賴、避免需要模型特定 tokenizer）
- 滿足 X7 Scope 定義的 "Context Budget calculator (Token counting)"

### 3. Priority-based Assembler 設計

對應 X7 Issue 的 priority table：

| Priority | Content | 保留規則 |
|----------|---------|---------|
| P0 | System / security rules | 永遠保留，使用 reserve |
| P1 | Current task and Task State | 使用 reserve |
| P2 | Related resources and rules (caller-injected) | 預算充足時保留 |
| P3 | Relevant historical summaries | 壓縮後保留 |
| P4 | Recent conversation | 截斷舊訊息 |
| P5 | Low-value raw Tool output | 最先被裁剪或壓縮 |

降級順序：P5 → P4 → P3 → P2（P0/P1 永遠保留）

### 4. Compression Strategy Framework 設計

```text
Step 1: Compress Tool Results（大於閾值的 tool output 截斷 + 摘要標記）
Step 2: Compress conversation history（舊訊息摘要取代原始文字）
Step 3: Drop low-relevance content（低優先級 block 全刪）
Step 4: Keep current task and critical evidence（P0/P1 永遠不動）
```

提供 `DefaultCompressionStrategy`，支援 `registerCustomStrategy` 插入自訂邏輯。

### 5. Pluggable 設計

`ContextAssembler` 接受 `blocks: ContextBlock[]`，不同 agent 可以注入不同的 block 組合。例如：
- Chatbot：System prompt + 歷史對話 + 目前訊息
- Deep Researcher：System prompt + 研究計畫 + 工具證據 + 來源摘要 + 歷史對話

### 6. 不修改既有 agent 呼叫

本次變更不強制修改 chatbot、deep-researcher、math-agent、mcp-agent 的內部邏輯。只在 `im-context-pack.ts` 中新增一個 helper 使用 context budget 作為估算上限，保持向後相容。

---

## 實作步驟（Task 拆解）

### Task 1：建立 Token 估算器 (`context-budget.ts`)

- `estimateTokens(content: string): number`
- `ContextBudgetConfig` interface
- `createBudget(config: ContextBudgetConfig): ContextBudget`
- `allocateBudget(budget, blocks): AllocationResult`

### Task 2：建立 Priority-based Assembler (`context-assembler.ts`)

- `ContextBlock`, `ContextPriority` 型別
- `createAssembler(config): ContextAssembler`
- `assemble(blocks: ContextBlock[]): AssembledContext`
- Priority-based 裁剪邏輯（P5→P4→P3→P2 降級，P0/P1 保留）

### Task 3：建立 Compression Strategy (`compression-strategy.ts`)

- `CompressionStrategy` interface
- `DefaultCompressionStrategy` — 實作四階段壓縮
- Strategy factory / registry（`registerStrategy`, `getStrategy`）

### Task 4：標記既有程式 deprecated 並新增 config key

- `state.ts`：`buildConversationContext` 加 `@deprecated` JSDoc
- `runtime-config.ts`：新增 `AGENT_CONTEXT_BUDGET_TOTAL` 預設 config key
- `im-context-pack.ts`：選用 context budget 估算與限制

### Task 5：編寫測試

- `context-budget.test.ts`：token 估算、預算分配、超標
- `context-assembler.test.ts`：優先級裁剪、所有 priority 層覆蓋
- `compression-strategy.test.ts`：預設策略四階段、自訂策略註冊

### Task 6：驗證既有 agent 回歸

- `cd backend && npm run lint && npm run test && npm run build`

---

## 非目標（Excludes）

- 不修改 BFF 或 Frontend
- 不修改 LangGraph State schema
- 不引入 tiktoken 或模型特定 tokenizer
- 不強制改寫既有 agent prompt 組裝邏輯
- 不修改 Weather/Research agent 的內部 context 處理（這次只建立框架）

## 風險

- **Token 估算精度**：簡易估算（字元/4）可能高估或低估實際 token 數，但 X7 文件要求的是 Token counting，不需要 100% 精確 → 採用此策略足夠，且保持與既有 codebase 一致
- **既有 agent 未立即遷移**：目前 chatbot/math-agent/mcp-agent 仍使用舊的 `buildConversationContext` → 接受此限制，deprecated 標記 + docs 引導，非本次 scope
