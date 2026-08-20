# Specs：add-agent-interaction-runtime

## ADDED Requirements

### Requirement: InteractionPolicy MUST 定義並發輸入的業務策略

Runtime MUST 透過 `InteractionPolicy` 定義 active run 期間收到新輸入時的業務策略：`strategy`（reject／enqueue／interrupt／supersede／rollback）、`clarificationReplyMode`（resume_same_task／new_task）、`cancellationMode`（cancel_if_read_only／compensate_if_needed／finish_committed_effect_then_correct）與 `allowIntentRevision`。策略為「業務政策 → 狀態映射」，MUST 複用 LangGraph／Agent Server 原生 run/queue 能力，MUST NOT 自建 queue／scheduler／worker pool，MUST NOT 建立平行於 LangGraph Agent Server 的第二個 Run Runtime。

#### Scenario: 未配置 policy 時採既有行為

GIVEN 一個 active run 收到新輸入
AND 未配置任何 `InteractionPolicy`
WHEN Runtime 評估互動
THEN MUST 採既有行為（不中斷、不 supersede）
AND MUST NOT 因缺少 policy 而 crash 或靜默放行未定義互動

#### Scenario: policy 為配置驅動而非硬編碼句型

GIVEN 需要判定「新輸入是否為 intent_revision」
WHEN Runtime 評估互動策略
THEN 策略 MUST 由 config／capability 注入
AND MUST NOT 以硬編碼自然語言關鍵字、句型或使用者輸入白名單作為主要判定

---

### Requirement: ActiveRunOwnership MUST 維持單一權威 run

每個 interaction thread／scope MUST 恰有一個權威 active run，由 `ActiveRunOwnership { threadId, taskId, runId, status, generation, supersededByRunId, updatedAt }` 表示。較新權威 run MUST 原子地 supersede 舊 run（`generation` 遞增、`supersededByRunId` 指向新 run）。ownership 是 visibility／business-state 契約，不是第二個 Run Runtime。

#### Scenario: 較新 run 原子取代舊 run

GIVEN thread `T` 目前權威 run 為 `R1`（generation 1）
AND 使用者送出新輸入觸發新 run `R2`
WHEN 依政策採用 supersede
THEN `R2` MUST 原子成為 thread `T` 的權威 run（generation 2）
AND `R1.status` MUST 轉為 `superseded` 且 `R1.supersededByRunId` MUST 為 `R2`
AND 任一時刻 thread `T` MUST 至多有一個 `active` run

#### Scenario: 單一權威 run 的不可分割性

GIVEN 兩個新 run 同時嘗試成為同一 thread 的權威 run
WHEN 執行 ownership 轉換
THEN MUST 以原子方式（DB constraint／lock）確保只有一個成功
AND 另一個 MUST 被拒絕或依序 supersede，MUST NOT 產生兩個並存 active run

---

### Requirement: superseded run 的延遲輸出 MUST NOT 成為目前 UI 狀態

被 supersede 的舊 run 若在較新 run 已權威後仍輸出 chunk／事件，MUST NOT 覆蓋目前 UI 狀態。Runtime MUST 以 `generation` 識別 stale 輸出並拒收或明顯降級。

#### Scenario: stale chunk 不覆蓋目前輸出

GIVEN run `R1`（generation 1）已被 run `R2`（generation 2）supersede
AND `R1` 仍吐出延遲 chunk
WHEN 該 chunk 到達 frontend
THEN MUST 被忽略或明顯降級（不得成為目前 UI 狀態）
AND MUST NOT 覆蓋 `R2` 已呈現的輸出

#### Scenario: superseded run 的 side effect 仍受 reconcile 治理

GIVEN run `R1` 已提交部分 side effect 後被 supersede
WHEN 處理 `R1` 的遺留 side effect
THEN MUST 仍遵守 X8.6 reconciliation／compensation 規則
AND MUST NOT 因 supersede 而靜默重放已提交副作用

---

### Requirement: 輸入分類 MUST 為 deterministic where possible 且 auditable

Runtime MUST 將進行中 run 期間的新輸入分類為 `clarification_answer`、`intent_revision`、`cancel_request`、`new_independent_task` 或 `duplicate_input` 其中一類。`cancel_request` 與 `duplicate_input` MUST 為 deterministic（訊號／idempotency key 判定）。`intent_revision` vs `new_independent_task` 在語意不可判定時 MAY 以模型/分類器作為 first-pass 建議，但分類結果 MUST 標記為 `tentative`，MUST 經人工確認後才成為最終分類。所有分類結果 MUST 可 audit（分類結果、依據、分類器版本、人工確認結果可追溯）。

#### Scenario: 五類輸入各有明確歸屬

GIVEN 一個 active run 期間的新輸入
WHEN 執行輸入分類
THEN MUST 歸入五類之一（`clarification_answer`／`intent_revision`／`cancel_request`／`new_independent_task`／`duplicate_input`）
AND 分類結果 MUST 標記 `confidence`（`deterministic` | `tentative`）
AND `deterministic` 分類 MUST 記錄訊號依據
AND `tentative` 分類 MUST 記錄分類器依據與版本，且 MUST 經人工確認後才成為最終分類

#### Scenario: 分類結果影響互動策略

GIVEN 新輸入被分類為 `intent_revision`（`confidence: deterministic` 或已人工確認）
AND policy 的 `allowIntentRevision` 為 true
WHEN Runtime 評估互動
THEN MUST 依 revision 策略處理（interrupt 或 supersede）
AND 若 `allowIntentRevision` 為 false，MUST 依 policy 回退（如 reject 或視為新任務）

#### Scenario: tentative 分類在人工確認前不觸發不可逆操作

GIVEN 新輸入的分類結果為 `tentative`（first-pass，尚未人工確認）
WHEN Runtime 評估互動
THEN MUST NOT 基於 tentative 分類觸發不可逆操作（如 supersede、cancel）
AND MUST 等待人工確認或依 safe fallback（如 reject 或 enqueue）處理

#### Scenario: tentative 分類的人工確認流程

GIVEN 新輸入的分類結果為 `tentative`（first-pass，尚未人工確認）
WHEN Runtime 產出 tentative 分類
THEN MUST 產生 `input_classification_tentative` 事件
AND 該事件 MUST 關聯 first-pass 分類、分類依據、分類器版本、active generation 與 prior Task/Run
AND Task MUST 進入等待人工確認的暫態（`waiting_confirmation`，`confirmationType: "input_classification"`）
AND MUST NOT 依 tentative 分類觸發不可逆操作（supersede／cancel）
AND 人工確認後 MUST 記錄確認結果於 audit（確認人、確認結果、時間）
AND 確認後 Runtime MUST 依 policy 以最終分類 resume

#### Scenario: tentative 分類未確認的超時 fallback

GIVEN 新輸入的分類結果為 `tentative` 且尚未人工確認
AND 超過可配置的確認期限（timeout）
WHEN Runtime 判定超時
THEN MUST 採 safe fallback（依 policy，如 reject 或視為 `new_independent_task`）
AND MUST NOT 自動依 tentative 分類執行不可逆操作
AND 超時 fallback 決策 MUST 記錄於 audit 並可追溯

---

### Requirement: clarification_answer MUST 回到等待中的 Task

分類為 `clarification_answer` 的輸入 MUST 依 `clarificationReplyMode` 回到等待中的 Task（`resume_same_task`）或另建新 Task（`new_task`）。在可行且確定時 MUST resume 到原本等待的 Task，MUST NOT 總建新 Task。

#### Scenario: clarification 回覆 resume 等待中的 Task

GIVEN Task `K` 正處於 `waiting_confirmation` 等待澄清
AND 使用者送出 `clarification_answer` 輸入
WHEN 依 policy `clarificationReplyMode: resume_same_task`
THEN 輸入 MUST resume 到 Task `K`
AND MUST NOT 建立新的 Task

#### Scenario: new_task 模式另建 Task

GIVEN policy 明確採 `clarificationReplyMode: new_task`
WHEN 收到 `clarification_answer` 輸入
THEN MUST 建立新 Task
AND 原等待 Task 的處理依 policy 定義（保留、取消或 supersede）

#### Scenario: HITL 等待中 intent_revision 不得直接 supersede

GIVEN Task `K` 正處於 `waiting_confirmation`（HITL）等待確認
AND 使用者送出被分類為 `intent_revision` 的輸入
WHEN Runtime 評估互動
THEN MUST NOT 直接 supersede 或中斷 HITL 流程
AND MUST 先 resolve HITL（由使用者明確完成或取消等待）後，才依 revision 策略處理
AND 僅明確 `cancel_request` 訊號可直接中斷 HITL

---

### Requirement: duplicate_input MUST NOT 產生重複 side effect

分類為 `duplicate_input` 的輸入 MUST NOT 觸發重複的 side effect。Runtime MUST 去重，避免相同輸入重放已提交的副作用。

#### Scenario: 重複輸入不重放副作用

GIVEN 相同輸入已處理過且已產生 side effect
AND 再次收到相同輸入（分類為 `duplicate_input`）
WHEN Runtime 評估互動
THEN MUST NOT 再次執行相同 side effect
AND MUST 以既有結果／狀態回應或明確標記為重複

---

### Requirement: side-effect-aware cancellation MUST 依目前 phase 分派

取消／中斷決策 MUST 依「目前 phase」分派：read-only／planning 允許 interrupt 或 supersede；可逆 side effect 已準備／已提交則補償後 restart/supersede；不可逆對外可見副作用已提交則 finish/correct/escalate（MUST NOT 假 rollback）；副作用狀態未知則先經 X8.6 reconcile 再決定 retry/cancel。

#### Scenario: read-only 期間可中斷

GIVEN 目前 run 正處於 read-only／planning phase
WHEN 使用者送出取消或 revision 輸入
THEN MUST 允許 interrupt 或 supersede
AND stale result MUST NOT 被發送

#### Scenario: 可逆已提交副作用先補償

GIVEN 目前 run 已提交可逆 side effect（如 reservation）
WHEN 使用者取消
THEN MUST 在替換執行前觸發補償（release reservation）
AND 補償完成後才 restart/supersede

#### Scenario: 不可逆已提交副作用採校正而非假 rollback

GIVEN 目前 run 已提交不可逆對外可見副作用（如已送出對外訊息）
WHEN 使用者取消
THEN MUST NOT 假裝 rollback 該副作用
AND MUST 記錄 corrective/manual 路徑（finish／correct／escalate）
AND 後續校正動作（如補發更正訊息）MUST 依 X8.7 authorization 執行

#### Scenario: 未知副作用結局先 reconcile

GIVEN 目前 run 的 side effect 結局為 `unknown`
WHEN 決定 retry 或 cancel
THEN MUST 先經 X8.6 reconcile 確認結局
AND 依 reconcile 結果決定 retry／cancel／corrective 路徑

---

### Requirement: 互動生命週期事件 MUST 關聯 prior/new run 與補償結果

互動生命週期事件（`cancelling`、`cancelled`、`superseded`、`rollback_requested`、`cancelled_after_commit`、`manual_intervention_required`）每個 transition MUST 關聯：prior Task/Run、active generation、新輸入、replacement Task/Run、side-effect state，以及補償／reconcile 結果。

#### Scenario: supersede 事件攜帶完整關聯

GIVEN run `R1` 被 run `R2` supersede
WHEN 產生 `superseded` 事件
THEN 事件 MUST 關聯 prior `R1`、replacement `R2`、active generation 與新輸入
AND MUST 記錄 side-effect state 供後續 reconcile／compensation 使用

---

### Requirement: interaction 決策 MUST 可經 Task Event + Audit + OTel trace

每個 interaction 決策（reject／enqueue／interrupt／supersede／rollback、分類結果、取消路徑）MUST 可經 Task Event、Audit 與 OTel metadata trace。correlation id（threadId／taskId／runId／generation）MUST 作為 trace attribute／structured audit field，MUST NOT 作為 metric label。

#### Scenario: 互動決策寫入 audit 且不洩漏身份

GIVEN 一次 supersede 決策發生
WHEN 決策被記錄
THEN MUST 寫入 Task Event 與 Audit
AND correlation id（threadId／taskId／runId）MUST 作為 trace attribute
AND MUST NOT 作為 metric label
AND 記錄內容 MUST 遵循既有 redaction 規則（不洩漏 raw credential／PII）

---

### Requirement: frontend MUST 可視化互動狀態並忽略 stale stream

frontend MUST 區分並可視化 queued、cancelling、superseded、compensation 等待、clarification requested/resumed 與 corrective/manual 路徑。frontend MUST 忽略或明顯降級來自 superseded run generation 的 stale stream 輸出。

#### Scenario: 互動狀態可視化

GIVEN 一個 Task 處於 cancelling 或 superseded 或 clarification waiting 狀態
WHEN frontend 渲染該 Task
THEN MUST 呈現對應的互動狀態（不得只顯示 generic running）
AND 使用者 MUST 能區分 queued／cancelling／superseded／clarification 等路徑

#### Scenario: superseded generation 的 stale stream 被降級

GIVEN frontend 已接獲 generation `N` 的權威輸出
AND 收到 generation `< N` 的 stale stream chunk
WHEN frontend 處理該 chunk
THEN MUST 忽略或明顯降級該 stale chunk
AND MUST NOT 讓其成為目前 UI 狀態

---

### Requirement: Runtime MUST NOT 建立第二個佇列或 Run Runtime

Business Interaction Runtime MUST 複用 LangGraph／Agent Server 原生 run/queue、checkpointer 與 store，MUST NOT 建立自訂 Agent queue／scheduler／worker pool，MUST NOT 建立平行於 LangGraph Agent Server 的第二個 Run Runtime。

#### Scenario: 互動政策只做狀態映射

GIVEN 需要處理並發輸入
WHEN Runtime 執行互動政策
THEN MUST 以「業務政策 → 狀態映射」方式操作既有 LangGraph run/queue
AND MUST NOT 引入獨立的佇列或 worker 排程
AND run 的實際執行仍由 LangGraph Agent Server 負責
