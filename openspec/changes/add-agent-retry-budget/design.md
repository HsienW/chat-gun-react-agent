# Design：add-agent-retry-budget

## 架構分層

```text
backend/src/runtime/
├── types.ts              (X1 - 既有，不修改)
├── state-machine.ts      (X1 - 既有，不修改)
├── events.ts             (X1 - 既有，不修改)
├── persistence/          (X1 - 既有，不修改)
└── retry/                (X2 - 新增)
    ├── error-classification.ts   錯誤分類（純函式）
    ├── backoff.ts                Backoff 策略（純函式）
    ├── retry-policy.ts           RetryPolicy 型別與預設值
    ├── retry-budget.ts           Budget Tracker（immutable plain object）
    └── retry-executor.ts         組合層：classification + budget + backoff + state machine + events
```

## 模組責任

| 模組 | 責任 | 副作用 |
|------|------|--------|
| `error-classification.ts` | 將 `StepError` + context 分類為 `ClassifiedError` | 無 |
| `backoff.ts` | 計算 retry delay（exponential / fixed / retry-after-header） | 無（jitter 使用 `Math.random`，視為可接受的隨機性） |
| `retry-policy.ts` | 定義 `RetryPolicy` 型別與 `DEFAULT_RETRY_POLICY` | 無 |
| `retry-budget.ts` | 建立、檢查、更新 Budget（attempts + elapsed time） | 無（pure immutable 更新） |
| `retry-executor.ts` | 執行完整 retry loop：分類 → budget check → state transition → event → backoff → retry | 有（呼叫狀態機、發送 events、等待 delay） |

## 資料模型

### Error Classification

```typescript
type ErrorCategory =
  | "timeout"
  | "rate_limit"
  | "server_error"        // 5xx
  | "schema_invalid"
  | "permission_denied"
  | "business_rejected"
  | "user_cancelled"
  | "unknown";

interface ClassifiedError {
  category: ErrorCategory;
  code: string;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;   // 來自 Retry-After header，僅 rate_limit
  originalError: StepError;
}
```

分類規則（優先級由上到下）：

| 條件 | category | retryable | 備註 |
|------|----------|-----------|------|
| `code === "USER_CANCELLED"` | user_cancelled | false | |
| `code === "PERMISSION_DENIED"` or `statusCode === 403` | permission_denied | false | |
| `code === "BUSINESS_REJECTED"` or `statusCode === 422` | business_rejected | false | |
| `statusCode === 429` | rate_limit | true | 含 `retryAfterMs` |
| `code === "TIMEOUT"` or `code === "ETIMEDOUT"` or `code === "ABORT_ERR"` | timeout | true | |
| `statusCode >= 500` | server_error | true | |
| `statusCode === 400` or `code === "SCHEMA_INVALID"` | schema_invalid | false | conditional，由 caller 決定是否修復重試 |
| 其他 | unknown | false | |

> **設計決策**：Error Classification 是純函式，不依賴外部狀態。`classifyError` 接受 X1 的 `StepError`（`{ code, message, details }`）加上可選的 `{ statusCode?, retryAfterHeader? }` context。分類規則以 `code` 為主要判斷、`statusCode` 為輔助（當 error 來自 HTTP call 時）。caller 可以對 `retryable: false` 的 `schema_invalid` 做條件式單次修復重試（透過在 `RetryPolicy.retryableCategories` 中明確加入 `"schema_invalid"`）。

### Retry Policy

```typescript
interface RetryPolicy {
  maxAttempts: number;       // 總執行次數上限（含 initial execution）。語意與 X1 AgentStep.maxAttempts 一致
  maxElapsedMs: number;      // 從 initial execution 開始計算的總 elapsed time 上限
  retryableCategories: ErrorCategory[];
  backoffStrategy: "exponential" | "fixed" | "retry-after-header";
  jitter: boolean;
}

const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,            // 總執行次數最多 3 次（1 initial + 最多 2 retries）
  maxElapsedMs: 60_000,
  retryableCategories: ["timeout", "rate_limit", "server_error"],
  backoffStrategy: "exponential",
  jitter: true,
};
```

> **設計決策**：Policy 由 caller 傳入，可 per-Step 覆蓋。若未指定，使用 `DEFAULT_RETRY_POLICY`。`retryableCategories` 明確列出哪些 error category 可重試，比單一 boolean 更靈活（例如某 Step 可以選擇將 `schema_invalid` 加入可重試清單以啟用單次修復重試）。

### Backoff

```typescript
interface BackoffOptions {
  baseMs?: number;         // default: 1000
  maxMs?: number;          // default: 30000
  retryAfterMs?: number;   // for retry-after-header strategy
  jitter?: boolean;        // default: true
}

function computeBackoff(
  strategy: "exponential" | "fixed" | "retry-after-header",
  attempt: number,          // 1-indexed（當前是第幾次重試）
  opts?: BackoffOptions
): number;                  // delay in ms
```

策略計算：

- **exponential**: `min(baseMs * 2^(attempt-1), maxMs)` → 若 jitter：±25% uniform random
  - attempt 1: ~1s, attempt 2: ~2s, attempt 3: ~4s, … capped at maxMs
- **fixed**: `baseMs` → 若 jitter：±25%
- **retry-after-header**: 若 `retryAfterMs` 存在則使用，否則 fallback 到 exponential。`Retry-After` 僅接受非負整數秒；HTTP-date 或其他無效格式不轉換為 `retryAfterMs`，因此自然走 exponential fallback

Jitter 範圍：`[delay * 0.75, delay * 1.25]`，使用 `Math.random()`。

> **設計決策**：Backoff 是純函式，不執行 `setTimeout`。呼叫者取得 delay ms 後自行等待。Jitter 使用 `Math.random()`，測試時驗證範圍而非精確值。

### Retry Budget

```typescript
interface RetryBudget {
  stepId: string;
  maxAttempts: number;       // 總執行次數上限（含 initial execution），與 X1 AgentStep.maxAttempts 語意一致
  maxElapsedMs: number;
  startedAt: number;         // epoch ms
  attempts: number;          // 目前已執行的總次數（含 initial execution），從 0 開始
}
```

> **語意對齊**：`RetryPolicy.maxAttempts` 與 X1 `AgentStep.maxAttempts` 語意一致，皆表示「總執行次數上限（含 initial execution）」。例如 `maxAttempts = 3` 表示總執行次數最多 3 次（1 initial + 最多 2 retries）。X2 Budget 不重新定義語意，直接沿用 X1 的定義。

```typescript
interface BudgetCheckResult {
  exhausted: boolean;
  reason?: "max_attempts" | "max_elapsed" | "cancelled";
  canRetry: boolean;
}
```

函式：

```typescript
function createBudget(stepId: string, policy: RetryPolicy): RetryBudget;
// 初始化時 attempts = 0（尚未執行任何 operation）
// maxAttempts 與 X1 AgentStep.maxAttempts 語意一致：總執行次數上限（含 initial）

function checkBudget(budget: RetryBudget, signal?: AbortSignal): BudgetCheckResult;
function recordAttempt(budget: RetryBudget): RetryBudget;
// 每次 operation 執行後遞增 attempts；attempts 代表目前總執行次數（含 initial）
```

檢查邏輯（優先級由上到下）：

1. `signal.aborted === true` → `{ exhausted: true, reason: "cancelled", canRetry: false }`
2. `attempts >= maxAttempts` → `{ exhausted: true, reason: "max_attempts", canRetry: false }`
3. `Date.now() - startedAt >= maxElapsedMs` → `{ exhausted: true, reason: "max_elapsed", canRetry: false }`
4. 以上皆非 → `{ exhausted: false, canRetry: true }`

> **設計決策**：Budget 是 plain object，`recordAttempt` 回傳新 budget（immutable 更新）。不使用 class 以保持純資料語意。Budget 的 `attempts` 從 0 開始，每次 operation 執行後透過 `recordAttempt` 遞增。檢查使用 `attempts >= maxAttempts`，因為 `maxAttempts` 表示總執行次數上限；當本次執行使 `attempts` 達到上限時，不得再安排 retry。這與 X1 `transitionStep` 在 `retryable_failed → pending` 使用的 `attempt >= maxAttempts` 邊界一致。

### Retry Executor（組合層）

```typescript
interface RetryConfig {
  policy?: RetryPolicy;
  step: AgentStep;
  taskId: string;
  signal?: AbortSignal;
  onEvent: (event: TaskEvent) => Promise<void>;  // event callback
}

interface RetryResult {
  finalStep: AgentStep;
  budget: RetryBudget;
  succeeded: boolean;
}

async function executeWithRetry(
  operation: () => Promise<{ output?: unknown; error?: StepError; statusCode?: number; retryAfterHeader?: string }>,
  config: RetryConfig
): Promise<RetryResult>;
```

執行流程：

```text
1. 建立 RetryBudget（attempts = 0，尚未執行任何 operation）
2. 以 `config.policy ?? DEFAULT_RETRY_POLICY` 取得 effective policy，並建立 immutable effective step copy，令 `effectiveStep.maxAttempts = policy.maxAttempts`，使 X1 state machine 與 X2 budget 使用相同上限
3. 進入 loop：
   a. 在 operation 前呼叫 `checkBudget(budget, signal)`；若已耗盡則不執行 operation，直接轉 `terminal_failed`
   b. 執行 operation()
   c. 成功（無 error）：
      → recordAttempt(budget)  // 計入本次執行
      → transitionStep(step, 'succeeded') → 發 step_completed event → 跳出
   d. 失敗：classifyError(error, { statusCode, retryAfterHeader })
   e. classifiedError.retryable === false
      → recordAttempt(budget)  // 計入本次執行
      → transitionStep(step, 'terminal_failed', { error }) → 發 step_failed event → 跳出
   f. classifiedError.retryable === true：
      → recordAttempt(budget)  // attempts += 1；例如 0 → 1
      → checkBudget(budget, signal)
        → exhausted（attempts >= maxAttempts 或 maxElapsedMs 或 cancelled）
          → transitionStep(step, 'terminal_failed', { error }) → 發 step_failed event → 跳出
        → canRetry
          → transitionStep(step, 'retryable_failed', { error }) → 發 step_failed event
          → 發 step_retrying event
          → computeBackoff(strategy, budget.attempts, { retryAfterMs })
          → sleep(delay, signal)；signal abort 時立即結束等待
          → 再次 checkBudget(budget, signal)
            → exhausted：`retryable_failed → terminal_failed`
            → canRetry：`retryable_failed → pending`
          → transitionStep(step, 'running') → 繼續 loop
```

> **設計決策**：`executeWithRetry` 是唯一有副作用的模組 — 它呼叫 X1 的 `transitionStep`（狀態機）、`create*Event` factories（event system）、實際 `sleep`（delay）。其他四個模組（classification、backoff、policy、budget）都是純函式。這樣的設計讓核心邏輯可以獨立單元測試，而整合測試只需要驗證 `executeWithRetry` 的正確編排。
>
> **Budget 檢查順序**：每次 operation 前先檢查一次，以涵蓋已取消或 `maxElapsedMs = 0` 等首次執行前已耗盡情況；operation 失敗後先 `recordAttempt` 再檢查，確保 `budget.attempts` 反映真實執行次數；backoff 結束後再檢查一次，避免取消或 elapsed budget 在等待期間失效。`checkBudget` 使用 `attempts >= maxAttempts`，達到總執行次數上限即不得再安排 retry。
>
> **可取消等待**：私有 backoff wait 接受 `AbortSignal`。若 signal 在等待中 abort，wait 立即結束並清理 timer/listener，executor 保持 step 在 `retryable_failed`，再次檢查 budget 後以合法的 `retryable_failed → terminal_failed` 轉移收斂為 `USER_CANCELLED`，不會先轉入 `pending` 或虛假 `running`。

## 與 X1 狀態機的互動

X2 的 Retry Executor **呼叫** X1 的 `transitionStep`，不修改狀態機：

```text
X2 Retry Executor
  → recordAttempt(budget)                                        // X2
  → checkBudget(budget, signal)                                  // X2
  → classifyError(step.error, context)                           // X2
  → transitionStep(step, 'retryable_failed', { error })          // X1
  → createStepFailedEvent(taskId, step)                          // X1
  → createStepRetryingEvent(taskId, step)                        // X1
  → computeBackoff(strategy, budget.attempts)                    // X2
  → sleep(delay, signal)                                         // X2，可取消
  → checkBudget(budget, signal)                                  // X2，涵蓋等待期間的 cancel / elapsed
  → transitionStep(step, 'pending')                              // X1
  → transitionStep(step, 'running')                              // X1
```

X1 狀態機內建的 `attempt < maxAttempts` 檢查作為**第二層防線**：即使 X2 Retry Budget 邏輯有 bug，X1 狀態機也會在 `retryable_failed → pending` 轉移時拒絕超限 retry。

## BFF Cancel Signal Propagation

```text
Browser (client disconnect)
  → BFF request handler 偵測到 client close
  → AbortController.abort()
  → signal 傳入 backend HTTP call
  → backend agent graph node 接收 signal
  → 傳入 executeWithRetry 的 config.signal
  → retry loop 每次 iteration 與 backoff wait 前後檢查 signal.aborted
  → aborted → checkBudget 回傳 exhausted (reason: "cancelled")
  → transitionStep(step, 'terminal_failed', { code: "USER_CANCELLED" })
```

> **設計決策**：使用標準 Web API `AbortSignal` / `AbortController`，不建立 custom cancel protocol。BFF 層的變更僅限於確認既有 AbortController 鏈能正確傳播。

## 資料流

```text
Backend Agent Graph Node
  → 執行 operation（tool call / model call）
  → operation 回傳 { error: StepError, statusCode?: number }
  → executeWithRetry(operation, config)
      ├── recordAttempt(budget)
      ├── classifyError(error, { statusCode })
      ├── checkBudget(budget, signal) → exhausted? → terminal_failed
      ├── transitionStep(step, 'retryable_failed')
      ├── onEvent(createStepFailedEvent(taskId, step))
      ├── onEvent(createStepRetryingEvent(taskId, step))
      ├── computeBackoff + abortable sleep
      ├── checkBudget（等待後）→ exhausted? → terminal_failed
      ├── transitionStep(step, 'pending')
      ├── transitionStep(step, 'running')
      └── 重新執行 operation ...
  → 最終：transitionStep(step, 'succeeded') | transitionStep(step, 'terminal_failed')
  → onEvent(createStepCompletedEvent | createStepFailedEvent)
```

## 替代方案

| 方案 | 評估 |
|------|------|
| **在每個 Agent Graph Node 內手寫 retry 邏輯** | ❌ 重複程式碼、不一致的 retry 行為、無法集中設定 policy |
| **使用 LangGraph 原生 node retry** | ❌ LangGraph node retry 粒度不足（只能整顆 node 重試，無法區分 error category）；沒有 budget tracker；沒有 BFF cancel 傳播 |
| **使用 external workflow engine（Temporal）** | ❌ 引入重型依賴。X2 是 Layer 1 的輕量 retry 框架，不綁定任何外部引擎 |
| **將 Retry Policy 放在 Tool Governance 層** | ❌ Tool Governance 管單次 tool execution；Retry Policy 管 Step 層級的多 attempt 策略。兩者分層明確，不互相取代 |
| **Error Classification 使用 class hierarchy** | ❌ 過度設計。`ClassifiedError` 是 plain object + discriminant `category`，足夠表達所有錯誤類型 |

## 與既有系統的關係

| 既有系統 | 關係 |
|---------|------|
| X1 State Machine（`state-machine.ts`） | 被呼叫，不修改。`transitionStep` 的內建 retry boundary 檢查作為第二層防線 |
| X1 Event System（`events.ts`） | 被呼叫，不修改。使用既有的 event factory 函式 |
| X1 Types（`types.ts`） | 被引用，不修改。`StepError` 是 error classification 的輸入 |
| X1 Persistence（`persistence/`） | 不直接依賴。Event/Task/Step 的持久化由 caller 負責（透過 `onEvent` callback） |
| Tool Governance（`tool-governance.ts`） | 分層：Tool Governance 管理單次 execution 的 timeout/limits；Retry Policy 管理 Step 層級多 attempt 策略 |
