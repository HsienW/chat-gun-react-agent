# Proposal：add-runtime-identity-permission-governance

## 變更定位

純 Runtime／平台治理，零業務依賴。在 X3 Persistent Audit 與 X8.6 ToolExecution ledger 之上，把 Tool Governance 從「tool-name allow/deny」升級為「生產級 authorization boundary」：建立 trusted Principal／Tenant／Scope 脈絡、正規化 ResourceRef、resource-level 權限決策、grants／decisions 持久化、Tool risk 分類與 HITL 串接，並把 privileged authorization 變更隔離在 Agent-callable Tool surface 之外。

本變更對應 `second-stage-plan-en-v3.md` 的 **X8.7**，是 Production Hardening Gate 的 **P0 #2**。X8.6 已交付 durable `tool_executions` ledger、`TrustedScope { scopeId, tenantId, principalId }` 最小介面與 `result_references.authorization_mismatch` 狀態；本變更把該最小介面收斂為正式 identity／scope／resource／authorization 模型，不重做 X8.6，也不重做 X3 Audit。

## 為什麼（Why）

生產副作用需要的不是「這個 Tool 有沒有被啟用」，而是：

> 這個已認證 principal，在此 active scope 下，是否被允許對「這個特定 resource」執行「這個 action」？

現況缺口：

```text
tool-governance.ts 的 allow/deny 只判斷 tool 名稱（TOOL_ALLOWLIST / TOOL_DENYLIST）
bff 的 authenticate() 把 client 送的 x-user-id / x-tenant-id 當作 principal 與 tenant
backend 直接信任 x-bff-user-id / x-bff-tenant-id 等透傳 header
沒有任何 resource-level 權限決策、grant、scope 可見/可寫分離或 HITL 分類
```

Client-provided `userId`／`tenantId` metadata MUST NOT 自身就具備權威性。Runtime 必須獨立建模 identity、active scope、resource ownership、grants 與 privileged control path。

## 問題描述

1. **Client identity metadata 被直接當作權威身份** — BFF 的 `authenticate()` 在 `requireAuth` 下回傳 `principal = x-user-id ?? "api-key-user"`，`ctx.tenantId = x-tenant-id ?? "default"`，並把 client 提供的 `x-user-id`／`x-tenant-id` 以 `x-bff-user-id`／`x-bff-tenant-id` 轉發給 backend；backend 側的 trusted scope 經由 LangGraph run config/state 注入（現況非由 backend 自行解析 header 名稱），使 client 控制的 identity 值一路成為 effective principal/tenant。任何 client 都能偽造 tenant／user，違反 Acceptance「偽造身份不得覆蓋 trusted PrincipalContext」。
2. **Tool Governance 只有 tool-name allow/deny，無 resource-level 決策** — `tool-governance.ts` 的 `resolveToolPolicy` 只依 `TOOL_ALLOWLIST`／`TOOL_DENYLIST` 與 `TOOL_<NAME>_ENABLED` 判斷，無法回答「這個 principal 在這個 scope 對這個 resource 是否被授權」。
3. **identity 與 scope 混在一起，無「visibility ≠ write」分離** — X8.6 的 `TrustedScope` 只有 scopeId／tenantId／principalId 三欄，未建模 `scopeType`、`ownerPrincipalId`、roles、scopes、active scope，無法表達「可讀但不可寫」「同一 principal 可存取多個 scope」。
4. **授權決策不持久、不與 ToolExecution 關聯** — 沒有 `permission_decisions`／`permission_grants`，無法回答「這個 side-effect ToolExecution 是依據哪個決策放行」；X8.6 acceptance「每個 side-effect ToolExecution 關聯到持久化的 permission decision」無法落地。
5. **無 Tool risk 分類與 HITL** — 敏感動作（refund-like、發送對外卡片）無法進入既有 HITL／Task waiting flow；授權 deny 也未與 X2 Retry Budget 明確切分（deny MUST NOT retry）。

## 解決方案

### 1. Trusted PrincipalContext（Part A）

```typescript
interface PrincipalContext {
  principalId: string;
  principalType: "user" | "merchant_staff" | "platform_staff" | "service";
  tenantId: string;
  roles: string[];
  scopes: string[];
  authSource: "trusted_gateway" | "service_token" | "development";
  authenticatedAt: string;
}
```

- `bff/`：由 `PrincipalResolver` contract（adapter pattern，不強制 OIDC/OAuth）自核准的 authentication source 解析 trusted principal／tenant；development 模式使用隔離的 development identity adapter。
- `backend/`：只消費 BFF 產出的 canonical trusted headers（`x-bff-principal-id`、`x-bff-principal-type`、`x-bff-tenant-id`、`x-bff-roles`、`x-bff-scopes`、`x-bff-auth-source`、`x-bff-authenticated-at`），MUST NOT 獨立信任任意 client identity header。
- BFF 停止把 raw `x-user-id`／`x-tenant-id` 當作權威身份直接透傳（改由 resolver 導出後以 trusted header 取代）。

### 2. Runtime Scope Model（Part B）

```typescript
interface RuntimeScope {
  scopeId: string;
  scopeType: "principal" | "tenant" | "team" | "conversation";
  tenantId: string;
  ownerPrincipalId?: string;
}
```

- Principal identity 與 active Scope 分離；principal 可存取多個 scope。
- 受保護操作 MUST 具備明確 active scope；visibility 不暗示 write 權威。
- 切換 scope MUST NOT 冒充其他 principal。

### 3. Normalized ResourceRef（Part C）

```typescript
interface ResourceRef {
  resourceType: "image_asset" | "task" | "step" | "tool_execution" | "product"
    | "offer" | "recommendation_card" | "memory" | "credential_ref" | string;
  resourceId: string;
  tenantId: string;
  ownerScopeId?: string;
}
```

Authorization、Audit、Memory、ToolExecution、Recommendation Adapter 一律使用 `ResourceRef`，取代散落的業務屬主檢查。

### 4. Grants 與非傳遞委派（Part D）

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

- 委派存取預設 non-transitive；未 `canDelegate` 不得 re-share／re-delegate。
- 跨 tenant 委派預設 deny（以顯式 `granteeTenantId` 比對 `resource.tenantId`）；grantee tenant 由 `RuntimeScope` 提供並持久化，MUST NOT 從 opaque `scopeId` 推導；grant 建立／撤銷 persisted 且 audited。

### 5. Resource-Level Authorization（Part E）

```typescript
interface AuthorizationRequest {
  principal: PrincipalContext;
  scope: RuntimeScope;
  action: string;
  resource: ResourceRef;
  context?: Record<string, unknown>;
}

interface AuthorizationDecision {
  decisionId: string;
  effect: "allow" | "deny" | "require_confirmation";
  reasonCode: string;
  matchedPolicy?: string;
  matchedGrantId?: string;
  createdAt: string;
}
```

決策依序檢查：tenant boundary、scope visibility／write、role／scope、action、ownership／resource-tenant、explicit grant lookup、contextual limits（amount／risk／environment）。

### 6. Tool Risk Policy + HITL（Part F）

| Risk | 範例 | 預設策略 |
|---|---|---|
| Read | 查詢目錄／訂單／狀態 | authorization 通過後自動 |
| Write | 建立／更新非金融紀錄 | 需 authorization |
| Sensitive | 保留福利／發補償／refund-like | authorization + HITL |
| Communication | 發送對外可見卡片／訊息 | authorization；依 policy 確認 |

`require_confirmation` MUST 進入既有 HITL／Task waiting flow。

### 7. Privileged 變更隔離在 Tool surface 之外（Part G）

Agent MUST NOT 暴露可讓其自我提升／冒充／自我批准 HITL／自建 privileged grant／繞過 tenant／resource ownership／讀 raw credential 的 Tool。Privileged 變更 MUST 經 trusted external control path 且分開 audit。

### 8. 持久化 decisions 與 grants（Part H）

新增 `permission_decisions`、`permission_grants`。持久化 principal、scope、tenant、action、resource、decision、matched grant／policy、reason code、policy version、`taskId`／`stepId`／`toolExecutionId` 與 redacted context summary。

### 9. 跨 tenant／跨 scope 安全（Part I）

ImageAsset、Task／Step／ToolExecution lookup、未來 Product／Offer／Card、長期 Memory scope、X8.6 cached Tool result 皆有明確守衛。

### 10. 與既有系統的整合

- Tool execution 前：`authorize(request)` → allow 才 dispatch；deny 直接回傳 typed denial，不進 X2 Retry。
- `tool-governance.ts` 的 `executeTyped()` 在 dispatch 前插入 authorization 邊界；deny 以新增 `denied_by_authorization` 型別化 outcome 呈現（不解析字串）。
- X8.6 `ToolExecution` 在 dispatch 前記錄 `decisionId` correlation。
- `result-reference-store.ts` 的 `authorization_mismatch` 改由 authorization layer 提供權威 scope 相容判定。

## 目標

- ✅ 建立 trusted `PrincipalContext`（含 principalType／roles／scopes／authSource／authenticatedAt）
- ✅ BFF 以 `PrincipalResolver` adapter 解析 trusted identity，不再把 client raw identity 當權威
- ✅ `RuntimeScope` 獨立建模，identity 與 active scope 分離，scope 切換不冒充 principal
- ✅ `ResourceRef` 正規化資源身份，供 authorization／audit／memory／tool-execution／recommendation 共用
- ✅ `PermissionGrant` non-transitive delegation，跨 tenant 預設 deny
- ✅ `AuthorizationDecision` allow／deny／require_confirmation 三態 + reasonCode + matched policy/grant
- ✅ Tool risk 分類（Read／Write／Sensitive／Communication）串接 HITL
- ✅ `permission_decisions`／`permission_grants` 持久化並與 ToolExecution／Audit correlation
- ✅ deny 不進 X2 Retry；每個 side-effect ToolExecution 關聯持久化 permission decision
- ✅ Agent 無 self-elevation／impersonation／self-approval 路徑
- ✅ 純 Runtime，不 import 任何業務常數

## 非目標

- ❌ Enterprise-wide IAM platform
- ❌ 強制 OIDC/OAuth 整合（trusted adapter contract 即足夠）
- ❌ OPA/Cedar 依賴（除非實作證明必要）
- ❌ Secret-manager platform
- ❌ Agent-callable 自我提升／冒充／自我批准 Tool
- ❌ 取代 X3 Audit 或 X8.6 ToolExecution ledger
- ❌ 在 backend 獨立信任任意 client identity header

## 受影響範圍

| 套件 | 影響 |
|------|------|
| bff | 新增 `src/identity.ts`（`PrincipalResolver` contract + development adapter + auth-source 解析） |
| bff | 修改 `src/server.ts`：authenticate → resolver、發送 canonical trusted headers、停止透傳 raw identity 為權威 |
| backend | 新增 `src/runtime/authorization/`（principal、scope、resource-ref、grants、authorization、tool-risk、decision/grant store） |
| backend | 修改 `src/platform/tool-governance.ts`：dispatch 前插入 authorization 邊界，新增 `denied_by_authorization` typed outcome |
| backend | 修改 `src/runtime/side-effect/tool-execution-runner.ts`：dispatch 前記錄 decision correlation |
| backend | 修改 `src/runtime/side-effect/result-reference-store.ts`：scope 相容判定改由 authorization layer 提供 |
| backend | 新增 migrations：`011_create_permission_grants.sql`、`012_create_permission_decisions.sql` |
| frontend | 本次不變動 |

## 與既有系統的關係

| 既有系統 | 關係 |
|---------|------|
| X3 Audit | authorization allow／deny／require_confirmation 寫入 `audit_events`；`actorType`／`actorId`／`decision`／`reasonCode` 既有欄位承接，本次「確實填入 principal／scope／resource 並建立 correlation」 |
| X8.6 ToolExecution | dispatch 前記錄 `decisionId`；`TrustedScope` 收斂為 `RuntimeScope`；`result_references.authorization_mismatch` 由 authorization layer 權威判定 |
| X2 Retry | `deny`／`denied_by_authorization` MUST NOT 進 retry；只有 `failed_not_committed` 在 Retry Budget 允許時 retry |
| Tool Governance | `executeTyped()` 前插入 authorization；allow 才 dispatch；deny 以 typed outcome 呈現 |
| X5 Distributed Lock | 授權決策為同步唯讀判斷，不引入 lock；grant 寫入以 DB constraint 保障 |
| X8 Observability | decisionId 作 trace attribute／structured audit field，不作 metric label |

## 風險

| 風險 | 緩解 |
|------|------|
| BFF 停止信任 raw client identity 造成既有部署斷裂 | 採 additive：預設 development adapter 保持 `public`／`anonymous` 相容；`requireAuth` 下的 production resolver 由 config 注入，不改寫既有 API key 認證，只把 principal 來源從 client header 改為 resolver 導出 |
| authorization 決策引入跨層 latency 或 fail-open | 決策為同步純函式 + DB grant lookup；決策 store 不可用時採 fail-closed deny（純讀取 Tool 另議），不靜默放行 |
| grant 委派鏈被誤設為可傳遞 | non-transitive 預設 + `canDelegate` 顯式欄位 + cross-tenant 預設 deny，皆有測試 |
| decision 持久化含 raw identity token／PII | 只存 redacted context summary 與 opaque ID，不存 raw token／credential |
| 授權規則硬編碼 tool 名稱或 resource key | `ToolRiskPolicy` 由 Tool descriptor 提供 risk tier，action 為字串、resource 為 `ResourceRef`，runtime 不硬編碼業務名稱 |

## 回滾策略

- 新增 `backend/src/runtime/authorization/` 與 `bff/src/identity.ts` 為全新模組，刪除即可回滾。
- `tool-governance.ts` 的 authorization 插入為 additive（未提供 resolver／policy 時採「development allow」或既有 allow/deny 行為），不改寫既有 tool allow/deny 語意。
- 新增 migrations 採 additive（`CREATE TABLE IF NOT EXISTS` + 新 index），不刪改既有 001–010 表格。
- BFF trusted header 為 additive（新增 canonical headers；raw header 透傳在 production resolver 下才停用）。
- 無既有資料遷移，無破壞性 schema 變更。
