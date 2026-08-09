# Spec：Model Provider Fault Tolerance

## ADDED Requirements

### Requirement: Provider Fallback Routing

當 primary provider 回傳 5xx 或 timeout 時，系統 MUST 依序嘗試 fallback providers。

#### Scenario: Primary 5xx 觸發 fallback

- **GIVEN** fallback 已啟用，`fallbackProviders: ["qwen", "openai-compatible"]`
- **WHEN** primary provider "ccr" 回傳 502
- **THEN** 系統依序嘗試 "qwen"
- **AND** 若 "qwen" 成功，回傳其結果
- **AND** `modelFallbackRate` metric 增加

#### Scenario: 所有 providers 失敗

- **GIVEN** fallback 已啟用，primary 與所有 fallback providers 皆回傳錯誤
- **WHEN** 最後一個 fallback 也失敗
- **THEN** 回傳 `ProviderExhaustedError`，包含所有嘗試過的 provider 與其錯誤
- **AND** Metric 記錄 `modelFallbackExhausted` 事件

#### Scenario: Fallback 未啟用

- **GIVEN** `LLM_FALLBACK_ENABLED=false` 或 `fallbackProviders` 為空
- **WHEN** primary provider 回傳 502
- **THEN** 系統行為與既有相同（per-request retry 後拋出錯誤）
- **AND** 不嘗試任何 fallback

#### Scenario: maxTotalAttempts 限制

- **GIVEN** `maxTotalAttempts=2`，primary + 2 fallback providers
- **WHEN** primary 失敗，第一個 fallback 失敗
- **THEN** 系統不再嘗試第二個 fallback
- **AND** 回傳 `ProviderExhaustedError`

#### Scenario: Per-provider timeout

- **GIVEN** `perProviderTimeoutMs=5000`
- **WHEN** primary provider 5 秒內未回應
- **THEN** 系統中斷 primary 請求
- **AND** 嘗試 fallback provider

---

### Requirement: Structured Output Repair Loop

系統 MUST 區分 parse error、validation error 與 refusal，並依 repairStrategy 進行修復或降級。

#### Scenario: Parse error 修復成功（retry_with_hint）

- **GIVEN** `repairStrategy="retry_with_hint"`，model 回傳 JSON 但 parse 失敗
- **WHEN** Structured output 的 `response_format` 被指定
- **THEN** 系統以原始 error 為 hint 重新呼叫模型
- **AND** 若第二次回傳合法 JSON，回傳 `{ status: "repaired", attempts: 2 }`

#### Scenario: Validation error 修復失敗 → partial

- **GIVEN** model 回傳合法 JSON 但 Zod schema validation 失敗
- **WHEN** `retry_with_hint` 修復嘗試後仍 validation 失敗
- **THEN** 若存在 partial valid fields，回傳 `{ status: "partial", partial: {...}, lastError: "..." }`
- **AND** 若完全無法 parse，進入 fallback（若 fallback 可用）

#### Scenario: Refusal / Content Filter → no retry

- **GIVEN** model 回傳 refusal 或 content filter 訊息
- **WHEN** Structured output parser 檢測到 refusal
- **THEN** 系統不回傳 retry
- **AND** 直接回傳 `{ status: "refusal", output: null }`
- **AND** 不嘗試 fallback（refusal 非 provider 錯誤）

#### Scenario: repairStrategy="none" → 不修復

- **GIVEN** `repairStrategy="none"`，model 回傳無法 parse 的內容
- **WHEN** Structured output parser 失敗
- **THEN** 不回傳 retry
- **AND** 直接回傳 `{ status: "exhausted", output: null }` 或進入 fallback

---

### Requirement: LLVM Gateway 向下相容

新增的 `createChatModelWithFallback` MUST NOT 破壞既有的 `createChatModel` 行為。

#### Scenario: createChatModel 行為不變

- **GIVEN** 既有 agent 使用 `llmGateway.createChatModel(options)`
- **WHEN** fallback 模組已部署
- **THEN** `createChatModel()` 行為與升級前完全相同
- **AND** fallback 預設 false（不影響既有路徑）

#### Scenario: createChatModelWithFallback 可選使用

- **GIVEN** agent 想使用 fallback
- **WHEN** `llmGateway.createChatModelWithFallback(options, fallbackPolicy)` 被呼叫
- **THEN** 回傳的 ChatModelInvoker 包含 fallback chain
- **AND** `createChatModel()` 仍可用於不需要 fallback 的場景

---

### Requirement: Error 分類與計量

Model provider 層級錯誤 MUST 有明確分類，供 Metrics 與 X2 Retry Budget 使用。

#### Scenario: Provider error 分類

- **GIVEN** primary provider 回傳不同類型的錯誤
- **WHEN** 錯誤被分類
- **THEN** 5xx → `provider_unavailable`
- **AND** 429 → `provider_rate_limited`
- **AND** Timeout → `provider_timeout`
- **AND** Parse error → `provider_response_invalid`
- **AND** Validation error → `structured_output_invalid`
- **AND** Refusal → `content_filter_refusal`

#### Scenario: FallbackEvent 記錄

- **GIVEN** fallback 發生
- **WHEN** 系統從 primary 切換至 fallback
- **THEN** 記錄 `model.fallback.attempt` event，包含 fromProvider、toProvider、reason
- **AND** event 透過 auditLogger 記錄（供事後分析）
