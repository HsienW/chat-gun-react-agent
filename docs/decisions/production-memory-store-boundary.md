# Production Memory Store Boundary

- 日期：2026-09-08
- Change：`add-long-term-memory-governance`（X10.1）
- 狀態：Accepted
- 決策：**升級整組 LangGraph persistence dependencies，以取得正式支援的 `PostgresStore`；不改用其他 Store，不自建 repository**

## 決策摘要

X10.1 原凍結的儲存媒介決策採 LangGraph `BaseStore` 邊界＋project-owned `MemoryStorePort`，production adapter 採 `PostgresStore`。第一次 T0 compatibility spike（`@langchain/langgraph` 0.2.74＋`@langchain/langgraph-checkpoint` 0.0.18＋`@langchain/langgraph-checkpoint-postgres` 0.0.5）以 hard gate 失敗：該 dependency 組合的 PostgreSQL adapter 只 export `PostgresSaver`，規格要求的 `PostgresStore` 並不存在。

CCR 依 T0 evidence 與協調仲裁，凍結下列單一決策：

> **升級整組 LangGraph persistence dependencies 至共同支援 `PostgresStore` 的版本組合。** 不改用其他官方 Store adapter，不自建 project-owned PostgreSQL repository。

三個候選方案的取捨：

| 方案 | 決策 |
| --- | --- |
| 升級 LangGraph／checkpoint／checkpoint-postgres 至共同支援 `PostgresStore` 的版本組合 | ✅ 採用（較符合原 BaseStore 設計，保留已核准的架構原則） |
| 改用其他經驗證的官方 LangGraph persistent BaseStore adapter | ❌ 不採用（無必要；`PostgresStore` 即為官方 production Store adapter） |
| project-owned PostgreSQL repository | ❌ 不採用（推翻「不得自建 repository／migration」的凍結決策，且需另立完整 ADR；`PostgresStore` 已提供官方 production 邊界） |

## 背景與 T0 失敗事實

第一次 T0（`run-2026-09-07-001`）確認：

1. `backend/package-lock.json` 解析 `@langchain/langgraph` 為 0.2.74；其相依 `@langchain/langgraph-checkpoint` 為 0.0.18。
2. `@langchain/langgraph` 與 `@langchain/langgraph-checkpoint` 均 export `BaseStore`、`InMemoryStore`。
3. 與 checkpoint 0.0.18 相容的 `@langchain/langgraph-checkpoint-postgres@0.0.5` peer range 為 `~0.0.15`。
4. 0.0.5 只 export `PostgresSaver`，沒有 `PostgresStore`。
5. 下一條 0.1.x adapter 要求 `@langchain/langgraph-checkpoint ^0.1.0`，與 LangGraph 0.2.74 的 `~0.0.17` 邊界不相容。
6. 因此 production Store boundary 無法於鎖定的 0.2.74 dependency 集上實作，必須升級。

## T0 候選矩陣（先驗證，再鎖版）

以下為 CCR 依 npm 正式版解析的 **候選** 版本矩陣；T0 spike 驗證通過後才以 lockfile 正式鎖版：

| 套件 | 目前鎖定 | 候選 |
| --- | --- | --- |
| `@langchain/langgraph` | 0.2.74（`^0.2.67`） | **1.4.14** |
| `@langchain/langgraph-checkpoint` | 0.0.18（間接） | **1.1.5** |
| `@langchain/langgraph-checkpoint-postgres` | —（未宣告） | **1.0.5** |
| `@langchain/core` | `^0.3.55` | **1.2.10** |
| `@langchain/langgraph-cli`（dev） | `^0.0.36` | **1.4.5** |
| `zod` | `^3.24.4` | **^3.25.32（保留 Zod 3，縮小變更）** |
| Node.js | 22（符合） | 維持 |

> `@langchain/langgraph-checkpoint-postgres@1.0.5` 的 peer 為 `@langchain/core ^1.1.44` 與 `@langchain/langgraph-checkpoint ^1.1.4`，與上述候選一致。此矩陣為 **candidate**，精確鎖版由 T0 驗證後以 lockfile 完成。

## 正式 import path 與能力

`PostgresStore` 的正式 import path：

```typescript
import { PostgresStore } from "@langchain/langgraph-checkpoint-postgres/store";
```

`1.0.5` 提供 `./store` subpath；官方實作繼承 `BaseStore`，包含 CRUD、search、TTL manager 與 migration/setup 能力。參考：LangGraph 原始碼 [`libs/checkpoint-postgres/src/store/index.ts`](https://github.com/langchain-ai/langgraphjs/blob/main/libs/checkpoint-postgres/src/store/index.ts) 與官方 [Memory 文件](https://docs.langchain.com/oss/javascript/langgraph/add-memory)。

## 連帶技術決策

升級方案確定後，下列技術決策一併凍結或委由 T0 定案：

1. **單一 checkpoint 版本**：採單一 `@langchain/langgraph-checkpoint@1.1.5`，避免雙版本型別與 runtime 不一致。T0 驗證無雙版本。
2. **CAS 原子性**：`MemoryStorePort.putIfRevision`（compare-and-swap）契約不變；機制優先採 adapter 原生 conditional put，否則以單一寫入 transaction（row lock／`WHERE revision = expected`）補足。T0 確認並記錄可行方案。
3. **TTL／expiry**：優先採 `PostgresStore` 原生 TTL/expiry 做實體清理；Governance 層仍於 recall 過濾 expired/deleted（defense-in-depth，不注入 Context）。
4. **setup／migration 部署責任**：記憶資料走 `PostgresStore` 自身表，**不新增 project migration**；由 `PostgresStore.setup()` 建表。T0 對同一 database/schema 連續執行 `setup()` 至少兩次；「重複執行安全」的成功標準為：(a) 每次均成功且無未處理錯誤；(b) 第一次 setup 後寫入的 sentinel record 在再次 setup 後仍可讀且內容不變；(c) 第二次執行後的 Store schema object 集合與 migration/version 狀態和第一次完成後相同（忽略非語意 timestamp），不產生重複 table/index；(d) 不執行 `DROP`、`TRUNCATE` 或 destructive rebuild。任一條件不滿足即為 T0 失敗並回報 ADR。通過後再依實測結果定案部署方式（啟動時／獨立 migration job／部署命令）。
5. **T0 環境**：以 Docker Compose 起真實 PostgreSQL（deterministic、可重現）；Docker daemon 需啟動。既有本機 PostgreSQL 或 CI service 為備援。
6. **升級相容性驗證範圍**：既有 LangGraph graph compile、streaming、checkpoint/resume、tool calling 全量回歸。

## 不重新決定的架構原則

下列原則未被 T0 推翻，維持不變：

- `MemoryStorePort` 封裝底層 Store。
- X8.7 `authorize()` 是讀寫刪除的唯一授權來源。
- namespace 不是安全邊界。
- 自動 recall、政策式寫入。
- Memory 以 P3 注入 context。
- current-turn explicit intent 永遠優先。
- 不提供 planner-controlled `read_memory`／`write_memory` Tool。
- 不保存 raw prompt、整段對話、credential 或未遮蔽 PII。

## 新的 hard gate

原「T0 compatibility spike（0.2.74）」改為 **dependency upgrade compatibility spike**，列為 Phase 0 hard gate。T0 必須驗證並記錄：

1. dependency 安裝與單一 checkpoint 版本。
2. `PostgresStore.setup()` 建表與重複執行安全性。
3. put/get/search/delete 全 CRUD。
4. TTL/expiry 行為。
5. process restart 後持久化。
6. 跨 Thread 存取。
7. atomic CAS 的可行方案。
8. 既有 graph compile、streaming、checkpoint/resume、tool calling 全量回歸。
9. tool-calling cancellation 契約：`tool().invoke()` 對 pre-aborted signal 必須立即 settle（不 pending）；既有 weather cancellation 回歸通過。

除下方「相容性修補授權」明訂的型別／compile 層級修補，與「tool-calling cancellation runtime 斷裂的處置」明訂的版本升級／dependency patch 外，任一步不通過 → 停止並回報 ADR，不得靜默改採自建 repository 或降級至 `PostgresSaver`。

## 相容性修補授權（LangChain 1.x compatibility remediation）

候選矩陣為跨大版本升級（`@langchain/core` 0.x → 1.2.9 等）。第二次 T0（`run-2026-09-07-001` attempt 3）在 Task 0.3 的 `npm run lint` 首步即失敗：LangChain Core 1.2.9 將 `ContentBlock.type` 改為 required，使既有 `backend/src/agents/message-normalization.ts:46` 的 `FunctionCallBlock` type predicate 不再可指派（TS2677）。此屬**升級引發的既有 runtime 型別相容性斷裂**，非語意或行為契約改變。

CCR 仲裁：**明確授權 Phase 0 內、有界的 LangChain 1.x compatibility remediation**，使既有 LangGraph runtime 在升級後重新通過型別檢查與全量回歸。此修補屬 dependency upgrade spike（Task 0.3）的一部分，不視為超出 X10.1 的範圍擴張。

### 授權範圍（allowed）

1. 修正因 0.x → 1.x 升級而無法型別檢查的**既有** backend 程式碼（含 `message-normalization.ts` 的 `FunctionCallBlock` 對齊 LangChain 1.x 官方 content block 型別）。
2. 只做型別／compile 層級的最小修正，行為語意 MUST 保持不變（仍把 function-call content block 正規化為 `tool_calls`）。
3. 修補範圍限於既有 runtime（graph compile、streaming、checkpoint/resume、tool calling 與既有 test 的型別斷裂），不觸及 X7／X8.7／X8.9 契約，不觸及 `src/memory/` 新模組的既有 Tasks 語意。

### 禁止範圍（MUST NOT）

1. MUST NOT 改變既有 normalization／graph／streaming 的 runtime 行為。
2. MUST NOT 以修補為名重構無關程式、擴散 diff，或改動 X7／X8.7／X8.9 契約。
3. MUST NOT 用 type assertion（`as any`）等硬映射掩蓋型別不一致；型別對齊必須以 LangChain 1.x 官方型別或等價最小修正完成，並有對應測試證明行為不變。
4. 若斷裂屬**語意／runtime 層級**（例如某 API 被移除且需改變行為、或 checkpoint/resume 契約改變），MUST NOT 靜默修補——仍需停止並回報 ADR。

### 仍屬 hard gate 的判定

Task 0.3 的型別／compile 斷裂可於授權範圍內修補後重跑全量回歸；但下列任一仍視為 hard gate 失敗，必須停止並回報 ADR：

- 修補後 `npm run lint && npm run test && npm run build` 仍不通過。
- 出現語意／runtime 契約斷裂（非純型別），或既有 graph／checkpoint／resume／tool calling 行為回歸測試失敗且需改變行為才能通過。
- `PostgresStore` 1.0.5 的 CAS／TTL／migration／setup 語意與設計不符（不因型別修補而改變判定）。
- 發現雙 checkpoint/core 版本，或需降級至 `PostgresSaver`／自建 repository 才能通過。

## tool-calling cancellation runtime 斷裂的處置

第三次 T0（attempt 4）在 Task 0.3 全量回歸揭露 `@langchain/core@1.2.9` 的 tool-calling cancellation **runtime 契約斷裂**：`tool()` wrapper（`DynamicStructuredTool.invoke`）對「呼叫前已 abort」的 `AbortSignal` 有競態漏洞——先 `controller.abort()` 再 `tool.invoke(input, { signal })` 時，wrapper 此時才註冊 abort listener（事件已發生、收不到），callback 回傳結構化 `cancelled` 結果後 wrapper 又因 `config.signal.aborted` 誤判而跳過 resolve，Promise 永久 pending。兩個既有 weather cancellation 回歸因此 timeout。此屬**語意／runtime 契約斷裂**，不屬已核准的型別／compile remediation。

### 決策：版本優先，dependency-level patch 為有界 fallback

1. **主要方案（版本）**：候選矩陣 `@langchain/core` 自 1.2.9 升級至 **1.2.10**（截至 2026-09-09 的 latest stable；已確認無 peerDependencies 衝突，且滿足 `checkpoint-postgres@1.0.5` 的 `core ^1.1.44` peer range）。T0 以「weather cancellation 回歸通過」為顯式 hard-gate 檢查，證明 1.2.10 已修復 pre-aborted signal 的永久 pending（`invoke()` 立即 settle 且 resolve 為 wrapped 結構化 `cancelled` 結果）。
2. **fallback（dependency-level patch）**：若 1.2.10（或當下最新 stable）經 T0 驗證仍未修復該 race，CCR 正式核准**有界 dependency-level patch**（`patch-package`／npm `overrides`），僅修 `tool()` wrapper 的 pre-aborted-signal 路徑，不得擴散。

### canonical cancellation outcome（CCR 仲裁定案，取代先前「立即 reject」文字）

pre-aborted `tool().invoke()` 的 canonical outcome：**MUST settle（永不永久 pending），且 MUST resolve 為 wrapped tool function 自身的回傳值**。本專案 weather tool 對已中止訊號在 `fetchJsonWithTimeout`／`fetchWithRetry`／`waitForRetry` 內部偵測並經自身 try/catch 回傳結構化 `{ status: "error", code: "weather_cancelled" }`（非 throw `AbortError`）。因此 wrapper MUST 在 callback 完成後 resolve 該結構化結果；MUST NOT 在入口搶先 `reject(AbortError)` 攔截 wrapped function；MUST NOT 因 callback 完成後 `config.signal.aborted === true` 而跳過 settle。wrapper 對 wrapped function 的取消語意 MUST 保持透明。先前「入口立即 reject `AbortError`」文字與既有 weather structured `cancelled` 契約實測無法同時成立，已廢止。

### dependency patch 授權範圍（僅 fallback 且經本 ADR 核准）

- **allowed**：修正 `tool()` wrapper 使其在 callback 完成後必定 resolve（含結構化 `cancelled` 結果），不因 `signal.aborted` 跳過 settle；不引入入口搶先 reject。patch 以 patch 檔＋lockfile 單一來源維護。
- **MUST NOT**：改變專案 tool 取消語意、回傳結構或 structured `cancelled` 行為；在 application code 繞過 wrapper；放寬測試 timeout/assertion；降級至 `PostgresSaver` 或自建 repository；以 `as any`／硬映射掩蓋。
- **驗證**：patch 後 weather cancellation 回歸通過（pre-aborted invoke 仍 resolve 為 `weather_cancelled`，不 reject、不 pending），且新增最小 pre-aborted invoke 立即 settle（resolve structured `cancelled`）的回歸測試。

### 仍屬 hard gate 的判定（新增）

- 升級（1.2.10 或更新）或 dependency patch 後，weather cancellation 回歸仍不通過 → 停止並回報 ADR。
- 修補改變既有 tool 取消語意、或需 application-level workaround／放寬測試才能通過 → 停止並回報 ADR。

## 風險與回滾

| 風險 | 緩解 |
| --- | --- |
| 大版本升級（0.x → 1.x）破壞既有 graph／checkpoint／resume／tool calling | T0 全量回歸為 hard gate；不通過即停止 |
| `PostgresStore` 1.0.5 的 CAS／TTL／migration 語意與設計不符 | T0 逐項驗證；不符則回報 ADR，不得靜默降級 |
| 雙 checkpoint／core 版本造成型別與 runtime 不一致 | 單一 checkpoint 版本 + lockfile 鎖版 |
| 升級範圍超出 X10.1（影響全 backend LangGraph runtime） | 升級本身屬 T0 hard gate，通過後才進行 Phases 1-8；回滾為還原 package.json/lockfile |
| `@langchain/core` `tool()` 對 pre-aborted signal 永久 pending（cancellation runtime 斷裂） | 候選矩陣 core 升級至 1.2.10，weather cancellation 回歸為 hard-gate 檢查；未修復則採本 ADR 核准的 dependency-level patch fallback，不得 application workaround 或放寬測試 |

回滾：升級僅涉及 `backend/package.json` 與 lockfile；還原即可回退至 0.2.74。X10.1 新增的 `backend/src/memory/` 為全新模組，刪除即可回滾，不新增 project migration、無既有資料遷移。
