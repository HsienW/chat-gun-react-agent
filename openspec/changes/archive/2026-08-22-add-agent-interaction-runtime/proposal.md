# Proposal：add-agent-interaction-runtime

## 變更定位

純 Runtime／平台治理，零業務依賴。在 X1 Task State Machine、X4 Compensation、X8.6 Side-effect ToolExecution、X8.7 Authorization 之上，建立「Business Interaction Runtime」：定義 active Agent Task 在「目前 run 尚未完成前收到新使用者輸入」時應如何反應的業務政策——double-texting、取消、supersede、clarification-resume、active-run ownership 與 side-effect-aware interruption。本變更**不建立第二個佇列／scheduler**，也**不建立與 LangGraph Agent Server 平行的第二個 Run Runtime**。

本變更對應 `second-stage-plan-en-v3.md` 的 **X8.8**，是 Production Hardening Gate 的一員（X8.6–X8.9）。X8.8 與 X8.9 為 X8.7 之後的獨立 siblings，可並行實作：X8.8 管「並發使用者互動與 active-run ownership」，X8.9 管「Decision Provenance／Context Reference 原語」。兩者不重疊。

## 為什麼（Why）

生產 IM Agent 需要的不是「transport 中斷」（BFF 已具備 abort 傳播），而是**業務互動政策**：

> Agent 正在分析／檢索時，使用者又送出「Actually, change to Korean style.」——Runtime 該如何反應？

現況缺口：

```text
BFF abort 傳播只處理 transport cancellation，不等於 business cancellation
LangGraph interrupt/resume 只處理 HITL，不處理「新輸入取代進行中 run」的政策
沒有 active-run ownership（哪個 run 對某 thread/scope 具權威性）
沒有 side-effect-aware cancellation（可逆補償 vs 不可逆校正 vs 未知先 reconcile）
沒有 deterministic input classification（clarification 回覆 vs intent 修訂 vs 取消 vs 新任務 vs 重複輸入）
stale superseded run 的輸出可能在較新 run 已權威後仍覆蓋目前 UI
```

「late output from a superseded Run must not become current UI state」是硬性安全／一致性要求：被取代的舊 run 不能在新 run 已權威後反過來覆蓋可見狀態。

## 問題描述

1. **無並發輸入的業務政策** — 目前 active run 期間收到新輸入時，沒有定義 `reject`／`enqueue`／`interrupt`／`supersede`／`rollback` 的政策選擇；只能靠 transport 層粗略中斷，缺乏業務語意。
2. **無 active-run ownership** — 沒有「單一權威 run」的持久化契約。誰是 thread/scope 目前的權威 run？新 run 何時、如何原子取代舊 run？舊 run 的延遲輸出如何被識別並拒收？皆未定義。
3. **stale superseded output 可能覆蓋現況** — 被 supersede 的舊 run 若在新 run 權威後仍吐出 chunk，會覆蓋正確輸出，無 generation 隔離機制。
4. **取消不感知 side-effect** — 取消時未依「目前 phase」分派：read-only 可中斷、可逆已提交副作用需補償、不可逆對外可見副作用需 finish/correct/escalate（不得假 rollback）、副作用狀態未知需先經 X8.6 reconcile。現況無此分派。
5. **輸入分類未正規化** — `clarification_answer`／`intent_revision`／`cancel_request`／`new_independent_task`／`duplicate_input` 未正規化；clarification answer 無法可靠回到「等待中的那個 Task」，可能誤建新 Task；重複輸入可能觸發重複副作用。
6. **frontend 無法表示互動狀態** — 沒有 queued／cancelling／superseded／compensation 等待／clarification requested-resumed／corrective-manual 的可視狀態；也不會忽略 superseded generation 的 stale stream。

## 解決方案

### Part A：Interaction Policy Contract

```typescript
type InteractionStrategy =
  | "reject"
  | "enqueue"
  | "interrupt"
  | "supersede"
  | "rollback";

interface InteractionPolicy {
  strategy: InteractionStrategy;
  clarificationReplyMode: "resume_same_task" | "new_task";
  cancellationMode:
    | "cancel_if_read_only"
    | "compensate_if_needed"
    | "finish_committed_effect_then_correct";
  allowIntentRevision: boolean;
}
```

- 政策是「業務政策 → 狀態映射」，不是自訂 queue。複用 LangGraph/Agent Server 原生 run/queue 能力。
- `InteractionStrategy` 為 closed enum；`InteractionPolicy` 依 config／capability 注入，runtime MUST NOT 硬編碼業務句型或使用者輸入白名單來判定策略。
- `InteractionStrategy` 回答「新輸入到達時對目前 active run 採取何種政策動作」；`cancellationMode` 回答「政策動作涉及取消／中斷時，如何處置已提交的 side effect」。兩者正交：`strategy` 決定做什麼，`cancellationMode` 決定取消／回退時 side effect 如何處置。`rollback` 的獨特觸發條件是「明確要求撤銷目前 run 已提交的可逆工作並以新輸入重啟」。

### Part B：Active-Run Ownership

```typescript
interface ActiveRunOwnership {
  threadId: string;
  taskId: string;
  runId: string;
  status: "active" | "superseded" | "completed" | "cancelled";
  generation: number;
  supersededByRunId?: string;
  updatedAt: string;
}
```

- 每個 interaction thread/scope 恰有一個權威 active run。
- 較新權威 run 原子地 supersede 舊 run（generation 遞增）。
- 被 supersede run 的延遲輸出 MUST NOT 成為目前 UI 狀態。
- superseded run 的 side effect 仍遵守 X8.6 reconciliation／compensation。
- ownership 是 visibility／business-state 契約，不是第二個 Run Runtime。

### Part C：Input Classification

```text
clarification_answer
intent_revision
cancel_request
new_independent_task
duplicate_input
```

- 分類在可行處 MUST 為 deterministic 且 auditable。
- `clarification_answer` MUST 回到等待中的 Task 而非總建新 Task；`duplicate_input` MUST 不觸發重複 side effect。
- 非 deterministic 分類（`intent_revision` vs `new_independent_task`）MAY 依分類器 first-pass 建議，結果 MUST 標記 `tentative` 並經人工確認後才成為最終分類；未確認前 MUST NOT 觸發不可逆操作，超時採 safe fallback（reject 或視為 `new_independent_task`）。

### Part D：Side-Effect-Aware Cancellation

| 目前 Phase | 預設行為 |
|---|---|
| Read-only / planning | 允許 interrupt 或 supersede |
| 可逆 side effect 已準備／已提交 | 補償後 restart/supersede |
| 不可逆對外可見副作用已提交 | finish/correct/escalate；絕不 fake rollback |
| 副作用狀態未知 | 先經 X8.6 reconcile 再決定 retry/cancel |

### Part E：Task State 與 Events

```text
cancelling
cancelled
superseded
rollback_requested
cancelled_after_commit
manual_intervention_required
```

- 每個 transition MUST 關聯：prior Task/Run、active generation、新輸入、replacement Task/Run、side-effect state、補償／reconcile 結果。
- 這些狀態擴充既有 X1 Task State Machine；transition 合法性由 state machine 收斂。

### Part F：Frontend Interaction UX

- frontend 區分 queued、cancelling、superseded、compensation 等待、clarification requested/resumed、corrective/manual 路徑。
- frontend MUST 忽略或明顯降級來自 superseded Run generation 的 stale stream 輸出。

## 目標

- ✅ 建立 `InteractionPolicy`（strategy／clarificationReplyMode／cancellationMode／allowIntentRevision）
- ✅ 建立 `ActiveRunOwnership`（單一權威 run、generation、原子 supersede）
- ✅ read-only 期間的新輸入依配置 interrupt/supersede，且 stale result 不被發送
- ✅ 被 supersede run 的延遲輸出無法覆蓋目前輸出
- ✅ clarification answer 回到預期的等待中 Task，而非總建新 Task
- ✅ 可逆已提交副作用在替換執行前觸發補償
- ✅ 不可逆已提交副作用記錄 corrective/manual 路徑，而非假 rollback
- ✅ `unknown` side-effect outcome 在 retry/cancel 前先經 X8.6 reconcile
- ✅ 重複輸入不產生重複 side effect
- ✅ frontend 可視化 queued/cancelling/superseded/clarification 狀態
- ✅ 互動決策可經 Task Event + Audit + OTel metadata trace

## 非目標

- ❌ 自訂 Agent queue / scheduler / worker pool
- ❌ 與 LangGraph Agent Server 平行的第二個 Run Runtime
- ❌ 泛用 chat 產品重設計
- ❌ 靜默重放已提交的 side effect
- ❌ 假設 transport abort 等同 business cancellation
- ❌ 取代 X1 Task State Machine、X4 Compensation、X8.6 Reconciliation 或 X8.7 Authorization

## Capabilities

### New Capabilities

- `agent-interaction-runtime`：Business Interaction Runtime 的互動政策、active-run ownership、輸入分類、side-effect-aware cancellation 決策、互動事件與跨層互動 UX 契約。

### Modified Capabilities

- `task-step-state-machine`：既有 X1 Task/Step 狀態機新增互動生命週期狀態與事件（`cancelling`、`superseded`、`rollback_requested`、`cancelled_after_commit`、`manual_intervention_required`）與其 transition 合法性規則。

## 受影響範圍

| 套件 | 影響 |
|------|------|
| backend | 新增 `src/runtime/interaction/`（policy、active-run ownership、input classification、side-effect-aware cancellation 決策、互動事件） |
| backend | 新增 `src/platform/interaction-runtime.ts`（production entrypoint：orchestrator + graph wrapper + terminal ownership callback） |
| backend | 修改 `state-machine.ts`：接受互動生命週期狀態與 transition 規則 |
| backend | 新增 migrations：active-run ownership 與互動事件持久化 |
| bff | 新輸入轉送、idempotency key 格式驗證與轉送、abort 協調（gateway 邊界，細部於 design） |
| frontend | 互動 UX 狀態（queued／cancelling／superseded／clarification／compensation 等待）、superseded generation stale stream 降級，與 metadata origin（idempotency key 產生、active-run hint） |

## 與既有系統的關係

| 既有系統 | 關係 |
|---------|------|
| X1 Task State Machine | 擴充互動生命週期狀態與 transition；`taskId`／`runId` correlation 承接 |
| X4 Compensation | 可逆 side effect 取消時觸發補償；`isReversible:false` 不可逆動作不自動 rollback |
| X8.6 ToolExecution | superseded run 的 side effect 遵守 reconciliation；`unknown` 結局先 reconcile 再 retry/cancel |
| X8.7 Authorization | 取消／supersede 觸發的受保護後續 side effect 仍經 authorization |
| LangGraph 原生 run/queue | 複用原生能力，不另建 queue／Runtime |
| BFF transport abort | transport abort 是傳輸層；本變更在其上疊加 business cancellation 政策，兩者不混淆 |

## 風險

| 風險 | 緩解 |
|------|------|
| stale superseded output 覆蓋目前輸出 | `ActiveRunOwnership.generation` 檢查 + frontend 依 generation 忽略／降級 stale stream |
| 不可逆副作用被假 rollback | `cancellationMode` 依 phase 分派；不可逆採 finish/correct/escalate，永不假 rollback |
| 重複輸入觸發重複 side effect | deterministic input classification + `duplicate_input` 去重 |
| supersede 與完成之間 race | ownership 原子轉換（單一權威 run），以 DB constraint／lock 保障 |
| 無政策時既有行為斷裂 | 未配置 `InteractionPolicy` 時採既有行為（不中斷、不 supersede），additive 落地 |
| 互動決策不可追溯 | 決策寫入 Task Event + Audit + OTel，correlate prior/new run、generation、side-effect state |

## 回滾策略

- 新增 `backend/src/runtime/interaction/` 為全新模組，刪除即可回滾。
- `state-machine.ts` 的新增狀態為 additive，不刪改既有 X1 狀態與 transition。
- 新增 migrations 採 additive（`CREATE TABLE IF NOT EXISTS`），不刪改既有表格。
- frontend 互動 UX 為 additive（新增狀態視覺，不改既有正常串流路徑）。
- 無既有資料遷移，無破壞性 schema 變更。
- 未配置 `InteractionPolicy` 時回退既有行為，可立即降級。
