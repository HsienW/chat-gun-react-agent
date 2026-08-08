# Proposal：add-context-budget-governance

## 問題描述

目前 `backend/src/state.ts` 的 `buildConversationContext` 僅取最後 10 則訊息作為對話上下文，缺乏以下能力：

1. **Token 預算定量控制**：無法限制送入模型的 context token 總量，長對話或大型 Tool Output 可能超標模型 context window。
2. **結構化優先級組裝**：所有訊息權重相同，無法區分系統規則（P0）、目前任務（P1）、相關資源（P2）、歷史摘要（P3）、近期對話（P4）與低價值 Tool 輸出（P5）。
3. **預算超標時的壓縮策略**：缺乏系統性降級機制（先壓縮 Tool 輸出 → 再壓縮對話歷史 → 再丟棄低關聯內容 → 保留關鍵證據）。

## 解決方案

在 `backend/src/context/` 建立通用 Context Budget 治理框架，包括：

1. **Context Budget 計算器**：Token 估算（UTF-8 bytes / 4）、預算分配（priority-based reserves）。
2. **Priority-based Assembler**：將 context blocks 依 P0–P5 優先級組裝，預算不足時從低優先級開始裁剪。
3. **Compression Strategy Framework**：四階段壓縮管線 + 可插拔策略註冊。

## 受影響套件與能力域

| 套件 | 能力域 | 變更類型 |
|------|--------|---------|
| backend | Context 組裝 | 新增 `backend/src/context/` 模組 |
| backend | Token 預算治理 | 新增 Budget Calculator + Assembler |
| backend | 壓縮策略 | 新增 Compression Strategy Framework |
| backend | Runtime Config | 新增 `AGENT_CONTEXT_BUDGET_TOTAL` key |
| backend | State Helper | 標記 `buildConversationContext` deprecated（保留相容） |

## 目標

- 建立通用、可插拔、不綁定業務的 Context Budget 治理框架
- 支援 Token 估算、Priority-based 組裝、壓縮策略
- 向後相容：既有 agent（chatbot、deep-researcher、math-agent、mcp-agent）不受影響
- 每個 Requirement 至少一個可驗證 Scenario

## 非目標

- 不修改 BFF 或 Frontend
- 不修改 LangGraph State schema
- 不引入 tiktoken 或模型特定 tokenizer
- 不強制改寫既有 agent 的 prompt 組裝邏輯（建立框架後由後續 issue 遷移）

## 風險與回滾策略

- **風險**：簡易 token 估算（字元/4）可能不精確 → 採用與既有 `estimateContextPackTokens` 一致策略，後續可更換精確 tokenizer
- **回滾**：所有變更為新增模組 + deprecated 標記，無破壞性變更，回滾只需刪除 `backend/src/context/` 目錄並移除 deprecated 標記
