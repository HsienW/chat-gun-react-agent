# Specs：add-agent-interaction-runtime（task-step-state-machine delta）

## ADDED Requirements

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
