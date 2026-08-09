# Proposal：add-observability-metrics-tracing

## 問題描述

目前 `backend/src/platform/observability.ts` 提供 `auditLogger` 與 `recordMetric`，但存在以下缺口：

1. **Metrics 缺乏持久化與查詢能力**：`recordMetric` 僅輸出 console log，無結構化儲存、無時間序列查詢、無 Dashboard 消費端點。
2. **缺乏分散式追蹤（Distributed Tracing）**：無 OpenTelemetry 整合，無法跨 BFF → Backend → LangGraph Node → Tool → Model Call 追蹤請求生命週期。
3. **模型 Provider Fault Tolerance 不足**：`backend/src/platform/llm-gateway.ts` 僅支援同 Provider 內部 retry（`maxRetries`），不支援跨 Provider fallback（primary 失敗 → backup provider）。X2 Retry Budget 覆蓋 HTTP-layer Tool 錯誤（timeout/5xx/429），但不覆蓋 Model Provider-layer failure。
4. **無 Cost Tracking**：Token 用量僅存在 AIMessage `usage_metadata`，缺乏彙總與 Dashboard 消費能力。

## 解決方案

建立完整 Agent Runtime 可觀測性，包含三大部分：

### Part A：Metrics + Cost Tracking

- `backend/src/platform/metrics/`：四層檢測點（Task / Step / Tool / Token）、Metrics Collector（in-memory time-series buffer）、Metrics REST 端點（透過 LangGraph `http.app` 機制掛載，使用內建 Hono，無需額外 HTTP server dependency）
- `bff/`：Metrics API Proxy Route（`/api/metrics` → Backend）
- Cost Tracking：Token cost、Model cost、Tool cost 計算與彙總

### Part B：OpenTelemetry Distributed Tracing

- `backend/src/platform/tracing/`：OTel SDK 初始化、Span Manager、Span 輔助工廠
- Span 階層：`BFF Span → Backend Span → LangGraph Node Span → Model Call Span / Tool Call Span`
- 每個 Span 附帶 `taskId` / `stepId` / `toolCallId` attributes

### Part C：Model Provider Fault Tolerance

- `backend/src/platform/llm-gateway.ts`：擴充 `ChatModelInvoker` 支援 fallback provider chain
- Structured Output Parse Error 修復迴圈（區分 parse error / validation error / refusal）
- `ModelFallbackPolicy` 設定：primary provider、fallback providers、max attempts、repair strategy

## 受影響套件與能力域

| 套件 | 能力域 | 變更類型 |
|------|--------|---------|
| backend | 可觀測性 Metrics | 新增 `backend/src/platform/metrics/` 模組、修改 `backend/langgraph.json`（新增 `http.app`） |
| backend | 分散式追蹤 | 新增 `backend/src/platform/tracing/` 模組 |
| backend | Model Provider Fault Tolerance | 修改 `backend/src/platform/llm-gateway.ts` |
| backend | Runtime Config | 新增 OTel exporter endpoint、metrics retention 等 env key |
| bff | Metrics API Route | 新增 `/api/metrics` proxy route |
| bff | Config | 新增 metrics 相關 env key |

## 目標

- 建立四層 Metrics 檢測（Task / Step / Tool / Token）不影響正常 Agent 流程
- Metrics 端點可供 Dashboard 消費（in-memory time-series，無外部 dependency）
- Cost 計算與實際 Token 用量一致
- OTel trace span 覆蓋完整鏈路：BFF → Backend → LangGraph → Tool → Model
- Model Provider 故障時正確 fallback 到 backup provider
- Structured Output parse failure 正確進入 repair loop
- 向後相容：既有 agent 不受影響，`recordMetric` 保留並升級

## 非目標

- 不引入 Prometheus / Grafana / Jaeger 等外部基礎設施（提供 REST 端點供現有 Dashboard 消費，OTel exporter 為 optional 設定）
- 不修改 LangGraph State schema
- 不修改 Frontend（metrics 由 Dashboard 端點消費，非直接嵌入 UI）
- 不修改 Tool 實作（metrics 透過檢測層收集，不侵入 Tool 內部）
- Part C 不覆蓋 MCP Tool 的 provider fallback（限於 LLM model provider）

## 風險與回滾策略

- **風險**：In-memory metrics buffer 可能因 process restart 遺失 → 設計為 latest-only snapshot，不作為持久記錄（持久審計由 `auditLogger` 處理）
- **風險**：OTel SDK overhead 可能影響效能 → 預設 disabled，透過 `OTEL_ENABLED` 開關控制
- **風險**：Model fallback 增加 latency → fallback attempts 受 `maxTotalAttempts` 硬限制，單次 primary timeout 後最多嘗試 2 個 fallback
- **回滾**：所有變更為新增模組或 optional feature flag 控制，`OTEL_ENABLED=false` 即關閉 tracing，fallback 預設 empty list 即無行為變更
