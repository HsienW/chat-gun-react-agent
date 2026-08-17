# Proposal：add-side-effect-tool-execution-runtime

## 變更定位

純 Runtime，零業務依賴。在 X3 Idempotency/Audit、X4 Compensation、X8 Observability 之上，建立「side-effect Tool 執行 ledger + Replay 保護 + Business-effect Idempotency + Reconciliation」的生產級執行 Runtime，獨立回答三個問題：

1. 這是同一個 logical Agent Tool call 的 replay 嗎？
2. 這個業務副作用已經發生了嗎？
3. 外部系統是否真的 commit 了這次操作？

本變更對應 `second-stage-plan-en-v3.md` 的 **X8.6**，是 Production Hardening Gate 的 P0 #1。本版已依 Codex 獨立審查結論修訂四個核心 Blocker（replayKey 語意、Governance typed outcome、effect／execution 資料模型、ledger fail-closed），未採納 CCR 先前草案中的 physical invocation identity 與 fail-open 回滾策略。

## 為什麼（Why）

X3 以 PostgreSQL-backed idempotency records 防止重複執行，X4 提供 Saga/Compensation，X8 提供 tracing/metrics。剩餘的生產缺口是「ambiguous outcome」問題：

```text
Agent 呼叫 send_card()
  → 下游 commit 成功
  → response 遺失 / timeout
  → Agent 看到失敗
  → Graph/node 被 replay
  → 盲目重試可能送出第二張卡片
```

生產 Runtime 必須在「決定是否重用結果／重試／reconcile／compensate／升級」之前，先區分 **Agent replay identity**、**business effect identity** 與 **external commit identity**。

## 問題描述

1. **Replay 與 side-effect 保護語意混在同一個欄位** — 既有草案把 `replayKey` 定義成 physical invocation identity，且在同一張表上對 `replay_key` 與 `business_effect_key` 都建唯一索引，無法表達「多個 replay、單一 business effect」的關係（Acceptance 15/16 的語意）。
2. **Governance 例外被轉成字串，外層 Runner 無法可靠分類** — `tool-governance.ts` 的 `governedInvoke` 在 catch 後回傳 `Error: <tool> failed by tool governance - ...` 字串，Runner 無法辨識 timeout／cancellation／明確未執行／下游明確拒絕／已送出但結果不明。解析錯誤字串又違反「禁止由顯示文字反推狀態」的專案規則。
3. **Side-effect ledger 寫入失敗時 fail-open** — 先前草案的回滾策略「tool_executions 寫入失敗時不 cache、直接執行」會在 PostgreSQL 故障時解除副作用保護，可能造成重複副作用。
4. **補償執行缺乏持久化與正確升級語意** — 既有 `compensation-registry.ts` 是 `stepName → CompensationAction[]` 的靜態設定；`toolExecutionId` 是 runtime instance ID，不應在 action registration 時綁定。既有 orchestrator 在 action 失敗後仍把 Step 標成 `compensated`，且補償失敗未轉成 `manual_intervention_required`。
5. **BFF 的 idempotency header 邊界不完整** — 已透傳 `x-idempotency-key`，但 CORS `access-control-allow-headers` 未包含它、無長度／格式／重複 header 驗證、缺少 trusted tenant／principal／route namespace、無 canonical 名稱定義。

## 解決方案

### 1. 分離四種 identity（修正 Blocker Q1）

```text
replayKey          = hash(runId + stepId + logicalToolCallId/toolCallId
                          + callIndex + toolName + toolVersion)
toolExecutionAttemptId = 每次實際呼叫下游時遞增的唯一 ID
businessEffectKey      = 跨 replay、attempt、甚至後續 Run 保護同一業務效果
requestDedupKey        = 短期 HTTP request 去重
```

語意分工：

- `replayKey`：同一 logical call，跨 checkpoint replay/resume 保持不變，**MUST NOT 包含會遞增的 `attempt`**。
- `toolExecutionAttemptId`：每次 physical invocation 的唯一 ID。
- `businessEffectKey`：長效，保護同一業務效果，不因 replay 或 attempt 變動而失效。
- `requestDedupKey`：短期，允許 TTL 過期。

若 `attempt` 必須保留，MUST 明確定義為「logical call generation」，且 checkpoint replay MUST NOT 遞增；實際下游重試另用 `executionAttempt`（physical attempt）。

### 2. Governance 保留型別化結果（修正 Blocker Q4）

新增 `GovernanceExecutor.executeTyped()`，回傳 discriminated union：

```typescript
type GovernedToolOutcome<TResult> =
  | { type: "succeeded"; result: TResult }
  | { type: "rejected_before_dispatch"; errorCode: string }
  | { type: "failed_not_committed"; errorCode: string }
  | { type: "ambiguous_after_dispatch"; errorCode: string }
  | { type: "cancelled"; dispatchState: "before" | "after" | "unknown" };
```

既有錯誤字串只在最外層 legacy LangChain 相容 adapter 產生。Runner 邊界為：

```text
ToolExecutionRunner → GovernanceExecutor.executeTyped() → Concrete Tool
                    → typed outcome/error → durable lifecycle transition
                    → legacy LangChain compatibility mapping
```

### 3. 資料模型表達「多 Replay、單一 Effect」（修正 Blocker 資料模型）

```text
business_effects (1)
  ├── N tool_executions (logical replay identity, FK → business_effect)
  │     ├── N tool_execution_attempts (physical attempts, append-only)
  │     └── N reconciliation_attempts / lifecycle events
  └── N compensation_executions
```

- `requestHash` 不一致時回傳 conflict，MUST NOT 重用舊結果。
- `externalOperationId` 不全域唯一，以 `(external_system_namespace, external_operation_id)` 複合唯一。
- DB constraint 與 CAS transition 為必要防線，不能只靠 TypeScript。
- `callIndex` 參與 identity，需要唯一性時 MUST NOT 為 optional。

### 4. Side-effect ledger fail-closed（修正 Blocker Ledger 降級）

刪除「寫入失敗時不 cache、直接執行」策略，改為：

- 純讀取／無副作用 Tool：可明確配置使用 legacy path。
- side-effect Tool：無法 durable prepare 時 fail-closed，**不呼叫下游**。
- 回傳型別化 `SIDE_EFFECT_LEDGER_UNAVAILABLE`，供上層 defer／retry。
- 只有成功持久化 `prepared` 並取得 effect claim 後，才允許 dispatch。

X8.5A「缺 credentials 不阻斷 Agent flow」屬可觀測性降級，不能類比 correctness-critical ledger。

### 5. Tool-owned side-effect descriptor（修正 Q3）

Generic runtime 不硬編碼 tool 名稱與 resource key 規則，改由 Tool 提供 descriptor：

```typescript
interface SideEffectToolDescriptor<TInput, TResult> {
  toolName: string;
  toolVersion: string;
  deriveBusinessEffectKey(input: TInput, scope: TrustedScope): string;
  reconcile?: SideEffectReconciler<TResult>;
  resultReferencePolicy: ResultReferencePolicy<TResult>;
}
```

無 reconciler 時，ambiguous outcome MUST 停止自動 retry，進入 defer／manual。

### 6. BFF idempotency header 收斂（修正 Q2）

- CORS `access-control-allow-headers` 加入 `x-idempotency-key`。
- 加入長度、格式、重複 header 驗證。
- 加入 trusted tenant／principal／route namespace，不只使用 client raw key。
- 定義 canonical 名稱；若改名採 additive alias 並定義衝突規則。
- TTL 改為具上下限的設定值，至少覆蓋 BFF retry／timeout window（不用無來源依據的固定 ≤60s）。
- 無 header 時：`requestDedupKey` 保持 absent，或明確定義 requestId-derived key 只保護同一 BFF request 的 upstream retry；不宣稱能防止使用者再次提交。

### 7. Compensation 整合（修正 Q6）

- Registry 繼續保存 action definition（stepName → CompensationAction 靜態設定）。
- 建立 compensation plan 時查詢該 step 已 committed 的 ToolExecution。
- 執行 action 前先建立 `compensation_execution` prepared record。
- 執行 context 帶入 `toolExecutionId`／`businessEffectId`。
- 補償失敗轉成 `manual_intervention_required`，MUST NOT 只記錄 failure 後繼續把 step 標成 compensated。

## 目標

- ✅ 四種 identity 分工明確，`replayKey` 為 logical identity（不含 attempt），`toolExecutionAttemptId` 為 physical identity
- ✅ `GovernedToolOutcome` typed contract，區分 succeeded／rejected_before_dispatch／failed_not_committed／ambiguous_after_dispatch／cancelled
- ✅ `business_effects`／`tool_executions`／`tool_execution_attempts`／`compensation_executions` 資料模型表達「多 replay、單 effect」
- ✅ Side-effect ledger fail-closed，durable prepare 失敗不 dispatch 下游
- ✅ `SideEffectToolDescriptor` contract，runtime 不硬編碼 tool 名稱／resource key
- ✅ Reconciliation 三態（committed／not_committed／unknown），unknown 停止自動 replay 並 persisted defer／manual
- ✅ Result reference store／resolver，不只存 `resultRef` 欄位
- ✅ 補償執行持久化，失敗轉 `manual_intervention_required`
- ✅ BFF CORS／header 驗證／namespace／canonical 名稱收斂
- ✅ 純 Runtime，不 import 任何業務常數

## 非目標

- ❌ Distributed exactly-once 宣稱；使用 replay protection + durable idempotency + reconciliation
- ❌ 通用分散式交易／2PC coordinator
- ❌ 取代 X3 Idempotency、X4 Compensation、X8 Observability
- ❌ 強制真實支付／優惠券系統；PostgreSQL-backed side-effect mock 可接受
- ❌ 跨 tenant 的 raw Tool-output cache
- ❌ 在 compensation registry 靜態註冊時綁定 runtime instance 的 `toolExecutionId`
- ❌ 以 `requestId` fallback 宣稱能防止使用者再次提交（新 request 通常取得新 requestId）

## 受影響範圍

| 套件 | 影響 |
|------|------|
| backend | 新增 `src/runtime/side-effect/`（identity、ledger、runner、reconciler、result-reference、descriptor contract） |
| backend | 修改 `src/platform/tool-governance.ts`：新增 `executeTyped()`，legacy `governedInvoke` 保留為最外層相容 adapter |
| backend | 修改 `src/runtime/compensation/`：補償 plan 查詢 committed ToolExecution、compensation_execution prepared record、manual_intervention_required 升級 |
| backend | 新增 migrations：`business_effects`、`tool_executions`、`tool_execution_attempts`、`compensation_executions`、`result_references`（或對等的 append-only lifecycle events） |
| bff | 修改 `src/server.ts`：CORS allow-headers、idempotency header 驗證、canonical 名稱、TTL 設定 |
| frontend | 本次不變動 |

## 與既有系統的關係

| 既有系統 | 關係 |
|---------|------|
| X3 Idempotency | `idempotency_records` 維持短期 request-dedup 用途；長效 business-effect protection 移入獨立的 `business_effects`，不塞進 `idempotency_records`（其 `expires_at NOT NULL`，見 migration 004） |
| X3 Audit | 所有 side-effect 生命週期事件寫入 `audit_events`；`tool_execution_id` 欄位已存在，本次為「確實填入並建立完整 correlation」 |
| X4 Compensation | 補償 plan 建立時查詢已 committed ToolExecution；`compensation_execution` prepared record + `manual_intervention_required` 升級 |
| X2 Retry | `not_committed` 才 retry，且僅在 Retry Budget 允許時；`unknown` 與 authorization denial 不進 retry |
| X5 Distributed Lock | 兩個 worker 同時 claim 相同 business effect 時，以 DB unique constraint + CAS 為 correctness 防線 |
| X8 Observability | ToolExecution correlation 沿用 OTel trace/span；IDs 作 trace attributes，不作 metric labels |
| Tool Governance | `executeTyped()` 提供 typed outcome；legacy string mapping 只在最外層 |

## 風險

| 風險 | 緩解 |
|------|------|
| PostgreSQL 故障時 side-effect 無法 dispatch | fail-closed + `SIDE_EFFECT_LEDGER_UNAVAILABLE` typed outcome，供上層 defer／retry；純讀取 Tool 走 legacy path |
| 同一 business effect 被兩個 worker 同時 claim | DB unique constraint（scoped business_effect_key）+ CAS transition 雙重防線，不以 TS 單獨保障 |
| requestHash 不一致卻重用舊結果 | conflict 回傳，MUST NOT 重用舊結果 |
| 補償失敗仍被標成 compensated | 補償失敗轉 `manual_intervention_required`，不繼續把 step 標成 compensated |
| businessEffectKey 含資源名稱或 PII | 記錄 hash／opaque ID，不存 raw key；不作為 metric label |

## 回滾策略

- 新增 `src/runtime/side-effect/` 目錄為全新模組，刪除即可回滾；`tool-governance.ts` 的 `executeTyped()` 為 additive（legacy `governedInvoke` 保留）。
- 新增 migrations 採 additive 方式（CREATE TABLE IF NOT EXISTS + 新 index），不刪改既有 X3/X4 表格。
- BFF 變更為 additive（新增 allow-header、驗證函式），可逐項 revert。
- 無既有資料遷移，無破壞性 schema 變更。
