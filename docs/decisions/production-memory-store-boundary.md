# Production Memory Store Boundary

- 日期：2026-09-08
- Change：`add-long-term-memory-governance`（X10.1）
- 狀態：Accepted（PLAN_DRAFT；待 Qwen review-plan 覆核後方可進入 apply-change）
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
| `@langchain/core` | `^0.3.55` | **1.2.9** |
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

任一步不通過 → 停止並回報 ADR，不得靜默改採自建 repository 或降級至 `PostgresSaver`。

## 風險與回滾

| 風險 | 緩解 |
| --- | --- |
| 大版本升級（0.x → 1.x）破壞既有 graph／checkpoint／resume／tool calling | T0 全量回歸為 hard gate；不通過即停止 |
| `PostgresStore` 1.0.5 的 CAS／TTL／migration 語意與設計不符 | T0 逐項驗證；不符則回報 ADR，不得靜默降級 |
| 雙 checkpoint／core 版本造成型別與 runtime 不一致 | 單一 checkpoint 版本 + lockfile 鎖版 |
| 升級範圍超出 X10.1（影響全 backend LangGraph runtime） | 升級本身屬 T0 hard gate，通過後才進行 Phases 1-8；回滾為還原 package.json/lockfile |

回滾：升級僅涉及 `backend/package.json` 與 lockfile；還原即可回退至 0.2.74。X10.1 新增的 `backend/src/memory/` 為全新模組，刪除即可回滾，不新增 project migration、無既有資料遷移。
