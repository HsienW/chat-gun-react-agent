# Design：add-runtime-identity-permission-governance

## 架構分層

```text
bff/src/
├── identity.ts          (新增：PrincipalResolver contract + development adapter + trusted header emit)
└── server.ts            (修改：authenticate → resolver、canonical trusted headers、停用 raw identity 權威)

backend/src/runtime/
├── authorization/       (X8.7 - 新增)
│   ├── principal.ts         PrincipalContext 型別 + trusted header 解析（只信任 x-bff-*）
│   ├── scope.ts             RuntimeScope 模型 + active scope 解析
│   ├── resource-ref.ts      ResourceRef 正規化
│   ├── grants.ts            PermissionGrant + non-transitive delegation rules
│   ├── authorization.ts     AuthorizationRequest/Decision + policy engine（decision store 介面）
│   ├── tool-risk.ts         ToolRiskPolicy 分類（Read/Write/Sensitive/Communication）+ HITL bridge
│   ├── decision-store.ts    permission_decisions 讀寫
│   ├── grant-store.ts       permission_grants 讀寫
│   └── index.ts             barrel export
├── side-effect/        (X8.6 - 修改：runner 記錄 decisionId；result-reference 接 authorization scope)
└── audit/              (X3 - 唯讀引用；authorization 決策寫入 audit_events)

backend/src/platform/
├── tool-governance.ts  (修改：executeTyped dispatch 前插入 authorization；新增 denied_by_authorization outcome)
└── observability.ts    (不修改)

backend/src/runtime/persistence/migrations/
├── 011_create_permission_grants.sql
└── 012_create_permission_decisions.sql
```

## 核心模型

### PrincipalContext（Trusted）

```typescript
type PrincipalType = "user" | "merchant_staff" | "platform_staff" | "service";
type AuthSource = "trusted_gateway" | "service_token" | "development";

interface PrincipalContext {
  principalId: string;
  principalType: PrincipalType;
  tenantId: string;
  roles: string[];
  scopes: string[];
  authSource: AuthSource;
  authenticatedAt: string;
}
```

- Backend 只從 `x-bff-principal-id`、`x-bff-principal-type`、`x-bff-tenant-id`、`x-bff-roles`、`x-bff-scopes`、`x-bff-auth-source`、`x-bff-authenticated-at` 解析；MUST NOT 讀取 raw `x-user-id`／`x-tenant-id`。
- `principalType`／`authSource` 為 closed enum；`roles`／`scopes` 為 open string array（來源於 resolver，不由 backend 硬編碼）。

### RuntimeScope

```typescript
type ScopeType = "principal" | "tenant" | "team" | "conversation";

interface RuntimeScope {
  scopeId: string;
  scopeType: ScopeType;
  tenantId: string;
  ownerPrincipalId?: string;
}
```

- Identity 與 scope 分離：`PrincipalContext` 回答「誰」，`RuntimeScope` 回答「在哪個 active scope 操作」。
- Protected operation MUST 有明確 active scope（scopeId 非空）；scope 切換不改變 `principalId`，MUST NOT 冒充他人。
- X8.6 的 `TrustedScope { scopeId, tenantId, principalId }` 收斂為 `RuntimeScope` 之於「active scope」的投影；X8.6 的 `principalId` 欄位移至 `PrincipalContext`（不再內建於 scope）。凡 scope 相容／cached result 判定 MUST 自 `PrincipalContext` 取 `principalId` 一併比對，避免同 scope 內跨 principal 洩漏。

### ResourceRef

```typescript
interface ResourceRef {
  resourceType: string;   // 預設列舉 + open string；runtime 不硬編碼業務類型
  resourceId: string;
  tenantId: string;
  ownerScopeId?: string;
}
```

- 所有需要「屬主／tenant 檢查」的 adapter 一律接收 `ResourceRef`。
- `resourceType` 提供已知列舉（image_asset／task／step／tool_execution／product／offer／recommendation_card／memory／credential_ref）但以 open string 收尾，避免未來 Domain 修改 Core union。

### PermissionGrant 與委派

```typescript
interface PermissionGrant {
  grantId: string;
  resource: ResourceRef;
  granteeScopeId: string;
  granteeTenantId: string;
  actions: string[];
  grantedByPrincipalId: string;
  grantedByScopeId: string;
  canDelegate: boolean;
  createdAt: string;
  expiresAt?: string;
}
```

委派規則：

- 預設 non-transitive：grantee 不得 re-share／re-delegate，除非該 grant 的 `canDelegate === true` 且新 grant 由同一 `resource` 與受控 `actions` 導出。delegation validation 以顯式 `RuntimeScope`（`newGranteeScope.tenantId`）提供新 grantee 的 tenant，grant 建立時持久化為 `grantee_tenant_id`。
- 跨 tenant 委派預設 deny：以顯式 grantee tenant（`grant.granteeTenantId`／`newGranteeScope.tenantId`）與 `resource.tenantId` 比對，不同則 MUST deny；MUST NOT 從 opaque `scopeId` 推導 tenant。
- grant 建立／撤銷寫入 `permission_grants` 並 audit；`expiresAt` 到期後 grant 失效。

### AuthorizationRequest → AuthorizationDecision

```typescript
interface AuthorizationRequest {
  principal: PrincipalContext;
  scope: RuntimeScope;
  action: string;
  resource: ResourceRef;
  context?: Record<string, unknown>;
}

type AuthorizationEffect = "allow" | "deny" | "require_confirmation";

interface AuthorizationDecision {
  decisionId: string;
  effect: AuthorizationEffect;
  reasonCode: string;
  matchedPolicy?: string;
  matchedGrantId?: string;
  createdAt: string;
}
```

決策順序（短路，first-match deny 優先）：

1. **tenant boundary**：`principal.tenantId !== resource.tenantId` → deny（`CROSS_TENANT_DENIED`）。
2. **active scope**：protected operation 且 `scope.scopeId` 空 → deny（`MISSING_ACTIVE_SCOPE`）；`scope.tenantId !== resource.tenantId` → deny。
3. **visibility vs write**：read action 檢查 visible scope；write／mutating action 檢查 writable scope（`SCOPE_NOT_WRITABLE`）。
4. **role／scope**：`principal.roles`／`principal.scopes` 對 action 的 policy 匹配。
5. **action**：`action` 是否在該 resource 的允許集合內。
6. **ownership**：`resource.ownerScopeId` 存在時比對 active scope（`RESOURCE_OWNERSHIP_MISMATCH`）。
7. **explicit grant**：查 `permission_grants` 是否有匹配 `(resource, granteeScopeId, action)` 的有效 grant。
8. **contextual limits**：`context` 的 amount／risk／environment 是否超過 policy 上限 → `require_confirmation` 或 `deny`。
9. **Tool risk**：Sensitive／Communication risk 且無 explicit grant 或 policy 要求 → `require_confirmation`。

### Tool Risk Policy

```typescript
type ToolRiskTier = "read" | "write" | "sensitive" | "communication";

interface ToolRiskPolicy {
  toolName: string;
  riskTier: ToolRiskTier;
  actions: string[];           // 該 Tool 可觸發的 resource action
  requireConfirmation: boolean;
  resourceRefResolver: (input: unknown, scope: RuntimeScope) => ResourceRef;
}
```

- Runtime 不硬編碼 tool 名稱；Tool 透過 `ToolRiskPolicy` 宣告 risk tier、actions 與 `resourceRefResolver`。
- `read` → authorization 通過後自動；`write` → authorization required；`sensitive`／`communication` → authorization + `require_confirmation`。
- `resourceRefResolver` 由 Tool 提供，把 input 正規化成 `ResourceRef`（runtime 不自行猜測 resource key）。
- 未註冊 `ToolRiskPolicy` 的 Tool：預設採 `read`（不呼叫 resource-level authorization 的 legacy 行為），或依 config 決定是否 deny。

### HITL Bridge

- `require_confirmation` 時，產生待確認 decision 並進入既有 HITL／Task waiting flow（X1 的 `waiting_confirmation` 狀態與既有事件 `waiting_confirmation`）。
- 確認逾時或使用者取消 MUST 採 fail-closed：decision 視為 deny，不 dispatch 下游。
- Agent MUST NOT 有可自行批准該 HITL 請求的 Tool 路徑（見 Part G）。

## 資料模型

### permission_grants（migration 011）

```sql
grant_id                TEXT PRIMARY KEY
resource_type           TEXT NOT NULL
resource_id             TEXT NOT NULL
resource_tenant_id      TEXT NOT NULL
resource_owner_scope_id TEXT
grantee_scope_id        TEXT NOT NULL
grantee_tenant_id       TEXT NOT NULL
actions                 TEXT[] NOT NULL            -- 或 JSONB，依 driver 支援
granted_by_principal_id TEXT NOT NULL
granted_by_scope_id     TEXT NOT NULL
can_delegate            BOOLEAN NOT NULL DEFAULT FALSE
created_at              TIMESTAMPTZ NOT NULL
expires_at              TIMESTAMPTZ
revoked_at              TIMESTAMPTZ
```

- `UNIQUE(resource_tenant_id, resource_id, grantee_scope_id)`（同一 resource 對同一 grantee scope 的授權唯一；多 grantor 由 `granted_by_principal_id` 記錄，避免多 grant 並存造成授權歧義）。
- grant 撤銷採 additive `revoked_at`（不刪除歷史，保留 auditability）；grant 有效當 `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())`。`expires_at` 只表自然過期，`revoked_at` 只表主動撤銷，兩者 MUST 分開記錄，不得以覆寫 `expires_at` 表達撤銷。

### permission_decisions（migration 012）

```sql
decision_id        TEXT PRIMARY KEY
principal_id       TEXT NOT NULL
principal_type     TEXT NOT NULL
tenant_id          TEXT NOT NULL
scope_id           TEXT NOT NULL
action             TEXT NOT NULL
resource_type      TEXT NOT NULL
resource_id        TEXT NOT NULL
effect             TEXT NOT NULL               -- allow | deny | require_confirmation
reason_code        TEXT NOT NULL
matched_policy     TEXT
matched_grant_id   TEXT
policy_version     TEXT
task_id            TEXT
step_id            TEXT
tool_execution_id  TEXT
context_summary    JSONB                        -- redacted context summary
created_at         TIMESTAMPTZ NOT NULL
```

- `context_summary` 只存 redacted summary；MUST NOT 存 raw identity token／credential／unmasked PII。
- 每個 side-effect `tool_executions` 的 dispatch 前 decision MUST 寫入並以 `tool_execution_id` 關聯。

### ContextRedactor（redaction contract）

```typescript
interface ContextRedactor {
  redact(context: Record<string, unknown>): Record<string, unknown>;
}
```

- 預設實作採 field allowlist：僅保留白名單欄位（非敏感的 scalar，如 `environment`、`riskTier`）與已標記為安全的欄位；其餘以 `"[redacted]"` 取代。
- MUST 提供測試 fixture 展示 before/after；raw identity token、credential、API key、unmasked PII 一律移除。
- `DecisionStore.record()` 於寫入前 MUST 呼叫 `ContextRedactor.redact()`。

## Tool Governance 整合

Trusted identity 資料流：BFF resolver → canonical trusted headers（`x-bff-principal-*`）→ backend LangGraph request → run config 注入 → authorization layer 讀取。backend 的 Tool 層 MUST NOT 自行解析任意 client identity header；`parseTrustedPrincipal` 只讀取 BFF 設定的 canonical headers（或等價的 injected config／state）。

`GovernanceExecutor.executeTyped()` 的 dispatch 前插入 authorization：

```text
executeTyped(input, config)
  ├─ 既有 policy.enabled 檢查（tool allow/deny，保留）
  ├─ 既有 input 大小檢查（保留）
  ├─ NEW: 解析 trusted principal/scope（由 config 注入，非 client header）
  ├─ NEW: ToolRiskPolicy.resourceRefResolver(input, scope) → ResourceRef
  ├─ NEW: authorize(request) → decision
  │     ├─ allow               → 繼續 dispatch
  │     ├─ deny                → 回傳 typed denied_by_authorization（不 dispatch）
  │     └─ require_confirmation → 進入 HITL，不 dispatch（等待確認）
  └─ dispatch（既有 withTimeout + Opik span）
```

- 新增 `GovernedToolOutcome` variant：`{ type: "denied_by_authorization"; errorCode: string; decisionId: string }`（與既有 succeeded／rejected_before_dispatch／failed_not_committed／ambiguous_after_dispatch／cancelled 並列）。
- `denied_by_authorization` 與 `rejected_before_dispatch` 皆不 dispatch；前者帶 `decisionId`，後者為 policy 拒絕。兩者 MUST NOT 進 X2 Retry。
- 未提供 principal/scope（development 模式或未配置）時：採隔離 development identity adapter，MUST NOT 假裝成任意 tenant 授權。

## Side-effect 整合（X8.6 修改）

- `tool-execution-runner.ts`：在 dispatch 前呼叫 authorization（若該 Tool 具 `ToolRiskPolicy`），記錄 `decisionId` 至 `tool_executions`（新增可選欄位或 correlation 記錄），確保 Acceptance「每個 side-effect ToolExecution 關聯持久化 permission decision」。
- `result-reference-store.ts`：`authorization_mismatch` 判定改由 authorization layer 提供權威 scope 相容函式 `isScopeCompatible(scope, principal, recordScope)`，MUST 同時比對 `scopeId + tenantId + principalId`（`principalId` 取自 `PrincipalContext`，非 `RuntimeScope`）；只比對 `scopeId + tenantId` 會造成同 scope 內跨 principal 的 cached result 洩漏，MUST NOT 發生。未授權 scope／principal 不得重用 cached result。

## BFF 變更

- `bff/src/identity.ts`：

```typescript
interface PrincipalResolver {
  resolve(req: IncomingMessage, config: BffConfig): PrincipalResolution;
}

type PrincipalResolution =
  | { ok: true; principal: PrincipalContext }
  | { ok: false; status: number; message: string };
```

- 內建 `ApiKeyPrincipalResolver`（沿用既有 API key 認證，但 principal 由 key→principal 映射解析，principalType 由 config／resolver 決定，不再以 client `x-user-id` 為 principal）與 `DevelopmentPrincipalResolver`（`public` tenant + `anonymous` principal + `development` authSource）。
- `server.ts`：以 resolver 取代現有 `authenticate()` 的 principal 來源；發送 canonical trusted headers；停止把 raw `x-user-id`／`x-tenant-id` 作為權威透傳（production resolver 下）。

```text
現況: client x-user-id / x-tenant-id → ctx.userId / ctx.tenantId → x-bff-user-id / x-bff-tenant-id
改後: resolver(authenticated source) → PrincipalContext → x-bff-principal-id / x-bff-principal-type /
      x-bff-tenant-id / x-bff-roles / x-bff-scopes / x-bff-auth-source / x-bff-authenticated-at
```

- 現有 `x-bff-user-id`／`x-bff-tenant-id` 在 additive 期間保留（供未升級 backend 相容），但 production resolver 下不再由 client raw header 直接決定。
- 新增 config flag `legacyHeaderMode`（預設 `true`，`false` 停用舊 `x-bff-user-id`／`x-bff-tenant-id`）；tasks 記錄 deprecation 時間線與 follow-up（backend 全量升級後移除舊 header surface，收斂單一 trusted header 介面）。

## 觀測性（Telemetry）

- `decisionId`、`principalId`、`scopeId` 可作 trace attribute 與 structured audit field；MUST NOT 作 metric label（高基數）。
- `principalId` 若可能含 PII，記錄 opaque ID；raw identity token／credential 一律不寫入 decision、audit、trace。
- authorization 決策與 deny 次數可作聚合 metric（以 `reasonCode`／`effect` 為 label，不帶 resource/principal ID）。

## 替代方案

| 方案 | 評估 |
|------|------|
| 直接在 backend 信任 client `x-user-id`／`x-tenant-id` | ❌ 違反 Acceptance 1（偽造身份不得覆蓋 trusted context）；已列為本變更核心問題 |
| 在 tool-governance 以 tool 名稱白名單做 resource 授權 | ❌ 無法表達 resource-level 授權；違反「禁止以固定 tool／資源白名單作為主要 resolver」 |
| 引進 OPA／Cedar 或完整 OIDC/OAuth | ❌ 超出本 Issue 非目標；trusted adapter contract 即足夠 |
| 授權決策 store 不可用時 fail-open | ❌ 可能放行未授權副作用；改採 fail-closed deny（純讀取 Tool 另議） |
| 在 `resourceType` 用 closed union 收尾 | ❌ 未來 Domain 需改 Core union；採預設列舉 + open string |

## 責任邊界

| 套件 | 責任 |
|------|------|
| bff | 認證、resolver、canonical trusted header 發送；不得承擔 Prompt／Planner／Agent Workflow |
| backend | 消費 trusted context、resource-level authorization、decision/grant 持久化、Tool risk 分類與 HITL 串接 |
| frontend | 本次不變動；HITL 確認 UI 屬既有 waiting flow，不新增 frontend 範圍 |
