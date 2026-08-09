# Spec：OpenTelemetry Distributed Tracing

## ADDED Requirements

### Requirement: OTel SDK 初始化與配置

Backend MUST 支援透過環境變數控制 OTel SDK 啟動與 exporter 配置，預設為 disabled。

#### Scenario: OTEL_ENABLED=false 時不啟動 SDK

- **GIVEN** `OTEL_ENABLED` 設為 `false` 或未設定
- **WHEN** Backend 啟動
- **THEN** OTel SDK 不啟動
- **AND** `SpanManager.startSpan()` 回傳 no-op span
- **AND** 不嘗試連接 OTLP exporter

#### Scenario: OTEL_ENABLED=true 且 exporter endpoint 已設定時啟動

- **GIVEN** `OTEL_ENABLED=true`, `OTEL_EXPORTER_OTLP_ENDPOINT=http://jaeger:4318/v1/traces`, `OTEL_EXPORTER_OTLP_PROTOCOL=http`
- **WHEN** Backend 啟動
- **THEN** OTel SDK 初始化成功
- **AND** Span 被正確 export 至 OTLP collector

#### Scenario: OTEL_ENABLED=true 但無 exporter endpoint

- **GIVEN** `OTEL_ENABLED=true`，`OTEL_EXPORTER_OTLP_ENDPOINT` 為空
- **WHEN** Backend 啟動
- **THEN** OTel SDK 初始化但使用 ConsoleSpanExporter
- **AND** Span 輸出至 console 而非遠端 collector
- **AND** ConsoleSpanExporter MUST 僅用於 local debug；生產環境 MUST 設定 `OTEL_EXPORTER_OTLP_ENDPOINT` 或保持 `OTEL_ENABLED=false` 以避免大量 console span 輸出

---

### Requirement: Span 階層

Span hierarchy MUST 反映完整請求鏈路：BFF → Backend → LangGraph Node → Model Call / Tool Call。

#### Scenario: 完整 Span 階層

- **GIVEN** OTel tracing 已啟用且 Dashboard 發起一個 Agent 請求
- **WHEN** 請求完整執行（LangGraph Node → Model Call → Tool Call）
- **THEN** 產生的 span tree 包含：
  - Root: `bff.proxy`（parent）
  - Child: `langgraph.invoke`（backend）
  - Child: `langgraph.node.{nodeName}`（LangGraph node）
  - Child: `llm.call`（model invocation）
  - Child: `tool.execute`（tool invocation）

#### Scenario: Span 帶有正確 attributes

- **GIVEN** 一個 `llm.call` span
- **WHEN** Model call 完成
- **THEN** span attributes 包含 `service.name`, `model.name`, `model.provider`, `task.id`, `step.id`
- **AND** 若 model call 失敗，span 包含 `error.type` 與 `error.message`

#### Scenario: W3C TraceContext 跨 BFF/Backend

- **GIVEN** BFF 收到帶有 `traceparent` header 的請求
- **WHEN** BFF proxy 轉發至 Backend
- **THEN** `traceparent` header 被保留並傳遞至 Backend
- **AND** Backend span 正確繼承 BFF span 的 trace context

---

### Requirement: SpanManager API

系統 MUST 提供 `SpanManager` 抽象，隔離 OTel API 細節。

#### Scenario: startSpan 建立新 span

- **GIVEN** OTel tracing 已啟用
- **WHEN** `spanManager.startSpan("tool.execute", { attributes: { "tool.name": "web_search" } })` 被呼叫
- **THEN** 回傳 active span，attributes 包含 tool.name
- **AND** span 自動成為目前 active span 的 child

#### Scenario: endSpan 結束 span

- **GIVEN** 一個 active span
- **WHEN** `spanManager.endSpan(span)` 被呼叫
- **THEN** span 結束，duration 被記錄
- **AND** span 被 export 至 OTLP collector

#### Scenario: recordException 記錄錯誤

- **GIVEN** 一個 active span 且 model call 拋出異常
- **WHEN** `spanManager.recordException(span, error)` 被呼叫
- **THEN** span 記錄 exception event 包含 error type 與 message
- **AND** span status 設為 ERROR

#### Scenario: OTel disabled 時 no-op

- **GIVEN** `OTEL_ENABLED=false`
- **WHEN** 任何 `spanManager.*` 方法被呼叫
- **THEN** 所有方法為 no-op（不拋錯、不記錄）
- **AND** `getActiveSpan()` 回傳 undefined

---

### Requirement: 檢測點不影響正常流程

Span 操作 MUST NOT 影響 Agent 執行流程。Span 建立或結束失敗 MUST be silently ignored。

#### Scenario: Span 操作失敗不阻斷 Agent flow

- **GIVEN** OTel SDK 初始化失敗或 exporter 無法連線
- **WHEN** Agent 執行中呼叫 `startSpan()` 或 `endSpan()`
- **THEN** Agent 執行流程不受影響
- **AND** 錯誤以 console.warn 記錄（不拋出例外）

#### Scenario: 無 parent span 時建立 root span

- **GIVEN** 目前沒有 active span
- **WHEN** `startSpan("langgraph.invoke")` 被呼叫
- **THEN** 建立一個新的 root span
- **AND** 不拋出錯誤

---

### Requirement: Tracing 與 Metrics 獨立

OTel tracing 與 Metrics 收集 MUST 為兩個獨立系統，互不耦合。

#### Scenario: OTel disabled 時 metrics 仍正常

- **GIVEN** `OTEL_ENABLED=false`，`AGENT_METRICS_ENABLED=true`
- **WHEN** Agent 執行
- **THEN** Metrics 正常收集與回傳
- **AND** 無任何 Span 被建立

#### Scenario: Metrics disabled 時 tracing 仍正常

- **GIVEN** `AGENT_METRICS_ENABLED=false`，`OTEL_ENABLED=true`
- **WHEN** Agent 執行
- **THEN** Span 正常建立與 export
- **AND** MetricsCollector 不收集任何資料
