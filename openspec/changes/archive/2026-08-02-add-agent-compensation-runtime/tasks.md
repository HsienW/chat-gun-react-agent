# Tasks：add-agent-compensation-runtime

## Phase 1：Compensation 型別與 Registry（backend）

### Task 1.1：建立 Compensation Action 型別模組

- [x] 建立 `backend/src/runtime/compensation/compensation-action.ts`
- [x] 定義 `CompensationAction<TContext>` 介面（actionId、description、execute、isReversible）
- [x] 定義 `CompensationActionResult` 介面（status: "compensated" | "failed"、error?）
- [x] 定義 `CompensationError` 介面（message、code?、detail?）
- [x] 定義 `CompensationPlan` 介面（taskId、failureStepId、failureReason、completedSteps、irreversibleSteps）
- [x] 定義 `CompensationStepEntry` 介面（stepId、stepName、actions）
- [x] 定義 `CompensationResult` 介面（taskId、totalActions、succeeded、failed、skippedIrreversible、overallStatus、failures、skippedIrreversibleActions）
- [x] 定義 `CompensationFailureEntry` 介面（stepId、actionId、error）
- [x] 定義 `SkippedIrreversibleEntry` 介面（stepId、actionId、reason）
- [x] 定義 `CompensateOptions` 介面（reason?、context?）
- [x] 不定義任何業務 Step 名稱或 Domain constant

**驗收：** TypeScript 編譯通過，型別可被其他模組正確引用

---

### Task 1.2：建立 Compensation Registry

- [x] 建立 `backend/src/runtime/compensation/compensation-registry.ts`
- [x] 定義 `CompensationRegistry` 介面（register、deregister、getActions、hasActions）
- [x] 實作 `CompensationRegistryImpl` class（純記憶體，Map<string, CompensationAction[]>）
- [x] `register(stepName, action)` — 新增補償動作至指定 stepName
- [x] `deregister(stepName, actionId)` — 依 actionId 移除；若 stepName 下無 action 則清除 key
- [x] `getActions(stepName)` — 回傳該 stepName 的所有 action（複製陣列防止外部修改）；未註冊則回傳空陣列
- [x] `hasActions(stepName)` — 回傳 boolean
- [x] 單元測試：register、重複 register（append）、deregister、deregister 不存在的 actionId、getActions 回傳不可變、hasActions

**驗收：** `cd backend && npx vitest run src/runtime/compensation/compensation-registry.test.ts` 全部通過

---

### Task 1.3：建立 Compensation Barrel Export

- [x] 建立 `backend/src/runtime/compensation/index.ts`
- [x] 匯出所有公開型別：`CompensationAction`、`CompensationActionResult`、`CompensationError`、`CompensationPlan`、`CompensationStepEntry`、`CompensationResult`、`CompensationFailureEntry`、`SkippedIrreversibleEntry`、`CompensateOptions`
- [x] 匯出 `CompensationRegistry` interface 與 `CompensationRegistryImpl`
- [x] 匯出 `SagaOrchestrator` interface 與 `SagaOrchestratorImpl`（Task 2.1）

**驗收：** TypeScript 編譯通過，其他模組可 import from `../compensation`

---

## Phase 2：Saga Orchestrator（backend）

### Task 2.1：建立 Saga Orchestrator

- [x] 建立 `backend/src/runtime/compensation/saga-orchestrator.ts`
- [x] 定義 `SagaOrchestrator` 介面（compensate 方法）
- [x] 實作 `SagaOrchestratorImpl` class，建構子注入 X1 既有 repository interface：`TaskRepository`、`StepRepository`、`EventRepository`、X3 `AuditLogger`、`CompensationRegistry`（共 5 個依賴）
- [x] 不自訂 `TaskReader`/`TaskEventWriter` 介面，直接使用 X1 既有的 `TaskRepository`、`StepRepository`、`EventRepository`（定義於 `backend/src/runtime/persistence/`）
- [x] 實作 `compensate(taskId, opts?)`：
  0. 驗證 Task status 為 `"partially_failed"` 或 `"cancelled"`（X1 定義的合法前置狀態），否則拋出 Error
  1. 透過 `TaskRepository.findById()` 讀取 Task 與 Steps
  2. 決定補償範圍（succeeded 的 Step，排除失敗點）
  3. Task 轉至 `"compensating"`（`TaskRepository.updateStatus(taskId, "compensating")`）
  4. 寫入 `compensation.triggered` audit event + `compensation_triggered` task event（使用 X1 `createCompensationTriggeredEvent` + `EventRepository.append()`）
  5. 逆序迭代 completedSteps：
     - Step 狀態從 `"succeeded"` 轉至 `"compensating"`（`StepRepository.updateStatus()`）
     - 查詢 `CompensationRegistry.getActions(stepName)`
     - 迭代每個 action：
       - 若 `isReversible === false` → 記錄 `compensation.action_skipped_irreversible` 至 Audit（僅 Audit），不執行
       - 若 `isReversible === true` → try/catch 執行 `execute(context)`，成功記錄 `compensation.action_succeeded` 至 Audit，失敗記錄 `compensation.action_failed` 至 Audit（僅 Audit，不寫 TaskEvents），不中斷補償鏈
       - `context` 包含 `{ taskId, stepId, ...opts.context }`
     - Step 轉至 `"compensated"`（`StepRepository.updateStatus()`）
  6. 彙總 CompensationResult
  7. Task 轉至 `"failed"`（`TaskRepository.updateStatus(taskId, "failed")`，X1 `compensating → failed` 合法 transition）
  8. 寫入 `compensation.completed` audit event + `compensation_completed` task event（使用 X1 `createCompensationCompletedEvent` + `EventRepository.append()`）
- [x] 處理邊界案例：無 succeeded Step（不進入 compensating，直接 return no_actions_needed）、無註冊 action（跳過）、全部 action 為 irreversible（全部跳過並記錄）
- [x] 單元測試（使用 mock TaskRepository、StepRepository、EventRepository、AuditLogger、CompensationRegistry）：
  - 正常補償 A+B（C 失敗），Task: partially_failed → compensating → failed
  - 無需補償（第一個 Step 就失敗，無 succeeded）
  - 不可逆操作跳過
  - 混合可逆/不可逆
  - 補償動作失敗後繼續（per-action 失敗僅 Audit）
  - user_cancelled reason
  - Task status 非 partially_failed/cancelled 時拋出錯誤

**驗收：** `cd backend && npx vitest run src/runtime/compensation/saga-orchestrator.test.ts` 全部通過

---

## Phase 3：合規檢查

### Task 3.1：合規檢查

- [x] `cd backend && npm run lint` 通過
- [x] `cd backend && npm run test` 全部通過（含所有新增 compensation 測試）
- [x] `cd backend && npm run build` 通過
- [x] 確認無 `any` 濫用
- [x] 確認無硬編碼業務 Step 名稱
- [x] 確認 Compensation 模組不 import 任何業務模組（僅依賴 X1 types/events/persistence repository interfaces、X3 audit interface）
- [x] 確認不修改任何 X1/X2/X3 既有模組
- [x] 確認所有公開函式有正確的 TypeScript 型別標註
- [x] `openspec validate add-agent-compensation-runtime --strict` 通過

**驗收：** Backend lint/test/build 全部通過，OpenSpec strict validation 0 issues
