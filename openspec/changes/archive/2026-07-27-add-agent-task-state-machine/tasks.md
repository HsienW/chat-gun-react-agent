# Tasks：add-agent-task-state-machine

## Phase 1：型別系統與狀態機（backend）

### Task 1.1：建立 Runtime 型別定義

- [x] 建立 `backend/src/runtime/types.ts`
- [x] 定義 `TaskStatus` union type（8 種狀態）
- [x] 定義 `StepStatus` union type（9 種狀態）
- [x] 定義 `AgentTask<TStep>` 泛型介面
- [x] 定義 `AgentStep<TStep>` 泛型介面
- [x] 定義 `StepError` 介面
- [x] 定義 `TaskEventType` union type（12 種事件）
- [x] 定義 `TaskEvent` 介面
- [x] 定義 `TransitionResult<T>` 型別（`{ valid: true; next: T } | { valid: false; reason: string }`）
- [x] 匯出 `index.ts` barrel export

**驗收：** TypeScript 編譯通過，無 `any` 濫用

---

### Task 1.2：實作 Task 狀態機

- [x] 建立 `backend/src/runtime/state-machine.ts`
- [x] 定義 Task 合法轉移矩陣（用 `Map<TaskStatus, Set<TaskStatus>>`）
- [x] 實作 `transitionTask(task, to)` 純函式
- [x] 驗證：非法轉移回傳 `{ valid: false, reason }`
- [x] 驗證：合法轉移回傳 `{ valid: true, next }` 且 `next` 是新物件
- [x] 驗證：Terminal State（completed、failed、cancelled）不接受任何轉移
- [x] 驗證：`running → failed` 直接轉移（無需補償的致命失敗）
- [x] 驗證：`waiting_confirmation → running` 轉移（resumed）
- [x] 驗證：`updatedAt` 更新
- [x] 單元測試：覆蓋所有合法與非法轉移路徑（含新增的 running→failed、waiting_confirmation→running）

**驗收：** `cd backend && npx vitest run src/runtime/state-machine.test.ts` 全部通過

---

### Task 1.3：實作 Step 狀態機

- [x] 在 `state-machine.ts` 中實作 `transitionStep(step, to, opts?)` 純函式
- [x] 定義 Step 合法轉移矩陣
- [x] 處理 `retryable_failed` 時自動遞增 `attempt`
- [x] 處理 `retryable_failed → pending` 重試路徑
- [x] 處理 `retryable_failed → terminal_failed` 超過 maxAttempts 路徑
- [x] 支援傳入 `error` 參數（`terminal_failed` 時記錄）
- [x] **Retry Boundary**：`transitionStep` 在 `retryable_failed → pending` 時 MUST 檢查 `step.attempt < step.maxAttempts`；超限時回傳 `{ valid: false, reason: "max attempts exceeded" }`
- [x] 單元測試：覆蓋所有合法與非法轉移路徑，包含 retry boundary（attempt 達上限時拒絕 pending）

**驗收：** `cd backend && npx vitest run src/runtime/state-machine.test.ts` 全部通過

---

### Task 1.4：實作 TaskEvent 建立工具

- [x] 建立 `backend/src/runtime/events.ts`
- [x] 實作每個 event type 的 factory 函式：
  - `createTaskCreatedEvent(task)`
  - `createStepStartedEvent(taskId, step)`
  - `createStepCompletedEvent(taskId, step)`
  - `createStepFailedEvent(taskId, step, error)`
  - `createStepRetryingEvent(taskId, step)`
  - `createTaskCompletedEvent(task)`
  - `createTaskFailedEvent(task, error)`
  - `createCompensationTriggeredEvent(task)`
  - `createCompensationCompletedEvent(task)`
  - `createWaitingConfirmationEvent(task, step?)`
  - `createResumedEvent(task)`
  - `createTaskCancelledEvent(task)`
- [x] 每個 factory 產生符合 `TaskEvent` 介面的物件
- [x] eventId 使用 `globalThis.crypto.randomUUID()`（Node 22+ 原生，不新增 uuid 依賴）
- [x] 單元測試：驗證每個 factory 產出正確結構

**驗收：** `cd backend && npx vitest run src/runtime/events.test.ts` 全部通過

---

## Phase 2：PostgreSQL Persistence（backend）

### Task 2.1：建立 DB 連線管理

- [x] 建立 `backend/src/runtime/persistence/connection.ts`
- [x] 使用 `platform/env.ts` 的 `getEnv('DATABASE_URL')` 讀取連線字串（遵循既有慣例）
- [x] 建立 pg Pool（支援 pool size 設定、TLS/SSL 配置）：
  - 本地開發：`PGSSLMODE=disable`；生產環境：`PGSSLMODE=require`
  - sslmode 可透過 DATABASE_URL query parameter 或 PGSSLMODE 環境變數設定
- [x] 提供 `getPool()` 與 `closePool()` 函式
- [x] 若無 DATABASE_URL，匯出明確的 not-configured 狀態（不 crash）
- [x] 安裝 `pg` 與 `@types/pg`（若尚未安裝）
- [x] **DB 架構說明**：runtime 的三張表存入與 LangGraph API 相同的 PostgreSQL 實例（`langgraph-postgres`），使用 default schema。這是 backend 首次直接存取 PostgreSQL，不影響 LangGraph 平台自行管理的內部表。

**驗收：** Pool 建立成功，可被其他 module import

---

### Task 2.2：建立 Migration 系統

- [x] 建立 `backend/src/runtime/persistence/migrations/` 目錄
- [x] 建立 `001_create_agent_tasks.sql`（up + down）
- [x] 建立 `002_create_task_steps.sql`（up + down）
- [x] 建立 `003_create_task_events.sql`（up + down）
- [x] 建立 `migration-runner.ts`：依序執行 up/down migration
- [x] Migration runner 記錄已執行的 migration（`_migrations` tracking table）

**驗收：** Migration up 後三張表存在；down 後三張表移除；重複 up 不報錯

---

### Task 2.3：實作 Task Repository

- [x] 建立 `backend/src/runtime/persistence/task-repository.ts`
- [x] `create(task)`: INSERT INTO agent_tasks
- [x] `findById(taskId)`: SELECT + JOIN task_steps
- [x] `updateStatus(taskId, status)`: UPDATE status + updated_at
- [x] `update(taskId, patch)`: partial UPDATE
- [x] 整合測試：實際寫入 PostgreSQL 並查詢

**驗收：** Integration test 通過（需要 DATABASE_URL）

---

### Task 2.4：實作 Step Repository

- [x] 建立 `backend/src/runtime/persistence/step-repository.ts`
- [x] `create(step)`: INSERT INTO task_steps
- [x] `findById(stepId)`: SELECT
- [x] `findByTaskId(taskId)`: SELECT WHERE task_id
- [x] `updateStatus(stepId, status, opts?)`: UPDATE status + error/output/timestamps
- [x] 整合測試

**驗收：** Integration test 通過

---

### Task 2.5：實作 Event Repository

- [x] 建立 `backend/src/runtime/persistence/event-repository.ts`
- [x] `append(event)`: INSERT INTO task_events
- [x] `findByTaskId(taskId)`: SELECT ORDER BY created_at
- [x] 整合測試
- [x] `streamByTaskId(taskId)` 留 stub（本 Change 先不做 real-time stream，後續 Change 補）

**驗收：** Integration test 通過

---

## Phase 3：前端 Timeline 元件（frontend）

### Task 3.1：建立前端 Task/Step 型別

- [x] 建立 `frontend/src/lib/task-types.ts`（與 backend 對齊的型別定義）
- [x] 不依賴 backend 原始碼，複製必要型別
- [x] 確保與 backend `types.ts` 相容
- [x] 新增型別相容性測試：`frontend/src/lib/__tests__/task-types-compat.test.ts`
  - 使用 TypeScript 結構比對驗證 frontend 型別與 backend 型別相容
  - 測試覆蓋 `TaskStatus`、`StepStatus`、`TaskEventType` 所有值

**驗收：** TypeScript 編譯通過 + 型別相容性測試通過

---

### Task 3.2：實作 taskEventReducer

- [x] 建立 `frontend/src/lib/task-event-reducer.ts`
- [x] 從 `task_created` event 初始化 `AgentTask`
- [x] 從 `step_started` 更新對應 Step 為 running
- [x] 從 `step_completed` 更新對應 Step 為 succeeded
- [x] 從 `step_failed` 更新對應 Step 為 retryable_failed 或 terminal_failed
- [x] 從 `step_retrying` 更新 attempt 並設為 running
- [x] 從 `task_completed` / `task_failed` 更新 Task 終端狀態
- [x] 從 `waiting_confirmation` 更新 Task/Step 為 waiting 狀態
- [x] 從 `task_cancelled` 更新 Task status 為 cancelled
- [x] 從 `compensation_triggered` 更新 Task status 為 compensating
- [x] 從 `compensation_completed` 更新相關 Step 為 compensated、Task 為 failed
- [x] 從 `resumed` 更新 Task status 從 waiting_confirmation 回到 running
- [x] 未知 eventType 安全忽略
- [x] 單元測試：覆蓋全部 12 種 event 類型與 edge case

**驗收：** `cd frontend && npx vitest run src/lib/task-event-reducer.test.ts` 全部通過

---

### Task 3.3：建立 TaskTimeline 元件

- [x] 建立 `frontend/src/components/AgentTaskTimeline/AgentTaskTimeline.tsx`
- [x] 建立 `frontend/src/components/AgentTaskTimeline/TaskHeader.tsx`（taskType、status badge、duration）
- [x] 建立 `frontend/src/components/AgentTaskTimeline/StepList.tsx`
- [x] 建立 `frontend/src/components/AgentTaskTimeline/StepItem.tsx`（stepName、status icon、attempt、error）
- [x] 使用 `useTaskEvents` hook（mock event stream 驅動）
- [x] 支援 empty state
- [x] 支援 loading state（task 存在但無 step 完成）
- [x] 元件測試：使用 React Testing Library

**驗收：** `cd frontend && npx vitest run src/components/AgentTaskTimeline/` 全部通過

---

### Task 3.4：建立 useTaskEvents hook（mock）

- [x] 建立 `frontend/src/components/AgentTaskTimeline/useTaskEvents.ts`
- [x] 本 Change 使用 mock data 模擬 event stream
- [x] 提供 `useTaskEvents(mockTaskId)` → `{ task, events, isLoading, error }`
- [x] Mock data 包含完整 Task 生命週期（created → running → completed）
- [x] 將來可替換為真實 BFF event stream

**驗收：** Hook 回傳正確結構，Timeline 元件可正常渲染

---

## Phase 4：整合驗證

### Task 4.1：Backend 完整生命週期整合測試

- [x] 建立 `backend/src/runtime/__tests__/integration.test.ts`
- [x] 測試路徑：建立 Task → 建立 Steps → 依序 transition → 驗證最終狀態
- [x] 測試路徑：Task 取消後 Step 不得再 transition
- [x] 測試路徑：Step retry → 超過 maxAttempts → terminal_failed
- [x] 使用真實 PostgreSQL（需要 DATABASE_URL）

**驗收：** `cd backend && npx vitest run src/runtime/__tests__/integration.test.ts` 通過

---

### Task 4.2：合規檢查

- [x] `cd backend && npm run lint` 通過
- [x] `cd backend && npm run test` 全部通過（含新增測試）
- [x] `cd backend && npm run build` 通過
- [x] `cd frontend && npm run lint` 通過
- [x] `cd frontend && npm run test` 全部通過
- [x] `cd frontend && npm run build` 通過
- [x] 確認無 `any` 濫用
- [x] 確認無硬編碼業務常數
- [x] 確認 metadata 欄位使用 JSONB 而非文字解析

**驗收：** 三套件 lint + test + build 全部通過
