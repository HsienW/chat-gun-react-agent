# Tasks：integrate-opik-agent-tracing-evaluation

## Phase A：Opik Agent Tracing

### Task A.1：新增 Opik dependency 與 config

- [x] **前置步驟**：確認 `opik` npm package 存在、版本號、TypeScript type export，並記錄實際 API 表面與 design interface（OpikClient、OpikTrace、OpikSpan）的 mapping。若 package 不存在或不支援 TypeScript，觸發 OTel export fallback 路徑。
- [x] 在 `backend/package.json` 新增 `opik` dependency（`^1.x`）
- [x] 在 `backend/src/platform/runtime-config.ts` 新增 Opik 相關 env key 與 type
  - `OPIK_ENABLED`、`OPIK_API_KEY`、`OPIK_WORKSPACE`、`OPIK_HOST`、`OPIK_PROJECT_NAME`、`OPIK_REDACT_ENABLED`
- [x] 所有 Opik env key 有預設值、型別與註解

**對應 Spec：** `opik-tracing` / Opik Client 初始化與配置
**驗證：** `npm run build` 通過

---

### Task A.2：實作 Opik Setup Module

- [x] 建立 `backend/src/platform/tracing/opik/opik-setup.ts`
  - `OpikConfig` interface
  - `initOpik(config: OpikConfig): OpikInitResult`（lazy initialization、idempotent）
  - Graceful degradation：SDK 未安裝 → no-op、API key 未設定 → no-op + warn、API 無法連線 → no-op + warn
- [x] Opik client 使用 dynamic import（`import("opik")`），避免 import-time side effect
- [x] 建立 `backend/src/platform/tracing/opik/opik-setup.test.ts`
  - `OPIK_ENABLED=false` → no-op
  - API key 未設定 → no-op + warn
  - SDK import 失敗 → no-op + warn

**對應 Spec：** `opik-tracing` / Opik Client 初始化與配置
**驗證：** `cd backend && npm run lint && npm run test && npm run build` 通過

---

### Task A.3：實作 Opik Redaction Layer

- [x] 建立 `backend/src/platform/tracing/opik/opik-redaction.ts`
  - `sanitizeSpanInput(input: unknown): unknown`
  - `sanitizeSpanOutput(output: unknown): unknown`
  - `sanitizeMetadata(metadata: Record<string, unknown>): Record<string, unknown>`
- [x] Redaction rules：
  - API Key / Token / Secret → `[redacted]`
  - 完整 Prompt → `[prompt:sha256hash]`
  - Email → `[email]`、Phone → `[phone]`
  - Correlation ID（taskId、stepId、toolCallId 等）→ 保留不變
- [x] 複用 `span-manager.ts` 的 `sanitizeErrorMessage` 邏輯
- [x] 建立 `backend/src/platform/tracing/opik/opik-redaction.test.ts`
  - API key 被 redact
  - Prompt 被替換為 hash
  - PII 被遮蔽
  - Correlation ID 保留

**對應 Spec：** `opik-tracing` / Redaction
**驗證：** `cd backend && npm run lint && npm run test && npm run build` 通過

---

### Task A.4：實作 OpikTracer

- [x] 建立 `backend/src/platform/tracing/opik/opik-tracer.ts`
  - `OpikTracer` interface
  - `createOpikTracer(config: OpikConfig): OpikTracer`
  - `traceAgentRun()`：建立 root trace → 包裝 execution callback → 回傳結果
  - `withNodeSpan()`：LangGraph node 層級的 span wrapper
  - `withLlmSpan()`：LLM call 層級的 span wrapper
  - `withToolSpan()`：Tool execution 層級的 span wrapper
- [x] Span metadata 包含 `threadId`、`runId`、`taskId`、`stepId`、`toolCallId`
- [x] 透過 Feature Flag（`OPIK_ENABLED`）切換 NoopOpikTracer 與 RealOpikTracer
- [x] 建立 `backend/src/platform/tracing/opik/opik-tracer.test.ts`
  - Disabled → no-op（不建立 trace）
  - Span hierarchy 正確（agent → node → llm/tool）
  - Span 失敗不影響 execution callback 回傳

**對應 Spec：** `opik-tracing` / Trace 階層、Correlation ID Mapping、檢測點不影響正常流程
**驗證：** `cd backend && npm run lint && npm run test && npm run build` 通過

---

### Task A.5：在 Agent Graph 中接入 OpikTracer

- [x] 在 LangGraph agent graph entry 呼叫 `OpikTracer.traceAgentRun()`
- [x] 在關鍵 node 中接入 `withNodeSpan()`
- [x] 在 `TracedChatModelInvoker`（`llm-gateway.ts`）加入 Opik span（與既有 OTel span 並存）
- [x] 在 Tool execution wrapper 加入 Opik span
- [x] 確保 Opik span 與 OTel span 互不干擾（各自獨立建立 context）

**對應 Spec：** `opik-tracing` / 與 X8 OTel 共存
**驗證：** 
  - `cd backend && npm run lint && npm run test && npm run build` 通過
  - 執行一個 Weather Agent → Opik trace 與 OTel trace 各自獨立產生

---

### Task A.6：執行完整 Agent Run 並驗證 Opik UI

- [x] 設定 `OPIK_ENABLED=true` + 有效 API key
- [x] 執行至少一個完整 Weather Agent run
- [ ] 在 Opik UI 中確認：
  - Trace hierarchy：`agent.weather` → `node.*` → `llm.call` / `tool.execute`
  - Span metadata 包含 correlation ID（threadId、runId、taskId、stepId）
  - Duration 正確
  - Token usage 可見（若有）
  - Error span 正確標記（若 agent 失敗）
- [ ] 確認 redaction 生效：無 secret、無完整 prompt、無 PII 出現在 Opik UI

**對應 Spec：** `opik-tracing` / Trace 階層、Redaction
**驗證：**
  - Opik UI 截圖 + 手動驗證（手動）
  - 新增 `opik-tracer.integration.test.ts`：使用 mock Opik client，驗證完整 trace hierarchy 結構（agent → node → llm/tool）、metadata 正確性、redaction 生效（自動化）

---

## Phase B：Opik Evaluation Pipeline

### Task B.1：建立 Evaluation Dataset

- [x] 建立 `backend/src/evaluation/opik/dataset.ts`
  - `createWeatherGoldenDataset(version: string): Promise<EvaluationDataset>`
  - 從 `weather-golden-eval.ts` 讀取 golden case
  - Redact 每個 item 的 input（移除 raw prompt、PII）
  - 上傳至 Opik 作為 versioned dataset
- [x] 建立 `backend/src/evaluation/opik/dataset.test.ts`
  - Dataset version 與內容正確
  - Dataset item 不含 PII
  - Version 衝突處理

**對應 Spec：** `opik-evaluation` / Dataset 建立與版本管理
**驗證：** `cd backend && npm run lint && npm run test && npm run build` 通過

---

### Task B.2：實作 Deterministic Metric

- [x] 建立 `backend/src/evaluation/opik/metrics/tool-call-correctness.ts`
  - `ToolCallCorrectnessMetric` class
  - 比較 actual tool calls vs expected tool calls
  - Partial match 支援（tool name match 但 arguments 部分 match）
  - Score 0.0–1.0
- [x] 建立 `backend/src/evaluation/opik/metrics/tool-call-correctness.test.ts`
  - 完全符合 → 1.0
  - 城市不符合 → < 1.0
  - 無 tool call → 0.0

**對應 Spec：** `opik-evaluation` / Deterministic Metric
**驗證：** `cd backend && npm run lint && npm run test && npm run build` 通過

---

### Task B.3：實作 LLM-as-Judge Metric

- [x] 建立 `backend/src/evaluation/opik/metrics/response-quality.ts`
  - `ResponseQualityMetric` class
  - Judge config 必須 versioned（prompt template hash）
  - Judge temperature forced to 0
  - Judge 輸出包含 score (0.0–1.0) + reasoning
  - Judge 失敗處理（model unavailable → mark FAILED）
- [x] 建立 `backend/src/evaluation/opik/metrics/response-quality.test.ts`
  - 高品質回應 → >= 0.8
  - 不相關回應 → < 0.5
  - Judge model 無法連線 → 標記 FAILED 不 crash

**對應 Spec：** `opik-evaluation` / LLM-as-Judge Metric
**驗證：** `cd backend && npm run lint && npm run test && npm run build` 通過

---

### Task B.4：實作 Experiment Runner

- [x] 建立 `backend/src/evaluation/opik/experiment.ts`
  - `runExperiment(config: ExperimentConfig): Promise<ExperimentResult>`
  - 步驟：load dataset → for each item → run agent → compute metrics → write feedback to Opik trace
  - Experiment result 記錄：dataset version、agent config、judge config、metric scores、trace IDs、timestamp
- [x] 支援相同 dataset version 但不同 agent config 的兩次 experiment 比較
- [x] 建立 `backend/src/evaluation/opik/experiment.test.ts`
  - 相同 config → 結果可比較
  - 不同 model → 可並排比較
  - Experiment result 記錄完整 config

**對應 Spec：** `opik-evaluation` / Experiment 可重現性、Trace-backed Evaluation
**驗證：** `cd backend && npm run lint && npm run test && npm run build` 通過

---

### Task B.5：執行 Evaluation Experiment

- [x] 以 dataset version `v1.0.0` 執行至少一次完整 experiment
- [x] 以不同 model/prompt config 執行第二次 experiment
- [ ] 在 Opik UI 中確認：
  - 兩次 experiment 並排比較
  - Each metric score 可追溯至特定 trace
  - Judge reasoning 可見
- [x] 記錄 judge config（model、prompt version、temperature）

**對應 Spec：** `opik-evaluation` / Experiment 可重現性
**驗證：** Opik UI 截圖 + Experiment result 檔案

---

## Phase C：決策記錄

### Task C.1：撰寫 Opik Integration 決策記錄

- [x] 建立 `docs/decisions/opik-integration-assessment.md`
- [x] 記錄以下維度：
  - **Operational cost**：SDK overhead（ms）、API call 次數、hosted service cost
  - **Trace latency/overhead**：啟用 Opik 前後的 agent latency 比較
  - **Debugging usefulness**：與僅使用 OTel（X8）相比的除錯效率提升
  - **Evaluation usefulness**：Dataset + experiment workflow 對品質保證的價值
  - **Data-governance constraints**：哪些資料類別不能 export、redaction 缺口
  - **Gaps compared with X8 OTel**：哪些場景 Opik 不足、哪些場景 OTel 不足
- [x] 明確建議：採用（production + dev）、僅保留為 dev tool、或拒絕
- [x] 若建議採用，記錄 migration path（從 trial 到 production 的條件）

**驗證：** 文件經 review 通過

---

## 相依性

| Task | 依賴 |
|------|------|
| A.2 | A.1（dependency 已新增） |
| A.3 | A.2（Opik config 已可用） |
| A.4 | A.2、A.3（redaction layer 已可用） |
| A.5 | A.4（OpikTracer 已實作） |
| A.6 | A.5（Agent graph 已接入） |
| B.1 | A.1（Opik dependency）、既有 `weather-golden-eval.ts` |
| B.2 | 無（純 deterministic，不依賴 Opik 連線） |
| B.3 | 無（pure function + LLM call，不依賴 Opik dataset） |
| B.4 | B.1、B.2、B.3（dataset + metrics 已可用） |
| B.5 | B.4、A.6（experiment runner + Opik tracing 已可用） |
| C.1 | A.6、B.5（trial 結果已產出） |

## 建議執行順序

1. A.1 → A.2 → A.3（setup + redaction，可平行）
2. A.4 → A.5 → A.6（tracer → integration → 驗證）
3. B.1 ← → B.2 ← → B.3（dataset + metrics，可平行於 Phase A 之後）
4. B.4 → B.5（experiment runner → 執行）
5. C.1（彙整所有結果後撰寫）
