# Design：add-agent-interaction-runtime

## Context

X1 已交付 Task/Step 狀態機與 `task_events` 持久化；X4 已交付 Saga/Compensation；X8.6 已交付 durable `tool_executions` ledger 與 reconciliation；X8.7 已交付 authorization boundary。BFF 已具備 transport abort 傳播，LangGraph 已具備 HITL interrupt/resume。

缺口在**業務互動層**：active run 期間收到新輸入時，Runtime 沒有政策可依。transport abort 只是「斷線」，不等於「業務取消」；HITL 只處理「等確認」，不處理「新輸入取代進行中 run」。

本變更建立 Business Interaction Runtime，複用 LangGraph 原生 run/queue，不做第二個佇列或 Runtime。

## Goals / Non-Goals

**Goals：**
- 建立 `InteractionPolicy`、`ActiveRunOwnership`、輸入分類、side-effect-aware cancellation 與互動事件。
- 單一權威 run、generation 隔離 stale 輸出。
- cancellation 依 phase 分派（interrupt／compensate／corrective／reconcile）。

**Non-Goals：**
- 不建自訂 queue／scheduler／worker pool。
- 不建平行於 LangGraph Agent Server 的第二個 Run Runtime。
- 不重做 X1 狀態機、X4 補償、X8.6 reconcile、X8.7 授權。
- 不做泛用 chat 產品重設計。

## 責任邊界

| 層 | 責任 | 不得 |
|---|---|---|
| frontend | 互動 UX（queued/cancelling/superseded/clarification）、依 generation 忽略 stale stream | 不得自行判定業務策略；不得持有模型／Tool 憑證 |
| bff | 新輸入轉送、edge 級 dedup 輔助（idempotency key）、abort 協調、metadata relay | 不得承擔互動策略決策（business policy） |
| backend | 互動策略、active-run ownership、輸入分類、side-effect-aware cancellation、互動事件 | 不得建第二佇列／Runtime；不得信任 client metadata 為權威 |

資料流：

```text
Browser → frontend → bff → backend (interaction policy + ownership + classification)
                              ├─ LangGraph run/queue (既有)
                              ├─ X8.6 reconcile（unknown side-effect）
                              ├─ X4 compensate（可逆）
                              └─ X8.7 authorize（corrective side-effect）
```

## 核心決策

### 決策 1：不建第二佇列／Runtime，複用 LangGraph 原生能力

- **選擇**：互動政策只做「業務政策 → 狀態映射」，run 的實際執行仍由 LangGraph Agent Server 負責。
- **替代方案**：自建 queue／scheduler／worker pool。**否決**——與 LangGraph 原生能力重複，引入分散式排程複雜度與一致性風險。
- **理由**：X8.8 的問題是「政策」與「權威 run 的 visibility」，不是「執行」。

### 決策 2：ActiveRunOwnership 與 Task status 正交

- **選擇**：`ActiveRunOwnership`（thread/scope 的權威 run + generation）獨立於 `AgentTask.status`（業務進度）。
- **替代方案**：把 ownership 塞進 Task status。**否決**——ownership 回答「哪個 run 權威」，Task status 回答「業務做到哪」，混雜會破壞 X1 狀態機語意。
- **理由**：generation 隔離與原子 supersede 需要獨立模型與獨立持久化。

### 決策 3：互動生命週期狀態以 ADDED 擴充 X1 state machine

- **選擇**：新增 `cancelling`、`superseded`、`rollback_requested`、`cancelled_after_commit`、`manual_intervention_required` 五個 Task 狀態與 transition，**不改既有八狀態語意**。
- **替代方案**：在 interaction 模組另建平行狀態。**否決**——會與 Task status 分歧，audit/reconcile 無法對齊。
- **理由**：互動狀態是 Task 生命週期的合法延伸，收斂進單一 state machine 才能保證 transition 合法性可驗證。

### 決策 4：輸入分類在 backend，BFF 只做 edge 級 dedup 輔助

- **選擇**：五類分類（`clarification_answer`／`intent_revision`／`cancel_request`／`new_independent_task`／`duplicate_input`）由 backend 判定並 audit；BFF 提供 edge 級 `duplicate_input` 輔助訊號（idempotency key 比對）。
- **替代方案**：分類全放 BFF。**否決**——BFF 不應承擔業務語意，且 backend 需單一事實來源做 audit。
- **理由**：分類結果要與 interaction 決策、audit、reconcile 關聯，單一事實來源在 backend。

### 決策 5：分類的「deterministic where possible」邊界

- **選擇**：`cancel_request`（明確取消訊號）與 `duplicate_input`（idempotency key 命中）採 deterministic；`clarification_answer` 依「是否有 waiting Task + 明確回覆關聯」判定；`intent_revision` vs `new_independent_task` 在語意不可判定時 MAY 依模型／分類器，但結果 MUST audit 並記錄分類依據。
- **理由**：完全 deterministic 的意圖分類會退化成關鍵字硬編碼（違反硬編碼禁令）；允許非 deterministic 類別但強制 audit，兼顧彈性與可追溯。

### 決策 6：side-effect-aware cancellation 依 X8.6 ledger 判定 phase

- **選擇**：取消決策查 X8.6 `tool_executions`／`business-effect-ledger` 判定目前 phase（read-only／reversible committed／irreversible committed／unknown），再分派 interrupt／compensate／corrective／reconcile。
- **替代方案**：互動層自行追蹤副作用狀態。**否決**——與 X8.6 ledger 重複且可能不一致。
- **理由**：X8.6 已是副作用事實來源；互動層消費它，不重做。

### 決策 7：ownership 原子性以 DB 約束 + generation CAS 實作

- **選擇**：`active_run_ownership` 表對（thread/scope）建立 partial unique index（恰一 `active`），supersede 用 conditional update（`WHERE generation = ?`）做 compare-and-swap。
- **替代方案**：X5 Redis distributed lock。**保留**——若 DB CAS 不足以覆蓋跨機房競態，再引入 X5 lock；預設以 DB 原子性為主。
- **理由**：ownership 是持久化 state，DB 原子性最簡且可稽核。

### 決策 8：stale stream 由 frontend 依 generation 降級，非傳輸層硬中斷

- **選擇**：backend 在事件中標記 `generation`（作為 `task_events.payload.generation` 標準欄位，來源為 `active_run_ownership`，見決策 3），BFF 透傳不修改；frontend 收到低 generation 的 chunk 時忽略／降級。**不**以 transport abort 硬斷 stale run 的 stream（transport abort ≠ business supersede）。
- **理由**：被 supersede 的 run 其 side effect 仍需 reconcile，硬斷傳輸會混淆「業務 supersede」與「傳輸中斷」。

### 決策 9：production interception 以 platform 層 graph wrapper 實作

- **選擇**：新增 `backend/src/platform/interaction-runtime.ts`，提供 `createInteractionOrchestrator(config)`（組合 policy／ownership／classify／cancel-decision／events + audit/metrics）與 `applyInteractionGovernance(graph, orchestrator)`（包裝 compiled graph：run-start 執行 interaction policy、run-end 執行 terminal ownership callback）。與既有 `instrumentGraphWithOpik` 同屬 graph 包裝層，並於各 agent graph compile 後套用。
- **替代方案**：(a) 自訂 HTTP middleware 或 LangGraph Agent Server 外掛攔截——**否決**，Agent Server 為外部 runtime，無此 hook；(b) 只交付 standalone 模組不接線——**否決**，spec 要求 production Runtime 行為，standalone 模組不改變實際行為。
- **理由**：互動政策需要 run 執行前的權威入口與 run 結束後的 terminal callback，graph wrapper 是最小侵入、可稽核且符合既有 wiring 模式（tool 經 `applyToolGovernance`、graph 經 `instrumentGraphWithOpik`）。

## 資料模型

```typescript
interface ActiveRunOwnershipRow {
  thread_id: string;
  scope_id: string;          // 與 X8.7 RuntimeScope.scopeId 對齊
  task_id: string;
  run_id: string;
  status: "active" | "superseded" | "completed" | "cancelled";
  generation: number;
  superseded_by_run_id?: string;
  updated_at: string;
}
```

- `active_run_ownership` 表：partial unique index on `(thread_id, scope_id) WHERE status = 'active'` 保證恰一權威 active run。
- `status` 的 `active → completed`／`active → cancelled` 轉換由 run 進入 terminal state 的 completion callback 觸發；非 `active` 記錄保留供 audit／generation 追溯，採 config 驅動的 TTL 或定期清理（不影響 partial unique index）。
- 互動事件沿用 X1 `task_events` 表，`event_type` 擴充互動事件，`payload` 攜帶 prior/new run、generation、新輸入分類、side-effect state 等關聯。
- 不新增獨立 interaction event 表（避免與 X1 event stream 分歧）。

## backend 設計

- 新增 `backend/src/runtime/interaction/`：
  - `policy.ts` — `InteractionPolicy` 型別與 config 載入。
  - `ownership.ts` — `ActiveRunOwnership` 讀寫、generation CAS、supersede。
  - `classify.ts` — 輸入分類（五類），輸出分類結果 + 依據。
  - `cancel-decision.ts` — 依 X8.6 ledger 判定 phase，分派 cancellation 路徑。
  - `events.ts` — 互動事件產生與 correlation。
- 修改 `backend/src/runtime/state-machine.ts`：新增五個互動狀態與 transition（純函式）。
- 新增 migration：`013_create_active_run_ownership.sql`（additive）。
- 新增 `backend/src/platform/interaction-runtime.ts`（production entrypoint）：
  - `createInteractionOrchestrator(config)` — 組合 `policy.ts`／`ownership.ts`／`classify.ts`／`cancel-decision.ts`／`events.ts` 與 audit/metrics，輸出 orchestrator。
  - `applyInteractionGovernance(graph, orchestrator)` — 包裝 compiled graph：run-start 依 `RunnableConfig.configurable`（threadId／runId／requestId／idempotency key／active-run hint／generation）執行 policy（load policy → ownership CAS → classify → cancel dispatch → event/audit/OTel）；run-end 執行 terminal ownership callback（`active` → `completed`／`cancelled`）。
  - 既有 graphs（`chatbot`／`deep_researcher`／`math_agent`／`mcp_agent`）compile 後套用 `applyInteractionGovernance`；未配置 `InteractionPolicy` 時為 no-op 回退既有行為。
  - client 提供的 `x-active-run-*`／idempotency key 為 hint，backend 以 `active_run_ownership` 為權威校正（沿用 X8.7 trusted principal 邊界）。
- 互動決策寫入 X3 Audit（`actorType`／`actorId`／`decision`／`reasonCode` 承接）與 OTel trace attribute。

## bff 設計

- 新增 input 轉送的 metadata：requestId、idempotency key（由 frontend 產生，BFF 只驗證格式並轉送）、client 的 active-run 提示（僅轉送，不判定）。
- 定義 metadata header 契約：`x-request-id`、`x-idempotency-key`（client 產生）、`x-active-run-id`＋`x-active-run-generation`（client 提示）；BFF 驗證格式後轉送為 Agent Server request `config.configurable`，不判定。
- BFF MUST NOT 查詢 active run 狀態、保存 idempotency key 歷史或進行去重比對；`duplicate_input` 命中判定與 active-run ownership 由 backend 以 `active_run_ownership`／X8.6 ledger 為單一事實來源判定。
- 維持既有 transport abort 傳播（不與 business cancellation 混為一談）。
- 不承擔互動策略決策。

## frontend 設計

- 新增互動狀態可視化：queued、cancelling、superseded、compensation 等待、clarification requested/resumed、corrective/manual。
- `stream-activity-state`／`task-event-reducer` 增加 generation 追蹤：以首個事件之 `generation` 初始化基準，忽略低 generation 的 stale chunk（不覆蓋目前 UI 狀態）。
- 新增 metadata origin：每次 request 產生 `idempotency key`（client UUID v4）並以 `x-idempotency-key` 送出；從最近互動事件追蹤 current `runId`＋`generation`，於後續 request 以 `x-active-run-id`／`x-active-run-generation` hint 送出（非權威，backend 以 ownership DB 校正）。
- 不改既有正常串流路徑（additive）。

## 觀測性

- 互動決策寫入 Task Event + Audit；correlation id（threadId／taskId／runId／generation）作 trace attribute，不作 metric label。
- 互動事件遵循既有 redaction（不洩漏 raw credential／unmasked PII）。

## 安全與權限分析

- 本變更不新增 Tool／MCP surface，不涉及新憑證持有。
- 但取消／supersede 觸發的 corrective side effect（如補發更正訊息）仍 MUST 經 X8.7 authorization，且 MUST 以原 Task/Run 的 principal/scope 評估。
- 互動決策 audit 不得洩漏 raw identity token／credential／unmasked PII。
- 輸入分類不得以 client 提供的 metadata 作為權威身份（沿用 X8.7 trusted principal 邊界）。

## 風險 / Trade-offs

| 風險 | 緩解 |
|---|---|
| stale superseded output 覆蓋目前輸出 | generation 隔離 + frontend 降級 + ownership CAS |
| 不可逆副作用被假 rollback | `cancellationMode` phase 分派；不可逆採 corrective/manual，永不假 rollback |
| 重複輸入觸發重複 side effect | deterministic `duplicate_input` 去重 + idempotency key |
| supersede 與完成之間 race | partial unique index + generation CAS 原子轉換 |
| 非 deterministic 分類被濫用 | 非 deterministic 類別強制 audit 並記錄分類依據 |
| 無政策時既有行為斷裂 | 未配置 policy 回退既有行為，additive 落地 |

## Migration Plan

1. 新增 `013_create_active_run_ownership.sql`（additive，`CREATE TABLE IF NOT EXISTS` + partial unique index）。
2. `state-machine.ts` 新增互動狀態為 additive，不刪改既有狀態。
3. 未配置 `InteractionPolicy` 時回退既有行為，可立即降級。
4. 回滾：刪除 `backend/src/runtime/interaction/` 與 migration 013 即可；無既有資料遷移。

## Resolved Decisions（原 Open Questions）

1. **分類的模型輔助邊界** ✅：`intent_revision` vs `new_independent_task` 語意不可判定時，**允許模型／分類器輔助作為 first-pass 建議**，但分類結果 MUST 標記為 `tentative`，**需經人工確認後才成為最終分類**。audit MUST 記錄 first-pass 分類依據、分類器版本與最終人工確認結果。
2. **等待中 Task 的 supersede** ✅：Task 進入 `waiting_confirmation`（HITL）時，**HITL 優先**。僅明確 `cancel_request` 訊號可中斷 HITL；`intent_revision` 需先 resolve HITL（完成或取消等待）後才能 supersede。
3. **generation 的持久化來源** ✅：**DB `active_run_ownership` 表為 generation 單一事實來源**，不依賴 LangGraph checkpointer。generation 遞增與 CAS 均以該表為準；對外以 `task_events.payload.generation` 標準欄位暴露，由 backend 寫入、BFF 透傳、frontend 追蹤。
4. **BFF dedup 的 idempotency key 語意** ✅：`duplicate_input` 以 **idempotency key 命中 + payload byte-level 完全相同**判定，不做語意等價判定。idempotency key 由 frontend 產生、BFF 只驗證格式並轉送；「命中」比對與 active-run ownership 由 backend 以 `active_run_ownership` 為單一事實來源判定（BFF 不保存 key 歷史、不查詢 active run 狀態）。
