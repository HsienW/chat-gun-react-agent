# Spec：Context Budget Governance

## ADDED Requirements

### Requirement：Token 估算

系統 MUST 提供 `estimateTokens` 函式，依據內容字串估算 token 數量。

估算策略：UTF-8 編碼位元組數除以 4 取天花板值。此策略與既有 `estimateContextPackTokens` 保持一致，不需要模型特定 tokenizer。

#### Scenario：英文文字估算

GIVEN 一段英文文字 "Hello World"（11 字元 × 1 byte = 11 bytes）
WHEN 呼叫 `estimateTokens`
THEN 回傳 `ceil(11 / 4) = 3` tokens

#### Scenario：CJK 文字估算

GIVEN 一段繁體中文 "繁體中文測試"（6 字元 × 3 bytes = 18 bytes）
WHEN 呼叫 `estimateTokens`
THEN 回傳 `ceil(18 / 4) = 5` tokens

#### Scenario：空白輸入

GIVEN 空字串 ""
WHEN 呼叫 `estimateTokens`
THEN 回傳 `0`

---

### Requirement：Context Priority 定義

系統 MUST 定義六層優先級（P0–P5）：

| Priority | Content | 保留規則 |
|----------|---------|---------|
| P0 | System / security rules | 永遠保留，不計入預算 |
| P1 | Current task and Task State | 優先使用預算 |
| P2 | Related resources and rules | 預算充足時保留 |
| P3 | Relevant historical summaries | 壓縮後保留 |
| P4 | Recent conversation | 截斷舊訊息 |
| P5 | Low-value raw Tool output | 最先被裁剪或壓縮 |

#### Scenario：優先級排序

GIVEN 不同 priority 的多個 ContextBlock
WHEN 進行預算分配
THEN 按 P0 → P5 順序處理
AND P0 block 永遠不會被裁剪

---

### Requirement：預算分配（allocateBudget）

系統 MUST 提供 `allocateBudget` 函式，依據 `ContextBudgetConfig` 對 ContextBlock 列表進行預算分配。

P0 block 永遠保留且不消耗預算。其餘 priority 按順序競爭剩餘預算。預算不足時，低優先級 block 依序被裁剪。

配置提供 `priorityReserves` 作為每層建議保留量（文件用途，非硬性上限）。

#### Scenario：預算充足時全部保留

GIVEN 兩個 ContextBlock（P0, P1），總 token 小於預算
WHEN 呼叫 `allocateBudget`
THEN 回傳所有 block
AND `trimmedBlocks` 為空
AND `exceeded` 為 false

#### Scenario：預算不足時裁剪低優先級

GIVEN P0 + 兩個 P5 block，總 token 超過預算
WHEN 呼叫 `allocateBudget`
THEN P0 保留
AND P5 block 被裁剪
AND `exceeded` 為 false（非 P0 觸發）

#### Scenario：P0 單獨超標

GIVEN 單一 P0 block，token 超出總預算
WHEN 呼叫 `allocateBudget`
THEN P0 仍被保留（強制保留）
AND `exceeded` 為 true

#### Scenario：空白輸入

GIVEN 空 ContextBlock 列表
WHEN 呼叫 `allocateBudget`
THEN 回傳空列表，無錯誤

---

### Requirement：Priority-based Context Assembler

系統 MUST 提供 `ContextAssembler`，將 ContextBlock 列表組裝為單一文字，用於注入 prompt template。

Assembler 接受可選的 `sectionHeaders` 設定，為不同優先級區塊加上標題。

#### Scenario：基本組裝

GIVEN P0 system rules 與 P1 task context
WHEN 呼叫 `assemble`
THEN 回傳 `AssembledContext`，`text` 包含兩者內容
AND `totalTokens` > 0
AND `truncatedBlocks` = 0

#### Scenario：客製化區塊標題

GIVEN assembler config 設定 `sectionHeaders` 包含 P0 標題 "## System Instructions"
WHEN 組裝包含 P0 block
THEN 輸出文字包含 "## System Instructions" 前綴

#### Scenario：空白輸入組裝

GIVEN 空 ContextBlock 列表
WHEN 呼叫 `assemble`
THEN 回傳空 `text`，`totalTokens` = 0

---

### Requirement：壓縮策略框架

系統 MUST 提供 `CompressionStrategy` interface 與 `DefaultCompressionStrategy` 實作。

Default 策略執行四階段管線：

1. **Compress Tool Results**：截斷 >2000 字元的 P5 tool output
2. **Compress Conversation**：截斷 >500 字元的 P4 對話訊息
3. **Drop Low-Relevance**：丟棄全部 P5 block，若仍超標則丟棄 P4
4. **Keep Critical**：P0/P1 永遠不變

策略 MUST 支援註冊與查詢（`registerCompressionStrategy` / `getCompressionStrategy`）。

#### Scenario：預算內不需壓縮

GIVEN 所有 block 總 token 小於預算
WHEN 呼叫 `compress`
THEN 回傳原始 block 列表（不做任何變更）

#### Scenario：大型 Tool Output 被截斷

GIVEN 一個 P5 block 內容超過 2000 字元，總 token 超過預算
WHEN 呼叫 `compress` with DefaultCompressionStrategy
THEN P5 block 內容被截斷至 ≤2000 字元
AND 截斷後標記 `[truncated]`

#### Scenario：超標時丟棄 P5

GIVEN Stage 1-2 壓縮後仍超預算
WHEN DefaultCompressionStrategy 進入 Stage 3
THEN 所有 P5 block 被丟棄
AND P0/P1 block 保留

#### Scenario：自訂策略註冊

GIVEN 一個實作 `CompressionStrategy` interface 的自訂策略
WHEN 呼叫 `registerCompressionStrategy` 註冊
THEN 可透過 `getCompressionStrategy(name)` 查詢到該策略
AND 查詢不存在的名稱回傳 DefaultCompressionStrategy

---

### Requirement：既有程式向後相容

修改 MUST NOT 破壞現有 agent 行為。

- `buildConversationContext` 保留並標記 `@deprecated`
- `im-context-pack.ts` 新增 `estimateContentTokens` helper
- `runtime-config.ts` 新增 `contextBudgetTotal` 欄位，預設 128000

#### Scenario：既有 agent 不受影響

GIVEN chatbot、deep-researcher、math-agent、mcp-agent
WHEN 執行 `npm run lint && npm run test && npm run build`
THEN 全部通過，無新增失敗
