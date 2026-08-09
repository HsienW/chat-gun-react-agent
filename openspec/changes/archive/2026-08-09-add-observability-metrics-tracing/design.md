# Design：add-observability-metrics-tracing

## 責任邊界

### Backend

- **Metrics Module** (`backend/src/platform/metrics/`)：四層檢測點、In-memory time-series collector、Metrics REST 端點（透過 LangGraph `http.app` 機制掛載 Hono app，必要時將 `hono` 加入 direct dependency）
- **Tracing Module** (`backend/src/platform/tracing/`)：OTel SDK 初始化、Span Manager、輔助工廠
- **LLM Gateway** (`backend/src/platform/llm-gateway.ts`)：擴充 fallback provider chain、structured output repair loop
- **Runtime Config**：新增 OTel / Metrics / Fallback 相關 env key
- **LangGraph Config** (`backend/langgraph.json`)：新增 `http.app` 欄位，指定 metrics endpoint Hono app 路徑

### BFF

- **Metrics Route**：新增 `/api/metrics` proxy route，將 Dashboard 請求轉發至 Backend metrics 端點
- **Config**：新增 metrics backend URL 設定

### Frontend

- 本次不變動。Metrics 由 Dashboard 端點消費（`/api/metrics`）。

---

## Part A：Metrics + Cost Tracking

### 資料流

```text
Agent Execution
  → recordTaskMetric() / recordStepMetric() / recordToolMetric() / recordTokenMetric()
  → MetricsCollector (in-memory ring buffer, latest N entries)
  → GET /api/metrics (REST endpoint)
  → BFF /api/metrics proxy
  → Dashboard consumption
```

### Metrics 結構

```typescript
// 四層檢測點
interface TaskMetric {
  kind: "task";
  taskId: string;
  status: "running" | "completed" | "failed" | "cancelled";
  durationMs?: number;
  stepCount?: number;
  ts: number;
}

interface StepMetric {
  kind: "step";
  stepId: string;
  taskId: string;
  nodeName: string;
  status: "running" | "completed" | "failed" | "retrying";
  durationMs?: number;
  attempt?: number;
  ts: number;
}

interface ToolMetric {
  kind: "tool";
  toolName: string;
  taskId: string;
  stepId: string;
  status: "success" | "error" | "timeout" | "permission_denied";
  durationMs: number;
  toolCallId?: string;
  ts: number;
}

interface TokenMetric {
  kind: "token";
  taskId: string;
  stepId: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  ts: number;
}

interface CostMetric {
  kind: "cost";
  taskId: string;
  totalCost: number;
  currency: string;
  breakdown: {
    modelCost: number;
    toolCost: number;
  };
  ts: number;
}

type MetricEntry = TaskMetric | StepMetric | ToolMetric | TokenMetric | CostMetric;
```

### MetricsEndpoint Response

```typescript
interface MetricsSnapshot {
  snapshotTs: number;
  metrics: {
    tasks: { total: number; completed: number; failed: number; cancelled: number; running: number };
    steps: { total: number; completed: number; failed: number; retrying: number };
    tools: { total: number; success: number; error: number; timeout: number; permissionDenied: number };
    tokens: { totalInput: number; totalOutput: number; totalTokens: number; avgTokensPerTask: number };
    cost: { totalCost: number; currency: string; modelCost: number; toolCost: number };
    latency: { avgTaskDurationMs: number; p95TaskDurationMs?: number };
    rates: {
      taskSuccessRate: number;
      toolSuccessRate: number;
      retryRecoveryRate: number;
      modelFallbackRate?: number;
      structuredOutputRepairSuccessRate?: number;
    };
  };
}
```

### Metrics Collector

```typescript
interface MetricsCollector {
  record(entry: MetricEntry): void;
  snapshot(): MetricsSnapshot;
  reset(): void;
}
```

- 使用 in-memory ring buffer，保留最近 N 筆 raw entries（預設 10000）
- `snapshot()` 即時計算 aggregate statistics
- 前端可透過 `GET /api/metrics` 定期輪詢（polling）

### Metrics Endpoint 掛載機制

`GET /metrics` 端點透過 LangGraph Server 的 `http.app` 機制掛載，利用 `@langchain/langgraph-api` 內建 Hono 框架：

1. **langgraph.json** 新增：
   ```json
   "http": { "app": "./src/platform/metrics/metrics-endpoint.ts:metricsApp" }
   ```
2. **metrics-endpoint.ts** export Hono app，註冊 `GET /metrics` route
3. LangGraph Server 啟動時自動註冊 custom route（`app.route("/", api)`），無需額外 HTTP server 或 `http.createServer`
4. Hono 已是 `@langchain/langgraph-api` 的 dependency（`hono: ^4.11.4`），**不需安裝新 npm 套件**
5. `backend/package.json` 將 `hono` 從 transitive 改為 direct dependency（使用 `^4` semver，與 langgraph-api 一致），確保 TypeScript type 可直接 import

```typescript
// metrics-endpoint.ts
import { Hono } from "hono";
import { getMetricsCollector } from "./metrics-collector.js";

export const metricsApp = new Hono()
  .get("/metrics", (c) => c.json(getMetricsCollector().snapshot()));
```

### Cost Tracking

- Token Cost：從 `usage_metadata` 提取 input/output tokens，乘以 provider-specific rate
- Model Cost：依 provider + model 的 per-1K-token 費率計算
- Tool Cost：從 Tool 執行結果提取（若有 cost 欄位）
- Provider rate 以 config 注入（預設有 openai / qwen / deepseek 費率表），不 hard-code

### Runtime Config 新增

| Key | Default | 說明 |
|-----|---------|------|
| `AGENT_METRICS_ENABLED` | `true` | 是否啟用 metrics 收集 |
| `AGENT_METRICS_BUFFER_SIZE` | `10000` | Ring buffer 最大容量 |
| `AGENT_METRICS_BACKEND_URL` | `http://localhost:2024` | Backend metrics endpoint（供 BFF 使用） |

---

## Part B：OpenTelemetry Distributed Tracing

### 架構

```text
BFF Span (service: "bff")
  └─ Backend Span (service: "backend")
       ├─ LangGraph Node Span (node: "{nodeName}")
       │    ├─ Model Call Span (model: "{model}", provider: "{provider}")
       │    └─ Tool Call Span (tool: "{toolName}")
       └─ Retry Span (attempt: N, reason: "{errorCategory}")
```

### Span Attributes

每個 Span 標準 attributes：

```typescript
interface TraceAttributes {
  "service.name": string;
  "task.id"?: string;
  "step.id"?: string;
  "tool.call.id"?: string;
  "model.name"?: string;
  "model.provider"?: string;

  // Retry 專用
  "retry.attempt"?: number;
  "retry.reason"?: string;

  // Error
  "error.type"?: string;
  "error.message"?: string;
}
```

### OTel 初始化

```typescript
interface TracingConfig {
  enabled: boolean;          // OTEL_ENABLED
  serviceName: string;       // OTEL_SERVICE_NAME，預設 "chat-gun-react-agent"
  exporterEndpoint?: string; // OTEL_EXPORTER_OTLP_ENDPOINT，gRPC 或 HTTP
  exporterProtocol: "grpc" | "http"; // OTEL_EXPORTER_OTLP_PROTOCOL，預設 "http"
  sampleRate: number;        // OTEL_SAMPLE_RATE，預設 1.0（100%）
}
```

- 使用 `@opentelemetry/api` + `@opentelemetry/sdk-trace-node`
- 預設 disabled（`OTEL_ENABLED=false`），無 exporter 時不啟動 SDK
- Exporter 採用 `OTLPTraceExporter`（HTTP protobuf 或 gRPC）
- Span 使用 `context.active()` 自動繼承 parent

### Span Manager

```typescript
interface SpanManager {
  startSpan(name: string, options?: SpanOptions): Span;
  endSpan(span: Span): void;
  recordException(span: Span, error: Error): void;
  setAttributes(span: Span, attributes: Record<string, string | number | boolean>): void;
  getActiveSpan(): Span | undefined;
}

interface SpanOptions {
  kind?: SpanKind;
  attributes?: Record<string, string | number | boolean>;
  parentContext?: Context;
}
```

### 檢測位置

| 層級 | 檢測點 | Span Name | 必要 attributes |
|------|--------|-----------|----------------|
| BFF | proxyLangGraph() | `bff.proxy` | service.name, task.id |
| Backend | LangGraph entry | `langgraph.invoke` | service.name, task.id |
| Backend | Node execution | `langgraph.node.{name}` | service.name, task.id, node.name |
| Backend | Model call | `llm.call` | service.name, model.name, model.provider, task.id, step.id |
| Backend | Tool call | `tool.execute` | service.name, tool.name, task.id, step.id, tool.call.id |
| Backend | Retry | `retry.attempt` | service.name, retry.attempt, retry.reason, task.id |

### Runtime Config 新增

| Key | Default | 說明 |
|-----|---------|------|
| `OTEL_ENABLED` | `false` | 是否啟用 OTel tracing |
| `OTEL_SERVICE_NAME` | `chat-gun-react-agent` | 服務名稱 |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | (空) | OTLP collector endpoint |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http` | Exporter protocol（grpc / http） |
| `OTEL_SAMPLE_RATE` | `1.0` | 取樣率 |

---

## Part C：Model Provider Fault Tolerance

### Fallback 策略

| Failure Scenario | Strategy |
|---|---|
| Model Provider 5xx | Fallback model routing（切換至 backup provider） |
| Structured Output Parse Error | Repair loop（區分 parse error / validation error / refusal） |
| Structured Output Validation Error | 有限修復嘗試，回傳 partial + error hint |
| Refusal / Content Filter | 不重試，回傳 refusal signal |
| Provider Timeout | Backoff retry，耗盡後 fallback |

### ModelFallbackPolicy

```typescript
interface ModelFallbackPolicy {
  primaryProvider: LlmProviderName;
  fallbackProviders: LlmProviderName[];
  maxTotalAttempts: number;
  repairStrategy: "none" | "retry_once" | "retry_with_hint";
  perProviderTimeoutMs: number;
}

// 使用 lazy getter 避免模組載入時副作用
// primaryProvider 在 runtime 透過 env 解析，非 import-time
function getDefaultFallbackPolicy(): ModelFallbackPolicy {
  return {
    primaryProvider: getConfiguredLlmProvider(),  // runtime 解析
    fallbackProviders: [],
    maxTotalAttempts: 3,
    repairStrategy: "retry_once",
    perProviderTimeoutMs: 30_000,
  };
}
```

`getDefaultFallbackPolicy()` 為 factory function（非 module const），在 `createChatModelWithFallback` 被呼叫時才解析 provider，避免模組 import 時環境變數尚未載入。
```

### Structured Output Repair Loop

```typescript
interface RepairResult {
  output: Record<string, unknown> | null;
  partial: Record<string, unknown> | null;
  status: "success" | "repaired" | "partial" | "refusal" | "exhausted";
  attempts: number;
  lastError?: string;
}
```

處理流程：

```text
Model Call → Raw Response
  → JSON Parse
      ✅ → Schema Validation
           ✅ → Success
           ❌ → Repair (retry_with_hint)
                ✅ → Repaired
                ❌ → Partial (return partial + error hint)
      ❌ → Repair (retry_once or retry_with_hint)
           ✅ → Repaired
           ❌ → Fallback Provider (if available)
```

- Refusal / Content Filter 直接回傳 refusal status，不重試
- `retry_once`：嘗試一次修復（不帶 hint）
- `retry_with_hint`：嘗試修復並附帶 schema error 資訊

### Structured Output Partial Extraction 策略

Zod `safeParse` 僅回傳 success/error，不會自動產生 partial result。Partial extraction 使用以下策略：

```typescript
/**
 * 使用 Zod 的 error.issues 反向提取已通過驗證的欄位。
 *
 * 策略：
 * 1. 先執行 schema.safeParse() 取得 error.issues
 * 2. 收集 issues 中涉及的 path（欄位名稱）
 * 3. 對每個未在 issues 中的頂層欄位，單獨執行 schema.shape[key].safeParse()
 * 4. 收集所有通過的欄位組成 partial result
 * 5. 若沒有可提取的 valid field，回傳 null
 *
 * 此策略確保：
 * - Partial 欄位通過與 original schema 相同的驗證
 * - 不假設欄位順序或依賴關係
 * - 欄位驗證失敗的原因被保留在 lastError 中
 */
function extractPartial<T extends z.ZodObject<any>>(
  rawData: unknown,
  schema: T
): { partial: Partial<z.infer<T>> | null; failedKeys: string[] } {
  // 1. safeParse 取得完整錯誤
  // 2. 從 error.issues 提取 failedKeys
  // 3. 對非 failed keys 進行逐欄位 safeParse
  // 4. 收集 valid fields
}
```

此策略的已知限制：
- 僅支援 ZodObject（最常見的 structured output 型別）
- 不嘗試修復交叉欄位依賴（若欄位 B 依賴欄位 A 的值，而 A validation 失敗，則 B 可能也無效）
- 巢狀物件中的 partial 欄位提取需遞迴處理（Phase 1 只處理頂層欄位）

### Gateway 擴充

修改現有 `LlmGateway` interface：

```typescript
export interface LlmGateway {
  createChatModel(options?: ChatModelOptions): ChatModelInvoker;
  createChatModelWithFallback(
    options?: ChatModelOptions,
    fallbackPolicy?: Partial<ModelFallbackPolicy>
  ): ChatModelInvoker;
}
```

`createChatModelWithFallback` 內部實作：

1. 建立 primary provider 的 ChatModelInvoker
2. 建立 fallback provider 的 ChatModelInvoker 列表
3. 包裝為 `FallbackChatModelInvoker`：嘗試 primary → 失敗依序嘗試 fallback
4. Structured output 時：parse error → repair loop → fallback

### 與既有 retry 的關係

- 既有 `OpenAiCompatibleChatModel.invoke()` 內的 per-request retry 保留不變（處理 transient network error）
- `FallbackChatModelInvoker` 是外層包裝，處理 provider-level failure（5xx、timeout、parse error）
- X2 Retry Budget 的錯誤分類可引用 Part C 的 provider error category
- 三層不互相繞過：Budget Control → Fallback Routing → Per-Request Retry

### Runtime Config 新增

| Key | Default | 說明 |
|-----|---------|------|
| `LLM_FALLBACK_ENABLED` | `false` | 是否啟用 provider fallback |
| `LLM_FALLBACK_PROVIDERS` | (空) | 逗號分隔的 fallback provider 列表 |
| `LLM_FALLBACK_MAX_ATTEMPTS` | `3` | 總嘗試次數上限 |
| `LLM_FALLBACK_TIMEOUT_MS` | `30000` | Per-provider timeout |
| `LLM_REPAIR_STRATEGY` | `retry_once` | Structured output 修復策略 |

---

## BFF 變更

### Metrics Proxy Route

新增 `/api/metrics` route，方法同既有的 `/api/langgraph/...` proxy 模式：

- `GET /api/metrics` → 轉發至 Backend `{AGENT_METRICS_BACKEND_URL}/metrics`
- 需要認證（同 `/api/langgraph`）
- 需要 rate limit（同既有）
- Response 直接透傳（不解析 metrics body）

### Config 新增

```typescript
// bff/src/config.ts
metricsBackendUrl: string;  // AGENT_METRICS_BACKEND_URL，預設同 langGraphApiUrl
```

---

## 替代方案

| 方案 | 優點 | 缺點 | 決策 |
|------|------|------|------|
| Prometheus + Grafana 直接集成 | 成熟生態 | 需外部 infrastructure、增加部署複雜度 | 不採用（提供 REST 端點供 Dashboard 消費） |
| 使用 LangSmith tracing | 與 LangGraph 深度整合 | 需 API key、資料外洩風險、非 self-hosted | 不採用（使用 OTel 標準，self-hosted） |
| Fallback 全部 provider 同時調用 | 延遲最低 | 成本最高、side effect 風險 | 不採用（sequential fallback） |
| 修改 LangGraph Server 內部 middleware | 更整合 | 侵入 LangGraph runtime、升級風險 | 不採用（檢測點寫在 agent graph 層，Metrics endpoint 使用官方 `http.app` 機制掛載） |

---

## 資料流總結

```text
┌─────────────────────────────────────────────────┐
│                    Dashboard                      │
│  GET /api/metrics          OTLP Collector (opt)  │
└──────────┬──────────────────┬───────────────────┘
           │                  │
┌──────────▼──────────────────▼───────────────────┐
│                    BFF                            │
│  /api/metrics → proxy to backend                 │
│  Trace context propagation (W3C TraceContext)     │
└──────────┬───────────────────────────────────────┘
           │
┌──────────▼───────────────────────────────────────┐
│                  Backend                          │
│  ┌──────────────────┐  ┌──────────────────────┐  │
│  │ MetricsCollector │  │ SpanManager (OTel)    │  │
│  │ (in-memory ring) │  │ (optional, disabled   │  │
│  │                  │  │  by default)          │  │
│  └────────┬─────────┘  └──────────┬───────────┘  │
│           │                       │              │
│  ┌────────▼───────────────────────▼───────────┐  │
│  │         Agent Graph Nodes                   │  │
│  │  recordStepMetric() / recordToolMetric()    │  │
│  │  startSpan() / endSpan()                    │  │
│  └────────┬───────────────────────────────────┘  │
│           │                                      │
│  ┌────────▼───────────────────────────────────┐  │
│  │         LLM Gateway (Fallback)              │  │
│  │  recordTokenMetric() / recordCostMetric()   │  │
│  │  startSpan("llm.call") / endSpan()          │  │
│  └─────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```
