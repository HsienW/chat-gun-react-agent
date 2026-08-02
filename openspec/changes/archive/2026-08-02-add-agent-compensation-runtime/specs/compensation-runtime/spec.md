# Specs：add-agent-compensation-runtime

## ADDED Requirements

### Requirement: CompensationAction MUST 定義可註冊的補償動作介面

`CompensationAction` MUST 提供 actionId、description、execute 函式與 isReversible 標記，並透過 `CompensationRegistry` 管理註冊與查詢。

#### Scenario: 定義一個可逆的補償動作

GIVEN 一個 Step 執行了「發送通知」的 side effect
AND 註冊了對應的 `CompensationAction`：
  - `actionId`: `"send_correction_notice"`
  - `description`: `"Send a correction notice to invalidate the previous notification"`
  - `isReversible`: `true`
  - `execute`: 發送更正通知的函式
WHEN 查詢該 Step 的補償動作
THEN MUST 回傳該 `CompensationAction`
AND `isReversible` MUST 為 `true`

#### Scenario: 定義一個不可逆的補償動作

GIVEN 一個 Step 執行了「實際寄出包裹」的 side effect
AND 註冊了對應的 `CompensationAction`：
  - `actionId`: `"recall_parcel"`
  - `isReversible`: `false`
WHEN 查詢該 Step 的補償動作
THEN `isReversible` MUST 為 `false`
AND Saga Orchestrator MUST NOT 嘗試自動執行 `execute()`

#### Scenario: 同一個 Step 註冊多個補償動作

GIVEN Step A 執行了兩個 side effect（建立資源 + 發送通知）
WHEN 註冊兩個 `CompensationAction`（`"release_resource"` + `"send_correction_notice"`）
THEN `CompensationRegistry` MUST 回傳兩個 action
AND 執行順序由註冊的逆序決定（後註冊的先執行）

#### Scenario: 未註冊補償動作的 Step

GIVEN Step A 沒有任何註冊的 `CompensationAction`
WHEN Saga Orchestrator 查詢該 Step 的補償動作
THEN MUST 回傳空陣列
AND Orchestrator MUST 跳過該 Step 的補償（不視為錯誤）

---

### Requirement: CompensationRegistry MUST 支援按 Step 類型查詢補償動作

`CompensationRegistry` MUST 提供依 `stepName` 查詢對應補償動作的能力，並支援動態註冊與移除。

#### Scenario: 依 stepName 註冊與查詢

GIVEN `CompensationRegistry` 已初始化
WHEN 呼叫 `registry.register("call_weather_api", compensationAction)`
THEN 呼叫 `registry.getActions("call_weather_api")` MUST 回傳包含該 action 的陣列

#### Scenario: 移除已註冊的補償動作

GIVEN `CompensationRegistry` 已註冊 `"call_weather_api"` 的補償動作
WHEN 呼叫 `registry.deregister("call_weather_api", "action-001")`
THEN 呼叫 `registry.getActions("call_weather_api")` MUST 不再包含 `"action-001"`

#### Scenario: 查詢未註冊的 stepName

GIVEN `CompensationRegistry` 沒有 `"unknown_step"` 的任何註冊
WHEN 呼叫 `registry.getActions("unknown_step")`
THEN MUST 回傳空陣列（不拋出錯誤）

---

### Requirement: Saga Orchestrator MUST 從失敗點逆序補償已完成的 Step

`SagaOrchestrator` MUST 讀取 Task 中所有 Step 的狀態，從失敗點向前（逆序）補償已完成（`succeeded`）的 Step，MUST NOT 觸及未執行的 Step。

Step 狀態轉換由 Saga Orchestrator 直接透過 `StepRepository.updateStatus()` 執行 SQL UPDATE（不經由 X1 `transitionStep()` 驗證）。這是因為 X1 `STEP_TRANSITIONS` 將 `"succeeded"` 定義為 terminal state（無 outgoing transition），且 `"succeeded"` 到 `"running"` 的路徑亦不存在。補償的 Step 路徑為：`succeeded → compensating → compensated`（兩次直接 SQL UPDATE）。

#### Scenario: Step C 失敗，補償已完成的 A 與 B

GIVEN Task 有三個 Step：A（succeeded）→ B（succeeded）→ C（terminal_failed）
AND Task status 為 `"partially_failed"`（X1 合法狀態）
AND Step A 註冊了 `compensateA`，Step B 註冊了 `compensateB`
WHEN 呼叫 `orchestrator.compensate(taskId)`
THEN Task status MUST 先轉至 `"compensating"`（X1 合法 transition）
AND MUST 先執行 Step B 的 `compensateB`
AND 再執行 Step A 的 `compensateA`
AND Step A/B 的 status MUST 最終為 `"compensated"`
AND Step C 的 status MUST 保持 `"terminal_failed"`（不執行未完成的 Step 的補償）
AND Task status MUST 最終轉至 `"failed"`（X1 `compensating → failed` 合法 transition）

#### Scenario: 只有一個 Step 失敗，無需補償其他 Step

GIVEN Task 有三個 Step：A（succeeded）→ B（running）→ C（pending）
AND Step A 註冊了 `compensateA`
AND Step B 失敗（terminal_failed）
WHEN 呼叫 `orchestrator.compensate(taskId)`
THEN MUST 只補償 Step A（唯一已完成的 Step）
AND MUST NOT 嘗試補償 Step B（失敗點本身不補償自己）
AND MUST NOT 觸及 Step C（尚未執行）

#### Scenario: 第一個 Step 就失敗，沒有需要補償的 Step

GIVEN Task 有一個 Step：A（terminal_failed）
AND Step 狀態沒有其他 succeeded 的 Step
WHEN 呼叫 `orchestrator.compensate(taskId)`
THEN MUST 回傳空的 CompensationResult（無需補償）
AND Task status MUST 維持 `"partially_failed"`（不進入 compensating 流程，因無需補償）

#### Scenario: 補償過程中 Task 被取消（User Cancel）

GIVEN Task 有兩個 succeeded Step：A、B
AND 使用者觸發取消
WHEN 呼叫 `orchestrator.compensate(taskId, { reason: "user_cancelled" })`
THEN MUST 補償 A 與 B
AND `compensation_triggered` event 的 reasonCode MUST 為 `"user_cancelled"`

---

### Requirement: Saga Orchestrator MUST 處理不可逆操作

`isReversible: false` 的補償動作 MUST NOT 被自動執行，MUST 記錄在 Audit 中並標記為需要人工介入。

#### Scenario: 不可逆操作被跳過並記錄

GIVEN Step A（succeeded）註冊了 `isReversible: false` 的補償動作 `"irreversible_action"`
WHEN Saga Orchestrator 嘗試補償 Step A
THEN MUST NOT 呼叫 `irreversible_action.execute()`
AND MUST 記錄 `compensation.action_skipped_irreversible` event 至 Audit
AND event payload MUST 包含 `actionId`、`stepId`、`reason: "irreversible_requires_manual_intervention"`

#### Scenario: 混合可逆與不可逆操作

GIVEN Step A 註冊了兩個補償動作：
  - `action-1`（isReversible: true）
  - `action-2`（isReversible: false）
WHEN Saga Orchestrator 補償 Step A
THEN MUST 執行 `action-1.execute()`
AND MUST NOT 執行 `action-2.execute()`
AND MUST 記錄 `action-2` 為 skipped_irreversible

---

### Requirement: 補償失敗 MUST 升級並記錄，不得靜默成功

補償動作的 `execute()` 若拋出錯誤，MUST 被捕獲、記錄完整 error context、寫入 Audit，並繼續執行下一個補償動作。MUST NOT 因單一補償失敗而中斷整個補償鏈。

#### Scenario: 補償動作執行失敗，記錄後繼續

GIVEN Step B 與 Step A 都需要補償
AND Step B 的 `compensateB.execute()` 拋出錯誤 `"External API unavailable"`
WHEN Saga Orchestrator 執行補償
THEN MUST 記錄 `compensation.action_failed` event 至 X3 Audit（`audit_events`），payload 包含：
  - `actionId`、`stepId`、`error.message`
AND MUST 繼續執行 Step A 的補償動作
AND MUST NOT 向上拋出錯誤中斷整個補償鏈
AND `task_events` table MUST NOT 寫入 per-action 失敗事件（X1 未定義 `compensation_failed` eventType；per-action 失敗僅記錄至 Audit）

#### Scenario: 所有補償完成後彙總結果

GIVEN Step B 補償失敗、Step A 補償成功
WHEN 補償鏈執行完畢
THEN `CompensationResult` MUST 包含：
  - `totalActions: 2`
  - `succeeded: 1`
  - `failed: 1`
  - `skippedIrreversible: 0`
AND `overallStatus` MUST 為 `"partial_failure"`
AND Task status MUST 更新為 `"failed"`（X1 `compensating → failed` 合法 transition）

#### Scenario: 所有補償成功

GIVEN Step B 與 Step A 的補償動作皆成功執行
WHEN 補償鏈執行完畢
THEN `CompensationResult.overallStatus` MUST 為 `"all_compensated"`
AND Task status MUST 更新為 `"failed"`（X1 `compensating → failed` 合法 transition）

---

### Requirement: Compensation Events MUST 進入既有 Audit 與 Task Events

所有補償相關的事件 MUST 透過既有的 `auditLogger.record()` 寫入 `audit_events`，並使用 X1 已定義的 TaskEventType（`compensation_triggered`、`compensation_completed`）寫入 `task_events` table。

Per-action 的成敗事件僅記錄至 X3 Audit（`audit_events`）；X1 `TaskEventType` 未定義 `"compensation_failed"`，本次不新增。

#### Scenario: 補償觸發時寫入 Audit

GIVEN Saga Orchestrator 開始執行補償
WHEN 補償觸發
THEN MUST 呼叫 `auditLogger.record("compensation.triggered", { taskId, failureStepId, completedStepIds, reasonCode })`
AND `task_events` table MUST 有一筆 `eventType: "compensation_triggered"` 的新紀錄（使用 X1 既有的 `createCompensationTriggeredEvent` 工廠函式）

#### Scenario: 補償完成時寫入 Audit

GIVEN 所有補償動作執行完畢
WHEN 補償鏈結束
THEN MUST 呼叫 `auditLogger.record("compensation.completed", { taskId, result: CompensationResult })`
AND `task_events` table MUST 有一筆 `eventType: "compensation_completed"` 的新紀錄（使用 X1 既有的 `createCompensationCompletedEvent` 工廠函式）

#### Scenario: 補償 action 失敗時寫入 Audit（per-action）

GIVEN 單一補償動作 `execute()` 失敗
WHEN 錯誤被捕獲
THEN MUST 呼叫 `auditLogger.record("compensation.action_failed", { taskId, stepId, actionId, error })`
AND MUST NOT 寫入 `task_events` table（X1 `TaskEventType` 中無 `"compensation_failed"`；per-action 失敗僅記錄至 X3 Audit）

---

### Requirement: 全部模組 MUST 不依賴任何業務常數

Compensation 框架的每個模組 MUST 為純 Runtime，不 import 任何業務 Step 名稱、Domain constant 或業務邏輯。

#### Scenario: 無業務 import

GIVEN `backend/src/runtime/compensation/` 下的所有模組
WHEN 檢查 import 路徑
THEN MUST NOT import 任何來自業務層的模組
AND MUST 只依賴 X1 Runtime 模組（types、events、persistence repository interfaces）、X3 Audit interface（`../../platform/observability.js` 的 `auditLogger`）與 X3 Idempotency（可選）

#### Scenario: CompensationAction 為通用介面

GIVEN `CompensationAction` 介面定義
WHEN 檢查型別
THEN `actionId` MUST 為 `string`（不限制為特定 enum）
AND `execute` MUST 接受泛型 context 參數而非特定業務型別
AND MUST NOT 包含任何業務相關預設值
