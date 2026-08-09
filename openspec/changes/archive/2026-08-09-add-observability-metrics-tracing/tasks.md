# Tasks：add-observability-metrics-tracing

## Part A：Metrics + Cost Tracking

- [x] **A.1** 建立 MetricsCollector 與 MetricEntry 型別
  - **Owner**：Codex
  - **Requirement**：四層 Metrics 檢測、Cost Tracking
  - **Scope**：新增 `backend/src/platform/metrics/metrics-collector.ts`
  - **驗證**：
    ```bash
    cd backend
    npx vitest run src/platform/metrics/metrics-collector.test.ts
    ```

- [x] **A.2** 實作四層檢測函式（recordTaskMetric / recordStepMetric / recordToolMetric / recordTokenMetric）
  - **Owner**：Codex
  - **Requirement**：四層 Metrics 檢測
  - **Scope**：新增 `backend/src/platform/metrics/instrumentation.ts`
  - **驗證**：
    ```bash
    cd backend
    npx vitest run src/platform/metrics/instrumentation.test.ts
    ```

- [x] **A.3** 實作 Cost Tracking（computeTokenCost + TokenRate）
  - **Owner**：Codex
  - **Requirement**：Cost Tracking
  - **Scope**：新增 `backend/src/platform/metrics/cost-tracker.ts`
  - **驗證**：
    ```bash
    cd backend
    npx vitest run src/platform/metrics/cost-tracker.test.ts
    ```

- [x] **A.4** 實作 Metrics REST 端點（GET /metrics → MetricsSnapshot）
  - **Owner**：Codex
  - **Requirement**：Metrics Snapshot API
  - **Scope**：
    - 新增 `backend/src/platform/metrics/metrics-endpoint.ts`（export Hono app `metricsApp`，註冊 `GET /metrics` route）
    - 修改 `backend/langgraph.json`（新增 `"http": { "app": "./src/platform/metrics/metrics-endpoint.ts:metricsApp" }`）
    - 若 `hono` 尚未作為 direct dependency，新增至 `backend/package.json`（使用 `^4` semver，與 `@langchain/langgraph-api` 一致；hono 已是 transitive dependency，無需實際安裝新套件）
    - 掛載機制：利用 `@langchain/langgraph-api` 內建 `http.app` → `registerHttp()` → `app.route("/", api)` 自動註冊，無需建立獨立 HTTP server
  - **驗證**：
    ```bash
    cd backend
    npx vitest run src/platform/metrics/metrics-endpoint.test.ts
    ```

- [x] **A.5** 升級既有 recordMetric 寫入 MetricsCollector
  - **Owner**：Codex
  - **Requirement**：向下相容現有 observability API
  - **Scope**：修改 `backend/src/platform/observability.ts`
  - **驗證**：既有 `observability.test.ts` 仍通過，新增 metrics-collector 整合測試

- [x] **A.6** 新增 Runtime Config（AGENT_METRICS_* env keys）
  - **Owner**：Codex
  - **Requirement**：Metrics config
  - **Scope**：修改 `backend/src/platform/runtime-config.ts`
  - **驗證**：config 讀取測試

- [x] **A.7** BFF 新增 /api/metrics proxy route（含認證與測試）
  - **Owner**：Codex
  - **Requirement**：BFF Metrics Proxy
  - **Scope**：修改 `bff/src/server.ts`、`bff/src/config.ts`；新增 BFF metrics proxy 單元測試
  - **驗證**：
    ```bash
    cd bff
    npm run build
    ```
  - **測試覆蓋**：
    - 認證通過 → proxy 轉發至 Backend metrics endpoint（mock）
    - 未認證 → 回傳 401
    - Backend metrics endpoint 失敗 → 回傳適當 status code

---

## Part B：OpenTelemetry Distributed Tracing

- [x] **B.1** 建立 OTel SDK 初始化模組（含 npm 依賴安裝）
  - **Owner**：Codex
  - **Requirement**：OTel SDK 初始化與配置
  - **Scope**：新增 `backend/src/platform/tracing/otel-setup.ts`、新增 npm 依賴
  - **npm 依賴**：
    ```bash
    cd backend
    npm install @opentelemetry/api @opentelemetry/sdk-trace-node @opentelemetry/exporter-trace-otlp-http
    ```
  - **驗證**：
    ```bash
    cd backend
    npx vitest run src/platform/tracing/otel-setup.test.ts
    ```

- [x] **B.2** 建立 SpanManager 抽象層
  - **Owner**：Codex
  - **Requirement**：SpanManager API
  - **Scope**：新增 `backend/src/platform/tracing/span-manager.ts`
  - **驗證**：
    ```bash
    cd backend
    npx vitest run src/platform/tracing/span-manager.test.ts
    ```

- [x] **B.3** 實作 Tracing Config（OTEL_* env keys）
  - **Owner**：Codex
  - **Requirement**：OTel 配置
  - **Scope**：修改 `backend/src/platform/runtime-config.ts`
  - **驗證**：config 讀取測試

- [x] **B.4** 在所有 agent graph nodes 插入 Span 檢測點（Phase 1）
  - **Owner**：Codex
  - **Requirement**：Span 階層、檢測點不影響正常流程
  - **Phase 1 Scope**：`backend/src/agents/deep-researcher.ts`（主要 agent，graph nodes 最多）
  - **Phase 2（後續）**：chatbot、math-agent、mcp-agent（輕量 wrapper，span 檢測點較少，由 Phase 1 建立模式後再推廣）
  - **已知限制**：Phase 1 僅覆蓋 deep-researcher，其他 agent 的 tracing 列為後續增強（不影響 blocker）
  - **驗證**：既有 deep-researcher 測試通過，新增 tracing 整合測試

- [x] **B.5** BFF Trace Context Propagation（W3C TraceContext）
  - **Owner**：Codex
  - **Requirement**：Span 階層（W3C TraceContext 跨 BFF/Backend）
  - **Scope**：修改 `bff/src/server.ts`
  - **實作要點**：
    1. 從 incoming request 提取 `traceparent` / `tracestate` header
    2. 將 `traceparent` / `tracestate` inject 到轉發至 Backend 的 request headers（`copyRequestHeaders` → `FORWARDED_REQUEST_HEADERS` 擴充）
    3. 若 incoming request 無 `traceparent`，不強制產生（讓 Backend 建立 root span）
  - **驗證**：BFF build + 手動驗證 traceparent header 穿透（或 server integration test）

---

## Part C：Model Provider Fault Tolerance

- [x] **C.1** 實作 ModelFallbackPolicy 與 FallbackChatModelInvoker
  - **Owner**：Codex
  - **Requirement**：Provider Fallback Routing
  - **Scope**：新增 `backend/src/platform/llm-fallback.ts`
  - **驗證**：
    ```bash
    cd backend
    npx vitest run src/platform/llm-fallback.test.ts
    ```

- [x] **C.2** 實作 Structured Output Repair Loop
  - **Owner**：Codex
  - **Requirement**：Structured Output Repair Loop
  - **Scope**：新增 `backend/src/platform/structured-output-repair.ts`
  - **驗證**：
    ```bash
    cd backend
    npx vitest run src/platform/structured-output-repair.test.ts
    ```

- [x] **C.3** 擴充 LlmGateway 新增 createChatModelWithFallback
  - **Owner**：Codex
  - **Requirement**：LLVM Gateway 向下相容
  - **Scope**：修改 `backend/src/platform/llm-gateway.ts`
  - **驗證**：既有 `llm-gateway.test.ts` 通過，新增 fallback 整合測試

- [x] **C.4** 新增 Fallback Config（LLM_FALLBACK_* env keys）
  - **Owner**：Codex
  - **Requirement**：Fallback config
  - **Scope**：修改 `backend/src/platform/runtime-config.ts`
  - **驗證**：config 讀取測試

- [x] **C.5** 實作 Provider Error 分類函式（provider error → category）
  - **Owner**：Codex
  - **Requirement**：Error 分類與計量
  - **Scope**：新增 `backend/src/platform/provider-error-category.ts`（獨立檔案，利於單獨測試與跨模組 reuse）
  - **驗證**：error 分類測試，確認 5xx/429/timeout/parse_error/validation_error/refusal 分類正確

---

## 跨層驗證

- [x] **X.1** 全層整合測試
  - **Owner**：Codex
  - **Requirement**：全部
  - **Scope**：既有 tests + 新增整合測試
  - **關鍵整合測試案例**：
    1. Metrics + Tracing 同時啟用：Agent 執行後 `/metrics` snapshot 正確、Span 完整輸出
    2. Fallback + Metrics 記錄：Primary provider 失敗 → fallback 成功 → `modelFallbackRate` metric 增加
    3. Repair Loop + Span 記錄：Structured output parse 失敗 → repair 成功 → Span 記錄 `repair.attempts`
    4. OTel disabled + Metrics enabled：無 Span、Metrics 正常收集（兩個系統獨立）
    5. 全 provider exhaustion：所有 provider 失敗 → error category 正確 → Metric 記錄
  - **驗證**：
    ```bash
    cd backend
    npm run lint
    npm run test
    npm run build
    cd ../bff
    npm run build
    ```

---

## 驗證摘要

| Requirement | Tasks | 驗證方式 |
|-------------|-------|---------|
| 四層 Metrics 檢測 | A.1, A.2, A.5 | 單元測試 + 整合測試 |
| Metrics Snapshot API | A.4 | 端點測試 |
| Cost Tracking | A.3 | 單元測試（費率計算正確性） |
| BFF Metrics Proxy | A.7 | BFF build + 單元測試（認證/proxy/錯誤） |
| OTel SDK 初始化 | B.1, B.3 | 單元測試（enable/disable/exporter）+ npm 依賴 |
| SpanManager API | B.2 | 單元測試（noop + real） |
| Span 階層（Backend） | B.4 | 整合測試（deep-researcher graph, Phase 1） |
| BFF TraceContext Propagation | B.5 | BFF build + traceparent 穿透驗證 |
| Provider Fallback Routing | C.1, C.3, C.4 | 單元測試 + 整合測試 |
| Structured Output Repair | C.2 | 單元測試（parse/validation/refusal/exhausted） |
| Error 分類 | C.5 | 單元測試 |
| 向下相容 | A.5, C.3 | 既有所有 tests 通過 |
