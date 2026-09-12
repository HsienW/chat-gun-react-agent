# Design：add-long-term-memory-governance

## 架構分層

```text
backend/src/memory/                        (X10.1 - 新增，backend-only)
├── types.ts                 LongTermMemoryRecord / MemoryAccessPolicy / MemoryRelation /
│                            MemoryCandidate / MemoryWriteRequest + runtime validation
├── store-port.ts            MemoryStorePort（project-owned 介面，封裝 BaseStore 語意）
├── store/
│   ├── in-memory-adapter.ts  InMemoryStoreAdapter（deterministic tests）
│   └── postgres-adapter.ts   PostgresStoreAdapter（production；T0 spike 驗證）
├── governance/
│   ├── memory-governance-service.ts   recall() / commit() / delete()，X8.7 authorize gate
│   ├── write-policy.ts                 MemoryWritePolicy（source/consent/retention/dedupe/idempotency）
│   └── relation-classifier.ts          same/supersedes/conflicts/coexists 分類
├── context/
│   └── memory-context-provider.ts      MemoryContextProvider（pre-model orchestration boundary）
├── index.ts                 barrel export
└── *.test.ts                單元／整合測試（含 InMemoryStore deterministic tests）

backend/src/context/                       (X7 - 唯讀引用 ContextBlock/ContextPriority/assembleContext/allocateBudget)
backend/src/runtime/authorization/         (X8.7 - 唯讀引用 ResourceRef/authorize)
backend/src/runtime/provenance/            (X8.9 - 唯讀引用 ContextRef/AuthorizedContextReferenceResolver/DecisionRecord)
```

X10.1 不新增 project migration；記憶資料落在 LangGraph PostgresStore 自身表結構內，由 T0 spike 確認其 setup/migration 語意。

## 儲存邊界（決策 1）

### LangGraph BaseStore 映射

LangGraph `BaseStore` 以 `(namespace: string[], key: string) → value` 儲存跨 thread 資料。`MemoryStorePort` 是 project-owned 介面，把 BaseStore 語意收斂成專案語意，避免其他層直接持有 BaseStore 型別：

```typescript
interface MemoryStorePort {
  get(namespace: MemoryNamespace, key: string): Promise<LongTermMemoryRecord | undefined>;
  put(namespace: MemoryNamespace, key: string, record: LongTermMemoryRecord): Promise<void>;
  // CAS（compare-and-swap）：僅當現有 revision 與 expectedRevision 相符時才寫入，回傳是否成功
  putIfRevision(namespace: MemoryNamespace, key: string, record: LongTermMemoryRecord, expectedRevision?: string): Promise<boolean>;
  search(namespace: MemoryNamespace, filter?: MemorySearchFilter): Promise<LongTermMemoryRecord[]>;
  delete(namespace: MemoryNamespace, key: string): Promise<void>;
}
```

- `MemoryNamespace = { tenantId, principalId, domain?, scopeId }` 序列化為 BaseStore namespace tuple（如 `["mem", tenantId, principalId, domain ?? SENTINEL, scopeId]`）；runtime validation MUST reject `domain === SENTINEL`（保留字），避免「未定義 domain」與合法值碰撞。
- `key = memoryId`；`value = LongTermMemoryRecord`（含 bi-temporal、revision、provenance 欄位）。
- `revision` 產生策略：canonical monotonic counter token `r<counter>`；`counter` 為不含前導零的正整數十進位字串（如 `r1`、`r2`、`r10000`），runtime validation 使用 `^r[1-9][0-9]*$`。格式不設固定位寬或 `r9999` 上限；遞增時以 `BigInt`（或等價任意精度整數）解析，CAS 只比較 token 是否相等，MUST NOT 以字典序判斷新舊。BaseStore `put` 為覆寫語意，故 optimistic concurrency 由 `putIfRevision` 保證（`expectedRevision` 不符回傳 `false` 且不覆寫）；若 `PostgresStore` 原生不提供 conditional put，adapter 須以單一寫入交易或 lock 補足（由 T0 spike 確認並記錄）。
- **namespace 只是路由鍵，不是安全邊界**。授權一律由 Governance Service 在 Store I/O 之前執行。

### Adapter 選擇

| Adapter | 用途 | 持久化 |
|---------|------|--------|
| `InMemoryStoreAdapter` | deterministic tests | 否（LangGraph `InMemoryStore`） |
| `PostgresStoreAdapter` | production | 是（LangGraph `PostgresStore` 1.0.5，`@langchain/langgraph-checkpoint-postgres/store`） |

- `PostgresStore` 的 JS package/module 路徑已定案為 `import { PostgresStore } from "@langchain/langgraph-checkpoint-postgres/store"`（1.0.5 提供 `./store` subpath）；採用 ADR 候選矩陣（`@langchain/langgraph` 1.4.14／checkpoint 1.1.5／checkpoint-postgres 1.0.5／core 1.2.10），精確鎖版由 T0 驗證後以 lockfile 完成。
- 兩者皆實作同一 `MemoryStorePort`；test 注入 InMemory，production 注入 Postgres。

### T0 dependency upgrade compatibility spike（hard gate）

首次 T0（0.2.74）已以 hard gate 失敗（相容 PostgreSQL adapter 只 export `PostgresSaver`，無 `PostgresStore`）。ADR 定案改為 **dependency upgrade compatibility spike**，以候選矩陣（`@langchain/langgraph` 1.4.14／checkpoint 1.1.5／checkpoint-postgres 1.0.5／core 1.2.10／cli 1.4.5／zod ^3.25.32）＋真實 PostgreSQL 驗證：

- dependency 安裝與單一 checkpoint 版本（無雙 checkpoint/core 型別與 runtime 不一致）
- `PostgresStore.setup()` 建表與重複執行安全性（不新增 project migration）
- put/get/search/delete 全 CRUD
- 跨 Thread 讀寫（Thread A 寫、Thread B 讀）
- process restart 後資料仍可讀
- TTL/expiry 行為（Store 原生 expiry + Governance 層過濾 defense-in-depth）
- tenant/scope isolation（同 namespace 不同 tenant 不得互相可見——governance 層隔離，非依賴 DB namespace）
- atomic CAS 可行方案（adapter 原生 conditional put，否則單一寫入 transaction）
- 既有 graph compile、streaming、checkpoint/resume、tool calling 全量回歸（升級引發的型別／compile 斷裂，依 ADR「相容性修補授權」可做有界修補、行為語意不變；語意／runtime 契約斷裂仍回報 ADR）
- tool-calling cancellation 契約：pre-aborted signal 的 `tool().invoke()` 立即 settle（resolve 為 wrapped 結構化 `cancelled` 結果，非 reject `AbortError`；見 ADR「canonical cancellation outcome」）；既有 weather cancellation 回歸通過（core 1.2.10；未修復則走 ADR dependency patch fallback）

**判定**：除 ADR「相容性修補授權」明訂的型別／compile 層級修補，與 ADR「tool-calling cancellation runtime 斷裂的處置」明訂的版本升級（core 1.2.10）／dependency patch 外，任一步不通過 → 停止並回報 ADR，不得靜默改成自建 repository 或降級至 `PostgresSaver`。X0 記錄為「僅完成 InMemoryStore smoke；PostgresStore 未驗證；Decision Record 遺失」。

## 核心模型

### LongTermMemoryRecord（承 issue Part A/C/F）

```typescript
interface LongTermMemoryRecord<TValue = unknown> {
  memoryId: string;
  namespace: { tenantId: string; principalId: string; domain?: string; scopeId: string };
  memoryType: "preference" | "negative_preference" | "accepted_choice" | "task_summary" | "service_context";
  value: TValue;
  provenance: { source: "user_explicit" | "user_feedback" | "task_result" | "model_inferred"; sourceRef?: string };
  confidence: number;             // 0..1
  revision: string;               // monotonic revision token
  validFrom?: string;             // bi-temporal: valid time
  validUntil?: string;
  recordedAt: string;             // bi-temporal: recorded time
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}
```

- `memoryId` 為該 `namespace` 內唯一 key；`revision` 為 optimistic concurrency token。
- runtime validation：`confidence` ∈ [0,1] finite；必填字串非空；`memoryType`／`provenance.source` 採封閉列舉 + 未知值處理（fail-closed reject）。

### MemoryCandidate（寫入前的中間產物）

```typescript
interface MemoryCandidate<TValue = unknown> {
  namespace: MemoryNamespace;
  memoryType: LongTermMemoryRecord["memoryType"];
  value: TValue;
  provenance: LongTermMemoryRecord["provenance"];
  confidence: number;
  validFrom?: string;
  validUntil?: string;
  expiresAt?: string;
  // 供 idempotency / dedupe / conflict 分類使用
  idempotencyKey: string;
}
```

- 只能由 synthesis 後、經 runtime validation 產出；不得為 raw conversation／model free text。

### MemoryAccessPolicy（承 issue Part B）

```typescript
type MemoryReadMode = "off" | "writable_scopes" | "visible_scopes";
type MemoryWriteMode = "off" | "writable_scopes";
interface MemoryAccessPolicy {
  readMode: MemoryReadMode;
  writeMode: MemoryWriteMode;
  visibleScopeIds: string[];
  writableScopeIds: string[];
}
```

- X8.7 authorization 是 visibility/write 的單一事實來源；`MemoryAccessPolicy` 是 `(RuntimeScope, X8.7 policy 結果)` 的純函數投影，僅供 debug/trace 與政策文件化，**不取代** `authorize()`；`authorize()` 結果與 policy 不一致時，以 `authorize()` 為準。

## 授權整合（決策 1/2 的交集）

- 每筆 memory 的 `ResourceRef` = `{ resourceType: "memory", resourceId: memoryId, tenantId, ownerScopeId: scopeId }`。
- **讀取**：`recall()` 對每個候選 memory 執行 `authorize({ action: "read", resource })`，allow 才納入結果；跨 tenant／未授權在資料回傳前 deny。
- **寫入/刪除**：`commit()`／`delete()` 執行 `authorize({ action: "write", resource })`。
- 必要時經 X8.9 `AuthorizedContextReferenceResolver.findRelated`（direct/1-hop）擴展相關 references，但**不得轉為任意 multi-hop 圖遍歷**。
- **namespace 不是安全邊界**；不得以「namespace 相同」推導授權，授權只能來自 X8.7 `authorize()`。

## 讀取路徑（決策 2）

```text
synthesis / runtime orchestration
  → MemoryContextProvider.recall(principal, scope, budgetHint)
      → MemoryGovernanceService.recall(principal, scope)
          → search(namespace) 取得候選 memory（含 memoryId → ResourceRef）
          → 對每筆執行 X8.7 authorize(action="read", ResourceRef)
          →（必要時）X8.9 AuthorizedContextReferenceResolver 擴展 1-hop references
          → 過濾 expired/deleted、套 relevance score、截斷
          → 回傳 authorized MemoryContextBlock[]
      → 轉為 X7 ContextBlock（priority = P3）
  → assembleContext / allocateBudget（P4 保留 recent conversation）
```

- `MemoryContextProvider` 是 pre-model/runtime orchestration boundary，**不執行 Store I/O**；Store I/O 只發生在 Governance Service 內（經 `MemoryStorePort`）。
- `principal` 型別為 X8.7 `PrincipalContext`、`scope` 型別為 X8.7 `RuntimeScope`（唯讀引用，不重定義）；`MemoryContextProvider` 自 graph state 的 canonical trusted context 取得並傳入，Governance Service 不自行構造身份。
- 召回結果固定落在 P3，MUST NOT 注入 P0/P1；P4 保留 current-thread recent conversation。
- **bounded、metadata-first recall**：先以 metadata（namespace／`memoryType`／`validFrom`／`validUntil`／`recordedAt`）取得有限候選，再載入 `value` 做 relevance 排序；candidate 數與注入 token 受 configurable cap（`maxCandidates`／`maxTokens`）約束，避免全表載入。此為 metadata-first recall，不引入 MEMORY.md 或 Markdown 檔案儲存。
- relevance scoring（截斷前排序）：`score = confidence × memoryTypeWeight(memoryType) × recencyDecay(recordedAt)`，降冪排序後依 `budgetHint` 截斷。`memoryTypeWeight` 由 application composition root 以 `MemoryRelevanceConfig.memoryTypeWeights: Readonly<Record<LongTermMemoryRecord["memoryType"], number>>` 注入 `MemoryGovernanceService`；五個 `memoryType` key 必須完整提供，值必須為 finite non-negative number，缺值、未知 key 或非法值一律 fail-closed reject，不使用隱含 fallback。production 值只由 backend config 單一來源提供，單元測試注入固定 fixture。`recencyDecay` 為 monotonic、有界、deterministic；同分時依 `recordedAt` 再依 `memoryId` 斷 tie。單元測試須覆蓋 config 驗證與固定基準案例，證明排序可重現。
- 每筆注入 block 附 scope/provenance/confidence/revision 供 debug/trace。

## 寫入路徑（決策 2）

```text
synthesis 後產出結構化 MemoryCandidate（runtime-validated）
  → MemoryWritePolicy.evaluate(candidate)
      → 敏感資料 / consent / retention 檢查
      → dedupe（與既有 record 比對）
      → idempotency（依 idempotencyKey）
  → 若 new/update：分類 relation = same/supersedes/conflicts/coexists
  → MemoryGovernanceService.commit(candidate, expectedRevision?)
      → X8.7 authorize(action="write", ResourceRef)
      → optimistic concurrency：expectedRevision 相符才 put；不符 → conflict（不覆蓋）
  → 衝突/supersession 決策 SHOULD 產出 X8.9 DecisionRecord（provenance，非 gate）
```

- `EvidenceStore`／`DecisionRecord`／Audit 僅記錄 provenance，**不作為 memory persistence 或 authorization gate**。
- 寫入為**非阻斷後寫**：失敗不得把已成功產生的使用者回答改成失敗；但必須可觀測，且僅能以 idempotency key 安全重試。
- 只保存 approved source：explicit user preference/correction、accepted recommendation／confirmed outcome、stable task summary。MUST NOT 保存 raw prompt、整段對話、credential、unmasked PII。
- **寫入排除政策**：除 raw prompt／整段對話／credential／unmasked PII 外，MUST NOT 保存 derivable information（可由 code／Git／既有文件重建）、ephemeral state（暫時任務狀態、單次對話中繼狀態）與已有 authoritative record 的內容。
- **雙層敏感資料防護**：敏感資料／PII／credential 於 (1) `MemoryCandidate` 接受時與 (2) 真正呼叫 Store adapter 前各檢查一次，兩層共用同一 policy/detector（單一來源），避免兩套規則漂移。

## 衝突分類與 bi-temporal（承 issue Part C/E/F）

- 分類規則：`same`（等價）、`supersedes`（新覆舊）、`conflicts`（矛盾）、`coexists`（並存）；於 replace/merge 前判定。
- 優先序：current-turn explicit text > current selection > high-confidence vision > **Long-term Memory** > low-confidence model inference。
- `validFrom/validUntil`（valid time）與 `recordedAt`（recorded time）分離：新觀察可 supersede 舊偏好而不抹除舊偏好的有效性事實。
- 歷史 revision immutable；restore 以「舊值 + 新 revision」寫回，保留 provenance/audit 連結。
- low-confidence inferred memory 不得成為 Hard Constraint。
- **memory non-authoritative**：memory 不是 fact 的 authoritative source；current-turn explicit intent 與 current authoritative state 永遠優先，過時 memory 以 `supersedes` 處理。主動 re-validation（grep／讀檔／查外部服務）不屬本階段，延後至後續 change，避免擴張成 Tool／深度召回。

## 資料模型與 migration

- 記憶資料走 LangGraph `PostgresStore` 自身表（BaseStore 通用 `(namespace, key, value)` 儲存），由 `PostgresStore.setup()` 建表，**不新增 project `runtime/persistence/migrations`**。
- project 既有 migration 001–016 不動；X8.9 §9 的 additive migration 約束適用於其自身表（`decision_records`／`context_refs`），與本變更的 store 表正交。
- tenant/scope ownership 由 record 內 `namespace` 欄位與 `ResourceRef` 投影承載；安全隔離由 Governance Service 的 `authorize()` 保證，不依賴 DB 層 namespace 隔離。

## 降級與失敗語意

| 情境 | 行為 |
|------|------|
| recall timeout | 降級空 memory context + 結構化觀測事件；不洩漏未授權內容 |
| 授權失敗（read） | 該筆排除，其餘照常；若整體失敗 → 空 context + 觀測事件 |
| Store unavailable | 降級空 memory context + 觀測事件；不阻塞模型前路徑 |
| 取消（cancellation） | MUST 傳遞，不吞掉上游取消 |
| 寫入失敗 | 非阻斷；不改已成功回答；可觀測；僅 idempotency key 重試 |

## 觀測性（Telemetry）

- recall 降級、授權 deny、Store unavailable、寫入失敗、conflict/supersession 皆產生結構化觀測事件（含 scope/reason，不洩漏 value 內容）。
- 衝突/supersession 決策產出 X8.9 `DecisionRecord`（provenance）。
- 不在 debug/trace 暴露 raw prompt、credential、unmasked PII 或 memory value 全文（僅 scope/provenance/revision 中繼資料）。

## 替代方案

| 方案 | 評估 |
|------|------|
| 自建 Postgres repo + additive migration | ❌ 使用者已凍結採 LangGraph BaseStore；僅當 T0 spike 失敗才經 ADR 重新評估，不得靜默回退 |
| 直接裸露 BaseStore 給各層使用 | ❌ 洩漏 LangGraph 型別、難以注入 test double；改以 `MemoryStorePort` 封裝 |
| 以 namespace 當安全邊界 | ❌ 使用者明訂 namespace 非安全邊界；授權必須走 X8.7 `authorize()` |
| planner-controlled memory Tool | ❌ X10.1 明訂不提供；留待後續 change |
| 無條件保存整段對話／模型自由文字 | ❌ 違反 write policy；僅 approved source |
| 把 EvidenceStore/DecisionRecord 當 persistence gate | ❌ provenance 不得作為 memory 持久化或授權 gate |
| MEMORY.md／Markdown filesystem 作為 production store | ❌ 參考實作的非資料庫儲存，不符 BaseStore/PostgresStore 邊界與逐筆授權／revision 要求 |
| 硬編碼召回數字（固定掃描 N 筆、固定選 M 筆） | ❌ 違反「不得硬編碼」；採 configurable cap |
| 以 user／feedback／project／reference 取代既有 `memoryType` | ❌ 直接硬複製外部分類；應映射到 X10.1 既有 `memoryType` |
| daily log／背景 consolidation（/dream） | ❌ 不屬 X10.1；寫入採政策式，非背景整理 |
| 模型／planner 直接以 Write／Edit 保存記憶 | ❌ 違反「政策式寫入、無 planner-controlled memory Tool」 |
| repo team sync API、local-wins 衝突、不傳播刪除 | ❌ 不符合 revision/CAS 與 explicit delete 語意 |
| 取消時回傳空記憶（吞掉取消） | ❌ X10.1 MUST 傳遞取消 |
| standalone vector database | ❌ native `PostgresStore` 是本 Change 的凍結邊界；若 T0 證明不足，須另開 ADR／Change 評估，不在 X10.1 內替換 |
| 主動 re-validation（grep／讀檔／查外部服務） | ❌ 會引入額外 I/O／Tool 與授權語意，延後至後續 Change；X10.1 只將 memory 視為 non-authoritative 並以 current authoritative state 優先 |

## 責任邊界

| 套件 | 責任 |
|------|------|
| backend（X10.1 memory） | `MemoryStorePort`／adapter、`MemoryGovernanceService`、`MemoryContextProvider`、`MemoryWritePolicy`、record 型別、T0 spike；唯讀引用 X7/X8.7/X8.9，不改其契約 |
| backend（X7 context） | 零變更；持續提供 `ContextBlock`／`ContextPriority`／`assembleContext`／`allocateBudget` |
| backend（X8.7 authorization） | 零變更；持續提供 `ResourceRef`／`authorize` |
| backend（X8.9 provenance） | 零變更；持續提供 `ContextRef`／`AuthorizedContextReferenceResolver`／`DecisionRecord` |
| bff | 本次不變動 |
| frontend | 本次不變動 |
