# Specs：add-long-term-memory-governance

## ADDED Requirements

### Requirement: LongTermMemoryRecord MUST 具備 scope、provenance、confidence、revision 與 bi-temporal 欄位

`LongTermMemoryRecord` MUST 承載 `namespace`（`tenantId`／`principalId`／`domain?`／`scopeId`）、`memoryType`（`preference`／`negative_preference`／`accepted_choice`／`task_summary`／`service_context`）、`value`、`provenance`（`source` ∈ user_explicit／user_feedback／task_result／model_inferred 與 `sourceRef?`）、`confidence`、`revision`，以及 bi-temporal（`validFrom?`／`validUntil?` 表示 valid time、`recordedAt` 表示 recorded time）與 `createdAt`／`updatedAt`／`expiresAt?`。`confidence` MUST 為 [0,1] 內 finite number；未知 `memoryType` 或 `provenance.source` MUST fail-closed reject。

#### Scenario: record 具備 bi-temporal 與 revision 欄位

GIVEN 建立一筆 `LongTermMemoryRecord`
WHEN 檢視其欄位
THEN MUST 含 `validFrom`／`validUntil`（valid time）與 `recordedAt`（recorded time）的可分離表示
AND MUST 含 `revision` 作為版本 token

#### Scenario: 未知 memoryType 被拒絕

GIVEN 建立 `LongTermMemoryRecord` 時 `memoryType` 為未知字串
WHEN 執行 runtime validation
THEN MUST fail-closed reject
AND MUST NOT 以任意值靜默接受

---

### Requirement: production memory persistence MUST 使用已驗證的 LangGraph Store 邊界，未驗證不得宣稱 production boundary 完成

production memory persistence MUST 採 LangGraph Store 邊界並以 project-owned port 封裝，production adapter 採 `PostgresStore`、`InMemoryStore` 僅供 deterministic tests。X0 的 native Store boundary MUST 記錄為「僅完成 InMemoryStore smoke；PostgresStore 未驗證；Decision Record 遺失」。production boundary MUST 經 T0 compatibility spike（真實 PostgreSQL + 實際解析的 `@langchain/langgraph` 版本）驗證 setup/migration、put/get/search/delete、跨 Thread、process restart、TTL 與 tenant/scope isolation 後才可宣告完成；spike 不通過 MUST 停止並回報 ADR，MUST NOT 靜默改採自建 repository。

#### Scenario: 未驗證前不宣告 production boundary 完成

GIVEN X0 決策記錄遺失且 PostgresStore 未以真實 PostgreSQL 驗證
WHEN 描述 production Store boundary 狀態
THEN MUST 標記為未驗證
AND MUST NOT 宣稱 production native Store boundary 已完成

#### Scenario: spike 不通過不得靜默改採自建 repository

GIVEN T0 compatibility spike 任一步失敗
WHEN 決定後續儲存方案
THEN MUST 停止並回報 ADR
AND MUST NOT 未經 ADR 即改採自建 repository

---

### Requirement: X8.7 authorization MUST 為 memory visibility/write 的單一事實來源，namespace MUST NOT 作為安全邊界

memory 的讀取／寫入／刪除 MUST 經 X8.7 `authorize(action, resource)`，其中 resource 為 `ResourceRef { resourceType: "memory", resourceId, tenantId, ownerScopeId }`。visible ≠ writable：具 visibility 不授與 write。namespace（含 tenantId 投影）只是路由鍵，MUST NOT 作為安全隔離依據；跨 tenant 或未授權存取 MUST 在資料回傳或落盤前 deny。

#### Scenario: visible-but-not-writable 可讀不可改

GIVEN principal 對某 memory 具 read 授權但無 write 授權
WHEN 嘗試讀取該 memory
THEN MUST 回傳該 memory
AND 嘗試寫入或刪除時 MUST deny

#### Scenario: 跨 tenant 讀取被拒

GIVEN principal 屬於 tenant `T1`
AND memory 的 `ResourceRef.tenantId` 為 `T2`（T2 ≠ T1）
WHEN 嘗試讀取該 memory
THEN MUST deny 且不回傳該 memory 內容

#### Scenario: namespace 相同不代表授權

GIVEN 兩筆 memory 位於相同 namespace 投影但不同 tenant
WHEN 判定存取權限
THEN MUST 以 X8.7 `authorize()` 結果為準
AND MUST NOT 因 namespace 相同而推導授權

---

### Requirement: 讀取 MUST 經 MemoryContextProvider 呼叫 recall() 並於 P3 注入，MUST NOT 在 context-assembler 內執行 Store I/O

memory 召回 MUST 由 pre-model orchestration boundary（`MemoryContextProvider`）呼叫 `recall()` 執行；召回結果經 X8.7 read authorization 過濾後轉為 X7 `ContextBlock` 並以 priority **P3** 注入既有 context 組裝與預算配置，MUST NOT 注入 P0/P1；P4 保留 current-thread recent conversation。Store I/O MUST 只發生在 governance 層（經 port），MUST NOT 在純 context-assembler 內執行。必要時可經 X8.9 authorized resolver 以 direct/1-hop 擴展相關 references，MUST NOT 任意 multi-hop 圖遍歷。

#### Scenario: 召回結果以 P3 注入

GIVEN `recall()` 回傳 authorized memory
WHEN `MemoryContextProvider` 轉為 `ContextBlock`
THEN 每筆 block 的 priority MUST 為 P3
AND MUST NOT 以 P0/P1 注入

#### Scenario: context-assembler 不執行 Store I/O

GIVEN context 組裝流程
WHEN 檢查 Store 讀寫發生位置
THEN Store I/O MUST 僅發生於 governance 層
AND 純 context-assembler MUST NOT 直接執行 Store I/O

#### Scenario: reference 擴展僅限 direct/1-hop

GIVEN memory 召回需擴展相關 references
WHEN 執行關聯查詢
THEN MUST 僅 direct/1-hop
AND MUST NOT 任意 multi-hop 圖遍歷

---

### Requirement: 寫入 MUST 只能由 runtime-validated MemoryCandidate 經 MemoryWritePolicy 與 X8.7 write authorization 後 commit

synthesis 後只能產出 runtime-validated `MemoryCandidate`，經 `MemoryWritePolicy`（敏感資料／consent／retention、dedupe、idempotency）與 X8.7 write authorization 後 commit。MUST NOT 無條件保存整段對話、raw prompt、模型自由文字、credential 或未遮蔽 PII。`EvidenceStore`／`DecisionRecord`／Audit 僅記錄 provenance，MUST NOT 作為 memory persistence 或 authorization gate。

#### Scenario: 未遮蔽 PII 不落盤

GIVEN `MemoryCandidate.value` 含未遮蔽 PII 或 credential
WHEN 經 `MemoryWritePolicy` 評估
THEN MUST 拒絕寫入
AND MUST NOT 落盤該內容

#### Scenario: 重複 idempotencyKey 不重複寫入

GIVEN 兩個 `MemoryCandidate` 具相同 `idempotencyKey`
WHEN 依序 commit
THEN 第二次 MUST 被判定為重複
AND MUST NOT 產生第二筆相同 memory

#### Scenario: provenance store 不成為授權 gate

GIVEN `DecisionRecord`／`EvidenceStore` 已記錄某決策
WHEN 判定 memory 寫入權限
THEN MUST 以 X8.7 `authorize()` 為準
AND MUST NOT 因 provenance 已記錄而授與寫入

---

### Requirement: 寫入 MUST 採 optimistic concurrency，revision 不符 MUST conflict 且永不靜默覆蓋

memory 更新 MUST 採 optimistic concurrency：提供 `expectedRevision` 時，相符才寫入並遞增 revision；不符 MUST 回傳 conflict，MUST NOT 靜默覆蓋較新 memory。caller 須 re-read 並重新評估 source／recency／confidence 後再重試。同 revision 的兩個 concurrent writer MUST 僅一成功。

#### Scenario: revision 不符回傳 conflict

GIVEN memory 目前 revision 為 `R2`
AND caller 以 `expectedRevision=R1` 嘗試寫入
WHEN commit
THEN MUST 回傳 conflict
AND MUST NOT 覆蓋 revision `R2` 的內容

#### Scenario: 同 revision 雙寫僅一成功

GIVEN 兩個 concurrent writer 以相同 `expectedRevision`
WHEN 同時 commit
THEN 僅一個成功
AND 另一個 MUST 收到 revision conflict

---

### Requirement: 新 memory MUST 先分類 same/supersedes/conflicts/coexists，current-turn explicit intent MUST 永遠優先

新 memory 於 replace/merge 前 MUST 分類為 `same`／`supersedes`／`conflicts`／`coexists`。優先序 MUST 為 current-turn explicit text > current selection > high-confidence vision > Long-term Memory > low-confidence model inference。low-confidence inferred memory MUST NOT 成為 Hard Constraint。衝突或 supersession 決策 SHOULD 產出 X8.9 Decision Provenance，而非靜默覆寫。

#### Scenario: current explicit preference 覆蓋衝突歷史 memory

GIVEN 歷史 memory 存有偏好 `X`
AND current-turn explicit intent 為 `Y`（與 `X` 衝突）
WHEN 決定生效偏好
THEN current-turn explicit intent `Y` MUST 優先
AND 歷史 `X` MUST 被分類為 superseded 而非靜默刪除

#### Scenario: low-confidence inferred 不升格 Hard Constraint

GIVEN 一筆 low-confidence `model_inferred` memory
WHEN 進入 constraint 判定
THEN MUST NOT 成為 Hard Constraint

#### Scenario: supersession 產出 provenance

GIVEN 新 memory supersede 舊 memory
WHEN 執行 supersession
THEN SHOULD 產出 X8.9 Decision Provenance
AND MUST NOT 靜默覆寫舊 memory

---

### Requirement: bi-temporal validity 與歷史 restore MUST 不抹除歷史修訂

`validFrom`／`validUntil`（valid time）與 `recordedAt`（recorded time）MUST 分離表示，使新觀察可 supersede 舊偏好而不抹除舊偏好先前有效的 fact。歷史 revision MUST immutable；restore MUST 以「舊值 + 新 revision」寫回並保留 provenance/audit 連結。MUST 支援 bounded point-in-time 查詢（依 valid/recorded timestamp）。

#### Scenario: valid time 與 recorded time 分離

GIVEN 一筆 memory 的 valid time 與 recorded time 不同
WHEN 檢視該 memory
THEN `validFrom`／`validUntil` 與 `recordedAt` MUST 可獨立表示
AND MUST NOT 因 recorded time 改變而更動 valid time

#### Scenario: restore 不抹除歷史

GIVEN 舊 revision 已存在
WHEN restore 舊值
THEN MUST 以「舊值 + 新 revision」寫回
AND 舊 revision 歷史 MUST 保留

---

### Requirement: retention、deletion 與 tenant/principal/domain/scope isolation MUST 使 delete/expiry 後不再注入 Context

memory MUST 支援 TTL/expiry、explicit delete 與 tenant/principal/domain/scope isolation。delete 或 expiry 後 MUST NOT 再注入 Context。correction MUST NOT 失去 auditability。

#### Scenario: expired memory 不注入 Context

GIVEN 一筆 memory 已過 `expiresAt` 或 `validUntil`
WHEN 執行 recall
THEN MUST 排除該 memory
AND MUST NOT 注入 Context

#### Scenario: delete 後不再召回

GIVEN 一筆 memory 已 explicit delete
WHEN 再次 recall
THEN MUST NOT 回傳該 memory

---

### Requirement: 讀寫刪除的降級與失敗 MUST 具明確語意且不洩漏未授權內容

recall timeout、授權失敗或 Store unavailable MUST 降級為空 memory context 並產生結構化觀測事件，MUST NOT 洩漏未授權內容。上游取消 MUST 傳遞，MUST NOT 吞掉。寫入失敗 MUST NOT 把已成功產生的使用者回答改成失敗，但 MUST 可觀測，且僅能以 idempotency key 安全重試。

#### Scenario: recall 失敗降級空 context 且可觀測

GIVEN recall 發生 timeout 或 Store unavailable
WHEN 執行 memory 召回
THEN MUST 降級為空 memory context
AND MUST 產生結構化觀測事件
AND MUST NOT 洩漏未授權 memory 內容

#### Scenario: 取消傳遞不吞掉

GIVEN 上游執行取消
WHEN memory 讀寫進行中
THEN MUST 傳遞取消
AND MUST NOT 靜默吞掉取消訊號

#### Scenario: 寫入失敗不改已成功回答

GIVEN 使用者回答已成功產生
AND 後續 memory 寫入失敗
WHEN 觀察使用者可見結果
THEN MUST 保持成功
AND 寫入失敗 MUST 可觀測且僅能以 idempotency key 重試

---

### Requirement: X10.1 MUST NOT 提供 planner-controlled memory Tool

X10.1 MUST NOT 提供 `read_memory`／`write_memory` planner-controlled Tool，亦 MUST NOT 提供深度召回。memory 讀取採自動召回、寫入採政策式寫入；Tool 與深度召回 MUST 留待後續 change，僅當觀測證明自動召回不足時才評估混合模式。

#### Scenario: 不提供 planner-controlled memory Tool

GIVEN X10.1 的 memory 能力
WHEN 檢視其對外讀寫介面
THEN MUST 不包含 `read_memory`／`write_memory` Tool
AND 讀取 MUST 為自動召回、寫入 MUST 為政策式寫入
