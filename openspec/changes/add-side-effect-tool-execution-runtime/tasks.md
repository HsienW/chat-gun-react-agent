# Tasks：add-side-effect-tool-execution-runtime

> 依 Codex 獨立審查結論修訂。四個 Blocker（replayKey logical identity、Governance typed outcome、effect／execution 資料模型、ledger fail-closed）與 Q2–Q6 均已拆入下列 Tasks。BFF 現已有 `test` script（`vitest run`），故 BFF 驗證命令為 `cd bff && npm run build && npm run test`。

## Phase 1：Identity 模型與 Side-effect Descriptor Contract（backend）

### Task 1.1：建立四種 identity 型別與 serialize/hash

- [ ] 建立 `backend/src/runtime/side-effect/identity.ts`
- [ ] 定義 `replayKey` 為 `hash(runId + stepId + logicalToolCallId/toolCallId + callIndex + toolName + toolVersion)`，**MUST NOT 含 attempt**
- [ ] 定義 `toolExecutionAttemptId`（每次 physical invocation 唯一）與 `executionAttempt`（physical attempt 遞增）
- [ ] 定義 `businessEffectKey`（由 descriptor 導出）與 `requestDedupKey`（短期）
- [ ] 定義 `TrustedScope` 最小介面（scopeId、tenantId、principalId），承接 X8.7 trusted scope
- [ ] 定義 `attempt`（若保留）為 logical call generation，checkpoint replay 不遞增
- [ ] 單元測試：replayKey 跨 resume 不變、不含 attempt、physical retry 不改變 replayKey

**驗收：** `cd backend && npx vitest run src/runtime/side-effect/identity.test.ts` 通過

### Task 1.2：建立 SideEffectToolDescriptor contract

- [ ] 建立 `backend/src/runtime/side-effect/side-effect-descriptor.ts`
- [ ] 定義 `SideEffectToolDescriptor<TInput, TResult>`（toolName、toolVersion、deriveBusinessEffectKey、reconcile?、resultReferencePolicy）
- [ ] 定義 `ResultReferencePolicy<TResult>`（toResultRef、resolveResultRef、isReusable）與 `CacheState`
- [ ] 定義 `SideEffectReconciler<TResult>` 三態：committed／not_committed／unknown
- [ ] 單元測試：runtime 不硬編碼 tool 名稱、無 reconciler 時 ambiguous 停止自動 retry

**驗收：** TypeScript 編譯通過，descriptor contract 可被測試 mock 引用

---

## Phase 2：GovernedToolOutcome typed outcome（backend platform）

### Task 2.1：tool-governance 新增 executeTyped()

- [ ] 修改 `backend/src/platform/tool-governance.ts`
- [ ] 新增 `GovernedToolOutcome<TResult>` discriminated union（succeeded／rejected_before_dispatch／failed_not_committed／ambiguous_after_dispatch／cancelled(dispatchState)）
- [ ] 新增 `executeTyped()`，依 timeout／cancellation／dispatch 前拒絕／下游明確拒絕／ambiguous 回傳對應 variant
- [ ] 保留既有 `governedInvoke` 作為最外層 legacy LangChain 相容 adapter（字串 mapping 只在這裡產生）
- [ ] 區分 timeout（`[governance_timeout]`）與外部 cancellation 訊號的 typed 映射
- [ ] 單元測試：五種 outcome、legacy adapter 與 executeTyped 並存、Runner 不需解析錯誤字串

**驗收：** `cd backend && npx vitest run src/platform/tool-governance.test.ts` 通過

---

## Phase 3：資料模型 Migrations（backend）

### Task 3.1：新增 side-effect 資料表

- [ ] 新增 migration `006_create_business_effects.sql`
  - `business_effects`（business_effect_id、scope_id、tenant_id、business_effect_key、external_system_namespace、external_operation_id、commit_state、expires_at 可 NULL、created_at/committed_at/updated_at）
  - `UNIQUE(tenant_id, scope_id, business_effect_key)`；`UNIQUE(external_system_namespace, external_operation_id)` 複合唯一（非全域唯一）
- [ ] 新增 migration `007_create_tool_executions.sql`
  - `tool_executions`（tool_execution_id、business_effect_id FK、replay_key、request/thread/run/task/step id、tool_name/tool_version、call_index、status、request_hash、result_ref、timestamps）
- [ ] 新增 migration `008_create_tool_execution_attempts.sql`
  - `tool_execution_attempts`（tool_execution_attempt_id、tool_execution_id FK、execution_attempt、dispatch_state、outcome、error_code、started_at/ended_at）append-only
- [ ] 新增 migration `009_create_compensation_executions.sql`
  - `compensation_executions`（compensation_execution_id、business_effect_id FK、tool_execution_id FK、compensation_action_id、status、context JSONB、timestamps）
- [ ] 新增 migration `010_create_result_references.sql`
  - `result_references`（result_ref_id、tool_execution_id FK、cache_state、result_hash、payload_ref、timestamps）
- [ ] 狀態轉換以 DB constraint + CAS（`WHERE status = $expected` + rowCount）保障，不以 TS 單獨保障

**驗收：** migration-runner 可套用全部 migration；`cd backend && npm run test`（含 migration-runner.test.ts）通過

---

## Phase 4：Side-effect Ledger、Runner 與 Reconciler（backend）

### Task 4.1：建立 business-effect ledger（fail-closed）

- [ ] 建立 `backend/src/runtime/side-effect/business-effect-ledger.ts`
- [ ] 實作 durable prepare（business_effects + tool_executions 同 transaction）與 effect claim
- [ ] prepare 失敗 → fail-closed，回傳 `SIDE_EFFECT_LEDGER_UNAVAILABLE`，不 dispatch 下游
- [ ] 純讀取／無副作用 Tool 走可配置 legacy path
- [ ] 只有成功持久化 `prepared` 並取得 claim 後才 dispatch
- [ ] 單元測試（mock DB）：prepare 失敗不執行下游、純讀取走 legacy、成功 claim 才 dispatch

**驗收：** `cd backend && npx vitest run src/runtime/side-effect/business-effect-ledger.test.ts` 通過

### Task 4.2：建立 ToolExecutionRunner

- [ ] 建立 `backend/src/runtime/side-effect/tool-execution-runner.ts`
- [ ] 流程：replayKey 查詢 → requestHash 比對（不一致 conflict）→ descriptor 分類 → durable prepare → dispatch（executeTyped）→ outcome 轉換 → reconcile
- [ ] 每次 physical dispatch 建立 `tool_execution_attempts`（executionAttempt 遞增）
- [ ] `unknown` 依 reconciler 三態：committed 不 retry、not_committed 依 Retry Budget、unknown 停止自動 replay 並 persisted defer
- [ ] 無 reconciler 時 ambiguous/unknown 進入 persisted manual/defer
- [ ] 單元測試：reuse 命中、requestHash conflict、attempt 遞增、三態轉換、無 reconciler defer

**驗收：** `cd backend && npx vitest run src/runtime/side-effect/tool-execution-runner.test.ts` 通過

### Task 4.3：建立 reconciler 三態處理

- [ ] 建立 `backend/src/runtime/side-effect/reconciler.ts`（SideEffectReconciler contract，或併入 descriptor）
- [ ] 單元測試：committed／not_committed／unknown 三態各自的後續動作

**驗收：** TypeScript 編譯通過，三態測試納入 Task 4.2 或獨立測試檔

---

## Phase 5：Result Reference Store／Resolver（backend）

### Task 5.1：建立 result reference store 與 resolver

- [ ] 建立 `backend/src/runtime/side-effect/result-reference-store.ts`
- [ ] store 保存 `payload_ref`、`result_hash`、`cache_state`（不存 raw payload）
- [ ] resolver 依 `cache_state`、authorization scope、tool version 判定可重用
- [ ] `version_mismatch`／`authorization_mismatch`／`invalidated`／`expired` 拒絕重用
- [ ] 單元測試：reusable 回傳 cached result、version/scope mismatch 拒絕、僅存 resultRef 欄位不足以回傳（需 store）

**驗收：** `cd backend && npx vitest run src/runtime/side-effect/result-reference-store.test.ts` 通過

---

## Phase 6：Compensation 整合（backend）

### Task 6.1：補償 plan 查詢 committed ToolExecution 並持久化 compensation_execution

- [ ] 修改 `backend/src/runtime/compensation/saga-orchestrator.ts`
- [ ] 建立 compensation plan 時查詢該 step 已 committed 的 ToolExecution（與 business_effect）
- [ ] 執行 action 前建立 `compensation_execution` prepared record
- [ ] 執行 context 帶入 `toolExecutionId`／`businessEffectId`
- [ ] 補償失敗 → `manual_intervention_required`，不得再標 step 為 `compensated`
- [ ] 將 for 迴圈底部無條件的 `updateStatus(step.stepId, 'compensated')` 改為條件式：該 step 所有 action 皆成功才 `compensated`；任一 action 失敗或進入 manual 則不標 `compensated`
- [ ] `resolveOverallStatus` 加入 `manual_intervention_required` 語意
- [ ] 既有 `compensation-registry.ts` 保持 `stepName → CompensationAction[]` 靜態設定，不綁定 runtime `toolExecutionId`
- [ ] 單元測試：prepared record、失敗不標 compensated、manual 升級、registry 不綁 runtime ID

**驗收：** `cd backend && npx vitest run src/runtime/compensation/saga-orchestrator.test.ts` 通過

---

## Phase 7：BFF 變更（bff）

### Task 7.1：收斂 idempotency header 的 CORS 與驗證

- [ ] 修改 `bff/src/server.ts`
- [ ] CORS `access-control-allow-headers` 加入 `x-idempotency-key`
- [ ] 加入長度、格式、重複 header 驗證
- [ ] 加入 trusted tenant／principal／route namespace（不以 client raw key 為唯一身份）
- [ ] 定義 canonical 名稱；若支援 `Idempotency-Key` 採 additive alias 並定義衝突規則
- [ ] TTL 改為具上下限設定值（`BFF_IDEMPOTENCY_TTL_MS`），覆蓋 BFF retry／timeout window
- [ ] 無 header 時 requestDedupKey 保持 absent；requestId-derived key 只保護同一 BFF request 的 upstream retry
- [ ] 測試：CORS 包含 header、重複 header、alias 衝突、TTL 設定、無 header 語意

**驗收：** `cd bff && npm run build && npm run test` 通過

---

## Phase 8：整合與故障注入測試（backend PostgreSQL integration）

### Task 8.1：並發與故障注入整合測試

- [ ] 兩個 worker 同時 claim 相同 business effect → 只有一個成功（真實 PostgreSQL integration，驗證 unique constraint + CAS）
- [ ] 同一 replay key 但 request hash 不同 → conflict，不重用舊結果
- [ ] ledger unavailable → side-effect 不執行（fail-closed）
- [ ] 下游 commit 後、ledger commit 前故障（fault injection，獨立 transaction 模擬 response 遺失）
- [ ] executing process crash 後轉 unknown 並 reconcile
- [ ] 無 reconciler 進入 persisted manual/defer
- [ ] Retention/tombstone policy 測試：tombstone 預設保留、domain 明確有效期限才 expiry
- [ ] Tenant/authorization scope mismatch 注入 policy 測試：scope 不符拒絕重用 cached result

**驗收：** `cd backend && npx vitest run src/runtime/side-effect/*.integration.test.ts` 通過（PostgreSQL 需可用）

---

## Phase 9：Audit Correlation 與 Telemetry（backend）

### Task 9.1：確實填入 toolExecutionId 並建立完整 correlation

- [ ] 修正先前草案 Task 9：`AuditEvent.toolExecutionId` **已存在**於 `audit-events.ts` 與 `005_create_audit_events.sql`，本次為「確實填入並建立完整 correlation」，非新增欄位
- [ ] 決定 requestId／threadId／runId 為 dedicated columns 或安全的 structured payload（redaction 後）
- [ ] 建立 replayKey／businessEffectKey／toolExecutionId／externalOperationId 與 Audit、OTel trace/span 的 correlation
- [ ] IDs 可作 trace attributes／structured audit fields；MUST NOT 作 metric labels
- [ ] businessEffectKey 可能含 PII 時記錄 hash／opaque ID，不存 raw key

**驗收：** `cd backend && npx vitest run src/runtime/audit/*.test.ts` 通過；無 raw key 洩漏

---

## Phase 10：合規檢查

### Task 10.1：全量驗證

- [ ] `cd backend && npm run lint` 通過
- [ ] `cd backend && npm run test` 通過（含所有新增 side-effect 測試）
- [ ] `cd backend && npm run build` 通過
- [ ] `cd bff && npm run build` 通過
- [ ] `cd bff && npm run test` 通過
- [ ] 確認無 `any` 濫用、無硬編碼業務 Step 名稱／tool 名稱／resource key 規則
- [ ] 確認 side-effect 模組不 import 任何業務模組
- [ ] 確認 ledger fail-closed、replayKey 不含 attempt、補償失敗轉 manual_intervention_required
- [ ] `openspec validate add-side-effect-tool-execution-runtime --strict` 通過

**驗收：** Backend lint/test/build 與 BFF build/test 全部通過，OpenSpec strict validation 0 issues
