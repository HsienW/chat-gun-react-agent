# Design：verify-langgraph-server-runtime-boundary

## 設計目標

本 Change 是研究型任務，不涉及程式碼實作。設計重點在於定義驗證方法、實驗場景與決策記錄結構。

## 驗證方法

### 1. 原始碼分析

閱讀 LangGraph JS SDK 原始碼（`@langchain/langgraph`、`@langchain/langgraph-checkpoint`），理解以下介面與實作：

- `Checkpointer`（MemorySaver、PostgresSaver）
- `Store`（跨 Thread 記憶體）
- `StateGraph.compile()` 與 interrupt 機制
- `Command`（resume、goto）
- Node retry policy
- LangGraph Server（`langgraphjs serve`）的 Queue/Worker 行為

### 2. 實際執行驗證

使用現有的 `deep_researcher` graph 進行以下場景測試：

#### 2.1 Background Run

```bash
# 啟動 langgraph server
cd backend && npx langgraphjs dev
# 透過 API 呼叫 runs/stream，觀察 background mode 行為
```

驗證重點：
- `runs/stream` 的 `streamMode: "background"` 是否可用
- 中斷後是否能透過 `runs/<runId>/resume` 恢復
- Background run 的生命週期管理

#### 2.2 Checkpointer 邊界

驗證重點：
- MemorySaver 儲存哪些 State（全部 Annotation 欄位？還是部分？）
- Checkpoint 在 interrupt 後是否完整保存
- Resume 後 State 恢復的正確性（特別是 tool messages 是否重複）
- 現有 `deep_researcher` 使用 MemorySaver，確認其行為特徵

#### 2.3 Queue/Worker 行為

驗證重點：
- `langgraphjs serve` 啟動後的並行請求處理
- 同一 thread 的請求是否序列化排隊
- 不同 thread 的請求是否並行
- Queue 滿時的行為（是否有內建 backpressure）

#### 2.4 Store（跨 Thread 記憶體）

驗證重點：
- `Store` API 的使用方式（`put`、`get`、`search`）
- 是否支援 PostgreSQL backend
- Namespace 隔離機制
- TTL / 過期策略

### 3. 責任邊界判定準則

對每個能力維度，依以下準則判定歸屬：

1. **LangGraph 原生**：該能力在 LangGraph SDK/Server 層完整提供，無需額外程式碼即可使用
2. **自建 Task Runtime**：LangGraph 不提供、僅部分提供、或提供的粒度不滿足 Agent Task Runtime 需求
3. **兩者協作**：LangGraph 提供底層機制，自建層封裝業務語義

判定時必須記錄：
- LangGraph 版本
- 驗證方法（原始碼分析 / 實際執行）
- 原生能力的具體範圍與限制
- 自建的理由

## 輸出格式

### Decision Record 結構

```markdown
# LangGraph Runtime Boundary Decision Record

## 版本資訊
- LangGraph JS：<version>
- LangGraph Checkpoint：<version>
- 驗證日期：<date>

## 能力矩陣
（如 proposal 中定義的表格）

## 各能力詳細分析
### <能力名稱>
- **原生狀態**：<已覆蓋 / 部分覆蓋 / 未覆蓋>
- **驗證方法**：<原始碼分析 / 實際執行 / 官方文件>
- **原生能力範圍**：<具體描述>
- **原生限制**：<具體描述>
- **自建理由**：<為什麼需要自建>
- **協作方式**：<原生層與自建層如何分工>

## 結論
- 原生可覆蓋的能力（無需自建）
- 需要自建的能力（含理由摘要）
- 需要協作的能力（含分工說明）

## 對 Layer 1 的影響
- 哪些設計假設因原生能力而改變
- 哪些自建能力可簡化（因原生已覆蓋部分）
```

## 技術約束

- 不修改現有程式碼
- 使用現有 `deep_researcher` graph 作為實驗對象（已是本專案最複雜的 graph）
- 若需要 PostgreSQL Checkpointer 驗證，可使用 `@langchain/langgraph-checkpoint-postgres` 進行本地測試（不影響現有 MemorySaver 配置）
- 驗證結果必須區分「已確認事實」與「基於文件的推斷」

## 替代方案

### 方案 A：直接跳過 Layer 0，開始 Layer 1 實作（不推薦）

風險：可能在實作到一半時發現 LangGraph 已有對應能力，造成重工。

### 方案 B：每個 Layer 1 Change 各自研究原生能力（不推薦）

風險：缺乏統一的責任邊界視圖，不同 Change 可能做出不一致的判斷。

### 方案 C：執行本 Change 的 Layer 0 研究（推薦）

優勢：一次性建立完整的責任邊界圖，為整個 Layer 1~2 提供決策基礎。
