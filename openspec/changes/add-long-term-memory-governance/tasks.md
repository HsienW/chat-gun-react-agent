# Tasks：add-long-term-memory-governance

> 對應 `second-stage-plan-en-v3.md` X10.1（Layer 2 Platform Governance 的 Long-Term Memory），backend-only。每個 Task 只有在實作完成、測試新增、驗證實際執行通過後才勾選 `- [x]`。T0 為 hard gate：不通過即停止並回報 ADR。

## Phase 0：dependency upgrade compatibility spike（hard gate）

> 首次 T0（0.2.74）已以 hard gate 失敗；ADR（`docs/decisions/production-memory-store-boundary.md`）定案升級整組 LangGraph persistence dependencies。以下三個 Task 為新的 hard gate：任一失敗即停止並回報 ADR，不得靜默改自建 repository 或降級至 `PostgresSaver`。

### Task 0.1：升級 LangGraph persistence dependencies 至候選矩陣

- [ ] 依 ADR 候選矩陣升級 `backend/package.json` 與 lockfile：`@langchain/langgraph` 1.4.14、`@langchain/langgraph-checkpoint` 1.1.5、`@langchain/langgraph-checkpoint-postgres` 1.0.5、`@langchain/core` 1.2.9、`@langchain/langgraph-cli` 1.4.5、`zod` ^3.25.32（保留 Zod 3）
- [ ] 驗證 dependency 安裝成功且為**單一 checkpoint 版本**（無雙 checkpoint/core 型別與 runtime 不一致）
- [ ] 確認 `import { PostgresStore } from "@langchain/langgraph-checkpoint-postgres/store"` 的 `./store` subpath 可用

**驗證：** `cd backend && npm install` 成功；`npm ls @langchain/langgraph @langchain/langgraph-checkpoint @langchain/langgraph-checkpoint-postgres @langchain/core` 顯示單一版本。

### Task 0.2：PostgresStore（1.0.5）＋真實 PostgreSQL 邊界驗證

- [x] 以真實 PostgreSQL（Docker Compose）驗證 `PostgresStore.setup()` 建表與重複執行安全性
- [x] 驗證 put/get/search/delete 全 CRUD
- [x] 驗證跨 Thread 讀寫（Thread A 寫、Thread B 讀，同一 authorized principal/tenant）
- [x] 驗證 process restart 後資料仍可讀
- [x] 驗證 TTL/expiry 行為（Store 原生 expiry + Governance 層過濾）
- [x] 驗證 tenant/scope isolation（同 namespace 不同 tenant 不得互相可見——governance 層隔離，非依賴 DB namespace）
- [x] 驗證 atomic CAS 可行方案並記錄（adapter 原生 conditional put，否則單一寫入 transaction）
- [x] 產出 spike 證據與結論（`InMemoryStore` smoke 已具，`PostgresStore` 結論於此固化）

**驗證：** T0 spike 腳本（backend 內，真實 PostgreSQL）全綠；結論記錄至 change evidence。`cd backend && npx vitest run src/memory/__spike__`

### Task 0.3：既有 LangGraph runtime 全量回歸（升級相容性）

- [ ] 驗證既有 graph compile 全量通過
- [ ] 驗證 streaming 行為不變
- [ ] 驗證 checkpoint/resume 不變
- [ ] 驗證 tool calling 不變
- [ ] 驗證既有 test 全量通過（含 context／authorization／provenance 回歸）

**驗證：** `cd backend && npm run lint && npm run test && npm run build` 全綠。

---

## Phase 1：Record 型別與 runtime validation（backend）

### Task 1.1：LongTermMemoryRecord / MemoryAccessPolicy / MemoryCandidate / MemoryRelation 型別

- [x] 建立 `backend/src/memory/types.ts`
- [x] 定義 `LongTermMemoryRecord`（`memoryId`／`namespace`／`memoryType`／`value`／`provenance`／`confidence`／`revision`／`validFrom?`／`validUntil?`／`recordedAt`／`createdAt`／`updatedAt`／`expiresAt?`）
- [x] 定義 `MemoryAccessPolicy`（`readMode`／`writeMode`／`visibleScopeIds`／`writableScopeIds`）
- [x] 定義 `MemoryCandidate` 與 `MemoryRelation`（`same`／`supersedes`／`conflicts`／`coexists`）
- [x] runtime validation：`confidence` ∈ [0,1] finite；必填字串非空；`memoryType`／`provenance.source` 封閉列舉 + 未知值 fail-closed reject
- [x] namespace 序列化 sentinel：reject `domain === SENTINEL`（保留字），避免未定義 domain 與合法值碰撞
- [x] 唯讀引用 X8.7 `ResourceRef`，不重定義身份模型

**驗證：** `cd backend && npx vitest run src/memory/types.test.ts`

---

## Phase 2：MemoryStorePort 與 InMemory adapter（backend）

### Task 2.1：MemoryStorePort 介面 + MemoryNamespace 序列化

- [x] 建立 `backend/src/memory/store-port.ts`
- [x] 定義 `MemoryStorePort`（`get`／`put`／`putIfRevision`(CAS)／`search`／`delete`），以 `MemoryNamespace { tenantId, principalId, domain?, scopeId }` 為 namespace 參數
- [x] 定義 namespace → BaseStore tuple 的序列化（單一來源）
- [x] 不直接暴露 BaseStore 型別給 port 使用方
- [x] 測試：namespace 序列化確定性、round-trip

**驗證：** `cd backend && npx vitest run src/memory/store-port.test.ts`

### Task 2.2：InMemoryStoreAdapter（deterministic tests）

- [x] 建立 `backend/src/memory/store/in-memory-adapter.ts`
- [x] 包裝 LangGraph `InMemoryStore`，實作 `MemoryStorePort`
- [x] `put` 覆寫同 key；`search` 依 namespace/filter 回傳；`delete` 移除
- [x] 測試：CRUD、同 key 覆寫、空結果、未知 namespace 回空

**驗證：** `cd backend && npx vitest run src/memory/store/in-memory-adapter.test.ts`

### Task 2.3：PostgresStoreAdapter（production，依 T0 結論）

- [x] 建立 `backend/src/memory/store/postgres-adapter.ts`
- [x] 包裝 `PostgresStore`（模組路徑 `@langchain/langgraph-checkpoint-postgres/store`，版本依 T0 鎖版），實作 `MemoryStorePort`
- [x] 連線設定由注入提供，不寫死 URL／credential
- [x] 測試：以 test double／T0 結論覆蓋 CRUD 對映（不含 live PG，除非 T0 已具備）

**驗證：** `cd backend && npx vitest run src/memory/store/postgres-adapter.test.ts`

---

## Phase 3：MemoryGovernanceService（backend）

### Task 3.1：recall()（讀取 + X8.7 read authorization）

- [x] 建立 `backend/src/memory/governance/memory-governance-service.ts`
- [x] `recall(principal: PrincipalContext, scope: RuntimeScope, budgetHint)`：search 候選 → 每筆 `authorize({ action: "read", resource: ResourceRef })` → 過濾 expired/deleted → relevance score（`confidence × memoryTypeWeight × recencyDecay`，deterministic 排序）→ 截斷 → 回傳 authorized blocks
- [x] 必要時經 X8.9 `AuthorizedContextReferenceResolver.findRelated`（direct/1-hop）擴展，MUST NOT 任意 multi-hop 遍歷
- [x] 跨 tenant／未授權在回傳前 deny
- [x] bounded、metadata-first recall：先以 metadata 取得有限候選，再載入 value 排序；candidate／token 受 configurable cap（`maxCandidates`／`maxTokens`）約束
- [x] relevance ordering deterministic（同輸入同輸出）；同分依 `recordedAt` 再 `memoryId` 斷 tie
- [x] telemetry 只記錄 scope/provenance/revision，不記錄 memory value
- [x] 測試：授權通過回傳、跨 tenant deny、未授權 scope deny、expired 不注入、cap 截斷、ordering 可重現、telemetry 無 value

**驗證：** `cd backend && npx vitest run src/memory/governance/memory-governance-service.test.ts`

### Task 3.2：commit()／delete()（寫入/刪除 + X8.7 write authorization）

- [x] `commit(candidate, expectedRevision?)`：`authorize({ action: "write", resource })` → optimistic concurrency → put
- [x] `delete(namespace, memoryId)`：`authorize({ action: "write", resource })` → delete
- [x] `expectedRevision` 不符 → conflict，不覆蓋較新 record
- [x] 測試：write 授權 deny 拒寫、revision 衝突、刪除授權 deny 拒刪

**驗證：** `cd backend && npx vitest run src/memory/governance/memory-governance-service.test.ts`

---

## Phase 4：MemoryContextProvider 與 X7 整合（backend）

### Task 4.1：MemoryContextProvider（pre-model orchestration boundary）

- [x] 建立 `backend/src/memory/context/memory-context-provider.ts`
- [x] `recall(principal, scope, budgetHint)` 呼叫 `MemoryGovernanceService.recall()`，轉成 X7 `ContextBlock`（`priority = P3`）
- [x] `principal: PrincipalContext`／`scope: RuntimeScope`（X8.7 型別）自 graph state 的 canonical trusted context 取得並傳入，不自行構造身份
- [x] 不執行 Store I/O（I/O 只在 Governance Service 內經 `MemoryStorePort`）
- [x] 每筆 block 附 scope/provenance/confidence/revision 中繼資料供 debug/trace
- [x] 測試：產出 P3 block、不產出 P0/P1、中繼資料完整

**驗證：** `cd backend && npx vitest run src/memory/context/memory-context-provider.test.ts`

### Task 4.2：與 assembleContext／allocateBudget 串接

- [x] P3 memory blocks 進入既有 `assembleContext`／`allocateBudget`；P4 保留 current-thread recent conversation
- [x] 召回結果受 X7 token budget 約束（`allocateBudget` 截斷不洩漏）
- [x] 測試：budget 不足時 P3 memory 被 `allocateBudget` 依優先序處理；P0/P1 恆優先

**驗證：** `cd backend && npx vitest run src/memory/context/memory-context-provider.test.ts`

---

## Phase 5：MemoryWritePolicy 與關係分類（backend）

### Task 5.1：MemoryWritePolicy（source/consent/retention/dedupe/idempotency）

- [x] 建立 `backend/src/memory/governance/write-policy.ts`
- [x] 僅 approved source（user_explicit／user_feedback／task_result，model_inferred 需滿足最低 confidence 門檻）
- [x] 敏感資料／consent／retention 檢查；dedupe（與既有 record 比對）；idempotency（依 `idempotencyKey`）
- [x] MUST NOT 保存 raw prompt／整段對話／credential／unmasked PII、derivable information、ephemeral task state 或已有 authoritative record 的內容
- [x] 雙層敏感資料防護：`MemoryCandidate` 接受時與呼叫 Store adapter 前各檢查一次，共用同一 policy/detector
- [x] 測試：approved source 通過、raw/PII/derivable/ephemeral 拒存、重複 idempotencyKey 不重複寫入、雙層檢查共用同一 detector

**驗證：** `cd backend && npx vitest run src/memory/governance/write-policy.test.ts`

### Task 5.2：MemoryRelation 分類（same/supersedes/conflicts/coexists）

- [x] 建立 `backend/src/memory/governance/relation-classifier.ts`
- [x] 於 replace/merge 前分類 `same`／`supersedes`／`conflicts`／`coexists`
- [x] current-turn explicit intent 永遠優先；low-confidence inferred 不得成為 Hard Constraint
- [x] memory non-authoritative：與 current authoritative state 衝突時以 authoritative state 優先、過時 memory supersede
- [x] 衝突/supersession 決策 SHOULD 產出 X8.9 `DecisionRecord`（provenance，非 gate）
- [x] 測試：supersede、conflict、coexists、low-confidence 不升格 Hard Constraint、memory non-authoritative（current state 優先）

**驗證：** `cd backend && npx vitest run src/memory/governance/relation-classifier.test.ts`

---

## Phase 6：Revision、bi-temporal、history/restore（backend）

### Task 6.1：optimistic concurrency 與 revision

- [x] `MemoryWriteRequest` 採 `expectedRevision?`；相符才 `putIfRevision`（CAS）並遞增 revision；不符 → conflict
- [x] 永不靜默覆蓋較新 memory；caller 須 re-read/re-evaluate 後重試
- [x] 測試：同 revision 雙寫僅一成功、另一 conflict；舊 Thread 不得覆蓋新偏好

**驗證：** `cd backend && npx vitest run src/memory/governance/memory-governance-service.test.ts`

### Task 6.2：bi-temporal validity 與歷史 restore

- [x] `validFrom`／`validUntil`（valid time）與 `recordedAt`（recorded time）分離建模
- [x] 歷史 revision immutable；restore 以「舊值 + 新 revision」寫回，保留 provenance/audit 連結
- [x] 支援 bounded point-in-time 查詢（valid/recorded）供測試與除錯
- [x] 測試：valid 時間可獨立表示、restore 不抹除歷史、point-in-time 查詢

**驗證：** `cd backend && npx vitest run src/memory/governance/memory-governance-service.test.ts`

---

## Phase 7：Retention、deletion、isolation 與降級（backend）

### Task 7.1：TTL/expiry、explicit delete、namespace isolation

- [x] 支援 TTL/expiry；delete/expiry 後不得再注入 Context
- [x] tenant/principal/domain/scope isolation；correction 不失去 auditability
- [x] 測試：expired 不注入、delete 後不召回、跨 tenant 不可見

**驗證：** `cd backend && npx vitest run src/memory/governance/memory-governance-service.test.ts`

### Task 7.2：降級與失敗語意

- [x] recall timeout／授權失敗／Store unavailable → 空 memory context + 結構化觀測事件，不洩漏未授權內容
- [x] 取消傳遞（不吞掉上游取消）
- [x] 寫入失敗非阻斷（不改已成功回答），可觀測、僅 idempotency key 重試
- [x] 測試：timeout 降級、store down 降級、取消傳遞、寫入失敗不污染結果

**驗證：** `cd backend && npx vitest run src/memory/governance/memory-governance-service.test.ts`

---

## Phase 8：全鏈整合測試與全量驗證（backend）

### Task 8.1：全鏈整合測試（recall → authorize → P3 injection → write policy → commit）

- [x] 建立 `backend/src/memory/integration.test.ts`（以 `InMemoryStoreAdapter` deterministic）
- [x] 案例：Thread A 寫、Thread B 讀（同 authorized principal/tenant）
- [x] 案例：visible-but-not-writable 可讀不可改
- [x] 案例：current explicit preference 覆蓋衝突歷史 memory
- [x] 案例：跨 tenant lookup denied
- [x] 案例：expired/deleted 不注入 Context
- [x] 案例：low-confidence inferred 不升格 Hard Constraint
- [x] 案例：寫入失敗不改已成功回答
- [x] 案例：derivable／ephemeral candidate 拒存（雙層防護）
- [x] 案例：bounded recall cap 截斷與 deterministic ordering
- [x] 案例：memory non-authoritative（current state 優先）

**驗證：** `cd backend && npx vitest run src/memory/integration.test.ts`

### Task 8.2：barrel export 與全量驗證

- [x] 建立 `backend/src/memory/index.ts` barrel export
- [x] 驗證不修改 X7 `context/`、X8.7 `authorization/`、X8.9 `provenance/` 契約
- [x] 驗證不新增 project migration、無自有持久化表
- [x] `cd backend && npm run lint` 通過
- [x] `cd backend && npm run test` 通過（含既有 context／authorization／provenance 回歸）
- [x] `cd backend && npm run build` 通過
- [x] 驗證無不必要 `any`；封閉列舉有單一來源與未知值處理
- [x] `openspec validate add-long-term-memory-governance --strict` 通過

**驗證：** Backend lint/test/build 通過；OpenSpec strict validation 0 issues
