# Design：add-side-effect-tool-execution-runtime

## 架構分層

```text
backend/src/runtime/
├── types.ts              (X1 - 既有，不修改)
├── events.ts             (X1 - 既有，不修改)
├── persistence/          (X1/X3 - 既有；新增 migrations)
├── retry/                (X2 - 既有，唯讀引用)
├── idempotency/          (X3 - 既有，維持短期 request-dedup)
├── audit/                (X3 - 既有，唯讀引用)
├── compensation/         (X4 - 修改：compensation_execution prepared + manual 升級)
└── side-effect/          (X8.6 - 新增)
    ├── identity.ts                四種 identity 的型別與 serialize/hash
    ├── side-effect-descriptor.ts  SideEffectToolDescriptor / ResultReferencePolicy
    ├── governed-outcome.ts        GovernedToolOutcome discriminated union
    ├── business-effect-ledger.ts  business_effects 讀寫與 claim (fail-closed)
    ├── tool-execution-runner.ts   ToolExecutionRunner 邊界（dispatch/transition/reconcile）
    ├── reconciler.ts              SideEffectReconciler contract 與三態
    ├── result-reference-store.ts  結果 reference 的 store／resolver
    └── index.ts                   barrel export

backend/src/platform/
├── tool-governance.ts    (修改：新增 executeTyped；legacy governedInvoke 保留為相容 adapter)
└── observability.ts      (不修改)

bff/src/
└── server.ts             (修改：CORS allow-headers + idempotency header 驗證)
```

## 四種 Identity 模型

| Identity | 公式／來源 | Lifetime | 語意 |
|----------|-----------|----------|------|
| `replayKey` | `hash(runId + stepId + logicalToolCallId/toolCallId + callIndex + toolName + toolVersion)` | Bound to Run/Step lineage | 同一 logical Tool call，跨 checkpoint replay/resume 不變。**MUST NOT 含 `attempt`** |
| `toolExecutionAttemptId` | 每次 physical dispatch 遞增的唯一 ID | Per physical invocation | 每次實際呼叫下游的 identity |
| `businessEffectKey` | 由 `SideEffectToolDescriptor.deriveBusinessEffectKey(input, scope)` 產生 | Long-lived / non-expiring by default | 保護同一業務效果，跨 replay／attempt／後續 Run |
| `requestDedupKey` | 來自 HTTP header（經 trusted namespace 正規化）或 requestId-derived | Short TTL | 防止快速重複提交／retry |

### attempt 語意釐清

`attempt` 若需保留，MUST 定義為 **logical call generation**（由 Graph/node 產生），且 checkpoint replay MUST NOT 遞增；實際下游重試另用 `executionAttempt`（physical attempt，記錄於 `tool_execution_attempts`）。同一 `replayKey` 對應一列 `tool_executions`，其下可有多列 `tool_execution_attempts`（`executionAttempt` 遞增）。

### TrustedScope

`deriveBusinessEffectKey` 的 `scope: TrustedScope` 來自 X8.7 的 trusted principal/tenant/scope 模型；X8.6 先以最小 `TrustedScope { scopeId, tenantId, principalId }` 介面承接，避免 runtime 硬編碼資源規則。scope 不一致時（tenant/principal mismatch）MUST 視為 authorization/scope mismatch，不得重用 cached result。

## 資料模型

```text
business_effects (1) ──┬── N tool_executions (logical replay identity, FK → business_effect)
                       │      ├── N tool_execution_attempts (physical attempts, append-only)
                       │      └── N reconciliation_attempts / lifecycle events (append-only)
                       └── N compensation_executions
```

### business_effects

```sql
business_effect_id      TEXT PRIMARY KEY
scope_id                TEXT NOT NULL          -- TrustedScope.scopeId
tenant_id               TEXT NOT NULL
business_effect_key     TEXT NOT NULL          -- scoped；unique within (tenant_id, scope_id, business_effect_key)
external_system_namespace TEXT                 -- 外部系統／provider／operation namespace
external_operation_id   TEXT
commit_state            TEXT NOT NULL          -- prepared | committed | compensated | unknown
expires_at              TIMESTAMPTZ            -- 預設 NULL（non-expiring tombstone）；僅 domain 明確有效期限才填
created_at / committed_at / updated_at
```

- Unique constraint：`UNIQUE(tenant_id, scope_id, business_effect_key)`。
- `external_operation_id` 不以全域唯一，改以 `UNIQUE(external_system_namespace, external_operation_id)` 複合唯一。
- Business-effect tombstone 預設保留，不任意 purge 後重新開放副作用。

### tool_executions

```sql
tool_execution_id       TEXT PRIMARY KEY
business_effect_id      TEXT REFERENCES business_effects(business_effect_id)  -- 純讀取 Tool 可 NULL
replay_key              TEXT NOT NULL          -- logical replay identity
request_id / thread_id / run_id / task_id / step_id
tool_name / tool_version
call_index              INTEGER NOT NULL       -- 參與 replayKey identity；NOT NULL
status                  TEXT NOT NULL          -- prepared | executing | committed | failed | unknown | compensating | compensated | manual_intervention_required
request_hash            TEXT
result_ref              TEXT
created_at / updated_at
```

- `replay_key` 全域唯一 `UNIQUE(replay_key)`（安全，因 hash 已含 runId，跨 run 的 logical call 不會碰撞）；不與 `business_effect_key` 同表唯一綁定。
- 同一 `business_effect` 可對應多個 `tool_executions`（不同 replayKey），代表「多 replay、單 effect」。

### tool_execution_attempts（append-only physical attempts）

```sql
tool_execution_attempt_id TEXT PRIMARY KEY   -- = toolExecutionAttemptId
tool_execution_id         TEXT REFERENCES tool_executions
execution_attempt         INTEGER NOT NULL   -- physical attempt 遞增
dispatch_state            TEXT               -- before | after | unknown
outcome                   TEXT               -- succeeded | rejected_before_dispatch | failed_not_committed | ambiguous_after_dispatch | cancelled
error_code                TEXT
started_at / ended_at
```

### compensation_executions

```sql
compensation_execution_id TEXT PRIMARY KEY
business_effect_id         TEXT REFERENCES business_effects
tool_execution_id          TEXT REFERENCES tool_executions
compensation_action_id     TEXT
status                     TEXT NOT NULL      -- prepared | executing | compensated | failed | manual_intervention_required
context                    JSONB              -- redacted context
created_at / updated_at
```

### result_references（result reference store）

```sql
result_ref_id      TEXT PRIMARY KEY
tool_execution_id  TEXT REFERENCES tool_executions
cache_state        TEXT NOT NULL              -- reusable | expired | invalidated | authorization_mismatch | version_mismatch
result_hash        TEXT
payload_ref        TEXT                       -- 指到儲存位置的 opaque reference，不存 raw payload
created_at / updated_at
```

`resultRef` 欄位不足以回傳 cached result；需 store 保存 payload reference，並由 resolver 依 `cache_state` 與 authorization/version 判定是否可重用。

### 生命週期轉換（CAS + DB constraint）

狀態轉換 MUST 由 DB constraint 與 CAS transition 保障（`WHERE status = $expected` + rowCount 檢查），不能只靠 TypeScript。`manual_intervention_required`、`failed`、`compensated` 為 terminal，MUST NOT 回到 running。

```text
prepared → executing → committed
                    → failed
                    → unknown ──reconcile──→ committed
                                        └──→ failed
prepared → rejected_before_dispatch（不 dispatch）
committed → compensating → compensated
```

## GovernedToolOutcome（typed contract）

```typescript
type GovernedToolOutcome<TResult> =
  | { type: "succeeded"; result: TResult }
  | { type: "rejected_before_dispatch"; errorCode: string }
  | { type: "failed_not_committed"; errorCode: string }
  | { type: "ambiguous_after_dispatch"; errorCode: string }
  | { type: "cancelled"; dispatchState: "before" | "after" | "unknown" };
```

`GovernanceExecutor.executeTyped()` 依 timeout／cancellation／明確未執行／下游明確拒絕／已送出但結果不明，回傳對應 variant。既有 `governedInvoke` 的 string 只在最外層 legacy LangChain adapter 產生，供既有 LangChain tool-calling 相容；Runner 一律使用 `executeTyped()`，不解析錯誤字串。

## SideEffectToolDescriptor（Q3 contract）

```typescript
interface SideEffectToolDescriptor<TInput, TResult> {
  toolName: string;
  toolVersion: string;
  deriveBusinessEffectKey(input: TInput, scope: TrustedScope): string;
  reconcile?: SideEffectReconciler<TResult>;
  resultReferencePolicy: ResultReferencePolicy<TResult>;
}

interface ResultReferencePolicy<TResult> {
  toResultRef(result: TResult): { resultHash: string; payloadRef: string };
  resolveResultRef(payloadRef: string): Promise<TResult | null>;
  isReusable(cacheState: CacheState, scope: TrustedScope, toolVersion: string): boolean;
}

type CacheState = "reusable" | "expired" | "invalidated" | "authorization_mismatch" | "version_mismatch";

interface SideEffectReconciler<TResult = unknown> {
  reconcile(input: {
    toolExecutionId: string;
    externalOperationId?: string;
    businessEffectKey: string;
  }): Promise<
    | { state: "committed"; result?: TResult }
    | { state: "not_committed" }
    | { state: "unknown"; reason?: string }
  >;
}
```

- Generic runtime 不硬編碼 tool 名稱與 resource key 規則。
- 無 reconciler 時，`ambiguous_after_dispatch`／`unknown` MUST 停止自動 retry，進入 persisted defer／manual。

## ToolExecutionRunner 流程

```text
execute(tool, input, context)
  │
  ├─ 1. 計算 replayKey（logical identity，不含 attempt）
  │     查詢既有 tool_executions（by replayKey）
  │     ├─ 命中且 requestHash 一致 → 依 result_references 判定可重用 → 回傳 cached result
  │     ├─ 命中但 requestHash 不一致 → conflict（不重用舊結果）
  │     └─ 未命中 → 建立 tool_executions（prepared）
  │
  ├─ 2. 依 descriptor 分類：
  │     ├─ 純讀取／無副作用 Tool → legacy path（可配置）
  │     └─ side-effect Tool → deriveBusinessEffectKey + business_effects claim
  │
  ├─ 3. durable prepare（business_effects + tool_executions 同 transaction）：
  │     ├─ 成功取得 effect claim → dispatch
  │     └─ 失敗 → fail-closed，回傳 SIDE_EFFECT_LEDGER_UNAVAILABLE（不呼叫下游）
  │
  ├─ 4. dispatch：GovernanceExecutor.executeTyped()，每次 physical dispatch 建立 tool_execution_attempts（executionAttempt 遞增）
  │
  ├─ 5. 依 outcome 轉換：
  │     succeeded               → committed，寫 result_references
  │     rejected_before_dispatch → 不 dispatch，failed
  │     failed_not_committed    → failed（X2 Retry Budget 允許時可 retry，新 attempt）
  │     ambiguous_after_dispatch → unknown → reconcile
  │     cancelled               → dispatchState 決定 reconcile 或 failed
  │
  └─ 6. reconcile：
        committed     → persist result，不 retry
        not_committed → retry only if Retry Budget allows
        unknown       → 停止自動 replay，persisted defer／manual
```

### Ledger fail-closed 策略

- 純讀取／無副作用 Tool：可明確配置使用 legacy path。
- side-effect Tool：無法 durable prepare 時 fail-closed，**不呼叫下游**。
- 回傳型別化 `SIDE_EFFECT_LEDGER_UNAVAILABLE`，供上層 defer／retry。
- 只有成功持久化 `prepared` 並取得 effect claim 後，才允許 dispatch。

X8.5A「缺 credentials 不阻斷 Agent flow」屬可觀測性降級，不能類比 correctness-critical ledger。

## Compensation 整合

- Registry 繼續保存 `stepName → CompensationAction[]` 靜態設定（不綁定 runtime `toolExecutionId`）。
- 建立 compensation plan 時，查詢該 step 已 committed 的 `ToolExecution`（與其 `business_effect`）。
- 執行 action 前先建立 `compensation_execution` prepared record。
- 執行 context 帶入 `toolExecutionId`／`businessEffectId`。
- 補償失敗轉 `manual_intervention_required`，MUST NOT 只記錄 failure 後繼續把 step 標成 compensated。
- 既有 `saga-orchestrator.ts` 的 `resolveOverallStatus` 需加入 `manual_intervention_required` 語意，且 action 失敗時不得再標 step 為 `compensated`。

## BFF 變更

- `access-control-allow-headers` 加入 `x-idempotency-key`。
- 對 `x-idempotency-key` 做長度、格式、重複 header 驗證。建議值：長度上限 256 字元、格式 `[A-Za-z0-9_\-:.]+`、重複 header 一律回傳 400（實作時可依 BFF 設定收斂，但 MUST 明確定義，不得靜默取第一個值）。
- 加入 trusted tenant／principal／route namespace，不以 client raw key 為唯一身份。
- 定義 canonical 名稱（`x-idempotency-key`）；若需支援 `Idempotency-Key`，採 additive alias 並定義兩者衝突規則。
- TTL 改為具上下限的設定值（`BFF_IDEMPOTENCY_TTL_MS`），至少覆蓋 BFF retry／timeout window。
- 無 header 時：`requestDedupKey` 保持 absent；requestId-derived key 只保護同一 BFF request 的 upstream retry。

## 替代方案

| 方案 | 評估 |
|------|------|
| 同一張 `tool_executions` 上對 `replay_key`、`business_effect_key` 都建唯一索引 | ❌ 無法表達「多 replay、單 effect」（Acceptance 15/16）；已被 Codex 列為 Blocker |
| `replayKey` 定義為 physical invocation identity（含 attempt） | ❌ 違反來源規劃（second-stage-plan-en-v3.md 與 Integration Acceptance 15）的 logical identity 語意；已被 Codex 列為 Blocker |
| ledger 寫入失敗時不 cache、直接執行 | ❌ fail-open，PostgreSQL 故障時解除副作用保護；已被 Codex 列為 Blocker |
| 在外層 Runner 解析 governance 錯誤字串 | ❌ 違反「禁止由顯示文字反推狀態」；改採 typed outcome |
| 長效 business-effect protection 塞進 `idempotency_records` | ❌ 既有 `expires_at NOT NULL`（migration 004），無法表達 non-expiring tombstone；改採獨立 `business_effects` |

## 觀測性（Telemetry）

- `requestId`、`replayKey`、`businessEffectKey`、`toolExecutionId` 可作 trace attributes 與 structured audit fields。
- MUST NOT 將 `requestId`、`replayKey`、`businessEffectKey` 當 metric labels（高基數）。
- 若 `businessEffectKey` 可能含資源名稱或 PII，記錄 hash／opaque ID，不存 raw key。
