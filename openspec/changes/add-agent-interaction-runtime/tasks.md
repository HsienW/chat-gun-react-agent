# Tasks：add-agent-interaction-runtime

> 依 `second-stage-plan-en-v3.md` X8.8 與 proposal/design/specs 拆分。所有 `- [ ]` 於實作並驗證通過後勾選，不得先勾選再補實作。
>
> 設計 Open Questions 已全部定案（見 design.md §Resolved Decisions）：(1) `waiting_confirmation` 期間收到新輸入，明確 cancel 訊號優先；intent_revision 需先 resolve HITL 再 supersede。(2) `intent_revision` vs `new_independent_task` 語意不可判定時，允許模型/分類器作為 first-pass 建議，分類結果 MUST 標記為 `tentative`，需經人工確認後才成為最終分類；audit MUST 記錄 first-pass 依據、分類器版本與人工確認結果。(3) `generation` 以 DB `active_run_ownership` 表為單一事實來源。(4) `duplicate_input` 以 idempotency key 命中 + payload byte-level 完全相同判定。
>
> 2026-08-20 plan revision：依 Codex apply-change blockers 補強 production entrypoint 與 frontend metadata origin（新增 Phase 7），原「全量驗證與合規」改編為 Phase 8（其 8.7／8.8 即原 7.7／7.8 端到端驗證）。

## Phase 1：Interaction Policy 與 Active-Run Ownership（backend）

- [x] 1.1 建立 `backend/src/runtime/interaction/policy.ts`：定義 `InteractionStrategy`（reject/enqueue/interrupt/supersede/rollback）與 `InteractionPolicy`（strategy/clarificationReplyMode/cancellationMode/allowIntentRevision）closed enum 型別，與 config 載入（未配置採既有行為 default）
- [x] 1.2 單元測試：policy 型別、config 載入、未配置 policy 採既有行為、無硬編碼業務句型
- [x] 1.3 建立 `backend/src/runtime/interaction/ownership.ts`：`ActiveRunOwnership` 讀寫、`generation` CAS、atomic supersede（`WHERE generation = ?` conditional update）
- [x] 1.4 單元測試：單一權威 run、generation 遞增、`supersededByRunId` 指向新 run、race 下恰一 active（DB mock）
- [x] 1.5 新增 migration `013_create_active_run_ownership.sql`（additive，`CREATE TABLE IF NOT EXISTS` + partial unique index on `(thread_id, scope_id) WHERE status='active'`）
- [x] 1.6 migration-runner 可套用全部 migration；`cd backend && npm run test`（含 migration-runner 測試）通過

**驗收：** `cd backend && npx vitest run src/runtime/interaction/policy.test.ts src/runtime/interaction/ownership.test.ts` 通過

## Phase 2：輸入分類（backend）

- [x] 2.1 建立 `backend/src/runtime/interaction/classify.ts`：五類分類（clarification_answer/intent_revision/cancel_request/new_independent_task/duplicate_input），輸出分類結果 + 分類依據 + `confidence` 標記（`deterministic` | `tentative`）；`tentative` 分類 MUST 經人工確認才成為最終分類
- [x] 2.2 deterministic 類別（cancel_request、duplicate_input）採訊號判定；duplicate_input 以 idempotency key 命中 + payload 完全相同判定
- [x] 2.3 非 deterministic 類別（intent_revision vs new_independent_task）允許分類器輔助作為 first-pass 建議；分類結果 MUST 標記為 `tentative`，MUST audit 記錄 first-pass 分類依據、分類器版本，並等待人工確認後才成為最終分類
- [x] 2.4 clarification_answer resume 等待中 Task（resume_same_task）／new_task 模式分派
- [x] 2.5 HITL 優先規則：`waiting_confirmation` 期間僅 `cancel_request` 可直接中斷 HITL；`intent_revision` 需先 resolve HITL 才 supersede
- [x] 2.6 單元測試：五類歸屬、duplicate 去重、clarification resume、分類結果 auditable、`tentative` 標記與人工確認前不成為最終分類、HITL 優先規則
- [x] 2.7 建立 tentative 分類的人工確認契約：確認 API 契約（確認人／確認結果／時間入 audit）、確認前 Task 暫態 `waiting_confirmation`（`confirmationType: "input_classification"`）、確認後依 policy 以最終分類 resume
- [x] 2.8 建立 tentative 分類未確認的超時 fallback：可配置確認期限，超時採 safe fallback（依 policy reject 或視為 `new_independent_task`），決策入 audit 可追溯
- [x] 2.9 單元測試：tentative 人工確認契約、超時 fallback、確認前不觸發不可逆操作（supersede/cancel）、確認後 resume

**驗收：** `cd backend && npx vitest run src/runtime/interaction/classify.test.ts` 通過

## Phase 3：Side-Effect-Aware Cancellation（backend）

- [x] 3.1 建立 `backend/src/runtime/interaction/cancel-decision.ts`：查 X8.6 `tool_executions`／`business-effect-ledger` 判定目前 phase（read-only/reversible committed/irreversible committed/unknown）
- [x] 3.2 依 phase 分派：read-only → interrupt/supersede；可逆已提交 → X4 compensate 後 restart/supersede；不可逆已提交 → corrective/manual（MUST NOT 假 rollback）；unknown → X8.6 reconcile 後決定
- [x] 3.3 corrective side effect（如補發更正訊息）MUST 經 X8.7 authorization 評估（沿用原 Task/Run 的 principal/scope）
- [x] 3.4 單元測試：四種 phase 分派、不可逆不假 rollback、unknown 先 reconcile、corrective 經 authorization

**驗收：** `cd backend && npx vitest run src/runtime/interaction/cancel-decision.test.ts` 通過

## Phase 4：互動生命週期狀態與事件（backend）

- [x] 4.1 修改 `backend/src/runtime/state-machine.ts`：新增 `cancelling`/`superseded`/`rollback_requested`/`cancelled_after_commit`/`manual_intervention_required` 五狀態與 transition（純函式，不改既有八狀態語意）
- [x] 4.2 單元測試：五新狀態合法 transition、非法轉移拒絕、既有狀態回歸不破
- [x] 4.3 建立 `backend/src/runtime/interaction/events.ts`：互動事件產生，關聯 prior/new run、generation、新輸入、side-effect state
- [x] 4.4 互動事件寫入 `task_events`（event_type 擴充）與 X3 Audit；correlation id 作 trace attribute 不作 metric label
- [x] 4.5 單元測試：互動事件類型、關聯資訊、redaction（不洩漏 credential/PII）
- [x] 4.6 涵蓋 `input_classification_tentative` 事件（關聯 first-pass 分類、分類依據、分類器版本、active generation、prior Task/Run）與 `waiting_confirmation` 的 `confirmationType: "input_classification"` 暫態

**驗收：** `cd backend && npx vitest run src/runtime/state-machine.test.ts src/runtime/interaction/events.test.ts` 通過

## Phase 5：BFF 邊界（bff）

- [x] 5.1 修改 `bff/src/server.ts`：新輸入轉送 metadata（requestId、idempotency key 格式驗證與轉送、client 的 active-run 提示轉送），不承擔互動策略決策
- [x] 5.2 明確 BFF 不查詢 active run 狀態、不保存 idempotency key 歷史、不進行去重比對；`duplicate_input` 命中與 active-run ownership 由 backend 單一事實來源判定（BFF 只驗證格式 + 轉送）
- [x] 5.3 維持 transport abort 傳播，明確區分 transport cancel 與 business cancel（不混淆）
- [x] 5.4 BFF 透傳 `generation`（`task_events.payload.generation` 標準欄位）不修改、不判定
- [x] 5.5 單元測試：metadata relay（含 idempotency key 格式驗證）、generation 透傳、abort 傳播回歸、BFF 不越權判定

**驗收：** `cd bff && npm run build && npm run test` 通過

## Phase 6：Frontend 互動 UX（frontend）

- [x] 6.1 互動狀態可視化：queued/cancelling/superseded/compensation 等待/clarification requested-resumed/corrective-manual
- [x] 6.2 擴充 `stream-activity-state.ts`／`task-event-reducer.ts`：以首個事件之 `generation` 初始化基準並追蹤，忽略低 generation 的 stale stream chunk（不覆蓋目前 UI 狀態）
- [x] 6.3 互動事件 → UI 狀態映射（依 task_events 互動事件渲染）
- [x] 6.4 單元測試：互動狀態渲染、stale chunk 降級、正常串流路徑回歸

**驗收：** `cd frontend && npm run lint && npm run test` 通過

## Phase 7：Production Entrypoint 與 Metadata Origin（backend + frontend）

- [ ] 7.1 建立 `backend/src/platform/interaction-runtime.ts`：`createInteractionOrchestrator(config)` 組合 policy/ownership/classify/cancel-decision/events + audit/metrics；`applyInteractionGovernance(graph, orchestrator)` 包裝 compiled graph（run-start interception + run-end terminal ownership callback）
- [ ] 7.2 run-start interception：讀 `RunnableConfig.configurable`（threadId/runId/requestId/idempotency key/active-run hint/generation），執行 load policy → ownership CAS → classify → cancel dispatch → event/audit/OTel；client metadata 為 hint，以 `active_run_ownership` 為權威
- [ ] 7.3 run-end terminal ownership callback：run 進入 terminal（completed/failed/cancelled）時將 `active_run_ownership.status` 轉為 completed/cancelled（保留 generation 供 audit）
- [ ] 7.4 將 `applyInteractionGovernance` 套用至既有 graphs（chatbot/deep_researcher/math_agent/mcp_agent compile 後）；未配置 `InteractionPolicy` 時為 no-op 回退
- [ ] 7.5 單元測試：orchestrator 依 config 分類並套用 policy（reject/supersede/enqueue 路徑）、terminal ownership callback、未配置 policy 回退、client hint 不被視為權威
- [ ] 7.6 frontend 產生 idempotency key（client UUID v4）並以 `x-idempotency-key` 送出；追蹤最近互動事件之 runId + generation，於後續 request 以 `x-active-run-id`/`x-active-run-generation` hint 送出（非權威）
- [ ] 7.7 單元測試：metadata origin 產生/追蹤/送出、非權威 hint 語意、正常串流回歸

**驗收：** `cd backend && npx vitest run src/platform/interaction-runtime.test.ts` 與 `cd frontend && npm run test` 通過

## Phase 8：全量驗證與合規

- [x] 8.1 `cd backend && npm run lint && npm run test && npm run build` 通過
- [x] 8.2 `cd bff && npm run build && npm run test` 通過
- [x] 8.3 `cd frontend && npm run lint && npm run test && npm run build` 通過
- [x] 8.4 `openspec validate add-agent-interaction-runtime --strict` 通過
- [x] 8.5 確認無硬編碼業務句型／使用者輸入白名單、無自訂 queue/scheduler、無第二 Run Runtime
- [x] 8.6 確認互動事件與 audit 遵循 redaction（無 raw credential/unmasked PII）
- [ ] 8.7 確認 superseded run 延遲輸出不覆蓋目前 UI 狀態（generation 隔離端到端驗證：backend 標記 generation → BFF 透傳 → frontend 忽略低 generation stale chunk）
- [ ] 8.8 確認未配置 policy 時 active-input runtime 路徑回退既有行為（端到端降級回歸）

**驗收：** Backend lint/test/build、BFF build/test、Frontend lint/test/build 全數通過，OpenSpec strict validation 0 issues，8.7／8.8 端到端驗證通過
