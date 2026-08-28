# decision-provenance-context-references Specification

## Purpose
Decision Provenance：持久化結構化決策記錄（DecisionRecord 的 outcome／reason／policy）、證據引用（EvidenceRef，重用 X8.7 ResourceRef）與上下文引用（ContextRef，open-set relationType），並透過授權的 ContextReferenceResolver 提供 direct／1-hop 查詢。TBD - created by archiving change add-decision-provenance-context-references.

## Requirements

### Requirement: DecisionRecord MUST 持久化結構化 outcome／reason／policy，MUST NOT 存 raw chain-of-thought

Runtime MUST 提供 `DecisionRecord { decisionId, requestId?, threadId?, runId?, taskId?, stepId?, decisionType, outcome, reasonCode, confidence?, policyVersion?, createdAt }`，其中 `decisionType`／`outcome`／`reasonCode` 為結構化且可查詢欄位。結果依賴 versioned policy 時 MUST 記錄 `policyVersion`。MUST NOT 持久化 raw hidden reasoning／chain-of-thought。

#### Scenario: 持久化結構化決策

GIVEN 一個決策具 `decisionType`、`outcome`、`reasonCode`、`confidence` 與 `policyVersion`
WHEN 建立 `DecisionRecord`
THEN 各結構化欄位 MUST 依輸入保存
AND `createdAt` MUST 由 Runtime 產生
AND 無任何 raw reasoning／chain-of-thought 欄位可被寫入

#### Scenario: 依 decision／task／step 識別符查詢

GIVEN 已持久化的 `DecisionRecord` 具 `decisionId`、`taskId` 與 `stepId`
WHEN 依 `decisionId`／`taskId`／`stepId` 查詢
THEN MUST 可依任一識別符取得該 record
AND 無需解析非結構化文字即可定位

#### Scenario: confidence 越界被拒絕

GIVEN 建立 `DecisionRecord` 時 `confidence` 超出 [0,1]
WHEN 執行 runtime validation
THEN MUST 回傳錯誤
AND MUST NOT 持久化越界值

#### Scenario: open-string 欄位超過長度上限被拒絕

GIVEN 建立 `DecisionRecord` 時 `decisionType`／`outcome`／`reasonCode` 或 `policyVersion` 超過 128 字元
WHEN 執行 runtime validation
THEN MUST 回傳錯誤
AND MUST NOT 持久化被截斷的值

---

### Requirement: EvidenceRef MUST 重用 X8.7 ResourceRef，MUST NOT 引進競爭資源身份

`EvidenceRef.resource` MUST 使用 X8.7 `ResourceRef { resourceType, resourceId, tenantId, ownerScopeId? }`。Runtime MUST NOT 定義第二套資源身份模型或另一套 tenant／owner 推導邏輯。

#### Scenario: evidence 引用 authorized resource 使用同一 ResourceRef

GIVEN 一個決策的證據引用某 message／tool_execution／memory／product-like resource
WHEN 建立 `EvidenceRef`
THEN `resource` MUST 為 X8.7 `ResourceRef`
AND MUST NOT 使用另一套 resource key 或 tenant 推導

#### Scenario: 未知 resourceType 仍可表示

GIVEN 未來 Domain 引入新 resource 類型
WHEN 建立 `EvidenceRef.resource`
THEN `resourceType` MUST 可表達為 open string
AND Core union MUST NOT 因新類型而需要修改

---

### Requirement: Evidence MUST 保留 observedAt 與可選 version／hash，保護歷史可解釋性

`EvidenceRef` MUST 記錄 `observedAt`（Runtime 評估該資源的時間），並可記錄 `resourceVersion`／`snapshotHash`。被引用資源後續變更時，歷史證據身份 MUST NOT 被摧毀。

#### Scenario: 被引用資源後續變更不摧毀歷史證據

GIVEN 一個 `EvidenceRef` 已記錄 `observedAt` 與 `resourceVersion`／`snapshotHash`
AND 被引用 resource 之後被修改
WHEN 事後查詢該證據
THEN `observedAt` 與 version／hash MUST 保留原值
AND 可識別該證據對應的是修改前的版本

#### Scenario: 只存 reference 而非 raw payload 副本

GIVEN 建立 `EvidenceRef`
WHEN 持久化
THEN MUST 只存 `ResourceRef`、`observedAt`、`resourceVersion`、`snapshotHash`
AND MUST NOT 複製 unrestricted raw payload 至 evidence 儲存

---

### Requirement: ContextRef.relationType MUST 為 open-set，Core 不因新 Domain relation 修改

`ContextRef.relationType` MUST 為 open string，而非 closed union。新增 Domain relation MUST NOT 要求修改 Core 常數或 schema。

#### Scenario: 新 Domain 加 relationType 不需改 Core

GIVEN 一個新 Domain 需要一個新的 relation（例如 `recommends_for`）
WHEN 建立 `ContextRef` 並使用該新 relation
THEN MUST 可直接使用該 open-string relation
AND Core union 或常數 MUST NOT 需要修改

#### Scenario: 建議初始 relation 可用但不閉合

GIVEN Runtime 提供 `derived_from`／`produced_by`／`supports`／`contradicts`／`mentions`／`selected_from`／`generated_from` 等建議 relation
WHEN 建立 `ContextRef`
THEN 建議 relation 可直接使用
AND 未列於建議清單的 relation MUST NOT 被拒絕

---

### Requirement: ContextReferenceResolver MUST 提供 direct／1-hop 授權查詢，MUST NOT 任意遞迴圖遍歷

`ContextReferenceResolver.findRelated` MUST 預設 direct／1-hop relation，接受 `relationType` 過濾與 `limit` 截斷。MUST NOT 提供任意 multi-hop 遞迴圖遍歷。

#### Scenario: 預設 1-hop 查詢

GIVEN 一個 resource 的 `context_refs` 關聯（source 或 target 為該 resource）
WHEN 呼叫 `findRelated(resource, {})`
THEN MUST 只回傳 1-hop 關聯的 resource
AND MUST NOT 遞迴展開第二層或更深 relation

#### Scenario: limit 截斷回傳

GIVEN 匹配的關聯數超過 `limit`
WHEN 呼叫 `findRelated(resource, { limit: N })`
THEN MUST 只回傳前 N 個
AND MUST NOT 無界回傳全部

#### Scenario: relationType 過濾

GIVEN 關聯含多種 `relationType`
WHEN 呼叫 `findRelated(resource, { relationType: "derived_from" })`
THEN MUST 只回傳 `relationType` 為 `derived_from` 的關聯

---

### Requirement: 引用讀取 MUST 通過 X8.7 tenant/scope authorization，跨 tenant／未授權 MUST deny

`ContextReferenceResolver.findRelated` 於回傳前 MUST 對 source 與每個候選 target 執行 X8.7 `authorize()`（read action）。跨 tenant 或未授權讀取 MUST 在資料回傳前 deny。

#### Scenario: 跨 tenant 引用讀取被拒

GIVEN principal 屬於 tenant `T1`
AND 嘗試讀取 tenant `T2` resource 的關聯引用
WHEN 執行 `findRelated`
THEN MUST deny 且不回傳 tenant `T2` 的任何 resource
AND MUST NOT 在授權前洩漏關聯資料

#### Scenario: 未授權 scope 讀取被拒

GIVEN principal 對某 scope 具 visibility 但無 read 授權
WHEN 嘗試讀取該 scope 內 resource 的關聯
THEN MUST deny
AND MUST NOT 僅因 resource 存在而回傳

#### Scenario: 授權 allow 才回傳

GIVEN principal 對 resource 具 read 授權
WHEN 執行 `findRelated`
THEN 只回傳授權通過的 candidate target
AND deny 的 candidate MUST 被排除

#### Scenario: 授權不可用 fail-closed

GIVEN authorization engine 不可用
WHEN 執行 `findRelated`
THEN MUST 回傳空集合（fail-closed）
AND MUST NOT 放行任何引用

---

### Requirement: provenance 內容 MUST 經 redaction，MUST NOT 持久化 raw prompt／CoT／credential／unmasked PII／unrestricted tool output

Decision／Evidence／Context 的持久化 MUST NOT 包含 raw prompt、hidden chain-of-thought、credential、unmasked PII 或 unrestricted raw tool output。只存結構化 outcome、reason code、reference、version 與 hash。

#### Scenario: raw prompt／CoT 不寫入

GIVEN 建立決策時輸入可能含 raw prompt 或 chain-of-thought
WHEN 持久化 `DecisionRecord`
THEN MUST 只存結構化 `decisionType`／`outcome`／`reasonCode`
AND MUST NOT 存 raw prompt 或 hidden reasoning

#### Scenario: credential／unmasked PII 不寫入

GIVEN evidence 或 context 建立過程可能接觸 credential／PII
WHEN 持久化
THEN MUST 只存 opaque reference 與 hash
AND MUST NOT 存 credential 或 unmasked PII

#### Scenario: unrestricted tool output 只存 ref 而非內容

GIVEN 一個 tool result 作為證據
WHEN 建立 `EvidenceRef`
THEN MUST 只存 `ResourceRef` 與 `snapshotHash`
AND MUST NOT 複製 raw tool output 內容

---

### Requirement: Decision 記錄 MUST 與 Audit／OTel／既有 correlation ID 建立關聯，MUST NOT 重複儲存其語意

`DecisionRecord` 於可用時 MUST 關聯 `requestId`／`threadId`／`runId`／`taskId`／`stepId`，並可經 `ResourceRef` 引用 `toolExecutionId`。X8.9 MUST NOT 重複 X3 Audit 或 X8.6 ToolExecution 的儲存語意。

#### Scenario: 決策與既有 correlation ID 關聯

GIVEN 一個決策發生於某 run 的某 task／step 內
WHEN 建立 `DecisionRecord`
THEN MUST 記錄可用的 `requestId`／`threadId`／`runId`／`taskId`／`stepId`
AND `EvidenceRef` 可經 `ResourceRef` 引用 `tool_execution`

#### Scenario: 不重複 Audit 與 ToolExecution 儲存

GIVEN X3 Audit 已記錄操作歷史、X8.6 已記錄 ToolExecution ledger
WHEN X8.9 持久化決策與證據
THEN MUST 只存 reference 與 correlation
AND MUST NOT 複製 audit_events 或 tool_executions 的內容

---

### Requirement: 持久化表 MUST 保留 tenant/scope ownership 並採 additive migration

`decision_records`、`decision_evidence_refs`、`context_refs` 的 migration MUST 為 additive（`CREATE TABLE IF NOT EXISTS`），不刪改既有 migration。透過 `ResourceRef` 投影 MUST 保留 `tenantId` 與可選 `ownerScopeId`。

#### Scenario: migration 為 additive 不刪改既有表

GIVEN 既有 migration 001–013 已存在
WHEN 套用 X8.9 的 014／015／016
THEN MUST 採 additive，不 DROP／ALTER 既有表格
AND 既有資料 MUST 不受影響

#### Scenario: 引用資源保留 tenant/scope ownership

GIVEN 建立 evidence／context 引用某 resource
WHEN 持久化
THEN `resource_tenant_id` MUST 保留該 resource 的 `tenantId`
AND `resource_owner_scope_id` 於存在時 MUST 保留 `ownerScopeId`
