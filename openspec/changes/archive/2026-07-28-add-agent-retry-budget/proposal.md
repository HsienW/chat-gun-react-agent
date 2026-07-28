# Proposal：add-agent-retry-budget

## 變更定位

純 Runtime，零業務依賴。在 X1 Task/Step State Machine 之上建立通用的 Step-level Retry Policy 框架，依據錯誤類型區分重試策略，並強制執行 Budget 上限。

## 問題描述

X1 的狀態機已定義 `retryable_failed` / `terminal_failed` 狀態和 `attempt` / `maxAttempts` 欄位，也內建了 `attempt < maxAttempts` 的邊界檢查。但目前缺失：

1. **沒有錯誤分類** — 無法區分 Timeout、5xx、429、Permission Denied、Business Rejected 等不同失敗類型
2. **沒有 Retry 策略** — 不知道何時該重試、何時不該重試；沒有 backoff 機制（exponential / fixed / retry-after-header）
3. **沒有 Budget 控制** — 除了 `maxAttempts` 之外沒有 elapsed time 上限；沒有 hard-stop 機制防止資源消耗失控
4. **沒有 BFF 取消傳播** — 使用者取消請求後，正在 retry 的 backend step 無法感知並停止

## 解決方案

建立四層結構：

1. **Error Classification** — 純函式，將 `StepError` 分類為 8 種 `ErrorCategory`（含 `unknown` fallback），並附帶 `retryable` 判定
2. **Backoff Strategy** — 純函式，計算 exponential / fixed / retry-after-header delay，含 jitter
3. **Retry Policy + Budget Tracker** — 可配置 policy（maxAttempts、maxElapsedMs、backoffStrategy、jitter）與 immutable budget tracker
4. **Retry Executor** — 組合層，整合 classification → budget check → state transition → event emission → backoff delay，執行完整 retry loop

## 目標

- ✅ Error Classification 框架：8 種 error category（含 `unknown` fallback），每種有明確的 retryable / non-retryable / conditional 判定
- ✅ Retry Policy：可配置 per-Step，含 maxAttempts、maxElapsedMs、backoffStrategy、jitter
- ✅ Retry Budget Tracker：追蹤 attempts 與 elapsed time，hard-stop on budget exhaustion
- ✅ Backoff Strategy：exponential / fixed / retry-after-header，含 ±25% jitter
- ✅ Retry Executor：組合 classification + budget + backoff + state machine + event emission
- ✅ BFF Cancel Signal Propagation：AbortSignal 鏈從 BFF 傳遞到 backend retry loop
- ✅ 純 Runtime，不 import 任何業務常數

## 非目標

- ❌ Idempotency（X3）
- ❌ Compensation（X4）
- ❌ Distributed Lock（X5）
- ❌ Tool Governance 層級的 retry（Tool Governance 管理單次 tool execution 的 timeout/limits；Retry Policy 管理 Step 層級的重試策略決策）
- ❌ Model Provider 層級的 retry/fallback（屬於 X8 Model Fault Tolerance）
- ❌ 修改 X1 狀態機核心邏輯（X2 的 Retry Executor 只**呼叫** X1 的 `transitionStep`，不修改狀態機本身）

## 受影響範圍

| 套件 | 影響 |
|------|------|
| backend | 新增 `src/runtime/retry/` 目錄：error-classification、backoff、retry-policy、retry-budget、retry-executor |
| bff | Cancel signal propagation：確認 AbortSignal 能從 BFF 傳遞到 backend agent graph node |
| frontend | 本次不變動 |

## 與 X1 的關係

X1 提供的基礎：
- `AgentStep.attempt` / `AgentStep.maxAttempts` — retry boundary 的計數基礎（語意：總執行次數上限，包含 initial execution。例如 `maxAttempts = 3` 表示總執行次數最多 3 次，即 1 次 initial + 最多 2 次 retry）
- `StepStatus.retryable_failed` / `StepStatus.terminal_failed` — 狀態機區分可重試與不可重試失敗
- `transitionStep()` 內建的 `attempt < maxAttempts` 檢查 — retry boundary 驗證（作為第二層防線）
- `TaskEventType.step_retrying` — retry 事件型別已定義
- `createStepRetryingEvent()` — retry event factory 已實作

X2 在 X1 之上新增**策略層**：何時 retry、如何 backoff、何時 hard-stop。Retry Executor 呼叫 X1 的狀態機和 event factory，不修改它們。

## 風險

| 風險 | 緩解 |
|------|------|
| Retry 分類邏輯與既有 Tool Governance 的 timeout 機制衝突 | 使用獨立 error code namespace；Retry 層讀取 Tool Governance 產生的 error code，不重複實作 timeout |
| Backoff 可能導致 Task 長時間卡住 | maxElapsedMs hard-stop；首次執行前、每次失敗後及 backoff 後均檢查 budget，超時後強制轉 terminal_failed |
| BFF cancel 無法到達正在 retry 的 backend | 使用標準 AbortSignal / AbortController 鏈；retry loop 每次 iteration 檢查 signal.aborted，且 backoff wait 可被 AbortSignal 立即中止 |
| `computeBackoff` 使用隨機數（jitter）影響純函式可測試性 | 接受 jitter 的隨機性是可接受的副作用；測試時驗證 delay 落在合理範圍內而非精確值 |

## 回滾策略

- `backend/src/runtime/retry/` 為全新目錄，刪除即可回滾
- 不修改 X1 狀態機、event system 或 persistence 層
- BFF cancel propagation 為最小變更（確認既有 AbortController 鏈可用）
