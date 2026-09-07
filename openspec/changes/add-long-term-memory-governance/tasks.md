# Tasks：add-long-term-memory-governance

> 對應 `second-stage-plan-en-v3.md` X10.1（Layer 2 Platform Governance 的 Long-Term Memory），backend-only。每個 Task 只有在實作完成、測試新增、驗證實際執行通過後才勾選 `- [x]`。T0 為 hard gate：不通過即停止並回報 ADR。

## Phase 0：T0 compatibility spike（hard gate）

### Task 0.1：LangGraph PostgresStore（0.2.74）＋真實 PostgreSQL 邊界驗證

- [ ] 以 lockfile 解析的 `@langchain/langgraph` 0.2.74（package.json 宣告 `^0.2.67`）確認 `BaseStore`／`PostgresStore`／`InMemoryStore` 的實際 package/module 路徑並記錄
- [ ] 以真實 PostgreSQL 驗證 setup/migration（`PostgresStore` 建表語意）
- [ ] 驗證 put/get/search/delete 全 CRUD
- [ ] 驗證跨 Thread 讀寫（Thread A 寫、Thread B 讀，同一 authorized principal/tenant）
- [ ] 驗證 process restart 後資料仍可讀
- [ ] 驗證 TTL/expiry 行為
- [ ] 驗證 tenant/scope isolation（同 namespace 不同 tenant 不得互相可見——governance 層隔離，非依賴 DB namespace）
- [ ] 產出 spike 證據與結論（`InMemoryStore` smoke 已具，`PostgresStore` 結論於此固化）
- [ ] 任一失敗 → 停止並回報 ADR，不得靜默改自建 repository

**驗證：** T0 spike 腳本（backend 內，真實 PostgreSQL）全綠；結論記錄至 change evidence。`cd backend && npx vitest run src/memory/__spike__`

---

## Phase 1：Record 型別與 runtime validation（backend）

### Task 1.1：LongTermMemoryRecord / MemoryAccessPolicy / MemoryCandidate / MemoryRelation 型別

- [ ] 建立 `backend/src/memory/types.ts`
- [ ] 定義 `LongTermMemoryRecord`（`memoryId`／`namespace`／`memoryType`／`value`／`provenance`／`confidence`／`revision`／`validFrom?`／`validUntil?`／`recordedAt`／`createdAt`／`updatedAt`／`expiresAt?`）
- [ ] 定義 `MemoryAccessPolicy`（`readMode`／`writeMode`／`visibleScopeIds`／`writableScopeIds`）
- [ ] 定義 `MemoryCandidate` 與 `MemoryRelation`（`same`／`supersedes`／`conflicts`／`coexists`）
- [ ] runtime validation：`confidence` ∈ [0,1] finite；必填字串非空；`memoryType`／`provenance.source` 封閉列舉 + 未知值 fail-closed reject
- [ ] namespace 序列化 sentinel：reject `domain === SENTINEL`（保留字），避免未定義 domain 與合法值碰撞
- [ ] 唯讀引用 X8.7 `ResourceRef`，不重定義身份模型

**驗證：** `cd backend && npx vitest run src/memory/types.test.ts`

---

## Phase 2：MemoryStorePort 與 InMemory adapter（backend）

### Task 2.1：MemoryStorePort 介面 + MemoryNamespace 序列化

- [ ] 建立 `backend/src/memory/store-port.ts`
- [ ] 定義 `MemoryStorePort`（`get`／`put`／`putIfRevision`(CAS)／`search`／`delete`），以 `MemoryNamespace { tenantId, principalId, domain?, scopeId }` 為 namespace 參數
- [ ] 定義 namespace → BaseStore tuple 的序列化（單一來源）
- [ ] 不直接暴露 BaseStore 型別給 port 使用方
- [ ] 測試：namespace 序列化確定性、round-trip

**驗證：** `cd backend && npx vitest run src/memory/store-port.test.ts`

### Task 2.2：InMemoryStoreAdapter（deterministic tests）

- [ ] 建立 `backend/src/memory/store/in-memory-adapter.ts`
- [ ] 包裝 LangGraph `InMemoryStore`，實作 `MemoryStorePort`
- [ ] `put` 覆寫同 key；`search` 依 namespace/filter 回傳；`delete` 移除
- [ ] 測試：CRUD、同 key 覆寫、空結果、未知 namespace 回空

**驗證：** `cd backend && npx vitest run src/memory/store/in-memory-adapter.test.ts`

### Task 2.3：PostgresStoreAdapter（production，依 T0 結論）

- [ ] 建立 `backend/src/memory/store/postgres-adapter.ts`
- [ ] 包裝 `PostgresStore`（模組路徑依 T0 結論），實作 `MemoryStorePort`
- [ ] 連線設定由注入提供，不寫死 URL／credential
- [ ] 測試：以 test double／T0 結論覆蓋 CRUD 對映（不含 live PG，除非 T0 已具備）

**驗證：** `cd backend && npx vitest run src/memory/store/postgres-adapter.test.ts`

---

## Phase 3：MemoryGovernanceService（backend）

### Task 3.1：recall()（讀取 + X8.7 read authorization）

- [ ] 建立 `backend/src/memory/governance/memory-governance-service.ts`
- [ ] `recall(principal: PrincipalContext, scope: RuntimeScope, budgetHint)`：search 候選 → 每筆 `authorize({ action: "read", resource: ResourceRef })` → 過濾 expired/deleted → relevance score（`confidence × memoryTypeWeight × recencyDecay`，deterministic 排序）→ 截斷 → 回傳 authorized blocks
- [ ] 必要時經 X8.9 `AuthorizedContextReferenceResolver.findRelated`（direct/1-hop）擴展，MUST NOT 任意 multi-hop 遍歷
- [ ] 跨 tenant／未授權在回傳前 deny
- [ ] 測試：授權通過回傳、跨 tenant deny、未授權 scope deny、expired 不注入

**驗證：** `cd backend && npx vitest run src/memory/governance/memory-governance-service.test.ts`

### Task 3.2：commit()／delete()（寫入/刪除 + X8.7 write authorization）

- [ ] `commit(candidate, expectedRevision?)`：`authorize({ action: "write", resource })` → optimistic concurrency → put
- [ ] `delete(namespace, memoryId)`：`authorize({ action: "write", resource })` → delete
- [ ] `expectedRevision` 不符 → conflict，不覆蓋較新 record
- [ ] 測試：write 授權 deny 拒寫、revision 衝突、刪除授權 deny 拒刪

**驗證：** `cd backend && npx vitest run src/memory/governance/memory-governance-service.test.ts`

---

## Phase 4：MemoryContextProvider 與 X7 整合（backend）

### Task 4.1：MemoryContextProvider（pre-model orchestration boundary）

- [ ] 建立 `backend/src/memory/context/memory-context-provider.ts`
- [ ] `recall(principal, scope, budgetHint)` 呼叫 `MemoryGovernanceService.recall()`，轉成 X7 `ContextBlock`（`priority = P3`）
- [ ] `principal: PrincipalContext`／`scope: RuntimeScope`（X8.7 型別）自 graph state 的 canonical trusted context 取得並傳入，不自行構造身份
- [ ] 不執行 Store I/O（I/O 只在 Governance Service 內經 `MemoryStorePort`）
- [ ] 每筆 block 附 scope/provenance/confidence/revision 中繼資料供 debug/trace
- [ ] 測試：產出 P3 block、不產出 P0/P1、中繼資料完整

**驗證：** `cd backend && npx vitest run src/memory/context/memory-context-provider.test.ts`

### Task 4.2：與 assembleContext／allocateBudget 串接

- [ ] P3 memory blocks 進入既有 `assembleContext`／`allocateBudget`；P4 保留 current-thread recent conversation
- [ ] 召回結果受 X7 token budget 約束（`allocateBudget` 截斷不洩漏）
- [ ] 測試：budget 不足時 P3 memory 被 `allocateBudget` 依優先序處理；P0/P1 恆優先

**驗證：** `cd backend && npx vitest run src/memory/context/memory-context-provider.test.ts`

---

## Phase 5：MemoryWritePolicy 與關係分類（backend）

### Task 5.1：MemoryWritePolicy（source/consent/retention/dedupe/idempotency）

- [ ] 建立 `backend/src/memory/governance/write-policy.ts`
- [ ] 僅 approved source（user_explicit／user_feedback／task_result，model_inferred 需滿足最低 confidence 門檻）
- [ ] 敏感資料／consent／retention 檢查；dedupe（與既有 record 比對）；idempotency（依 `idempotencyKey`）
- [ ] MUST NOT 保存 raw prompt／整段對話／credential／unmasked PII
- [ ] 測試：approved source 通過、raw/PII 拒存、重複 idempotencyKey 不重複寫入

**驗證：** `cd backend && npx vitest run src/memory/governance/write-policy.test.ts`

### Task 5.2：MemoryRelation 分類（same/supersedes/conflicts/coexists）

- [ ] 建立 `backend/src/memory/governance/relation-classifier.ts`
- [ ] 於 replace/merge 前分類 `same`／`supersedes`／`conflicts`／`coexists`
- [ ] current-turn explicit intent 永遠優先；low-confidence inferred 不得成為 Hard Constraint
- [ ] 衝突/supersession 決策 SHOULD 產出 X8.9 `DecisionRecord`（provenance，非 gate）
- [ ] 測試：supersede、conflict、coexists、low-confidence 不升格 Hard Constraint

**驗證：** `cd backend && npx vitest run src/memory/governance/relation-classifier.test.ts`

---

## Phase 6：Revision、bi-temporal、history/restore（backend）

### Task 6.1：optimistic concurrency 與 revision

- [ ] `MemoryWriteRequest` 採 `expectedRevision?`；相符才 `putIfRevision`（CAS）並遞增 revision；不符 → conflict
- [ ] 永不靜默覆蓋較新 memory；caller 須 re-read/re-evaluate 後重試
- [ ] 測試：同 revision 雙寫僅一成功、另一 conflict；舊 Thread 不得覆蓋新偏好

**驗證：** `cd backend && npx vitest run src/memory/governance/memory-governance-service.test.ts`

### Task 6.2：bi-temporal validity 與歷史 restore

- [ ] `validFrom`／`validUntil`（valid time）與 `recordedAt`（recorded time）分離建模
- [ ] 歷史 revision immutable；restore 以「舊值 + 新 revision」寫回，保留 provenance/audit 連結
- [ ] 支援 bounded point-in-time 查詢（valid/recorded）供測試與除錯
- [ ] 測試：valid 時間可獨立表示、restore 不抹除歷史、point-in-time 查詢

**驗證：** `cd backend && npx vitest run src/memory/governance/relation-classifier.test.ts`

---

## Phase 7：Retention、deletion、isolation 與降級（backend）

### Task 7.1：TTL/expiry、explicit delete、namespace isolation

- [ ] 支援 TTL/expiry；delete/expiry 後不得再注入 Context
- [ ] tenant/principal/domain/scope isolation；correction 不失去 auditability
- [ ] 測試：expired 不注入、delete 後不召回、跨 tenant 不可見

**驗證：** `cd backend && npx vitest run src/memory/governance/memory-governance-service.test.ts`

### Task 7.2：降級與失敗語意

- [ ] recall timeout／授權失敗／Store unavailable → 空 memory context + 結構化觀測事件，不洩漏未授權內容
- [ ] 取消傳遞（不吞掉上游取消）
- [ ] 寫入失敗非阻斷（不改已成功回答），可觀測、僅 idempotency key 重試
- [ ] 測試：timeout 降級、store down 降級、取消傳遞、寫入失敗不污染結果

**驗證：** `cd backend && npx vitest run src/memory/governance/memory-governance-service.test.ts`

---

## Phase 8：全鏈整合測試與全量驗證（backend）

### Task 8.1：全鏈整合測試（recall → authorize → P3 injection → write policy → commit）

- [ ] 建立 `backend/src/memory/integration.test.ts`（以 `InMemoryStoreAdapter` deterministic）
- [ ] 案例：Thread A 寫、Thread B 讀（同 authorized principal/tenant）
- [ ] 案例：visible-but-not-writable 可讀不可改
- [ ] 案例：current explicit preference 覆蓋衝突歷史 memory
- [ ] 案例：跨 tenant lookup denied
- [ ] 案例：expired/deleted 不注入 Context
- [ ] 案例：low-confidence inferred 不升格 Hard Constraint
- [ ] 案例：寫入失敗不改已成功回答

**驗證：** `cd backend && npx vitest run src/memory/integration.test.ts`

### Task 8.2：barrel export 與全量驗證

- [ ] 建立 `backend/src/memory/index.ts` barrel export
- [ ] 驗證不修改 X7 `context/`、X8.7 `authorization/`、X8.9 `provenance/` 契約
- [ ] 驗證不新增 project migration、無自有持久化表
- [ ] `cd backend && npm run lint` 通過
- [ ] `cd backend && npm run test` 通過（含既有 context／authorization／provenance 回歸）
- [ ] `cd backend && npm run build` 通過
- [ ] 驗證無不必要 `any`；封閉列舉有單一來源與未知值處理
- [ ] `openspec validate add-long-term-memory-governance --strict` 通過

**驗證：** Backend lint/test/build 通過；OpenSpec strict validation 0 issues
