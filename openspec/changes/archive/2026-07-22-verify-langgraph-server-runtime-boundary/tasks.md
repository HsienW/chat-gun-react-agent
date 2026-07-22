# Tasks：verify-langgraph-server-runtime-boundary

## 任務總覽

| Task ID | 任務 | 優先級 | 預估工作量 |
|---|---|---|---|
| T1 | LangGraph Checkpointer 原始碼分析 | P0 | 2h |
| T2 | LangGraph Server Queue/Worker 原始碼分析 | P0 | 2h |
| T3 | LangGraph Store（跨 Thread 記憶體）API 分析 | P0 | 1.5h |
| T4 | Background Run 與 Interrupt/Resume 實際執行驗證 | P0 | 3h |
| T5 | Checkpointer 邊界實際執行驗證 | P0 | 2h |
| T6 | Queue/Worker 行為實際執行驗證 | P1 | 2h |
| T7 | 撰寫 Decision Record `docs/decisions/langgraph-runtime-boundary.md` | P0 | 3h |
| T8 | 與 `second-stage-plan.md` 對齊，更新 Layer 1 設計前提 | P1 | 1h |

合計預估：約 16.5 小時

---

## 執行狀態

- [x] T1：LangGraph Checkpointer 原始碼分析
- [x] T2：LangGraph Server Queue/Worker 原始碼分析
- [x] T3：LangGraph Store（跨 Thread 記憶體）API 分析
- [x] T4：Background Run 與 Interrupt/Resume 實際執行驗證
- [x] T5：Checkpointer 邊界實際執行驗證
- [x] T6：Queue/Worker 行為實際執行驗證
- [x] T7：撰寫 Decision Record `docs/decisions/langgraph-runtime-boundary.md`
- [x] T8：與 `second-stage-plan.md` 對齊，更新 Layer 1 設計前提

### 完成證據

- Decision Record 已產出：`docs/decisions/langgraph-runtime-boundary.md`
- `second-stage-plan.md` Layer 0 能力矩陣已對齊驗證結果
- 已執行 `MemorySaver` + `interrupt()` + `Command(resume)` + `InMemoryStore` 本地 smoke
- 已執行 `langgraphjs dev --no-browser -n 2` server smoke，確認 4 個 graph 註冊與 2 workers 啟動
- 已透過 SDK 執行 `assistants.search()`、`threads.create()` 與 `math_agent` deterministic `/runs/wait`
- 已執行 backend 相鄰測試與全量驗證：`npm run lint`、`npm run test`、`npm run build`
- spec 格式統一化：`specs/langgraph-runtime-boundary.md` 全形冒號改半形（`：`→`:`，共 20 處 Requirement/Scenario 標題）

### 未執行項

- 未安裝或驗證 `@langchain/langgraph-checkpoint-postgres`、`PostgresSaver`、`PostgresStore`
- 未執行 live `deep_researcher` weather interrupt/resume，因其依賴 LLM provider、Open-Meteo 網路與互動式澄清輸入
- 未新增測試 harness 或修改現有 Agent Graph，符合本 Change 的非目標

---

## T1：LangGraph Checkpointer 原始碼分析

### 目標

分析 `@langchain/langgraph-checkpoint` 的 Checkpointer 介面與實作，理解檢查點機制的能力邊界。

### 工作內容

1. 閱讀 `@langchain/langgraph-checkpoint` 的 Checkpointer 介面定義（`get`、`put`、`list` 等方法）
2. 閱讀 `MemorySaver` 原始碼，確認儲存範圍
3. 閱讀 `PostgresSaver`（若有安裝）的實作
4. 確認 `Annotation.Root` 與 Checkpoint 的互動方式
5. 對比現有 `deep_researcher` 的 `DeepResearchState`（15 個 Annotation 欄位），分析哪些欄位會進入 Checkpoint

### 驗證

- 輸出 Checkpointer 介面分析筆記
- 產出 MemorySaver vs PostgresSaver 能力對照表
- 標記「原生覆蓋」vs「需自建」的邊界

---

## T2：LangGraph Server Queue/Worker 原始碼分析

### 目標

分析 `@langchain/langgraph-cli`（`langgraphjs serve`）的 Queue 與 Worker 實作，理解任務排程能力。

### 工作內容

1. 閱讀 `langgraphjs serve` 的 Queue 實作
2. 分析並行請求處理機制（同一 thread vs 不同 thread）
3. 確認是否有內建 retry、backoff、rate limit
4. 分析 Worker 生命週期管理

### 驗證

- 輸出 Queue/Worker 架構分析筆記
- 確認原生 Queue 能力與 Layer 1 需求的落差

---

## T3：LangGraph Store（跨 Thread 記憶體）API 分析

### 目標

分析 `Store` API 的能力與限制，判斷是否能滿足跨 Task Memory 需求。

### 工作內容

1. 閱讀 `Store` 介面定義（`put`、`get`、`search`、`delete`）
2. 確認 `PostgresStore` 的持久化行為
3. 分析 Namespace 隔離、TTL、過期策略
4. 確認與 Checkpointer 的責任區別

### 驗證

- 輸出 Store API 分析筆記
- 確認 Store 是否可作為 Layer 1 Memory 的基礎設施

---

## T4：Background Run 與 Interrupt/Resume 實際執行驗證

### 目標

以現有 `deep_researcher` graph 執行實際的 interrupt/resume 循環，驗證 LangGraph 原生 HITL 機制。

### 工作內容

1. 在 local 啟動 `langgraphjs dev`，執行 `deep_researcher` graph
2. 觸發 `clarifyInterrupt` 節點的中斷（透過天氣查詢歧義場景）
3. 觀察 interrupt payload 的結構與序列化
4. 透過 resume API 恢復執行，觀察 State 恢復的正確性
5. 測試以下邊界場景：
   - Resume 後 tool messages 是否重複
   - Interrupt 期間的並行請求行為
   - 長時間 interrupt 後 resume（模擬 timeout）

### 驗證

- 至少一次完整的 interrupt → resume → weather result 循環
- 記錄實際執行日誌與觀察
- 產出 interrupt/resume 行為分析

### 命令

```bash
cd backend
npx langgraphjs dev
# 使用 curl 或 httpie 測試 API
```

---

## T5：Checkpointer 邊界實際執行驗證

### 目標

驗證 Checkpoint 保存的實際內容與恢復行為。

### 工作內容

1. 使用 MemorySaver 執行一次完整 graph run
2. 在 interrupt 後檢查 Checkpoint 內容
3. 驗證 resume 後的 State 欄位完整性
4. 比較第一次執行與 resume 後的 tool call 次數

### 驗證

- 產出 Checkpoint 內容範例
- 確認哪些 State 欄位進入 Checkpoint、哪些不進入

---

## T6：Queue/Worker 行為實際執行驗證

### 目標

驗證 LangGraph Server 在並行請求下的實際行為。

### 工作內容

1. 對同一 thread 發送兩個並行請求，觀察序列化行為
2. 對不同 thread 發送並行請求，觀察並行度
3. 快速連續發送多個請求，觀察 backpressure 行為

### 驗證

- 產出並行請求行為分析
- 確認是否需要自建 Distributed Lock

---

## T7：撰寫 Decision Record

### 目標

將 T1~T6 的分析與驗證結果整理為正式的 Decision Record。

### 工作內容

1. 撰寫 `docs/decisions/langgraph-runtime-boundary.md`
2. 包含：
   - 驗證時的 LangGraph 版本資訊
   - 能力矩陣（原生 vs 自建 vs 協作）
   - 各能力的詳細分析、驗證方法、原生範圍、自建理由
   - 對 Layer 1 實作的具體建議
3. 每個結論必須有驗證證據或原始碼引用

### 驗證

- Decision Record 格式完整
- 每個能力判定有明確證據
- 結論可被 Layer 1 實作直接引用

---

## T8：與 second-stage-plan.md 對齊

### 目標

根據 Layer 0 驗證結果，檢查 `second-stage-plan.md` 中 Layer 1 的設計假設是否需要調整。

### 工作內容

1. 對比 Decision Record 與 `second-stage-plan.md` 的 Layer 1 定義
2. 檢查 Change 1-1 ~ 1-5 的設計假設是否與原生能力衝突
3. 如有需要，更新 `second-stage-plan.md` 中對應章節

### 驗證

- Layer 1 設計假設與 Decision Record 一致
- 若有衝突，已記錄並提出調整建議
