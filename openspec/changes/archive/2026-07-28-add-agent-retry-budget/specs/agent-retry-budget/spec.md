# Specs：add-agent-retry-budget

## ADDED Requirements

### Requirement: Error Classification MUST 正確分類所有失敗類型

Error Classification MUST 依據 `StepError.code` 與可選的 `statusCode` 將錯誤分類為 8 種 `ErrorCategory`（含 `unknown` fallback），並附帶明確的 `retryable` 判定。

#### Scenario: Timeout 錯誤分類為可重試

GIVEN 一個 `StepError` 其 `code` 為 `"TIMEOUT"`
WHEN 呼叫 `classifyError(error)`
THEN 回傳的 `ClassifiedError.category` MUST 為 `"timeout"`
AND `retryable` MUST 為 `true`

#### Scenario: 5xx 錯誤分類為可重試

GIVEN 一個 `StepError` 其 `code` 為 `"UPSTREAM_ERROR"`
AND context `{ statusCode: 502 }`
WHEN 呼叫 `classifyError(error, { statusCode: 502 })`
THEN 回傳的 `ClassifiedError.category` MUST 為 `"server_error"`
AND `retryable` MUST 為 `true`

#### Scenario: 429 錯誤分類為可重試且附帶 retryAfterMs

GIVEN 一個 `StepError` 其 `code` 為 `"RATE_LIMITED"`
AND context `{ statusCode: 429, retryAfterHeader: "5" }`
WHEN 呼叫 `classifyError(error, { statusCode: 429, retryAfterHeader: "5" })`
THEN 回傳的 `ClassifiedError.category` MUST 為 `"rate_limit"`
AND `retryable` MUST 為 `true`
AND `retryAfterMs` MUST 為 `5000`

#### Scenario: Retry-After HTTP-date 不進行不安全解析

GIVEN 一個 `StepError` 其 `code` 為 `"RATE_LIMITED"`
AND context `{ statusCode: 429, retryAfterHeader: "Wed, 21 Oct 2015 07:28:00 GMT" }`
WHEN 呼叫 `classifyError(error, context)`
THEN 回傳的 `ClassifiedError.category` MUST 為 `"rate_limit"`
AND `retryAfterMs` MUST 為 `undefined`
AND 後續 retry-after-header backoff MUST fallback 到 exponential strategy

#### Scenario: Permission Denied 錯誤不可重試

GIVEN 一個 `StepError` 其 `code` 為 `"PERMISSION_DENIED"`
WHEN 呼叫 `classifyError(error)`
THEN 回傳的 `ClassifiedError.category` MUST 為 `"permission_denied"`
AND `retryable` MUST 為 `false`

#### Scenario: Business Rejected 錯誤不可重試

GIVEN 一個 `StepError` 其 `code` 為 `"BUSINESS_REJECTED"`
WHEN 呼叫 `classifyError(error)`
THEN 回傳的 `ClassifiedError.category` MUST 為 `"business_rejected"`
AND `retryable` MUST 為 `false`

#### Scenario: User Cancelled 錯誤不可重試

GIVEN 一個 `StepError` 其 `code` 為 `"USER_CANCELLED"`
WHEN 呼叫 `classifyError(error)`
THEN 回傳的 `ClassifiedError.category` MUST 為 `"user_cancelled"`
AND `retryable` MUST 為 `false`

#### Scenario: Schema Invalid 錯誤為條件式

GIVEN 一個 `StepError` 其 `code` 為 `"SCHEMA_INVALID"`
WHEN 呼叫 `classifyError(error)`
THEN 回傳的 `ClassifiedError.category` MUST 為 `"schema_invalid"`
AND `retryable` MUST 為 `false`（由 caller 決定是否在 Policy 中明確加入）

#### Scenario: 未知錯誤保守處理

GIVEN 一個 `StepError` 其 `code` 無法匹配任何已知類別
AND 無 `statusCode`
WHEN 呼叫 `classifyError(error)`
THEN 回傳的 `ClassifiedError.category` MUST 為 `"unknown"`
AND `retryable` MUST 為 `false`
AND MUST NOT 拋出錯誤

#### Scenario: code 匹配優先於 statusCode

GIVEN 一個 `StepError` 其 `code` 為 `"PERMISSION_DENIED"`
AND context `{ statusCode: 500 }`（矛盾輸入：code 說權限錯誤但 HTTP 是 server error）
WHEN 呼叫 `classifyError(error, { statusCode: 500 })`
THEN code 匹配 MUST 優先
AND 回傳的 `ClassifiedError.category` MUST 為 `"permission_denied"`
AND `retryable` MUST 為 `false`

---

### Requirement: Backoff Strategy MUST 正確實作三種策略

Backoff 計算 MUST 支援 exponential、fixed 與 retry-after-header 三種策略，每種 MUST 為純函式。

#### Scenario: Exponential backoff 隨 attempt 倍增

GIVEN 使用 exponential strategy
AND `baseMs = 1000`, `maxMs = 30000`
WHEN 呼叫 `computeBackoff("exponential", 1)`（第 1 次重試）
THEN 回傳值 MUST 在 `[750, 1250]` 範圍內（baseMs=1000，含 ±25% jitter）
AND 呼叫 `computeBackoff("exponential", 2)`（第 2 次重試）
THEN 回傳值 MUST 在 `[1500, 2500]` 範圍內（baseMs*2=2000，含 jitter）
AND 呼叫 `computeBackoff("exponential", 3)`（第 3 次重試）
THEN 回傳值 MUST 在 `[3000, 5000]` 範圍內（baseMs*4=4000，含 jitter）

#### Scenario: Exponential backoff capped at maxMs

GIVEN 使用 exponential strategy
AND `maxMs = 5000`
WHEN 呼叫 `computeBackoff("exponential", 10)`（理論值遠超 maxMs）
THEN 回傳值 MUST 不超過 `maxMs * 1.25`（含 jitter 的最大值）
AND 回傳基礎值（pre-jitter）MUST 為 `5000`

#### Scenario: Fixed backoff 回傳恆定值

GIVEN 使用 fixed strategy
AND `baseMs = 2000`, `jitter: false`
WHEN 呼叫 `computeBackoff("fixed", 1)`
THEN 回傳值 MUST 為 `2000`
AND 呼叫 `computeBackoff("fixed", 5)` 亦 MUST 回傳 `2000`

#### Scenario: Retry-after-header 使用 header 值

GIVEN 使用 retry-after-header strategy
AND `retryAfterMs = 10000`
WHEN 呼叫 `computeBackoff("retry-after-header", 1, { retryAfterMs: 10000 })`
THEN 回傳值（pre-jitter）MUST 為 `10000`

#### Scenario: Retry-after-header 無值時 fallback 到 exponential

GIVEN 使用 retry-after-header strategy
AND `retryAfterMs` 未提供
WHEN 呼叫 `computeBackoff("retry-after-header", 1)`
THEN MUST fallback 到 exponential strategy 的行為

#### Scenario: Jitter 可關閉

GIVEN 使用 exponential strategy
AND `jitter: false`
WHEN 呼叫 `computeBackoff("exponential", 1, { jitter: false })`
THEN 回傳值 MUST 為精確的 `baseMs`（無隨機變化）

---

### Requirement: Retry Budget Tracker MUST 強制執行上限

Retry Budget Tracker MUST 追蹤 attempts 與 elapsed time，並在任一上限達到時回傳 exhausted。

#### Scenario: 未超過上限時允許重試

GIVEN 一個 RetryBudget
AND `attempts = 1`, `maxAttempts = 3`（已執行 1 次，總執行次數上限為 3）
AND `startedAt = Date.now() - 10000`, `maxElapsedMs = 60000`
AND 無 AbortSignal
WHEN 呼叫 `checkBudget(budget)`
THEN `BudgetCheckResult.exhausted` MUST 為 `false`
AND `canRetry` MUST 為 `true`

#### Scenario: maxAttempts 耗盡

GIVEN 一個 RetryBudget
AND `attempts = 3`, `maxAttempts = 3`（已執行次數已達總執行次數上限）
WHEN 呼叫 `checkBudget(budget)`
THEN `BudgetCheckResult.exhausted` MUST 為 `true`
AND `reason` MUST 為 `"max_attempts"`
AND `canRetry` MUST 為 `false`

#### Scenario: maxElapsedMs 耗盡

GIVEN 一個 RetryBudget
AND `startedAt = Date.now() - 61000`, `maxElapsedMs = 60000`
WHEN 呼叫 `checkBudget(budget)`
THEN `BudgetCheckResult.exhausted` MUST 為 `true`
AND `reason` MUST 為 `"max_elapsed"`
AND `canRetry` MUST 為 `false`

#### Scenario: 取消訊號

GIVEN 一個 RetryBudget
AND 一個已 abort 的 AbortSignal（`signal.aborted === true`）
WHEN 呼叫 `checkBudget(budget, signal)`
THEN `BudgetCheckResult.exhausted` MUST 為 `true`
AND `reason` MUST 為 `"cancelled"`
AND `canRetry` MUST 為 `false`

#### Scenario: recordAttempt 正確遞增

GIVEN 一個 RetryBudget 其 `attempts = 0`（初始狀態，尚未執行）
WHEN 呼叫 `recordAttempt(budget)`（operation 執行後遞增）
THEN 回傳的新 budget MUST 有 `attempts = 1`（代表 1 次總執行）
AND 原始 budget MUST NOT 被修改

#### Scenario: createBudget 從 policy 初始化

GIVEN `RetryPolicy` 有 `maxAttempts = 5`, `maxElapsedMs = 30000`
WHEN 呼叫 `createBudget("step-1", policy)`
THEN 回傳的 `RetryBudget.stepId` MUST 為 `"step-1"`
AND `maxAttempts` MUST 為 `5`
AND `maxElapsedMs` MUST 為 `30000`
AND `attempts` MUST 為 `0`（初始值，尚未執行任何 operation）
AND `startedAt` MUST 為目前時間（epoch ms）

> **語意說明**：`attempts` 從 0 開始，每次 operation 執行後透過 `recordAttempt` 遞增。`maxAttempts` 是總執行次數上限（含 initial execution），與 X1 `AgentStep.maxAttempts` 語意一致。`checkBudget` 使用 `attempts >= maxAttempts` 判斷耗盡：當已執行次數達到上限時，不得再安排 retry。

---

### Requirement: Retry Executor MUST 正確編排 retry loop

Retry Executor MUST 整合 error classification、budget check、state machine transition、event emission 與 backoff delay，形成完整的 retry loop。

#### Scenario: 操作成功則不重試

GIVEN 一個 operation 在第一次呼叫即回傳 `{ output: "result" }`（無 error）
AND 一個有效的 RetryConfig
WHEN 呼叫 `executeWithRetry(operation, config)`
THEN `RetryResult.succeeded` MUST 為 `true`
AND `RetryResult.finalStep.status` MUST 為 `"succeeded"`
AND `RetryResult.budget.attempts` MUST 為 `1`（1 次總執行）
AND operation MUST 只被呼叫一次

#### Scenario: 首次執行前 budget 已耗盡

GIVEN RetryPolicy 設定 `maxElapsedMs = 0`
AND 一個尚未被呼叫的 operation
WHEN 呼叫 `executeWithRetry(operation, config)`
THEN executor MUST 在首次 operation 前呼叫 `checkBudget`
AND operation MUST NOT 被呼叫
AND `RetryResult.succeeded` MUST 為 `false`
AND `RetryResult.finalStep.status` MUST 為 `"terminal_failed"`
AND `RetryResult.finalStep.error.code` MUST 為 `"RETRY_BUDGET_EXHAUSTED"`

#### Scenario: 可重試錯誤 → retry loop 成功

GIVEN 一個 operation：
  - 第 1 次呼叫回傳 `{ error: { code: "TIMEOUT" } }`
  - 第 2 次呼叫回傳 `{ output: "result" }`（成功）
AND RetryConfig 使用 DEFAULT_RETRY_POLICY
WHEN 呼叫 `executeWithRetry(operation, config)`
THEN operation MUST 被呼叫 2 次
AND `RetryResult.succeeded` MUST 為 `true`
AND `RetryResult.finalStep.status` MUST 為 `"succeeded"`
AND `RetryResult.budget.attempts` MUST 為 `2`（1 initial + 1 retry = 2 次總執行）
AND retry loop 中 MUST 經歷：`retryable_failed` → `pending` → `running`（第二次）

#### Scenario: 超過 maxAttempts 後 terminal_failed

GIVEN 一個 operation 每次都回傳 `{ error: { code: "TIMEOUT" } }`
AND RetryPolicy 設定 `maxAttempts = 2`
WHEN 呼叫 `executeWithRetry(operation, config)`
THEN operation MUST 被呼叫 2 次（第 1 次 + 1 次 retry，總執行次數上限為 2）
AND `RetryResult.succeeded` MUST 為 `false`
AND `RetryResult.finalStep.status` MUST 為 `"terminal_failed"`
AND `RetryResult.budget.attempts` MUST 為 `2`

#### Scenario: 不可重試錯誤直接 terminal_failed

GIVEN 一個 operation 回傳 `{ error: { code: "PERMISSION_DENIED" } }`
AND RetryConfig 使用 DEFAULT_RETRY_POLICY
WHEN 呼叫 `executeWithRetry(operation, config)`
THEN operation MUST 只被呼叫 1 次
AND `RetryResult.succeeded` MUST 為 `false`
AND `RetryResult.finalStep.status` MUST 為 `"terminal_failed"`
AND MUST NOT 經歷任何 retry

#### Scenario: 取消訊號中止 retry loop

GIVEN 一個 operation 每次都回傳 `{ error: { code: "TIMEOUT" } }`
AND 一個 AbortController
AND RetryConfig 傳入 `signal = controller.signal`
WHEN retry loop 第一次 iteration 後進入 backoff wait，並呼叫 `controller.abort()`
THEN backoff wait MUST 立即結束，不等待完整 delay
AND retry loop MUST 在下一次 budget check 時停止
AND `RetryResult.finalStep.status` MUST 為 `"terminal_failed"`
AND `RetryResult.finalStep.error.code` MUST 為 `"USER_CANCELLED"`
AND Step MUST NOT 為了收斂取消而進入虛假的 `pending → running`

#### Scenario: schema_invalid 條件式重試

GIVEN 一個 operation 回傳 `{ error: { code: "SCHEMA_INVALID" } }`
AND RetryPolicy 設定 `retryableCategories: ["timeout", "rate_limit", "server_error", "schema_invalid"]`
AND `maxAttempts = 2`
AND 第 1 次 retry 後 operation 回傳成功
WHEN 呼叫 `executeWithRetry(operation, config)`
THEN `RetryResult.succeeded` MUST 為 `true`
AND operation MUST 被呼叫 2 次

#### Scenario: Step 狀態轉移序列正確

GIVEN 一個會失敗一次然後成功的 operation
AND RetryConfig 使用 DEFAULT_RETRY_POLICY
WHEN 呼叫 `executeWithRetry(operation, config)`
THEN `transitionStep` MUST 按以下順序被呼叫：
  1. `running → retryable_failed`
  2. `retryable_failed → pending`
  3. `pending → running`（retry）
  4. `running → succeeded`（最終成功）

#### Scenario: 非法狀態轉移時不進入 retry

GIVEN config.step 的 status 不是 `"running"`（例如是 `"succeeded"`，一個已完成的 step）
WHEN 呼叫 `executeWithRetry(operation, config)`
THEN `transitionStep(step, 'retryable_failed')` 會回傳 `{ valid: false }`
AND retry loop MUST NOT 執行
AND `RetryResult.succeeded` MUST 為 `false`

---

### Requirement: RetryPolicy MUST 支援 per-Step 自訂

RetryPolicy MUST 可由 caller 自訂且支援 DEFAULT_RETRY_POLICY 作為 fallback。

#### Scenario: 未指定 Policy 時使用預設值

GIVEN 未傳入自訂 RetryPolicy
WHEN 使用 RetryPolicy
THEN MUST 使用 `DEFAULT_RETRY_POLICY`（maxAttempts=3（總執行最多 3 次，即 1 initial + 最多 2 retries）, maxElapsedMs=60000, exponential + jitter）

#### Scenario: Per-Step 覆蓋 Policy

GIVEN 某 Step 需要禁止 retry（`maxAttempts = 1`, `maxElapsedMs = 5000`）（總執行最多 1 次）
WHEN 傳入自訂 `RetryPolicy`
THEN 自訂值 MUST 覆蓋預設值
AND 該 Step 的 retry 行為 MUST 遵守自訂 policy
AND Retry Executor 使用的 immutable effective step copy 之 `maxAttempts` MUST 與 policy 相同

#### Scenario: 自訂 retryableCategories

GIVEN 某 Step 需要對 `schema_invalid` 做單次修復重試
WHEN 傳入 `retryableCategories: ["timeout", "rate_limit", "server_error", "schema_invalid"]`
THEN `schema_invalid` 錯誤 MUST 被視為可重試

---

### Requirement: BFF Cancel Signal MUST 能傳播到 Backend Retry Loop

BFF 的 client disconnect MUST 能透過 AbortSignal 中止後端正執行的 retry loop。

#### Scenario: Client disconnect 中止 retry

GIVEN BFF 與 backend 之間使用 AbortController/AbortSignal
AND backend retry loop 正在執行（等待可取消的 backoff delay）
WHEN client disconnect 導致 BFF abort controller
THEN backoff wait MUST 立即結束
AND backend retry loop MUST 在下一次 budget check 偵測到 cancelled
AND retry loop MUST 停止
AND Step MUST 轉移至 `terminal_failed` with error code `"USER_CANCELLED"`

#### Scenario: 無 AbortSignal 時 retry loop 正常運作

GIVEN RetryConfig 未傳入 `signal`（`undefined`）
WHEN retry loop 執行
THEN `checkBudget` MUST NOT 因為 signal 而回傳 cancelled
AND retry loop MUST 正常運作至成功或耗盡 budget

---

### Requirement: 全部模組 MUST 不依賴任何業務常數

Retry 框架的每個模組 MUST 為純 Runtime，不 import 任何業務 Step 名稱、Domain constant 或業務邏輯。

#### Scenario: 無業務 import

GIVEN `backend/src/runtime/retry/` 下的所有模組
WHEN 檢查 import 路徑
THEN MUST NOT import 任何來自業務層（如 `tools/weather*`、`prompts.ts` 中的業務邏輯）的模組
AND MUST 只依賴 `../types.ts`、`../state-machine.ts`、`../events.ts`（X1 Runtime 模組）

#### Scenario: Error category 不包含業務語意

GIVEN `ErrorCategory` union type
WHEN 檢查所有可能值
THEN MUST NOT 包含任何業務相關類別（如 `"weather_api_error"`、`"recommendation_timeout"`）
AND 所有 category MUST 為通用錯誤類型（timeout、rate_limit、server_error、schema_invalid、permission_denied、business_rejected、user_cancelled、unknown）
