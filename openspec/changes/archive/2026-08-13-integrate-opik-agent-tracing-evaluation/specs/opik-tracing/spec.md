# Spec：Opik Agent Tracing

## ADDED Requirements

### Requirement: Opik Client 初始化與配置

Backend MUST 支援透過環境變數控制 Opik client 啟動，預設為 disabled。Opik 連線失敗 MUST NOT 影響正常 Agent 流程。

#### Scenario: OPIK_ENABLED=false 時不啟動 Opik

- **GIVEN** `OPIK_ENABLED` 設為 `false` 或未設定
- **WHEN** Backend 啟動
- **THEN** Opik client 不初始化
- **AND** `OpikTracer.traceAgentRun()` 直接呼叫 execution callback，不建立任何 trace
- **AND** 不嘗試連接 Opik API

#### Scenario: OPIK_ENABLED=true 且 API key 已設定時啟動

- **GIVEN** `OPIK_ENABLED=true`，`OPIK_API_KEY` 已設定，`OPIK_WORKSPACE` 已設定
- **WHEN** Backend 啟動
- **THEN** Opik client 初始化成功
- **AND** `OpikTracer.traceAgentRun()` 建立完整的 Opik trace hierarchy

#### Scenario: OPIK_ENABLED=true 但 API key 未設定

- **GIVEN** `OPIK_ENABLED=true`，`OPIK_API_KEY` 為空
- **WHEN** Backend 啟動
- **THEN** console.warn 記錄 "Opik enabled but OPIK_API_KEY not configured"
- **AND** Opik client 降級為 no-op
- **AND** 不拋出例外

#### Scenario: Opik API 無法連線

- **GIVEN** Opik client 已初始化但 Opik API 無法連線
- **WHEN** Agent 執行中呼叫 `traceAgentRun()`
- **THEN** console.warn 記錄連線失敗
- **AND** Agent 執行流程不受影響
- **AND** `execution()` callback 仍被呼叫並回傳結果

---

### Requirement: Trace 階層

Opik trace hierarchy MUST 反映 Agent 執行階層：Agent → LangGraph Node → LLM Call / Tool Call。

#### Scenario: 完整 Trace 階層

- **GIVEN** Opik tracing 已啟用且執行一個 Weather Agent 請求
- **WHEN** 請求完整執行（agent node → LLM call → tool call → LLM call → response）
- **THEN** Opik trace 包含：
  - Root: `agent.weather` trace（metadata: threadId, runId, taskId）
  - Child span: `node.{nodeName}`（metadata: stepId, nodeName）
  - Child span: `llm.call`（metadata: model.name, model.provider, inputTokens, outputTokens）
  - Child span: `tool.execute`（metadata: toolName, toolCallId, durationMs, status）

#### Scenario: Agent 失敗時的 Error Span

- **GIVEN** Opik tracing 已啟用且 Agent 執行中發生錯誤
- **WHEN** LLM call 拋出例外或 tool execution 失敗
- **THEN** 對應 span 的 metadata 包含 error.type 與 error.message
- **AND** Trace status 標記為 failed
- **AND** Error message 經過 redaction（不含 secret/key/token）

#### Scenario: Retry 紀錄

- **GIVEN** Agent 執行中 tool call 失敗並觸發 retry
- **WHEN** Retry executor 執行
- **THEN** 產生 `retry.attempt` span（metadata: attempt, reason, stepId）
- **AND** Retry span 為失敗的 tool span 的 sibling（非 child）

---

### Requirement: Correlation ID Mapping

Opik trace/span metadata MUST 保留專案 correlation ID，不改變既有語意。

#### Scenario: Trace metadata 包含所有 correlation ID

- **GIVEN** 一個 Agent run 具有 `threadId`、`runId`、`taskId`
- **WHEN** Opik trace 建立
- **THEN** Trace metadata 包含 `threadId`、`runId`、`taskId`
- **AND** 每個 child span 繼承 parent 的 correlation ID
- **AND** LLM span 額外包含 `stepId`
- **AND** Tool span 額外包含 `stepId` 與 `toolCallId`

#### Scenario: Correlation ID 不改變既有語意

- **GIVEN** Opik tracing 已啟用
- **WHEN** Agent 執行
- **THEN** `threadId`、`runId`、`taskId`、`stepId`、`toolCallId` 的值與未啟用 Opik 時完全相同
- **AND** Opik 不修改、不覆寫、不生成新的 correlation ID

---

### Requirement: Redaction

Span input/output 與 metadata MUST 經過 redaction 後才傳送至 Opik。MUST NOT 傳送 secret、完整 prompt、unmasked PII 或未過濾 raw tool output。

#### Scenario: API Key 被 redact

- **GIVEN** Span input 包含 `{ "authorization": "Bearer sk-abc123" }`
- **WHEN** Redaction layer 處理
- **THEN** Output 為 `{ "authorization": "[redacted]" }`
- **AND** API Key 原始值不被傳送至 Opik

#### Scenario: 完整 Prompt 被替換為 hash

- **GIVEN** Span input 的欄位 key 為 `system`、`prompt`、`systemPrompt`、`messages` 或 `instructions`（prompt 相關欄位）
- **WHEN** Redaction layer 處理
- **THEN** 該欄位的值被替換為 prompt template name 或 SHA-256 hash
- **AND** 完整 prompt 原文不被傳送至 Opik
- **AND** Redaction 基於 field key 判斷，而非字元長度

#### Scenario: PII 被遮蔽

- **GIVEN** Span output 包含 email `user@example.com` 與 phone `+886-912-345-678`
- **WHEN** Redaction layer 處理
- **THEN** Email 被替換為 `[email]`
- **AND** Phone 被替換為 `[phone]`
- **AND** 原始 PII 不被傳送至 Opik

#### Scenario: Redaction 不影響 CORRELATION ID

- **GIVEN** Span metadata 包含 `taskId: "task-abc-123"`
- **WHEN** Redaction layer 處理
- **THEN** `taskId` 保持 `"task-abc-123"` 不變
- **AND** Correlation ID 不被 redact

---

### Requirement: 與 X8 OTel 共存

Opik tracing 與 X8 OTel tracing MUST 為兩個獨立系統，互不干擾、不產生重複 logical span。

#### Scenario: Opik 與 OTel 同時啟用

- **GIVEN** `OPIK_ENABLED=true`，`OTEL_ENABLED=true`
- **WHEN** Agent 執行
- **THEN** Opik trace 與 OTel trace 各自獨立產生
- **AND** Opik spans 不干擾 OTel span context
- **AND** OTel spans 不干擾 Opik trace context
- **AND** 同一個 LLM call 在兩個系統中各有一個 span（各自獨立，不互為 parent/child）

#### Scenario: Opik enabled 但 OTel disabled

- **GIVEN** `OPIK_ENABLED=true`，`OTEL_ENABLED=false`
- **WHEN** Agent 執行
- **THEN** Opik traces 正常產生
- **AND** OTel 無任何 span 產生

#### Scenario: OTel enabled 但 Opik disabled

- **GIVEN** `OTEL_ENABLED=true`，`OPIK_ENABLED=false`
- **WHEN** Agent 執行
- **THEN** OTel spans 正常產生
- **AND** Opik 無任何 trace 產生

---

### Requirement: 平行執行的 Trace Isolation

當多個 Agent 平行執行時，Opik trace 的 parent-child 關係 MUST 正確隔離，不產生交錯或錯誤歸屬。

#### Scenario: 兩個 Agent 平行執行

- **GIVEN** Opik tracing 已啟用且兩個 Agent（如 Weather + Deep Research）平行執行
- **WHEN** 兩個 Agent 各自建立 Opik trace
- **THEN** 每個 trace 的 span hierarchy 獨立且完整
- **AND** Agent A 的 span 不會錯誤歸屬到 Agent B 的 trace
- **AND** Correlation ID（threadId、runId）正確區分兩個 Agent
- **AND** Trace context 不跨 Agent 洩漏

#### Scenario: 同 Agent 內平行 Tool Call

- **GIVEN** 一個 Agent run 內同時呼叫兩個 tool
- **WHEN** 兩個 tool 平行執行
- **THEN** 兩個 tool span 為同一 parent node span 的 children
- **AND** 各自 toolCallId 獨立且正確

---

### Requirement: 檢測點不影響正常流程

Opik span 操作 MUST NOT 影響 Agent 執行流程。Span 建立或結束失敗 MUST be silently ignored。

#### Scenario: Opik span 操作失敗不阻斷 Agent flow

- **GIVEN** Opik client 初始化成功但中途 span.end() 拋出例外
- **WHEN** Agent 執行中
- **THEN** 例外被 catch 且以 console.warn 記錄
- **AND** Agent 執行流程不受影響
- **AND** 已建立的 spans 盡力完成 end

#### Scenario: Opik SDK 動態 import 失敗

- **GIVEN** `OPIK_ENABLED=true` 但 `opik` package 未安裝
- **WHEN** Backend 嘗試初始化 Opik client
- **THEN** 動態 import 失敗被 catch
- **AND** console.warn 記錄 "Opik SDK not available, tracing disabled"
- **AND** 降級為 no-op
- **AND** Agent 執行不受影響
