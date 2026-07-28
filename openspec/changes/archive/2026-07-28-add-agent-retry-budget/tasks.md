# Tasks：add-agent-retry-budget

## Phase 1：Error Classification 與 Backoff（backend）

### Task 1.1：建立 Error Classification 系統

- [x] 建立 `backend/src/runtime/retry/error-classification.ts`
- [x] 定義 `ErrorCategory` union type（8 種：timeout、rate_limit、server_error、schema_invalid、permission_denied、business_rejected、user_cancelled、unknown）
- [x] 定義 `ClassifiedError` 介面（category、code、message、retryable、retryAfterMs?、originalError）
- [x] 實作 `classifyError(error: StepError, context?: { statusCode?: number; retryAfterHeader?: string }): ClassifiedError` 純函式
- [x] 分類規則優先級：code 匹配 > statusCode 匹配 > unknown fallback
- [x] `retryAfterHeader` 解析為 ms（例如 `"5"` → `5000`）；HTTP-date 或其他非數字格式不解析，使 backoff fallback 到 exponential
- [x] 單元測試：每種 error category 正確分類、邊界情況（矛盾輸入、缺失 context、HTTP-date fallback）

**驗收：** `cd backend && npx vitest run src/runtime/retry/error-classification.test.ts` 全部通過

---

### Task 1.2：實作 Backoff Strategy

- [x] 建立 `backend/src/runtime/retry/backoff.ts`
- [x] 定義 `BackoffOptions` 介面（baseMs、maxMs、retryAfterMs、jitter）
- [x] 實作 `computeBackoff(strategy, attempt, opts?): number` 純函式
- [x] Exponential: `min(baseMs * 2^(attempt-1), maxMs)`
- [x] Fixed: 恆定 `baseMs`
- [x] Retry-After: 使用 `retryAfterMs`，fallback 到 exponential
- [x] Jitter: `delay * (0.75 + Math.random() * 0.5)`，可關閉（`jitter: false`）
- [x] 單元測試：驗證 delay 範圍、jitter 邊界、max cap、fallback 行為

**驗收：** `cd backend && npx vitest run src/runtime/retry/backoff.test.ts` 全部通過

---

## Phase 2：Retry Policy 與 Budget Tracker（backend）

### Task 2.1：建立 Retry Policy 型別

- [x] 建立 `backend/src/runtime/retry/retry-policy.ts`
- [x] 定義 `RetryPolicy` 介面（maxAttempts、maxElapsedMs、retryableCategories、backoffStrategy、jitter）
- [x] 匯出 `DEFAULT_RETRY_POLICY` 常數
- [x] 確保 `retryableCategories` 預設為 `["timeout", "rate_limit", "server_error"]`

**驗收：** TypeScript 編譯通過，型別可被其他模組正確引用

---

### Task 2.2：實作 Retry Budget Tracker

- [x] 建立 `backend/src/runtime/retry/retry-budget.ts`
- [x] 定義 `RetryBudget` 介面（stepId、maxAttempts、maxElapsedMs、startedAt、attempts）
- [x] 定義 `BudgetCheckResult` 介面（exhausted、reason?、canRetry）
- [x] 實作 `createBudget(stepId, policy): RetryBudget`（初始化 attempts = 0）
- [x] 實作 `checkBudget(budget, signal?): BudgetCheckResult`（檢查邏輯：cancelled > `attempts >= maxAttempts` > max_elapsed）
- [x] 實作 `recordAttempt(budget): RetryBudget`（immutable 更新）
- [x] Budget 檢查優先級：cancelled > max_attempts > max_elapsed
- [x] 單元測試：每種 exhausted 條件、cancellation、Immutable 更新驗證

**驗收：** `cd backend && npx vitest run src/runtime/retry/retry-budget.test.ts` 全部通過

---

## Phase 3：Retry Executor 組合層（backend）

### Task 3.1：實作 Retry Executor

- [x] 建立 `backend/src/runtime/retry/retry-executor.ts`
- [x] 定義 `RetryConfig` 介面（policy?、step、taskId、signal?、onEvent）；未提供 policy 時使用 `DEFAULT_RETRY_POLICY`
- [x] 定義 `RetryResult` 介面（finalStep、budget、succeeded）
- [x] 實作 `executeWithRetry(operation, config): Promise<RetryResult>`
- [x] 整合流程：execute → recordAttempt → classifyError → checkBudget → transitionStep → event emission → backoff → retry
- [x] 首次 operation 前檢查 budget；已取消、elapsed 已耗盡或總執行次數上限無效時不得執行 operation
- [x] 使用 effective policy 建立 immutable effective step copy，令 `step.maxAttempts` 與 `policy.maxAttempts` 同步，避免 X1 state machine 與 X2 budget 邊界分歧
- [x] Retry loop 中正確呼叫 X1 `transitionStep` 狀態轉移序列：
  - 每次 operation 執行後呼叫 `recordAttempt(budget)` 計入總執行次數
  - 失敗且 retryable：先 `recordAttempt`，再 `checkBudget` → `attempts >= maxAttempts` 或其他 exhausted 原因則 `terminal_failed`
  - canRetry：`running → retryable_failed` → 發 `step_failed` event
  - 發 `step_retrying` event
  - backoff wait 必須接受 `AbortSignal`；等待期間取消時立即結束並由 `retryable_failed → terminal_failed`
  - backoff 後再次檢查 budget，仍可重試才執行 `retryable_failed → pending`（準備重試）
  - `pending → running`（開始重試）
  - 最終 `running → succeeded` 或 `running → terminal_failed`
- [x] 非 retryable error：直接 `running → terminal_failed`
- [x] Budget exhausted：直接轉 `terminal_failed`
- [x] Cancelled：轉 `terminal_failed` with code `"USER_CANCELLED"`
- [x] 整合測試：成功、retry 後成功、maxAttempts 總執行次數耗盡、非 retryable、首次執行前 budget 耗盡、backoff 期間取消、狀態轉移序列

**驗收：** `cd backend && npx vitest run src/runtime/retry/retry-executor.test.ts` 全部通過

---

### Task 3.2：建立 retry module barrel export

- [x] 建立 `backend/src/runtime/retry/index.ts`
- [x] 匯出所有公開型別：`ErrorCategory`、`ClassifiedError`、`RetryPolicy`、`RetryBudget`、`BudgetCheckResult`、`RetryConfig`、`RetryResult`、`BackoffOptions`
- [x] 匯出所有公開函式：`classifyError`、`computeBackoff`、`createBudget`、`checkBudget`、`recordAttempt`、`executeWithRetry`
- [x] 匯出 `DEFAULT_RETRY_POLICY`

**驗收：** TypeScript 編譯通過，其他模組可 import from `../retry`

---

## Phase 4：BFF Cancel Signal Propagation

### Task 4.1：確認並補強 BFF Cancel Signal 傳播路徑

- [x] 檢查 BFF 既有 AbortController/AbortSignal 使用狀況（`bff/src/server.ts`）
- [x] 若已有 AbortController 鏈：確認 client disconnect → backend request abort 路徑完整
- [x] 若尚無：建立最小可行 AbortSignal 傳播路徑（request handler → backend HTTP call）
- [x] 確認 `signal` 能傳入 backend agent graph node
- [x] 整合測試（若環境允許）：模擬 client cancel → backend retry loop 停止

**驗收：** BFF cancel 行為可手動驗證或自動化測試

---

## Phase 5：合規檢查

### Task 5.1：合規檢查

- [x] `cd backend && npm run lint` 通過
- [x] `cd backend && npm run test` 全部通過（含所有新增 retry 測試）
- [x] `cd backend && npm run build` 通過
- [x] `cd bff && npm run build` 通過（若 BFF 有修改）
- [x] 確認無 `any` 濫用
- [x] 確認無硬編碼業務 Step 名稱
- [x] 確認 Retry 框架不 import 任何業務模組（僅依賴 X1 `types.ts`、`state-machine.ts`、`events.ts`）
- [x] 確認所有公開函式有正確的 TypeScript 型別標註

**驗收：** Backend + BFF lint/test/build 全部通過
