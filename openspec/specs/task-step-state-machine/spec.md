# task-step-state-machine Specification

## Purpose
TBD - created by archiving change add-agent-task-state-machine. Update Purpose after archive.
## Requirements
### Requirement: Task 狀態機 MUST 支援完整生命週期

Task 狀態機 MUST 涵蓋 created、running、waiting_confirmation、completed、partially_failed、compensating、failed 與 cancelled 八種狀態，以及所有合法轉移路徑。

#### Scenario: Task 正常完成

GIVEN 一個 status 為 `created` 的 Task
WHEN Task 開始執行
THEN Task status MUST 依序轉移：`created` → `running` → `completed`

#### Scenario: Task 需要等待使用者確認

GIVEN 一個 status 為 `running` 的 Task
WHEN 某 Step 需要 Human-in-the-loop 確認
THEN Task status MUST 轉移為 `waiting_confirmation`
AND Task MUST 可以從 `waiting_confirmation` 轉移為 `completed`（確認通過）
AND Task MUST 可以從 `waiting_confirmation` 轉移為 `cancelled`（使用者取消）

#### Scenario: Task 部分失敗後進入補償

GIVEN 一個 status 為 `running` 的 Task
WHEN 部分 Step 失敗且無法重試
THEN Task status MUST 轉移為 `partially_failed`
AND Task MUST 可以從 `partially_failed` 轉移為 `compensating`
AND Task MUST 從 `compensating` 只能轉移為 `failed`

#### Scenario: Task 遭遇不可恢復的致命失敗

GIVEN 一個 status 為 `running` 的 Task
AND 沒有任何 Step 已完成（無副作用需補償）
WHEN Task 遭遇不可恢復的致命錯誤（如系統崩潰、未預期異常）
THEN Task status MUST 可轉移為 `failed`
AND MUST NOT 經過補償流程

#### Scenario: Task 補償完成後到達失敗

GIVEN 一個 status 為 `compensating` 的 Task
AND 所有已完成 Step 的補償動作已執行
WHEN 補償流程結束
THEN Task status MUST 轉移為 `failed`
AND MUST 記錄所有補償結果

#### Scenario: Task 取消

GIVEN 一個 status 為 `created` 或 `running` 或 `waiting_confirmation` 的 Task
WHEN Task 被取消
THEN Task status MUST 轉移為 `cancelled`
AND `cancelled` 為 Terminal State，MUST NOT 再轉移到其他狀態

#### Scenario: 非法狀態轉移必須拒絕

GIVEN 一個 status 為 `completed` 的 Task
WHEN 嘗試將其轉移為 `running`
THEN 狀態機 MUST 回傳 `{ valid: false, reason: "..." }`
AND Task status MUST NOT 改變

---

### Requirement: Step 狀態機 MUST 支援完整生命週期

Step 狀態機 MUST 涵蓋 pending、running、waiting_confirmation、succeeded、retryable_failed、terminal_failed、compensating、compensated 與 skipped 九種狀態，以及所有合法轉移路徑。

#### Scenario: Step 正常完成

GIVEN 一個 status 為 `pending` 的 Step
WHEN Step 開始執行
THEN Step status MUST 依序轉移：`pending` → `running` → `succeeded`

#### Scenario: Step 可重試失敗

GIVEN 一個 status 為 `running` 的 Step
AND Step 的 `attempt` < `maxAttempts`
WHEN Step 遇到可重試錯誤（如 timeout、5xx）
THEN Step status MUST 轉移為 `retryable_failed`
AND Step MUST 可以從 `retryable_failed` 轉移回 `pending`（準備重試）
AND `attempt` counter MUST 遞增

#### Scenario: Step 超過最大重試次數

GIVEN 一個 status 為 `retryable_failed` 的 Step
AND Step 的 `attempt` >= `maxAttempts`
WHEN Step 不能再重試
THEN Step status MUST 轉移為 `terminal_failed`
AND MUST 記錄最終 error

#### Scenario: Step 遭遇不可重試錯誤

GIVEN 一個 status 為 `running` 的 Step
WHEN Step 遭遇不可重試的致命錯誤（如 invalid input、permission denied、business rejected）
THEN Step status MUST 轉移為 `terminal_failed`
AND MUST 記錄 error code 與 message
AND Step MUST NOT 嘗試重試

#### Scenario: Step 需要使用者確認

GIVEN 一個 status 為 `running` 的 Step
WHEN Step 需要 Human-in-the-loop 確認
THEN Step status MUST 轉移為 `waiting_confirmation`
AND MUST 從 `waiting_confirmation` 可轉移為 `succeeded`

#### Scenario: Step 略過

GIVEN 一個 status 為 `pending` 或 `running` 的 Step
WHEN 條件判斷該 Step 不需要執行
THEN Step status MUST 可以轉移為 `skipped`
AND `skipped` 為 Terminal State

#### Scenario: Step 補償

GIVEN 一個 status 為 `running` 的 Step（某個後續 Step 失敗觸發補償）
WHEN 需要補償此 Step 的副作用
THEN Step status MUST 可以轉移為 `compensating`
AND MUST 從 `compensating` 只可轉移為 `compensated`
AND `compensated` 為 Terminal State

#### Scenario: Step 非法狀態轉移必須拒絕

GIVEN 一個 status 為 `succeeded` 的 Step
WHEN 嘗試將其轉移為 `running`
THEN 狀態機 MUST 回傳 `{ valid: false, reason: "..." }`
AND Step status MUST NOT 改變

---

### Requirement: Task/Step 型別系統 MUST 為泛型設計

型別系統 MUST NOT 依賴任何具體業務 Step 名稱，使用 TypeScript 泛型讓使用方定義自己的 Step 集合。

#### Scenario: 不同業務可使用不同 Step 名稱

GIVEN 使用方定義 `type WeatherSteps = "geocode" | "fetch_forecast" | "format_result"`
AND 使用方定義 `type RecommendSteps = "extract_intent" | "vector_search" | "rerank"`
WHEN 建立 `AgentTask<WeatherSteps>` 與 `AgentTask<RecommendSteps>`
THEN 兩個 Task 的 steps 陣列 MUST 有正確的 stepName 型別
AND 型別系統 MUST NOT 知道任何具體 Step 名稱

#### Scenario: metadata 支援任意附加資訊

GIVEN 使用方需要附加業務相關 metadata（如 userId、sessionId）
WHEN 建立 AgentTask 時傳入 `metadata: { userId: "u1", sessionId: "s1" }`
THEN metadata MUST 被保存且型別為 `Record<string, unknown>`
AND metadata MUST NOT 影響狀態機行為

---

### Requirement: TaskEvent MUST 涵蓋所有生命週期事件

事件類型 MUST 完整覆蓋 Task 和 Step 的狀態變化，讓消費方可重建完整生命週期。

#### Scenario: Task 層級事件

GIVEN 一個 Task 經歷完整生命週期
WHEN Task 狀態發生變化
THEN MUST 產生對應事件：`task_created`、`task_completed`、`task_failed`、`task_cancelled`、`waiting_confirmation`、`resumed`、`compensation_triggered`、`compensation_completed`

#### Scenario: resumed 事件語意

GIVEN 一個 status 為 `waiting_confirmation` 的 Task
WHEN 使用者確認後系統需要繼續執行更多 Step
THEN Task status MUST 轉移為 `running`
AND MUST 產生 `resumed` 事件
AND 若使用者確認後 Task 無需進一步執行，SHALL 直接走 `waiting_confirmation → completed`，不產生 resumed

#### Scenario: Step 層級事件

GIVEN 一個 Step 經歷完整生命週期
WHEN Step 狀態發生變化
THEN MUST 產生對應事件：`step_started`、`step_completed`、`step_failed`、`step_retrying`

#### Scenario: 事件攜帶必要關聯資訊

GIVEN 任何 TaskEvent
WHEN 事件被產生
THEN 事件 MUST 包含 `eventId`（唯一識別）、`taskId`、`eventType`、`createdAt`
AND Step 層級事件 MUST 包含 `stepId`
AND 事件 MAY 包含 `payload`（任意附加資料）

---

### Requirement: PostgreSQL 持久層 MUST 正確儲存與查詢 Task/Step/Event

PostgreSQL MUST 作為 Task/Step/Event 的持久儲存層，提供完整的 CRUD 操作。

#### Scenario: 建立與查詢 Task

GIVEN 一個新的 AgentTask
WHEN 呼叫 `taskRepo.create(task)`
THEN Task MUST 被寫入 `agent_tasks` 表
AND 呼叫 `taskRepo.findById(taskId)` MUST 回傳該 Task 及其所有 Steps

#### Scenario: 更新 Task 狀態

GIVEN 一個已存在的 Task
WHEN 呼叫 `taskRepo.updateStatus(taskId, "running")`
THEN Task 的 status MUST 更新為 `running`
AND `updated_at` MUST 更新為目前時間

#### Scenario: 建立與查詢 Step

GIVEN 一個新的 AgentStep
WHEN 呼叫 `stepRepo.create(step)`
THEN Step MUST 被寫入 `task_steps` 表
AND 呼叫 `stepRepo.findByTaskId(taskId)` MUST 回傳該 Task 的所有 Steps

#### Scenario: 附加事件

GIVEN 一個 TaskEvent
WHEN 呼叫 `eventRepo.append(event)`
THEN Event MUST 被寫入 `task_events` 表
AND 呼叫 `eventRepo.findByTaskId(taskId)` MUST 回傳該 Task 的所有 Events（依 createdAt 排序）

#### Scenario: Migration 可逆

GIVEN 已執行的 up migration
WHEN 執行 down migration
THEN 對應資料表 MUST 被刪除
AND up migration 再次執行後 MUST 成功重建

---

### Requirement: 前端 Timeline 元件 MUST 正確渲染 Task/Step 進度

前端 MUST 提供一個獨立、可複用的 AgentTaskTimeline 元件，根據 Task/Step 狀態即時渲染進度。

#### Scenario: Timeline 顯示所有 Step 狀態

GIVEN 一個包含多個 Step 的 AgentTask（有的 succeeded、有的 running、有的 pending）
WHEN AgentTaskTimeline 元件渲染該 Task
THEN 每個 Step MUST 以不同視覺樣式區分 succeeded、running、pending、failed、skipped 等狀態
AND Step 顯示順序 MUST 與 steps 陣列一致

#### Scenario: Timeline 即時更新

GIVEN AgentTaskTimeline 已渲染一個 running 中的 Task
WHEN 新的 `step_completed` 事件抵達
THEN 對應 Step 的顯示 MUST 從 running 變為 succeeded
AND 下一個 pending Step MUST 變為 running

#### Scenario: Timeline 顯示錯誤資訊

GIVEN 一個 status 為 `terminal_failed` 的 Step
AND Step 帶有 error（code + message）
WHEN AgentTaskTimeline 渲染該 Step
THEN MUST 顯示 error code 與 message
AND MUST 顯示 attempt 次數（如 "Attempt 3/3"）

#### Scenario: Timeline 無資料狀態

GIVEN 沒有任何 Task 資料
WHEN AgentTaskTimeline 渲染
THEN MUST 顯示 empty state（例如 "No active task"）
AND MUST NOT 拋出錯誤或顯示空白

#### Scenario: Unknown event type 安全降級

GIVEN AgentTaskTimeline 收到未知的 eventType
WHEN taskEventReducer 處理該 event
THEN MUST 安全忽略該 event
AND MUST 回傳現有 state 不變
AND MUST NOT 拋出錯誤

---

### Requirement: 狀態機實作 MUST 是純函式

狀態機核心邏輯 MUST 沒有任何副作用，不碰資料庫、不發事件、不依賴外部狀態。

#### Scenario: 狀態機不執行 IO

GIVEN 呼叫 `transitionTask(task, newStatus)`
WHEN 狀態機執行轉移驗證
THEN MUST NOT 呼叫任何資料庫、檔案系統或網路
AND MUST 為同步函式（或無副作用 async）
AND 相同輸入 MUST 回傳相同輸出

#### Scenario: 狀態機回傳新物件而非修改原物件

GIVEN 一個 AgentTask 物件
WHEN 呼叫 `transitionTask(task, "running")` 成功
THEN 回傳的 `next` Task MUST 是一個新物件
AND 原始 `task` 物件 MUST NOT 被修改

---

### Requirement: Task 狀態機 MUST 支援互動生命週期狀態

Task 狀態機 MUST 在既有八種狀態之外，新增互動生命週期狀態 `cancelling`、`superseded`、`rollback_requested`、`cancelled_after_commit` 與 `manual_intervention_required`，並定義其合法轉移路徑。這些狀態不改變既有 `created → running → waiting_confirmation → completed`、`partially_failed → compensating → failed` 與 `cancelled` 的語意。

#### Scenario: 取消先進入 cancelling 再進入 cancelled

GIVEN 一個 status 為 `running` 的 Task
AND 收到取消請求（read-only 或無已提交副作用）
WHEN 取消被受理
THEN Task status MUST 先轉移為 `cancelling`
AND 待取消完成後 MUST 轉移為 `cancelled`
AND `cancelled` 為 Terminal State，MUST NOT 再轉移到其他狀態

#### Scenario: run 被取代時進入 superseded

GIVEN 一個 status 為 `running` 的 Task
AND 其對應 run 被較新 run supersede（generation 遞增）
WHEN supersede 發生
THEN Task status MUST 轉移為 `superseded`
AND `superseded` 為 Terminal State，MUST NOT 再轉移回 `running`
AND 該 Task 的延遲輸出 MUST NOT 成為目前 UI 狀態

#### Scenario: 可逆已提交副作用觸發 rollback_requested

GIVEN 一個 status 為 `running` 的 Task
AND 其已提交可逆 side effect（如 reservation）
WHEN 使用者取消且需補償
THEN Task status MUST 轉移為 `rollback_requested`
AND MUST 從 `rollback_requested` 轉移為 `compensating` 以觸發補償
AND 補償完成後依結果轉移為 `cancelled` 或 `failed`

#### Scenario: 不可逆已提交副作用進入 cancelled_after_commit

GIVEN 一個 Task 已提交不可逆對外可見副作用（如已送出對外訊息）
AND 使用者請求取消
WHEN Runtime 判定不可 rollback
THEN Task status MUST 轉移為 `cancelled_after_commit`
AND 系統 MUST 記錄 corrective/manual 路徑
AND MUST NOT 假裝 rollback 已提交副作用

#### Scenario: 需人工介入時進入 manual_intervention_required

GIVEN 一個 Task 的補償／reconcile 結果需人工決策（不可自動復原）
WHEN 系統無法自動決定下一步
THEN Task status MUST 轉移為 `manual_intervention_required`
AND 在人工介入前 MUST NOT 自動 retry 或假裝完成
AND 人工介入後 MUST 依結果轉移到合法後續狀態

#### Scenario: 互動狀態非法轉移必須拒絕

GIVEN 一個 status 為 `superseded` 或 `cancelled_after_commit` 的 Task
WHEN 嘗試將其轉移回 `running`
THEN 狀態機 MUST 回傳 `{ valid: false, reason: "..." }`
AND Task status MUST NOT 改變

---

### Requirement: TaskEvent MUST 涵蓋互動生命週期事件

TaskEvent 的事件類型 MUST 涵蓋互動生命週期，讓消費方可重建互動決策歷程。新增事件對應互動狀態轉移，並攜帶 prior Task/Run、active generation、新輸入、replacement Task/Run 與 side-effect state 等關聯資訊。

#### Scenario: 互動事件類型

GIVEN 一個 Task 經歷互動生命週期（取消／supersede／rollback／manual intervention）
WHEN 互動狀態發生變化
THEN MUST 產生對應事件：`cancelling`、`cancelled`、`superseded`、`rollback_requested`、`cancelled_after_commit`、`manual_intervention_required`
AND 事件 MUST 包含 `eventId`、`taskId`、`eventType`、`createdAt`

#### Scenario: 互動事件攜帶必要關聯

GIVEN 任何互動生命週期事件
WHEN 事件被產生
THEN 事件 MUST 關聯 prior Task/Run、active generation、新輸入、replacement Task/Run 與 side-effect state
AND 事件 MAY 包含 `payload`（任意附加資料）
AND 事件 MUST NOT 洩漏 raw credential 或 unmasked PII

