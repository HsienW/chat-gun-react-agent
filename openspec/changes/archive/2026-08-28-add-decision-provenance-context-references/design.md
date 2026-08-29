# Design：add-decision-provenance-context-references

## 架構分層

```text
backend/src/runtime/
├── provenance/          (X8.9 - 新增)
│   ├── decision-record.ts           DecisionRecord 型別 + factory + runtime validation
│   ├── evidence-ref.ts              EvidenceRef + EvidenceRole + validation
│   ├── context-ref.ts               ContextRef + open-set relationType + validation
│   ├── decision-record-store.ts     DecisionRecordStore 介面 + PgDecisionRecordStore（decision_records）
│   ├── evidence-store.ts            EvidenceStore 介面 + PgEvidenceStore（decision_evidence_refs）
│   ├── context-ref-store.ts         ContextRefStore 介面 + PgContextRefStore（context_refs）
│   ├── context-reference-resolver.ts  ContextReferenceResolver + AuthorizedContextReferenceResolver
│   └── index.ts                     barrel export
├── authorization/       (X8.7 - 唯讀引用 ResourceRef、authorize、ContextRedactor)
└── audit/               (X3 - 唯讀引用；decision 寫入 audit 屬既有路徑，不重複儲存)

backend/src/runtime/persistence/migrations/
├── 014_create_decision_records.sql
├── 015_create_decision_evidence_refs.sql
└── 016_create_context_refs.sql
```

## 核心模型

### DecisionRecord

```typescript
interface DecisionRecord {
  decisionId: string;
  requestId?: string;
  threadId?: string;
  runId?: string;
  taskId?: string;
  stepId?: string;
  decisionType: string;   // open string；Domain 自定義，Core 不硬編碼業務決策類型
  outcome: string;        // open string；結構化 outcome
  reasonCode: string;     // open string；reason code
  confidence?: number;    // 0..1
  policyVersion?: string;
  createdAt: string;
}
```

- `decisionId` 為 primary identity；`requestId`／`threadId`／`runId`／`taskId`／`stepId` 為 correlation（可選）。
- `decisionType`／`outcome`／`reasonCode` open string，與 X8.7 `ResourceRef.resourceType` 一致：預設列舉可用但不閉合，避免 Core 因新 Domain 決策類型而修改。
- MUST NOT 存 raw hidden reasoning／chain-of-thought。`confidence` 若有，限制為 [0,1]；runtime validation 拒絕越界值。
- 建立時 runtime validation：`decisionId` 非空、`decisionType`／`outcome`／`reasonCode` 非空。
- open-string 欄位（`decisionType`／`outcome`／`reasonCode`／`policyVersion`）長度上限 128 字元；超過上限 runtime validation MUST reject（不得靜默截斷），避免不同值截斷後 collision 造成輸入／輸出不一致。

### EvidenceRef

```typescript
type EvidenceRole =
  | "input"
  | "supporting"
  | "contradicting"
  | "policy"
  | "memory"
  | "tool_result";

interface EvidenceRef {
  evidenceRefId: string;
  decisionId: string;
  resource: ResourceRef;   // 重用 X8.7 ResourceRef，不引進競爭身份
  role: EvidenceRole;
  observedAt: string;
  resourceVersion?: string;
  snapshotHash?: string;
}
```

- 只存 reference／version／hash，不複製 unrestricted raw payload。
- `observedAt` 記錄 Runtime 評估該資源的時間；`resourceVersion`／`snapshotHash` 在被引用資源後續變更時保護歷史可解釋性。
- `role` 為 closed enum（`input`／`supporting`／`contradicting`／`policy`／`memory`／`tool_result`）；`resource.resourceType` 為 open string。

### ContextRef

```typescript
interface ContextRef {
  contextRefId: string;
  source: ResourceRef;
  target: ResourceRef;
  relationType: string;   // open-set
  createdAt: string;
}
```

- `relationType` open-set；建議初始 relation：`derived_from`／`produced_by`／`supports`／`contradicts`／`mentions`／`selected_from`／`generated_from`。Core 提供常數清單僅作參考，不構成 closed union；新 Domain 加 relation 不需改 Core。
- `source` 與 `target` 皆為 `ResourceRef`；`source.tenantId` 與 `target.tenantId` 不同時，寫入前需通過授權（跨 tenant relation 預設 deny，除非政策允許）。

### ContextReferenceResolver

```typescript
interface ContextReferenceResolver {
  findRelated(
    resource: ResourceRef,
    principal: PrincipalContext,
    scope: RuntimeScope,
    options?: { relationType?: string; limit?: number }
  ): Promise<ResourceRef[]>;
}
```

- `findRelated` 是唯一對外引用查詢入口；內部先對 `resource` 與每個候選 `target` 執行 X8.7 `authorize()`（read action），deny 即排除。
- 預設 direct／1-hop（`source = resource` 或 `target = resource` 的 `context_refs`），`limit` 控制回傳上限；MUST NOT 提供任意 multi-hop 遞迴遍歷。
- `limit` 語意為「最多查 N 筆候選」（SQL `LIMIT` 在授權過濾前套用），非「保證回傳 N 筆已授權結果」；候選被 deny 時最終回傳可能少於 N 筆。
- `principal`／`scope` 由呼叫者注入（承接 X8.7 trusted identity 資料流），resolver 不自行解析身份。

## 資料模型

### decision_records（migration 014）

```sql
decision_id       TEXT PRIMARY KEY
request_id        TEXT
thread_id         TEXT
run_id            TEXT
task_id           TEXT
step_id           TEXT
decision_type     TEXT NOT NULL
outcome           TEXT NOT NULL
reason_code       TEXT NOT NULL
confidence        DOUBLE PRECISION          -- 0..1，可空
policy_version    TEXT
created_at        TIMESTAMPTZ NOT NULL
```

- `CREATE INDEX ON decision_records (task_id)`、`(step_id)`、`(decision_type)` 支援查詢；`task_id`／`step_id` 可空。

### decision_evidence_refs（migration 015）

```sql
evidence_ref_id         TEXT PRIMARY KEY
decision_id             TEXT NOT NULL REFERENCES decision_records(decision_id)
resource_type           TEXT NOT NULL
resource_id             TEXT NOT NULL
resource_tenant_id      TEXT NOT NULL
resource_owner_scope_id TEXT
role                    TEXT NOT NULL   -- input | supporting | contradicting | policy | memory | tool_result
observed_at             TIMESTAMPTZ NOT NULL
resource_version        TEXT
snapshot_hash           TEXT
```

- 以 `resource_type`／`resource_id`／`resource_tenant_id`（+ 可選 `resource_owner_scope_id`）投影 `ResourceRef`，保留 tenant/scope ownership。
- `CREATE INDEX ON decision_evidence_refs (decision_id)`、`(resource_tenant_id, resource_id)`。

### context_refs（migration 016）

```sql
context_ref_id         TEXT PRIMARY KEY
source_type            TEXT NOT NULL
source_id              TEXT NOT NULL
source_tenant_id       TEXT NOT NULL
source_owner_scope_id  TEXT
target_type            TEXT NOT NULL
target_id              TEXT NOT NULL
target_tenant_id       TEXT NOT NULL
target_owner_scope_id  TEXT
relation_type          TEXT NOT NULL
created_at             TIMESTAMPTZ NOT NULL
```

- `source`／`target` 各自投影 `ResourceRef`；`relation_type` open string。
- `CREATE INDEX ON context_refs (source_tenant_id, source_id)`、`(target_tenant_id, target_id)`。

三者皆 additive（`CREATE TABLE IF NOT EXISTS`），不刪改 001–013。

## Redaction

- DecisionRecord 本身只含結構化欄位，不含 raw content；evidence/context 只存 ref/version/hash，不複製 payload。因此 provenance 寫入路徑不新增 raw content 欄位。
- 若未來需要對 open-string 欄位（如 `outcome` 誤植內容）做防護，重用 X8.7 `ContextRedactor` 契約；`DecisionRecordStore.record()` 寫入前可選擇性套用 redaction，但本變更不新增任何 raw prompt／CoT／credential／unmasked PII／unrestricted tool output 欄位。
- `snapshotHash` 為內容 hash（如 SHA-256），非 raw 內容；MUST NOT 以 hash 反推或儲存原始 payload。

## 授權整合

`AuthorizedContextReferenceResolver.findRelated` 資料流：

```text
findRelated(resource, principal, scope, options)
  ├─ authorize(principal, scope, "read", resource)        → deny 即回傳 []
  ├─ 查 context_refs（source=resource OR target=resource，1-hop）
  │     ├─ relationType 過濾（若有）
  │     └─ limit 截斷
  ├─ 對每個候選 target 執行 authorize(principal, scope, "read", target)
  │     └─ deny 即排除
  └─ 回傳授權通過的 ResourceRef[]
```

- 授權決策不可用時 fail-closed（回傳 `[]`，MUST NOT 放行）。
- `AuthorizationDecision.effect` 三值中，`deny` 與 `require_confirmation` 目前皆視同 deny（fail-closed，回傳 `[]`）；resolver 不區分「明確 deny」與「待確認」。若未來需區分 pending confirmation，再擴充回傳契約。
- 跨 tenant（`resource.tenantId !== principal.tenantId`）在第一步即被 X8.7 `authorize()` deny。

**寫入側授權**：`ContextRefStore.record()` 於寫入前，若 `source.tenantId !== target.tenantId`，MUST 通過 X8.7 `authorize()`（對 target 執行 read action）檢查，deny 即拒絕寫入。寫入側授權與 `findRelated` 讀取側授權共同構成 ContextRef 的 tenant 邊界；兩者皆 fail-closed。

## 觀測性（Telemetry）

- `decisionId` 作 trace attribute／structured audit field，MUST NOT 作 metric label（高基數）。
- Decision 寫入不重複 X3 Audit；若某決策具審計語意，仍走既有 `audit_events`（X3 路徑），X8.9 只補「為何」的 provenance，兩者以 `decisionId`／correlation ID 關聯。
- 聚合 metric（如 decision 總數）可帶 `decisionType`／`reasonCode` 為 label，不帶 resource/principal ID。

## 替代方案

| 方案 | 評估 |
|------|------|
| 建立 Graph DB／Knowledge Graph | ❌ 超出 X8.9 非目標；引用原語只需 1-hop relation |
| RDF/OWL/ontology 層 | ❌ 過重；本變更採薄引用原語 |
| 為每個 Domain 建立獨立 provenance 表 | ❌ X9 消費 X8.9，不得重定義 Recommendation-only provenance；違反「單一來源」 |
| `relationType` 用 closed union | ❌ 未來 Domain 需改 Core；採 open-set |
| `findRelated` 提供任意 multi-hop | ❌ 可能退化成未授權圖遍歷；預設 1-hop + limit |
| 在 provenance 表複製 raw payload | ❌ 違反 redaction 與資料最小化；只存 ref/version/hash |

## 責任邊界

| 套件 | 責任 |
|------|------|
| backend | 定義 DecisionRecord／EvidenceRef／ContextRef、持久化、授權引用查詢、correlation；不擁有業務決策語意 |
| bff | 本次不變動 |
| frontend | 本次不變動 |

Domain（X9 及後續）注入 `decisionType`／`outcome`／`reasonCode` 的實際值與 evidence resource；Core 不硬編碼任何業務決策類型、relation 語意或 resource 類型。
