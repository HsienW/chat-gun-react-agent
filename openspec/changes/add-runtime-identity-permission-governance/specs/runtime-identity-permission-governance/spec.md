# Specs：add-runtime-identity-permission-governance

## ADDED Requirements

### Requirement: Trusted PrincipalContext MUST 由核准的 authentication source 解析，client metadata MUST NOT 具備權威性

Runtime MUST 由核准的 authentication source（trusted gateway／service token／development）解析 `PrincipalContext`，包含 `principalId`、`principalType`、`tenantId`、`roles`、`scopes`、`authSource` 與 `authenticatedAt`。任意 client-provided `userId`／`tenantId` metadata MUST NOT 自身即具備權威性，MUST NOT 覆蓋 trusted context。

#### Scenario: 偽造 client identity header 不影響 trusted principal

GIVEN 一個 client 請求攜帶偽造的 `x-user-id` 與 `x-tenant-id`
AND BFF 已配置 production `PrincipalResolver`
WHEN 解析 trusted `PrincipalContext`
THEN `principalId`／`tenantId` MUST 由 resolver 自核准 authentication source 導出
AND MUST NOT 採用 client 提供的 raw `x-user-id`／`x-tenant-id`
AND backend MUST 只消費 BFF 產出的 canonical trusted headers

#### Scenario: development 模式使用隔離 identity adapter

GIVEN 運行於 development 模式且未配置 production authentication source
WHEN 解析 trusted context
THEN MUST 使用隔離的 development identity adapter（`public` tenant、`anonymous` principal、`development` authSource）
AND MUST NOT 假裝成任意 tenant 的授權身份

---

### Requirement: Principal identity 與 active RuntimeScope MUST 獨立表示

`PrincipalContext` 回答「誰」，`RuntimeScope` 回答「在哪個 active scope 操作」，兩者 MUST 獨立表示並分開 audit。Principal 可存取多個 scope，protected operation MUST 具備明確 active scope。

#### Scenario: 同一 principal 可於不同 active scope 操作

GIVEN 一個 principal 同時隸屬於 `principal` scope 與 `team` scope
WHEN 以不同 active scope 執行 protected operation
THEN `principalId` MUST 保持不變
AND `RuntimeScope.scopeId`／`scopeType` MUST 反映目前的 active scope
AND 授權決策 MUST 分別依 active scope 評估

#### Scenario: protected operation 缺少 active scope 被拒絕

GIVEN 一個受保護的寫入 action
AND 請求未提供明確 active scope（`scopeId` 為空）
WHEN 執行 authorization
THEN MUST 回傳 deny（`MISSING_ACTIVE_SCOPE`）
AND MUST NOT 放行

---

### Requirement: 切換 scope MUST NOT 冒充其他 principal

切換 active scope MUST NOT 改變 `principalId` 或冒充其他 principal；scope 切換只改變操作脈絡，不改變身份。

#### Scenario: scope 切換不改 principal 身份

GIVEN principal `P` 切換 active scope 從 `S1` 至 `S2`
WHEN 建立新的 authorization request
THEN `principal.principalId` MUST 仍為 `P`
AND MUST NOT 使用 `S2` 的 `ownerPrincipalId` 取代 `P` 作為身份

---

### Requirement: ResourceRef MUST 為跨層正規化的資源身份

Authorization、Audit、Memory、ToolExecution 與 Recommendation adapter MUST 使用 `ResourceRef { resourceType, resourceId, tenantId, ownerScopeId }` 作為資源身份，取代散落的業務屬主檢查。`resourceType` 採預設列舉 + open string，runtime MUST NOT 硬編碼業務類型。

#### Scenario: 授權與 audit 使用同一 ResourceRef

GIVEN 一個授權決策與其對應的 audit event
WHEN 建立 resource 身份
THEN 兩者 MUST 使用同一 `ResourceRef`
AND MUST NOT 各自推導出不同的 resource key 或 tenant

#### Scenario: 未知 resourceType 仍可表示

GIVEN 一個未來 Domain 引入新 resource 類型
WHEN 建立 `ResourceRef`
THEN `resourceType` MUST 可表達為 open string
AND Core union MUST NOT 因新類型而需要修改

---

### Requirement: PermissionGrant 委派 MUST 預設 non-transitive

委派存取 MUST 預設 non-transitive；grantee MUST NOT re-share／re-delegate，除非該 grant 明確 `canDelegate: true`。

#### Scenario: 未 canDelegate 的 grant 不得再委派

GIVEN principal `A` 授與 principal `B` 對 resource `R` 的 grant（`canDelegate: false`）
AND `B` 嘗試授與 `C` 對 `R` 的權限
WHEN 評估該再委派
THEN MUST deny
AND 不建立新 grant

#### Scenario: canDelegate 的 grant 可在受控範圍內再委派

GIVEN grant 具 `canDelegate: true`
WHEN grantee 對同一 resource 與受控 actions 再委派
THEN MUST 建立新 grant
AND 新 grant MUST 記錄 `grantedByPrincipalId` 為實際委派者
AND 再委派範圍 MUST 不大於原 grant 的 actions

---

### Requirement: 跨 tenant 委派與存取 MUST 預設 deny

跨 tenant 的 grant 建立、resource 存取與 scope 切換 MUST 預設 deny，除非政策明確允許。

#### Scenario: 跨 tenant 委派被拒

GIVEN grant 的 `granteeScopeId` 屬於 tenant `T1`
AND `resource.tenantId` 為 tenant `T2`（T2 ≠ T1）
WHEN 建立 grant
THEN MUST deny（`CROSS_TENANT_DENIED`）

#### Scenario: 跨 tenant resource 存取在 Tool 執行前被拒

GIVEN principal 屬於 tenant `T1`
AND 其嘗試對 tenant `T2` 的 resource 執行 action
WHEN 執行 authorization
THEN MUST 在 Tool dispatch 前回傳 deny
AND MUST NOT 呼叫下游 Tool

---

### Requirement: Resource-level AuthorizationDecision MUST 依序評估 tenant／scope／role／action／ownership／grant／contextual limits

`AuthorizationDecision` MUST 依序檢查 tenant boundary、active scope、visibility vs write、role／scope、action、ownership、explicit grant 與 contextual limits，回傳 `allow`／`deny`／`require_confirmation` 三態與 `reasonCode`、`matchedPolicy`、`matchedGrantId`。

#### Scenario: 可讀但不可寫的 scope 不得修改受保護資源

GIVEN principal 對某 scope 具 visibility 但無 write 授權
AND 其嘗試對該 scope 內的 resource 執行 mutating action
WHEN 執行 authorization
THEN MUST 回傳 deny（`SCOPE_NOT_WRITABLE`）
AND MUST NOT 僅因 visible 而放行寫入

#### Scenario: 缺少 role／scope／grant 拒絕受保護 action

GIVEN 一個受保護 action 需要特定 role／scope／grant
AND 目前 principal 三者皆缺
WHEN 執行 authorization
THEN MUST 回傳 deny
AND `reasonCode` MUST 指出缺失的授權來源

#### Scenario: 匹配的 explicit grant 放行

GIVEN 一個有效 grant 匹配 `(resource, granteeScopeId, action)` 且未過期
WHEN 執行 authorization
THEN MUST 回傳 allow
AND `matchedGrantId` MUST 指向該 grant

#### Scenario: contextual limit 觸發 require_confirmation

GIVEN 一個 action 具 contextual limit（例如金額上限）
AND request context 超過該上限
WHEN 執行 authorization
THEN MUST 回傳 `require_confirmation`（而非直接 allow）
AND 進入 HITL

---

### Requirement: Tool risk 分類 MUST 映射至 authorization 策略

Tool MUST 透過 `ToolRiskPolicy` 宣告 risk tier（read／write／sensitive／communication）、actions 與 `resourceRefResolver`。Read 授權後自動、Write 需授權、Sensitive／Communication 需授權 + `require_confirmation`。runtime MUST NOT 硬編碼 tool 名稱。

#### Scenario: read 風險授權後自動執行

GIVEN 一個 read-tier Tool 且 authorization 回傳 allow
WHEN 執行
THEN MUST 直接 dispatch，不需 HITL

#### Scenario: sensitive 風險進入 HITL 確認

GIVEN 一個 sensitive-tier Tool（例如 refund-like）
WHEN authorization 通過但 risk policy 要求確認
THEN MUST 回傳 `require_confirmation`
AND MUST 進入既有 HITL／Task waiting flow

#### Scenario: 未註冊 ToolRiskPolicy 的 Tool 採預設行為

GIVEN 一個未註冊 `ToolRiskPolicy` 的 Tool
WHEN 執行
THEN MUST 依 config 採預設（read 或 deny）
AND MUST NOT 由 runtime 以 tool 名稱硬編碼 risk tier

---

### Requirement: require_confirmation MUST 進入 HITL，且逾時／取消 MUST fail-closed

`require_confirmation` MUST 進入既有 HITL／Task waiting flow；確認逾時或使用者取消 MUST 視為 deny，MUST NOT dispatch 下游。

#### Scenario: 敏感動作等待確認成功後才 dispatch

GIVEN 一個 `require_confirmation` 決策已進入 HITL
AND 使用者（或受信控制路徑）確認放行
WHEN 決策被確認
THEN 才允許 dispatch 下游 Tool

#### Scenario: HITL 確認逾時視為 deny

GIVEN 一個 `require_confirmation` 決策等待確認
AND 等待超過政策上限
WHEN 逾時觸發
THEN MUST 視為 deny（fail-closed）
AND MUST NOT dispatch 下游 Tool

#### Scenario: HITL 取消視為 deny

GIVEN 一個 `require_confirmation` 決策等待確認
AND 使用者取消
WHEN 取消觸發
THEN MUST 視為 deny
AND MUST NOT dispatch 下游 Tool

---

### Requirement: Agent MUST NOT 具備自我提升、冒充或自我批准 HITL 的 callable 路徑

Agent MUST NOT 暴露可自我提升 role／scope、冒充其他 principal、批准自己的 HITL 請求、自建 privileged grant、繞過 tenant／resource ownership 或讀取 raw credential 的 Tool。Privileged 變更 MUST 經 trusted external control path 且分開 audit。

#### Scenario: 不存在自我提升或冒充的 Tool 路徑

GIVEN Agent 試圖提升自身 role 或冒充其他 principal
WHEN 檢查可用 Tool surface
THEN MUST 不存在任何 callable Tool 可完成該動作
AND 對應 privileged 變更 MUST 僅能由 trusted external control path 觸發

#### Scenario: Agent 無法自行批准自己的 HITL 請求

GIVEN 一個由 Agent 觸發的 `require_confirmation` 決策
WHEN Agent 嘗試自行批准該請求
THEN MUST NOT 存在 Agent-callable Tool 可完成自我批准
AND 批准 MUST 由受信控制路徑（或人類）完成並分開 audit

---

### Requirement: permission_decisions 與 permission_grants MUST 持久化並建立 correlation

每個 authorization 決策 MUST 寫入 `permission_decisions`，grant 建立／撤銷 MUST 寫入 `permission_grants`；兩者 MUST 記錄 principal、scope、tenant、action、resource、decision、matched grant／policy、reason code、policy version、`taskId`／`stepId`／`toolExecutionId` 與 redacted context summary。

#### Scenario: 授權決策可依 toolExecutionId 查詢

GIVEN 一個 side-effect ToolExecution 已 dispatch
AND 其 dispatch 前通過 authorization
WHEN 查詢該 execution 的決策
THEN MUST 能依 `toolExecutionId` 找到對應 `permission_decisions` 紀錄
AND 紀錄 MUST 含 effect、reasonCode、matched policy/grant 與 redacted context summary

#### Scenario: grant 撤銷仍保留可稽核歷史

GIVEN 一個已建立的 grant 被撤銷
WHEN 查詢 grant 歷史
THEN MUST 能重建建立與撤銷軌跡
AND MUST NOT 以覆寫方式抹除建立紀錄

---

### Requirement: authorization denial MUST NOT 被 X2 Retry Budget 重試

`deny` 與 `denied_by_authorization` outcome MUST NOT 進入 X2 Retry Budget；只有 `failed_not_committed` 等可重試錯誤才依 Retry Budget retry。

#### Scenario: 授權拒絕不觸發重試

GIVEN 一個 Tool 因 authorization 被 deny（`denied_by_authorization`）
WHEN 上層 Runner 處理該 outcome
THEN MUST NOT 建立新的 physical attempt
AND MUST NOT 進入 X2 Retry Budget

#### Scenario: 非授權的可重試錯誤仍可重試

GIVEN 一個 `failed_not_committed` outcome（下游未 commit）
AND X2 Retry Budget 允許
WHEN 上層 Runner 處理
THEN MUST 仍可重試
AND 重試前 MUST 重新評估 authorization

---

### Requirement: 每個 side-effect ToolExecution MUST 關聯到持久化的 permission decision

每個 side-effect `tool_executions` 的 dispatch 前決策 MUST 持久化，並以 `decisionId` 關聯到該 `tool_executions`；未通過 authorization 的 side-effect Tool MUST NOT dispatch。

#### Scenario: 授權決策先於副作用 dispatch 且被記錄

GIVEN 一個 side-effect Tool 即將 dispatch
WHEN 執行 authorization
THEN decision MUST 在 dispatch 前持久化
AND `tool_executions` MUST 記錄對應 `decisionId`
AND 決策為 deny 或未通過時 MUST NOT dispatch

---

### Requirement: permission context MUST 被 redaction

`permission_decisions` 的 context、audit 與 trace MUST 只存 redacted summary；raw identity token、credential、API key、unmasked PII MUST NOT 被持久化。

#### Scenario: raw identity token 不寫入決策紀錄

GIVEN 一個授權決策的 context 可能含 raw identity token 或 credential
WHEN 持久化 `permission_decisions`
THEN MUST 只存 redacted summary 與 opaque ID
AND MUST NOT 存 raw token、credential 或 unmasked PII

#### Scenario: principalId 若含 PII 記錄 opaque ID

GIVEN `principalId` 可能含 PII
WHEN 寫入 audit 或 trace
THEN MUST 記錄 hash／opaque ID
AND MUST NOT 存 raw principalId

---

### Requirement: Cached result 的 scope 相容判定 MUST 同時檢查 principal 身份

scope 相容（scope compatibility）判定 MUST 同時比對 `scopeId + tenantId + principalId`；`principalId` 取自 `PrincipalContext`，非 `RuntimeScope`。只比對 `scopeId + tenantId` 會造成同 scope 內跨 principal 的 cached result 洩漏，MUST NOT 發生。

#### Scenario: 同 scope 不同 principal 不得重用 cached result

GIVEN principal `A` 於 scope `S`（tenant `T`）執行 Tool 並產生 cached result
AND principal `B` 於相同 scope `S`（tenant `T`）請求重用該 cached result
WHEN 進行 scope 相容判定
THEN MUST 判定不相容（principalId 不同）
AND MUST NOT 回傳 `A` 的 cached result 給 `B`

#### Scenario: 相同 principal 於相同 scope 可重用

GIVEN principal `A` 於 scope `S` 與 tenant `T` 的 cached result
AND 同一 principal `A` 以相同 `S`／`T` 再次請求
WHEN 進行 scope 相容判定
THEN `scopeId + tenantId + principalId` 皆相符
AND 可依其它 policy（tool version 等）決定是否重用

---

### Requirement: grant 撤銷 MUST 以 revoked_at 區分於自然過期

grant 撤銷 MUST 以 additive `revoked_at` 記錄，MUST NOT 以覆寫 `expires_at` 表達撤銷。grant 有效當 `revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())`。自然過期與主動撤銷 MUST 可分開稽核。

#### Scenario: 主動撤銷與自然過期可分開稽核

GIVEN 一個 grant 已建立且有 `expires_at`
AND 該 grant 被主動撤銷
WHEN 查詢 grant 歷史
THEN `revoked_at` MUST 非空
AND `expires_at` MUST 保留原值
AND 系統 MUST 能區分「自然過期」與「主動撤銷」

#### Scenario: 撤銷後的 grant 不再放行

GIVEN 一個 grant 已設定 `revoked_at`
WHEN authorization 查詢匹配 grant
THEN MUST 視為無效（`revoked_at` 非空）
AND MUST NOT 依該 grant 放行

---

### Requirement: permission context redaction MUST 由 ContextRedactor 契約定義

`permission_decisions` 的 `context_summary` redaction MUST 由 `ContextRedactor` 契約定義，含 field allowlist／blocklist 與測試 fixture。`DecisionStore.record()` 寫入前 MUST 呼叫 `ContextRedactor.redact()`。

#### Scenario: redaction 依 field allowlist 移除敏感欄位

GIVEN 一個決策 context 含 `authorization` token、`amount` 與 `environment`
AND `ContextRedactor` 的 allowlist 只含 `environment`
WHEN 執行 `redact(context)`
THEN 回傳 context MUST 只保留 allowlist 欄位
AND `authorization` token 等非 allowlist 欄位 MUST 被移除或取代為 `"[redacted]"`

---

## MODIFIED Requirements

### Requirement: BFF 認證 MUST 解析 trusted PrincipalContext，而非以 client raw identity 為權威

BFF 的 `authenticate()` 目前把 client `x-user-id` 當作 principal、`x-tenant-id` 當作 tenant 並透傳。本次 MUST 改以 `PrincipalResolver` 自核准 authentication source 解析 `PrincipalContext`，發送 canonical trusted headers，production resolver 下 MUST NOT 以 client raw identity header 為權威。

#### Scenario: production resolver 不採 client raw identity

GIVEN BFF 配置 production `PrincipalResolver`
AND client 請求攜帶 `x-user-id`／`x-tenant-id`
WHEN BFF 解析 trusted context
THEN principal／tenant MUST 由 resolver 導出
AND canonical trusted headers（`x-bff-principal-id`、`x-bff-principal-type`、`x-bff-tenant-id`、`x-bff-roles`、`x-bff-scopes`、`x-bff-auth-source`、`x-bff-authenticated-at`）MUST 取代 raw header 作為 backend 的信任來源

#### Scenario: development resolver 保持既有無驗證相容

GIVEN 未配置 production resolver（development）
WHEN BFF 解析 context
THEN MUST 使用 development adapter（`public`／`anonymous`／`development`）
AND 既有無 `requireAuth` 行為 MUST 保持可用

#### Scenario: legacyHeaderMode 控制舊 header 的停用時程

GIVEN 需平滑過渡既有 `x-bff-user-id`／`x-bff-tenant-id` 表面
WHEN 部署新 canonical trusted headers
THEN 舊 header 的保留 MUST 由 `legacyHeaderMode` config flag 控制（預設 additive 保留）
AND 停用時程 MUST 於 tasks 記錄 deprecation 計畫
AND backend 全量升級後 MUST 移除舊 header surface

---

### Requirement: Tool Governance MUST 在 dispatch 前執行 resource-level authorization

`tool-governance` 的 `executeTyped()` MUST 在 dispatch 前執行 authorization（依 `ToolRiskPolicy`），allow 才 dispatch；deny 回傳新增 `denied_by_authorization` typed outcome，`require_confirmation` 進入 HITL。未提供 principal／scope 時 MUST 採隔離 development identity，MUST NOT 假裝成任意 tenant 授權。

#### Scenario: allow 才 dispatch

GIVEN authorization 回傳 allow
WHEN 執行 `executeTyped()`
THEN MUST 繼續 dispatch 下游 Tool

#### Scenario: deny 回傳 typed outcome 且不 dispatch

GIVEN authorization 回傳 deny
WHEN 執行 `executeTyped()`
THEN MUST 回傳 `{ type: "denied_by_authorization", errorCode, decisionId }`
AND MUST NOT dispatch 下游
AND 上層 Runner MUST 不需解析錯誤字串即可分類該 outcome

#### Scenario: require_confirmation 不 dispatch 並等待 HITL

GIVEN authorization 回傳 `require_confirmation`
WHEN 執行 `executeTyped()`
THEN MUST NOT dispatch 下游
AND MUST 進入 HITL／Task waiting flow
