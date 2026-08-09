# Spec：Observability Metrics + Cost Tracking

## ADDED Requirements

### Requirement: 四層 Metrics 檢測

Agent Runtime MUST 在四個層級收集 metrics：Task / Step / Tool / Token，收集失敗 MUST NOT 影響正常 Agent 執行流程。

#### Scenario: Task metric 記錄成功

- **GIVEN** 一個 Agent Task 進入 running 狀態
- **WHEN** `recordTaskMetric()` 被呼叫
- **THEN** 該 metric 寫入 MetricsCollector，包含 taskId、status、ts
- **AND** 即使 collector 內部出錯，Task 執行不受影響（fire-and-forget）

#### Scenario: Tool metric 記錄成功與失敗

- **GIVEN** 一個 Tool 呼叫完成（成功或失敗）
- **WHEN** `recordToolMetric()` 被呼叫
- **THEN** metric 包含 toolName、taskId、stepId、status（success/error/timeout/permission_denied）、durationMs
- **AND** 失敗 Tool 的 status 正確反映 error type

#### Scenario: Token metric 擷取

- **GIVEN** 一個 Model Call 完成且 AIMessage 含有 `usage_metadata`
- **WHEN** `recordTokenMetric()` 被呼叫
- **THEN** metric 包含 inputTokens、outputTokens、totalTokens、model、provider
- **AND** 若 `usage_metadata` 不存在，metric 仍記錄但 token 值為 0

#### Scenario: Metrics 收集不影響 Agent flow

- **GIVEN** MetricsCollector 內部 buffer 已滿或發生錯誤
- **WHEN** 任何 `record*Metric()` 被呼叫
- **THEN** Agent 執行流程不受影響
- **AND** 錯誤被吞掉並以 console.warn 記錄（不拋出例外）

---

### Requirement: Metrics Snapshot API

Backend MUST 提供 REST 端點回傳 metrics 快照，供 Dashboard 消費。

#### Scenario: GET /metrics 回傳快照

- **GIVEN** MetricsCollector 中有 N 筆 metric entries
- **WHEN** `GET /metrics` 被呼叫
- **THEN** 回傳 200 與 `MetricsSnapshot` JSON，包含 tasks/steps/tools/tokens/cost/latency/rates aggregate
- **AND** `snapshotTs` 為快照計算時間

#### Scenario: 空 metrics 回傳零值

- **GIVEN** MetricsCollector 中沒有任何 entries
- **WHEN** `GET /metrics` 被呼叫
- **THEN** 回傳 200 與 zero-value snapshot（總數皆為 0，success rate 為 1.0）

#### Scenario: /metrics 不需認證（內部端點）

- **GIVEN** Metrics endpoint 為 backend 內部端點
- **WHEN** `GET /metrics` 被呼叫
- **THEN** 不需認證（BFF 層負責認證與 proxy）
- **AND** BFF `/api/metrics` 需要認證（與其他 API route 一致）

---

### Requirement: Cost Tracking

系統 MUST 基於 Token 用量與 provider-specific rate 計算模型成本。

#### Scenario: Token cost 計算

- **GIVEN** 一個 Model Call 消耗 inputTokens=1000、outputTokens=500，provider rate 為 input $0.15/1M、output $0.60/1M
- **WHEN** `computeTokenCost()` 被呼叫
- **THEN** 回傳 `{ inputCost: 0.00015, outputCost: 0.0003, totalCost: 0.00045, currency: "USD" }`

#### Scenario: 未知 provider 使用預設費率

- **GIVEN** 一個 provider 不在費率表中
- **WHEN** `computeTokenCost()` 被呼叫
- **THEN** 使用 DEFAULT_TOKEN_RATE 計算（保守估計）
- **AND** metric 標記 `rateSource: "default"`

#### Scenario: Task 完成後彙總成本

- **GIVEN** 一個 Task 包含多個 Step，每個 Step 包含 Model Call 與 Tool Call
- **WHEN** Task 進入 completed 狀態
- **THEN** `recordCostMetric()` 彙總該 Task 的 modelCost + toolCost
- **AND** `CostMetric.breakdown` 區分 modelCost 與 toolCost

---

### Requirement: BFF Metrics Proxy

BFF MUST proxy `/api/metrics` 請求至 Backend metrics 端點，使用既有的認證與限流機制。

#### Scenario: BFF proxy metrics 請求

- **GIVEN** Dashboard 請求 `GET /api/metrics` 經過 BFF
- **WHEN** 認證通過
- **THEN** BFF 轉發請求至 Backend `{AGENT_METRICS_BACKEND_URL}/metrics`
- **AND** 回傳 Backend response（透傳，不修改 body）

#### Scenario: 未認證 metrics 請求被拒絕

- **GIVEN** 請求未攜帶有效 API key
- **WHEN** `GET /api/metrics` 經過 BFF
- **THEN** 回傳 401（同其他 API route）

---

### Requirement: 向下相容現有 observability API

新增模組 MUST NOT 破壞既有的 `auditLogger` 與 `recordMetric` API。

#### Scenario: 既有 recordMetric 仍可運作

- **GIVEN** Metrics module 已啟用
- **WHEN** 既有的 `recordMetric()` 被呼叫
- **THEN** metric 同時寫入新 MetricsCollector（升級，不取代）
- **AND** console log 行為保留

#### Scenario: 既有 auditLogger 不受影響

- **GIVEN** Metrics module 已啟用
- **WHEN** `auditLogger.record()` 被呼叫
- **THEN** 行為與升級前完全相同
