# Design：integrate-opik-agent-tracing-evaluation

## 責任邊界

### Backend

- **Opik Setup Module** (`backend/src/platform/tracing/opik/opik-setup.ts`)：Opik client 初始化、config 驗證、graceful degradation
- **Opik Trace Wrapper** (`backend/src/platform/tracing/opik/opik-tracer.ts`)：將 LangGraph agent execution 包裝為 Opik trace/span 階層
- **Redaction Layer** (`backend/src/platform/tracing/opik/opik-redaction.ts`)：複用 X8 `sanitizeErrorMessage` 的 redaction 邏輯，擴充 span input/output 過濾
- **Evaluation Dataset** (`backend/src/evaluation/opik/dataset.ts`)：從 golden case 建立 versioned dataset
- **Experiment Runner** (`backend/src/evaluation/opik/experiment.ts`)：可重現 experiment 執行
- **Runtime Config**：新增 Opik 相關 env key
- **Backend `package.json`**：新增 `opik` dependency（optional）

### BFF

- 本次不變動。Opik SDK 在 backend 直接與 Opik API 通訊，不經過 BFF proxy。

### Frontend

- 本次不變動。Opik UI 由 hosted service 提供。

---

## Part A：Opik Agent Tracing

### 整合路徑選擇

採用 **Opik SDK 直接 instrumentation**（非 OTel export 路徑），理由：

1. OTel span 語意較通用，LangGraph node/edge、agent step、retry 等專屬語意在 OTel export 過程中可能遺失
2. Opik SDK 原生支援巢狀 trace hierarchy、feedback scores、tagging，不需額外 adapter
3. Opik 提供 `opik.configure()` 可選擇性地橋接 OTel，但 primary path 使用直接 SDK 呼叫以保留完整 agent 語意

若後續發現直接 SDK instrumentation 與既有的 OTel `SpanManager.withSpan()` 產生重複 logical span，則以 feature flag 控制兩個路徑互斥或合併。

### Trace Hierarchy

```text
Opik Trace (name: agent run, metadata: { threadId, runId })
  ├─ Agent Span (name: agent name, metadata: { taskId })
  │    ├─ LangGraph Node Span (name: node name, metadata: { stepId })
  │    │    ├─ LLM Call Span (name: "llm.call", metadata: { model, provider, inputTokens, outputTokens })
  │    │    └─ Tool Call Span (name: "tool.execute", metadata: { toolName, toolCallId, durationMs })
  │    └─ Retry Span (name: "retry", metadata: { attempt, reason })
  └─ Feedback / Score (optional, for evaluation)
```

### Opik Client 初始化

```typescript
// opik-setup.ts
interface OpikConfig {
  enabled: boolean;           // OPIK_ENABLED
  apiKey?: string;            // OPIK_API_KEY
  workspace?: string;         // OPIK_WORKSPACE
  host?: string;              // OPIK_HOST，預設 "https://www.comet.com/opik/api"
  projectName: string;        // OPIK_PROJECT_NAME，預設 "chat-gun-react-agent"
  redactEnabled: boolean;     // OPIK_REDACT_ENABLED，預設 true
}

interface OpikClient {
  startTrace(name: string, metadata?: Record<string, unknown>): OpikTrace;
  isConfigured(): boolean;
}

interface OpikTrace {
  startSpan(name: string, metadata?: Record<string, unknown>): OpikSpan;
  end(input?: unknown, output?: unknown): void;
  logFeedback(name: string, value: number, reason?: string): void;
}

interface OpikSpan {
  end(input?: unknown, output?: unknown): void;
  update(metadata: Record<string, unknown>): void;
}
```

### OpikTracer 抽象

```typescript
// opik-tracer.ts
interface OpikTracer {
  traceAgentRun(
    agentName: string,
    metadata: AgentRunMetadata,
    execution: () => Promise<AgentRunResult>
  ): Promise<AgentRunResult>;
}

interface AgentRunMetadata {
  threadId: string;
  runId: string;
  taskId?: string;
  requestId?: string;
  modelName?: string;
  providerName?: string;
}
```

### Graceful Degradation

- `OPIK_ENABLED=false` 或未設定 → `OpikTracer.traceAgentRun()` 直接呼叫 execution callback，不建立任何 trace
- Opik API 無法連線 → console.warn + no-op，不拋出例外
- Opik API key 未設定 → console.warn："Opik enabled but OPIK_API_KEY not configured"，降級為 no-op
- SDK import 失敗（未安裝）→ catch + no-op，不影響 agent flow

### Redaction Rules（複用並擴充 X8）

複用 `span-manager.ts` 的 `sanitizeErrorMessage`，並新增 span input/output 過濾：

```typescript
// opik-redaction.ts
interface OpikRedactionRules {
  sanitizeSpanInput(input: unknown): unknown;
  sanitizeSpanOutput(output: unknown): unknown;
  sanitizeMetadata(metadata: Record<string, unknown>): Record<string, unknown>;
}
```

MUST NOT export 的內容：
- API Key、Token、Password、Secret、Credential
- 完整 Prompt（僅保留 prompt template name 或 hash）
- 完整 Conversation（僅保留 message count、role distribution summary）
- Raw Tool Output（僅保留 structured summary、hash、reference）
- Unmasked PII（email、phone、address、name）

MUST export 的內容：
- Structured summaries
- Hashes、references
- Redacted payloads
- Error types、status codes、latency、token counts
- Agent name、node name、tool name、model name、provider name
- Correlation IDs（threadId、runId、taskId、stepId、toolCallId）

### 與既有 traceNode() 的整合

`deep-researcher.ts` 與 `mcp-agent.ts` 已有兩種 node execution 模式：

| 模式 | 檔案 | 機制 |
|------|------|------|
| traceNode() wrapper | `deep-researcher.ts:114-131` | 使用 `getSpanManager().withSpan()` 為每個 node 建立 OTel span |
| 直接 .addNode() | `mcp-agent.ts:46-56` | 無 OTel wrapper，直接註冊 node |

OpikTracer 採用以下整合策略，確保所有 LangGraph agent 自動獲得雙重 tracing，且避免分散的 instrumentation 邏輯：

1. **在 `traceNode()` 內部加入 Opik span 建立**（與 OTel span 並行）：修改 `withNodeSpan()` 為同時建立 OTel span（既有）與 Opik span（新增），所有使用 `traceNode()` 的 agent 自動受益。
2. **提供獨立的 `withOpikNode()` wrapper**：供 `mcp-agent.ts` 等直接 `.addNode()` 的 agent 使用，不強制耦合 OTel。
3. **Opik span 使用獨立的 context**：不依附 OTel `context.active()`，避免 context propagation 衝突。

此設計確保：
- `deep-researcher.ts` 透過 `traceNode()` 自動獲得 Opik node span
- `mcp-agent.ts` 透過 `withOpikNode()` 手動接入
- 兩個 tracing 系統的 instrumentation 邏輯集中在同一層，降低維護成本

### 檢測點

| 檢測點 | 位置 | Span Name | 必要 Metadata |
|--------|------|-----------|---------------|
| Agent Run Entry | LangGraph graph entry | `agent.{name}` | threadId, runId, taskId, model.name, provider.name |
| LangGraph Node | Node execution wrapper（traceNode / withOpikNode） | `node.{nodeName}` | stepId, nodeName |
| LLM Call | `TracedChatModelInvoker` 內部 | `llm.call` | model.name, model.provider, inputTokens, outputTokens |
| Tool Call | Tool execution wrapper | `tool.execute` | toolName, toolCallId, durationMs, status |
| Retry | Retry executor | `retry.attempt` | attempt, reason, stepId |

### Runtime Config 新增

| Key | Default | 說明 |
|-----|---------|------|
| `OPIK_ENABLED` | `false` | 是否啟用 Opik tracing |
| `OPIK_API_KEY` | (空) | Opik API key |
| `OPIK_WORKSPACE` | (空) | Opik workspace name |
| `OPIK_HOST` | `https://www.comet.com/opik/api` | Opik API host |
| `OPIK_PROJECT_NAME` | `chat-gun-react-agent` | Opik project name |
| `OPIK_REDACT_ENABLED` | `true` | 是否啟用 redaction |

---

## Part B：Opik Evaluation Pipeline

### Dataset 建立

從既有 golden case 建立 versioned dataset：

```typescript
// dataset.ts
interface EvaluationDataset {
  name: string;
  version: string;
  items: EvaluationItem[];
}

interface EvaluationItem {
  id: string;
  input: unknown;          // Agent input（redacted）
  expectedOutput?: unknown; // Expected output（for deterministic metrics）
  goldenTrace?: string;     // Reference to golden trace（optional）
  metadata?: Record<string, unknown>;
}
```

Dataset 來源：
- `backend/src/tools/weather-golden-eval.ts` — 現有天氣查詢 golden case
- 手動挑選的 Deep Research 成功案例（至少 3-5 個）
- 明確標註 version（如 `v1.0.0`），不自動追加快照

### Metrics 設計

#### Deterministic Metric：Tool Call Correctness

```typescript
interface ToolCallCorrectnessMetric {
  name: "tool_call_correctness";
  evaluate(item: EvaluationItem, result: AgentRunResult): MetricScore;
}

interface MetricScore {
  name: string;
  value: number;  // 0.0 - 1.0
  reason?: string;
}
```

檢查 agent 是否呼叫了預期的 tool、tool arguments 是否符合 schema。

#### LLM-as-Judge Metric：Response Quality

```typescript
interface LlmJudgeConfig {
  model: string;
  provider: string;
  temperature: number;  // MUST be 0 for reproducibility
  promptTemplate: string;
}

interface LlmJudgeMetric {
  name: "response_quality";
  judgeConfig: LlmJudgeConfig;
  evaluate(item: EvaluationItem, result: AgentRunResult): Promise<MetricScore>;
}
```

- Judge prompt 必須 versioned（寫在 evaluation dataset 或 experiment config 中）
- Judge temperature = 0 以確保可重現性
- Judge 輸出必須包含 reasoning（why this score）
- 記錄 judge model、prompt version、timestamp

### Experiment 執行

```typescript
// experiment.ts
interface ExperimentConfig {
  datasetVersion: string;
  agentConfig: {
    model: string;
    provider: string;
    promptVersion?: string;
  };
  metrics: (ToolCallCorrectnessMetric | LlmJudgeMetric)[];
  judgeConfig?: LlmJudgeConfig;
  maxItems?: number;            // 最多執行 N 個 dataset items，預設全部
  perItemTimeoutMs?: number;    // 每個 item 的 agent run 逾時，預設 120000
  maxTotalCostUsd?: number;     // 成本上限（估算），超過時終止 experiment
}

interface ExperimentResult {
  experimentId: string;
  datasetVersion: string;
  metrics: MetricScore[];
  traceIds: string[];  // Opik trace IDs for trace-backed evaluation
}
```

Experiment 必須：
1. 固定 dataset version（不可變更）
2. 記錄 agent config（model、provider、prompt version）
3. 記錄 judge config（model、temperature、prompt template version）
4. 每個 dataset item 產生獨立的 Opik trace
5. Metric scores 回寫至 Opik trace 作為 feedback

### Item-level 失敗策略

每個 dataset item 的 agent run 獨立執行，單一 item 失敗不中斷整個 experiment：

| 失敗類型 | 處理方式 |
|----------|----------|
| Agent run 逾時（> perItemTimeoutMs） | 標記該 item 為 `TIMEOUT`，metric score = 0.0，繼續下一個 item |
| Agent run 拋出例外 | 標記該 item 為 `FAILED`，metric score = 0.0，記錄 error type/message，繼續下一個 item |
| LLM Judge 無法連線 | 該 metric 標記為 `JUDGE_FAILED`，不影響其他 metric 或 item |
| Opik API 無法連線 | Metric 仍計算，僅 feedback 寫入失敗（console.warn），不中斷 experiment |
| 成本上限觸發（累計 token 成本 >= maxTotalCostUsd） | 終止 experiment，記錄已完成 items 的結果，未執行 items 標記為 `SKIPPED` |

Experiment result 必須記錄所有 item 的最終狀態（`COMPLETED` / `FAILED` / `TIMEOUT` / `SKIPPED`），確保結果可解釋。

### 可比較性保證

同一 dataset version + 不同 agent config（如不同 model）→ 產生兩組 experiment，可在 Opik UI 中並排比較：
- Trace hierarchy 差異
- Metric score 差異
- Token 用量差異
- Latency 差異

---

## BFF 變更

無。Opik SDK 在 backend 直接與 Opik API 通訊。

---

## Frontend 變更

無。Opik UI 由 hosted service 提供。

---

## 替代方案

| 方案 | 優點 | 缺點 | 決策 |
|------|------|------|------|
| 純 OTel export（透過 OTLP exporter 將 trace 送到 Opik） | 不需新增 dependency、複用 X8 投資 | 語意遺失風險高（LangGraph node/edge、agent step）、hierarchy 不保證保留 | 不採用作為 primary path，但保留為 fallback |
| LangSmith | LangChain/LangGraph 官方整合 | 需 API key、資料外洩風險、vendor lock-in、付費 | 不採用 |
| 自建 evaluation pipeline（PostgreSQL + 自訂 UI） | 完全控制 | 開發成本高、重複造輪、缺乏 experiment comparison UI | 不採用 |
| Opik SDK 直接 instrumentation（primary）+ OTel coexistence | 完整 agent 語意、可關閉、不衝突 | 新增 dependency、需 redaction layer | **採用** |

---

## 資料流

```text
┌─────────────────────────────────────────────────────────┐
│                   Opik Hosted UI                          │
│  Traces / Spans / Datasets / Experiments / Feedback      │
└────────────────────────┬────────────────────────────────┘
                         │ HTTPS (API key auth)
                         │ Redacted data only
┌────────────────────────▼────────────────────────────────┐
│                     Backend                               │
│  ┌──────────────────────────────────────────────────┐   │
│  │              OpikTracer                           │   │
│  │  ┌───────────┐  ┌──────────────┐                 │   │
│  │  │ Opik Client│  │Redaction Layer│                │   │
│  │  │ (SDK)     │  │(sanitize、    │                 │   │
│  │  │           │  │ filter fields)│                 │   │
│  │  └─────┬─────┘  └──────┬───────┘                 │   │
│  │        │               │                          │   │
│  │  ┌─────▼───────────────▼───────┐                  │   │
│  │  │    Agent Graph Nodes         │                  │   │
│  │  │  startSpan / endSpan         │                  │   │
│  │  │  (Opik spans)               │                  │   │
│  │  └──────────────────────────────┘                  │   │
│  └───────────────────────────────────────────────────┘   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │          Evaluation Pipeline                      │   │
│  │  Dataset Loader → Experiment Runner → Metrics     │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │          OTel SpanManager (X8, unchanged)         │   │
│  │  (獨立運行，與 Opik 互不干擾)                      │   │
│  └──────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```
