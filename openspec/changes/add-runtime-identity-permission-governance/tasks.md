# Tasks：add-runtime-identity-permission-governance

> 依 `second-stage-plan-en-v3.md` X8.7 與 proposal/design/specs 拆分。依賴 X3 Persistent Audit 與 X8.6 ToolExecution ledger。BFF 現已有 `test` script（`vitest run`），故 BFF 驗證命令為 `cd bff && npm run build && npm run test`。所有 Task 的 `- [ ]` 於實作並驗證通過後勾選，不得先勾選再補實作。

## Phase 1：Identity 與 Scope 模型（backend）

### Task 1.1：建立 PrincipalContext 與 trusted header 解析

- [ ] 建立 `backend/src/runtime/authorization/principal.ts`
- [ ] 定義 `PrincipalContext`（principalId、principalType、tenantId、roles、scopes、authSource、authenticatedAt）
- [ ] 定義 `PrincipalType`（user／merchant_staff／platform_staff／service）與 `AuthSource`（trusted_gateway／service_token／development）為 closed enum
- [ ] 定義 `parseTrustedPrincipal(headers)`：只讀取 `x-bff-principal-id`／`x-bff-principal-type`／`x-bff-tenant-id`／`x-bff-roles`／`x-bff-scopes`／`x-bff-auth-source`／`x-bff-authenticated-at`，MUST NOT 讀取 raw `x-user-id`／`x-tenant-id`
- [ ] 對缺失欄位做 runtime validation（缺 principalId／tenantId 時回傳錯誤或 development fallback，不得用空字串冒充身份）
- [ ] 單元測試：解析 canonical headers、忽略 raw identity header、缺欄位處理

**驗收：** `cd backend && npx vitest run src/runtime/authorization/principal.test.ts` 通過

### Task 1.2：建立 RuntimeScope 模型

- [ ] 建立 `backend/src/runtime/authorization/scope.ts`
- [ ] 定義 `RuntimeScope`（scopeId、scopeType、tenantId、ownerPrincipalId?）
- [ ] 定義 `ScopeType`（principal／tenant／team／conversation）
- [ ] 定義 `isActiveScopePresent(scope)` 與 `scopeTenantMatches(scope, resourceTenant)`
- [ ] 收斂 X8.6 `TrustedScope` 至 `RuntimeScope` 投影（保留 X8.6 既有 `TrustedScope` 匯出或新增相容轉換，不破壞 side-effect 既有 import）
- [ ] 單元測試：scopeType 列舉、active scope 判斷、tenant 比對

**驗收：** `cd backend && npx vitest run src/runtime/authorization/scope.test.ts` 通過；既有 side-effect 測試不因 `TrustedScope` 收斂而破

### Task 1.3：建立 ResourceRef 正規化

- [ ] 建立 `backend/src/runtime/authorization/resource-ref.ts`
- [ ] 定義 `ResourceRef`（resourceType、resourceId、tenantId、ownerScopeId?）
- [ ] 定義 `KNOWN_RESOURCE_TYPES` 預設列舉 + open string 收尾（`resourceType: string`）
- [ ] 定義 `resourceTenantMatches`、`resourceOwnerMatches` 輔助
- [ ] 單元測試：已知與未知 resourceType、tenant／owner 比對

**驗收：** `cd backend && npx vitest run src/runtime/authorization/resource-ref.test.ts` 通過

---

## Phase 2：Grants 與委派（backend）

### Task 2.1：建立 PermissionGrant 與 non-transitive delegation

- [ ] 建立 `backend/src/runtime/authorization/grants.ts`
- [ ] 定義 `PermissionGrant`（grantId、resource、granteeScopeId、actions、grantedByPrincipalId、grantedByScopeId、canDelegate、createdAt、expiresAt?）
- [ ] 定義 `validateDelegation(grant, newGranteeScopeId, newActions)`：non-transitive、canDelegate、cross-tenant、actions 範圍收斂
- [ ] 跨 tenant 委派預設 deny；`expiresAt` 到期視為無效
- [ ] 單元測試：canDelegate=false 不得再委派、cross-tenant 拒、actions 不可放大、過期失效

**驗收：** `cd backend && npx vitest run src/runtime/authorization/grants.test.ts` 通過

### Task 2.2：建立 grant-store 持久化

- [ ] 建立 `backend/src/runtime/authorization/grant-store.ts`
- [ ] 定義 `GrantStore` 介面（create、revoke、findMatching）
- [ ] 建立 `PgGrantStore` 讀寫 `permission_grants`
- [ ] 撤銷採 additive `revoked_at`；grant 有效當 `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())`，不覆寫 `expires_at`、不刪除歷史
- [ ] 單元測試（mock DB）：create／revoke／findMatching、過期 grant 不匹配、revoked grant 不匹配、expiry 與 revocation 可分開稽核

**驗收：** `cd backend && npx vitest run src/runtime/authorization/grant-store.test.ts` 通過

---

## Phase 3：Authorization 決策引擎（backend）

### Task 3.1：建立 AuthorizationRequest／Decision 與 policy engine

- [ ] 建立 `backend/src/runtime/authorization/authorization.ts`
- [ ] 定義 `AuthorizationRequest`、`AuthorizationDecision`（effect、reasonCode、matchedPolicy、matchedGrantId、createdAt）
- [ ] 建立 `AuthorizationEngine.authorize(request)`，依序檢查：tenant boundary → active scope → visibility vs write → role/scope → action → ownership → explicit grant → contextual limits → tool risk
- [ ] 決策為同步純函式 + grant lookup（經 `GrantStore` 介面注入）；授權決策不可用時採 fail-closed deny
- [ ] 定義 `reasonCode` 列舉（CROSS_TENANT_DENIED、MISSING_ACTIVE_SCOPE、SCOPE_NOT_WRITABLE、MISSING_ROLE_SCOPE_GRANT、RESOURCE_OWNERSHIP_MISMATCH、REQUIRES_CONFIRMATION 等）
- [ ] 單元測試：跨 tenant deny、可讀不可寫 deny、缺 role/scope/grant deny、grant 放行、contextual limit 觸發 require_confirmation

**驗收：** `cd backend && npx vitest run src/runtime/authorization/authorization.test.ts` 通過

### Task 3.2：建立 ToolRiskPolicy 與 HITL bridge

- [ ] 建立 `backend/src/runtime/authorization/tool-risk.ts`
- [ ] 定義 `ToolRiskTier`（read／write／sensitive／communication）與 `ToolRiskPolicy`（toolName、riskTier、actions、requireConfirmation、resourceRefResolver）
- [ ] 定義 `classifyToolAction(policy, action)`：read→allow 後自動、write→authorization、sensitive／communication→authorization + requireConfirmation
- [ ] 定義 HITL bridge：`require_confirmation` 進入既有 Task `waiting_confirmation` 狀態／事件；逾時／取消 fail-closed deny
- [ ] runtime MUST NOT 硬編碼 tool 名稱；未註冊 policy 的 Tool 採 config 預設
- [ ] 單元測試：四種 tier 分類、未註冊 policy 預設、HITL 逾時／取消 deny

**驗收：** `cd backend && npx vitest run src/runtime/authorization/tool-risk.test.ts` 通過

### Task 3.3：建立 decision-store 與 ContextRedactor

- [ ] 建立 `backend/src/runtime/authorization/decision-store.ts`
- [ ] 定義 `DecisionStore` 介面（record）
- [ ] 建立 `PgDecisionStore` 寫入 `permission_decisions`（含 principal／scope／tenant／action／resource／effect／reasonCode／matched policy/grant／policyVersion／taskId／stepId／toolExecutionId／context_summary）
- [ ] 建立 `ContextRedactor` 契約與預設實作（field allowlist／blocklist），`record()` 寫入前 MUST 呼叫 `redact()`
- [ ] `context_summary` 只存 redacted summary；MUST NOT 存 raw token／credential／unmasked PII
- [ ] 單元測試（mock DB）：record、redaction（含 before/after fixture）、依 toolExecutionId 查詢

**驗收：** `cd backend && npx vitest run src/runtime/authorization/decision-store.test.ts` 通過

---

## Phase 4：Migrations（backend）

### Task 4.1：新增 permission_grants 與 permission_decisions 表

- [ ] 新增 migration `011_create_permission_grants.sql`（grant_id、resource_type、resource_id、resource_tenant_id、resource_owner_scope_id、grantee_scope_id、actions、granted_by_principal_id、granted_by_scope_id、can_delegate、created_at、expires_at、revoked_at）
- [ ] 新增 migration `012_create_permission_decisions.sql`（decision_id、principal_id、principal_type、tenant_id、scope_id、action、resource_type、resource_id、effect、reason_code、matched_policy、matched_grant_id、policy_version、task_id、step_id、tool_execution_id、context_summary、created_at）
- [ ] 建立必要的唯一/複合 index（grant 去重、依 tool_execution_id 查詢 decision）
- [ ] 採 additive（CREATE TABLE IF NOT EXISTS），不刪改 001–010

**驗收：** migration-runner 可套用全部 migration；`cd backend && npm run test`（含 migration-runner 測試）通過

---

## Phase 5：Tool Governance 整合（backend）

### Task 5.1：executeTyped dispatch 前插入 authorization

- [ ] 修改 `backend/src/platform/tool-governance.ts`
- [ ] `GovernedToolOutcome` 新增 `{ type: "denied_by_authorization"; errorCode: string; decisionId: string }` variant
- [ ] `executeTyped()` 在 dispatch 前：解析 trusted principal/scope（由 config 注入）→ `ToolRiskPolicy.resourceRefResolver` → `authorize(request)` → allow 才 dispatch／deny 回 typed outcome／require_confirmation 進 HITL
- [ ] 未提供 principal/scope 時採隔離 development identity，不假裝任意 tenant 授權
- [ ] legacy `governedInvoke` 相容層將 `denied_by_authorization` 對映為字串錯誤（只在最外層）
- [ ] 單元測試：allow dispatch、deny typed outcome 不 dispatch、require_confirmation 不 dispatch、legacy 相容

**驗收：** `cd backend && npx vitest run src/platform/tool-governance.test.ts` 通過

### Task 5.2：authorization deny 不進 X2 Retry，且 side-effect ToolExecution 記錄 decisionId

- [ ] 修改 `backend/src/runtime/side-effect/tool-execution-runner.ts`
- [ ] dispatch 前呼叫 authorization（若 Tool 具 `ToolRiskPolicy`），記錄 `decisionId` 至 `tool_executions`（新增可選欄位或 correlation 記錄）
- [ ] `denied_by_authorization` 與 `deny` MUST NOT 建立新 physical attempt，MUST NOT 進 X2 Retry Budget
- [ ] 修改 `backend/src/runtime/side-effect/result-reference-store.ts`：`authorization_mismatch` 判定改由 authorization layer 的 `isScopeCompatible(scope, principal, recordScope)` 提供，MUST 同時比對 `scopeId + tenantId + principalId`
- [ ] 單元測試：deny 不重試、decisionId 關聯、同 scope 不同 principal 拒用 cached result、同 principal 可重用

**驗收：** `cd backend && npx vitest run src/runtime/side-effect/tool-execution-runner.test.ts src/runtime/side-effect/result-reference-store.test.ts` 通過

---

## Phase 6：BFF 身份解析（bff）

### Task 6.1：建立 PrincipalResolver 與 development adapter

- [ ] 建立 `bff/src/identity.ts`
- [ ] 定義 `PrincipalResolver` contract（resolve(req, config) → PrincipalResolution）
- [ ] 建立 `ApiKeyPrincipalResolver`（沿用 API key 認證，principal 由 key→principal 映射解析，principalType 由 config/resolver 決定，不採 client `x-user-id` 為 principal）
- [ ] 建立 `DevelopmentPrincipalResolver`（`public` tenant、`anonymous` principal、`development` authSource）
- [ ] 依 config 選擇 resolver（additive，未配置時採 development）
- [ ] 單元測試：resolver 選擇、API key 解析、development fallback、偽造 header 不影響 principal

**驗收：** `cd bff && npx vitest run src/identity.test.ts` 通過

### Task 6.2：server.ts 發送 canonical trusted headers

- [ ] 修改 `bff/src/server.ts`
- [ ] 以 resolver 取代 `authenticate()` 的 principal 來源；發送 canonical trusted headers（`x-bff-principal-id`、`x-bff-principal-type`、`x-bff-tenant-id`、`x-bff-roles`、`x-bff-scopes`、`x-bff-auth-source`、`x-bff-authenticated-at`）
- [ ] production resolver 下停止把 raw `x-user-id`／`x-tenant-id` 作為權威透傳（既有 `x-bff-user-id`／`x-bff-tenant-id` additive 保留供未升級 backend 相容）
- [ ] 新增 config flag `legacyHeaderMode`（預設 `true`，`false` 停用舊 header）；tasks 記錄 deprecation 時程與 follow-up
- [ ] `FORWARDED_REQUEST_HEADERS` 中 raw identity header 的處理收斂（不再作為權威身份）
- [ ] 測試：trusted headers 內容、production 下不採 client raw identity、legacyHeaderMode 開關、additive 相容

**驗收：** `cd bff && npm run build && npm run test` 通過

---

## Phase 7：Audit Correlation 與合規檢查

### Task 7.1：authorization 決策寫入 audit 並建立 correlation

- [ ] 授權 allow／deny／require_confirmation 寫入 `audit_events`（既有 `actorType`／`actorId`／`decision`／`reasonCode` 欄位承接，確實填入 principal／scope／resource）
- [ ] `decisionId`、`principalId`、`scopeId` 作 trace attribute／structured audit field，MUST NOT 作 metric label
- [ ] 確認 permission context 全程 redaction：無 raw identity token／credential／unmasked PII 寫入 decision、audit、trace
- [ ] 單元測試：audit event 含決策、無 raw token 洩漏

**驗收：** `cd backend && npx vitest run src/runtime/audit/*.test.ts src/runtime/authorization/*.test.ts` 通過

### Task 7.2：全量驗證與合規

- [ ] `cd backend && npm run lint` 通過
- [ ] `cd backend && npm run test` 通過（含既有 side-effect／audit／tool-governance 回歸）
- [ ] `cd backend && npm run build` 通過
- [ ] `cd bff && npm run build` 通過
- [ ] `cd bff && npm run test` 通過
- [ ] 確認無 `any` 濫用、無硬編碼業務 tool 名稱／resource key／tenant 白名單
- [ ] 確認 `backend/src/runtime/authorization/` 不 import 任何業務模組
- [ ] 確認 deny 不進 X2 Retry、每個 side-effect ToolExecution 關聯 decisionId、跨 tenant 在 Tool 前 deny
- [ ] `openspec validate add-runtime-identity-permission-governance --strict` 通過

**驗收：** Backend lint/test/build 與 BFF build/test 全部通過，OpenSpec strict validation 0 issues
