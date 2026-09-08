# Proposal：add-long-term-memory-governance

## 變更定位

純 backend、承接 X7／X8.7／X8.9／X9／X10 的第二階段 P1 hardening 變更。對應 `second-stage-plan-en-v3.md` 的 **X10.1**（Layer 2 Platform Governance，Dependencies: X7, X8.7, X8.9, X9, X10）。

X10.1 補上「Memory + Context Budget」缺口的 Memory 那一半：在 LangGraph Store 之上建立 **scope-aware、versioned、bi-temporal 的 Long-Term Memory Governance**，同時保留 X7 Context Budget 優先序。目標不是「記住一切」，而是只持久化 durable、有用、具 provenance、遵守 visible/write scope、處理 concurrent update／correction／restore／temporal validity／explicit conflict，且永不覆蓋 current-turn explicit intent 的結構化記憶。

## 為什麼（Why）

X7 已提供量化的 Context Budgeting、優先序組裝與壓縮；X8.7 提供 `ResourceRef` 與 `authorize(action, resource)` 作為 visibility/write 的單一事實來源；X8.9 提供 `ContextRef`／`ContextRefStore`／`DecisionRecord`／`EvidenceStore` 與 direct/1-hop 授權遍歷；X9/X10 提供了具體的 Recommendation workload，使 Memory 能對真實 intent/constraint 語意設計。

但至今**不存在 memory 模組**——`memory` 目前只是 X8.7 的一個 resource-type 常數；而 requirement 原文所引用的「native Store boundary validated by X0」在 codebase 中**並未真正成立**：X0 的決策記錄（`docs/decisions/langgraph-runtime-boundary.md`）遺失，實際僅完成 InMemoryStore smoke，`PostgresStore` 從未以真實 PostgreSQL 驗證，且「Decision Record」缺失。因此本變更不能把 production native Store boundary 視為已完成，必須以 T0 compatibility spike 重新驗證。

核心分離原則（承繼 X8.7／X8.9）：

> **Store 提供跨 thread 持久化；X8.7 `authorize(ResourceRef)` 才是 visibility/write 的安全邊界；namespace 只是路由鍵，不是安全邊界。**

## 問題描述

1. **無 memory 模組** — 專案只有 X8.7 的 `memory` resource-type 常數，沒有可用的 Long-Term Memory 讀寫能力；跨 thread 的偏好／事實／任務摘要無處可存。
2. **production Store 邊界未驗證** — requirement 宣稱依賴「X0 驗證的 native Store 邊界」，但 X0 決策記錄遺失、PostgresStore 未驗證，不能直接宣告為既成能力。
3. **讀寫授權語意未固化** — 需明確「visible ≠ writable」，並以 X8.7 `authorize()` 為唯一來源；不得以 namespace 當安全邊界。
4. **Context 整合落點未定** — 需將 memory 召回接入 X7 `assembleContext`／`allocateBudget` 的 P3/P4，且不得污染 current-turn explicit intent（P1）或 recent conversation（P4）。
5. **寫入治理語意未固化** — 需以政策式寫入（approved source + consent/retention/dedupe/idempotency + X8.7 write authorization）取代「整段對話／模型自由文字無條件保存」。

## 解決方案

### 架構決策（本提案已凍結，勿再當作開放疑問）

**決策 1 — 儲存媒介**：採 LangGraph **BaseStore 邊界**，由 project-owned **`MemoryStorePort`／Memory Governance Service** 封裝，不直接裸露 BaseStore。production adapter 採 **`PostgresStore`**；**`InMemoryStore` 僅供 deterministic tests**。首次 T0 compatibility spike（0.2.74）已以 hard gate 失敗：相容的 PostgreSQL adapter 只 export `PostgresSaver`，沒有 `PostgresStore`。CCR 已仲裁凍結 **升級整組 LangGraph persistence dependencies** 至共同支援 `PostgresStore` 的版本組合（詳見 `docs/decisions/production-memory-store-boundary.md` 的 T0 候選矩陣），並把原 T0 改為 **dependency upgrade compatibility spike** 作為新 hard gate：以候選矩陣（`@langchain/langgraph` 1.4.14／checkpoint 1.1.5／checkpoint-postgres 1.0.5／core 1.2.9）＋真實 PostgreSQL 驗證 dependency 安裝與單一 checkpoint 版本、`PostgresStore.setup()`、CRUD、跨 Thread、process restart、TTL、atomic CAS 與既有 graph/checkpoint/resume/tool-calling 全量回歸。X0 記錄為「僅完成 InMemoryStore smoke；PostgresStore 未驗證；Decision Record 遺失」，不得宣稱 production native Store boundary 已完成。所有讀寫刪除仍須經 X8.7 `authorize(ResourceRef)`；namespace 不得視為安全邊界。**spike 不通過 → 停止並回報 ADR，不得靜默改成自建 repository 或降級至 `PostgresSaver`。**

**決策 2 — 整合邊界**：採「**自動讀取＋政策式寫入**」，**X10.1 不提供 planner-controlled memory Tool**。

- **讀取**：新增 `MemoryContextProvider` 作為 pre-model/runtime orchestration boundary，呼叫 `MemoryGovernanceService.recall()`；Governance Service 對每筆 memory `ResourceRef` 執行 X8.7 read authorization，必要時才用 X8.9 `AuthorizedContextReferenceResolver` 擴展相關 references；召回結果轉成 P3 `ContextBlock` 交給既有 `assembleContext`／`allocateBudget`。P4 保留給 current-thread recent conversation。**不得在純 context-assembler 內執行 Store I/O**。
- **寫入**：synthesis 後只能產出 runtime-validated `MemoryCandidate`，經 `MemoryWritePolicy`（敏感資料／consent／retention、dedupe、idempotency）與 X8.7 write authorization 後由 Governance Service commit。`EvidenceStore`／`DecisionRecord`／Audit 僅記錄 provenance，不作為 memory persistence 或 authorization gate。**不得無條件保存整段對話或模型自由文字**。
- **降級／失敗**：recall timeout、授權失敗或 Store unavailable → 降級為空 memory context 並產生結構化觀測事件，不得洩漏未授權內容；取消必須傳遞。寫入失敗不得把已成功產生的使用者回答改成失敗，但必須可觀測、僅能以 idempotency key 安全重試。
- **後續 change**：`read_memory`／`write_memory` Tool 與深度召回留待後續；僅當觀測證明自動召回不足才評估混合模式。

### Part A：Memory Record 契約（承 X10.1 issue Part A/C/F）

`LongTermMemoryRecord` 承載 namespace（`tenantId`／`principalId`／`domain?`／`scopeId`）、`memoryType`（`preference`／`negative_preference`／`accepted_choice`／`task_summary`／`service_context`）、`value`、`provenance`（`source` ∈ user_explicit／user_feedback／task_result／model_inferred）、`confidence`、`revision`，以及 bi-temporal（`validFrom`／`validUntil` vs `recordedAt`）、`createdAt`／`updatedAt`／`expiresAt?`。

### Part B：Visible vs Writable scope（承 issue Part B）

`MemoryAccessPolicy` 區分 `readMode`（off／writable_scopes／visible_scopes）與 `writeMode`（off／writable_scopes）；X8.7 authorization 是 visibility/write 的單一事實來源。visible-but-not-writable 可讀不可改。

### Part C：衝突分類與 bi-temporal（承 issue Part C/E/F）

新 memory 於 replace/merge 前先分類為 `same`／`supersedes`／`conflicts`／`coexists`；current-turn explicit intent 永遠優先；low-confidence inferred 不得成為 Hard Constraint；衝突／supersession 決策 SHOULD 產出 X8.9 Decision Provenance。寫入採 optimistic concurrency（`expectedRevision`），revision 不符 → conflict，永不靜默覆蓋較新 memory。

### Part D：Retention／Deletion／Isolation（承 issue Part H）

支援 TTL/expiry、explicit delete、tenant/principal/domain/scope isolation；delete/expiry 後不得再注入 Context；歷史 revision immutable、可 restore 為新 revision。

### 治理原則（吸收參考實作的可行設計，本階段納入）

X10.1 吸收 Claude Code 記憶子系統（Session／Private／Project／Team Memory）的可採納設計，但不照搬其實作。本階段納入下列治理契約：

1. **durable／non-derivable 分離**：只保存跨 session 仍有價值、且無法由 authoritative source（code／Git／既有文件／transcript）重建的內容；拒絕 transient task state 與暫時性中繼狀態。
2. **bounded、metadata-first recall**：`MemoryContextProvider` 先以 metadata 取得有限候選，再經授權、穩定排序、configurable cap 與 ContextBudget 篩選後注入 P3；不引入 MEMORY.md 或 Markdown 檔案儲存。
3. **明確寫入排除政策**：除 raw prompt／credential／unmasked PII 外，再排除 derivable information、ephemeral state 與已有 authoritative record 的內容。
4. **memory non-authoritative**：memory 非事實來源；current-turn explicit intent 與 current authoritative state 永遠優先，過時 memory 以 supersede 處理。主動 re-validation（grep／讀檔／查外部服務）延後至後續 change，避免擴張成 Tool／深度召回。
5. **有界召回與可觀測性**：configurable record/token cap、deterministic ordering、timeout、空結果降級；telemetry 不記錄 memory value。
6. **雙層敏感資料防護**：`MemoryCandidate` 接受時與真正呼叫 Store adapter 前各檢查一次，共用同一 policy/detector，避免兩套規則漂移。

> 上述原則保留 X10.1 既有 schema（`memoryType` 等），不直接套用參考實作的 user／feedback／project／reference 分類，也不引入其 Markdown 儲存、硬編碼數字或團隊同步機制。

## 目標

- ✅ 建立 `MemoryStorePort`（project-owned）封裝 LangGraph BaseStore，`InMemoryStore`（test）／`PostgresStore`（prod）adapter
- ✅ 通過 **dependency upgrade compatibility spike**（候選矩陣 + 真實 PostgreSQL：dependency 安裝與單一 checkpoint 版本、`PostgresStore.setup()`、CRUD、跨 Thread、process restart、TTL、atomic CAS、既有 graph/checkpoint/resume/tool-calling 全量回歸）
- ✅ 建立 `MemoryGovernanceService`（`recall`／`commit`），讀寫刪除皆經 X8.7 `authorize(ResourceRef)`
- ✅ 建立 `MemoryContextProvider`，召回經授權後轉 P3 `ContextBlock` 交給 `assembleContext`／`allocateBudget`
- ✅ 建立 `MemoryCandidate` 與 `MemoryWritePolicy`（approved source、consent/retention、dedupe、idempotency）
- ✅ bi-temporal（valid vs recorded）與 revision-based optimistic concurrency、歷史 restore
- ✅ 降級／失敗語意：recall 降級空 context + 可觀測；寫入非阻斷、僅 idempotency key 重試
- ✅ X10.1 不提供 planner-controlled memory Tool

## 非目標

- ❌ planner-controlled `read_memory`／`write_memory` Tool 與深度召回 — 留待後續 change
- ❌ standalone vector database（除非 native Store 經 spike 證明不足，且需另開 ADR）
- ❌ 無條件保存整段對話／raw prompt／模型自由文字／credential／未遮蔽 PII
- ❌ 以 namespace 作為安全邊界，或繞過 X8.7 authorization／tenant isolation
- ❌ 以 `EvidenceStore`／`DecisionRecord`／Audit 充當 memory persistence 或 authorization gate
- ❌ 自建 memory 表或 additive migration（儲存採 LangGraph PostgresStore 自身表結構，見 design）
- ❌ MEMORY.md／Markdown filesystem 作為 production memory store
- ❌ 硬編碼召回數字（固定掃描 N 筆、模型固定選 M 筆）
- ❌ 以 user／feedback／project／reference 取代既有 `memoryType` 分類
- ❌ daily log／背景 consolidation（如 /dream）機制
- ❌ 模型／planner 直接以 Write／Edit 保存記憶（違反政策式寫入）
- ❌ repo team sync API、local-wins 衝突解析、不傳播刪除
- ❌ 取消時回傳空記憶吞掉取消（X10.1 MUST 傳遞取消）
- ❌ 主動 re-validation（grep／讀檔／查外部服務）— 留待後續 change
- ❌ 修改 X7／X8.7／X8.9 既有契約

## 規格疑問

本提案已由協調仲裁凍結架構決策（見上），故不列為開放疑問。首次 T0 spike 的兩個殘餘點已由 ADR 仲裁定案：

1. **PostgresStore 的 JS package/module 路徑**：已定案為 `import { PostgresStore } from "@langchain/langgraph-checkpoint-postgres/store"`（1.0.5 提供 `./store` subpath），不再由 spike 猜測路徑。
2. **BaseStore 與既有自建 `runtime/persistence` 的邊界**：記憶資料走 LangGraph `PostgresStore` 自身表、由 `PostgresStore.setup()` 建表，不新增 project migration；是否與既有 Postgres 連線／connection pool 共享，由 T0 spike 驗證並記錄。

## Capabilities

### New Capabilities

- `long-term-memory-governance`：在 LangGraph Store 之上提供 scope-aware、versioned、bi-temporal 的 Long-Term Memory Governance（`MemoryStorePort`、`MemoryGovernanceService`、`MemoryContextProvider`、`MemoryCandidate`＋`MemoryWritePolicy`、revision/conflict/history、retention/isolation），並以 T0 compatibility spike 驗證 production Store 邊界。

## 受影響範圍

| 套件 | 影響 |
|------|------|
| backend | 新增 `src/memory/`（store-port、adapters、governance service、context-provider、write-policy、candidate、record types + 測試） |
| backend | 新增 dependency upgrade compatibility spike 驗證（候選矩陣 + 真實 PostgreSQL；含既有 graph/checkpoint/resume/tool-calling 全量回歸） |
| backend | 唯讀引用 X7 `context/`（`ContextBlock`／`ContextPriority`／`assembleContext`／`allocateBudget`）、X8.7 `authorization/`（`ResourceRef`／`authorize`）、X8.9 `provenance/`（`ContextRef`／`AuthorizedContextReferenceResolver`／`DecisionRecord`）；不修改其契約 |
| backend | 不新增 project migration（記憶資料走 LangGraph PostgresStore 自身表） |

> bff 與 frontend 本次不變動。

## 與既有系統的關係

| 既有系統 | 關係 |
|---------|------|
| X7 Context Budget | `MemoryContextProvider` 產出 P3 `ContextBlock`，交給既有 `assembleContext`／`allocateBudget`；P4 保留 recent conversation；不污染 P0/P1 |
| X8.7 Authorization | 每筆 memory `ResourceRef` 讀寫刪除皆經 `authorize(action, resource)`；namespace 非安全邊界 |
| X8.9 Decision Provenance | recall 必要時經 `AuthorizedContextReferenceResolver` 擴展；衝突／supersession 決策 SHOULD 產出 `DecisionRecord`；`EvidenceStore` 僅記 provenance |
| LangGraph Store（候選矩陣 1.x） | `MemoryStorePort` 封裝 BaseStore；`InMemoryStore`（test）／`PostgresStore`（prod，`@langchain/langgraph-checkpoint-postgres/store`）adapter |
| X0 Runtime Boundary | 以其「僅 InMemoryStore smoke、PostgresStore 未驗證、Decision Record 遺失」為前置事實，由 T0 spike 補驗證 |

## 風險

| 風險 | 緩解 |
|------|------|
| **大版本升級（0.x → 1.x）破壞既有 graph／checkpoint／resume／tool calling，或 `PostgresStore` 1.0.5 的 CAS／TTL／migration 語意與設計不符** | dependency upgrade compatibility spike 為 hard gate（含全量回歸）；不通過 → 停止並回報 ADR，不得靜默改自建 repository 或降級至 `PostgresSaver` |
| X0「native Store boundary 已完成」被誤認 | 本提案明確標記 X0 缺口，design/spec 不得宣稱 production Store boundary 已完成 |
| 以 namespace 當安全邊界導致跨 tenant 洩漏 | Governance Service 在 Store I/O 前執行 X8.7 `authorize()`；spec 有跨 tenant deny Scenario |
| 寫入失敗連帶污染已成功回答 | 寫入為非阻斷後寫；失敗僅可觀測 + idempotency key 重試，不改 user-visible 結果 |
| 召回阻塞模型前路徑（timeout／store down） | recall 降級空 context + 結構化觀測事件，不洩漏未授權內容；取消傳遞 |
| 無條件保存整段對話／PII | `MemoryWritePolicy` 白名單 approved source；spec 有 raw/PII 拒存 Scenario |
| low-confidence inferred 成為 Hard Constraint | conflict priority 明訂 current-turn explicit 優先；spec 有 Scenario |

## 回滾策略

- 新增 `backend/src/memory/` 為全新模組，刪除即可回滾。
- 不新增 project migration、無既有資料遷移、無破壞性 schema 變更；記憶資料在 LangGraph PostgresStore 自身表內。
- 唯讀引用既有 `context/`、`authorization/`、`provenance/`，不改其契約；無 bff／frontend 變更。
- T0 spike 產物（腳本／證據）獨立於 `src/memory/`，可單獨移除。
