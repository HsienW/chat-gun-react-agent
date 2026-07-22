# Proposal：verify-langgraph-server-runtime-boundary

## 變更摘要

在自建 Agent Task Runtime（Layer 1：Task/Step State Machine、Retry Budget、Idempotency、Compensation、Distributed Step Lock）之前，必須先釐清 LangGraph Agent Server 自帶的 Queue、Worker、Checkpointer、Store 能力邊界，避免重造輪子。

## 問題描述

目前 `second-stage-plan.md` 定義了 Layer 1~2 的自建 Task Runtime 能力（七個薄弱點），但尚未系統性地驗證 LangGraph 原生 Runtime 已經覆蓋哪些能力、哪些是真正需要自建的。沒有這份責任邊界文件，後續實作可能：

1. 重複實作 LangGraph 已內建的能力（浪費工程資源）
2. 假設 LangGraph 會處理某個邊界場景，但實際上它不管（導致 Runtime 缺陷）
3. 無法清楚向 reviewer / stakeholder 解釋「為什麼要自建」而非沿用原生

## 解決方案

執行 Layer 0 研究型 Change：`verify-langgraph-server-runtime-boundary`

### 工作範圍

1. **LangGraph Server Background Run 驗證** — 驗證 `runs/stream` 的 background mode、interrupt/resume 行為
2. **LangGraph Checkpointer 邊界** — 確認 MemorySaver / PostgreSQL Checkpointer 覆蓋範圍（哪些狀態它管、哪些不管）
3. **LangGraph Queue/Worker** — 驗證 LangGraph Server 自帶的任務佇列與 worker 行為、並行控制
4. **LangGraph Store（Persistent Memory）** — 驗證跨 Thread 持久化記憶體 API 的能力與限制
5. **責任邊界圖** — 畫出 LangGraph 原生能力 vs 自建 Task Runtime 的責任邊界
6. **Decision Record** — 寫成一個 markdown decision record，說明哪些能力用原生、哪些自建、為什麼

### 關鍵交付物

```text
docs/decisions/langgraph-runtime-boundary.md
```

內容至少包含以下能力矩陣：

| 能力 | LangGraph 原生 | 自建 Task Runtime | 理由 |
|---|---|---|---|
| Graph State 持久化 | Checkpointer（MemorySaver / PG） | - | 原生已覆蓋 |
| HITL interrupt/resume | ✅ | - | 原生已覆蓋 |
| 業務 Task/Step 狀態 | - | ✅ 自建 | LangGraph 不管業務語義 |
| Task Queue | 內建（langgraph serve） | - | 原生已覆蓋 |
| Retry（Step-level） | 部分（node retry） | ✅ 自建 | 原生 retry 粒度不夠 |
| Tool Idempotency | - | ✅ 自建 | 原生不管副作用 |
| Audit | - | ✅ 自建 | 原生不管審計 |
| Distributed Lock | - | ✅ 自建 | 原生不管並行控制 |
| 跨 Task Memory | Store（PG） | - | 原生已覆蓋 |
| Cost Tracking | - | ✅ 自建 | 原生不管成本 |

### 目標

- 明確標記哪些自建 Task Runtime 能力是「補原生缺口」而非「重造輪子」
- 為 Layer 1 實作提供準確的責任邊界參考
- 避免後續架構審查時對自建 vs 原生的取捨產生爭議

### 非目標

- 不實作任何 Task Runtime 程式碼（那是 Layer 1 的工作）
- 不修改現有 Agent Graph（chatbot、deep_researcher、math_agent、mcp_agent）
- 不變更 LangGraph 依賴版本
- 不建立自動化測試框架（本 Change 是研究型，輸出是文件）

## 受影響範圍

### 受影響套件

- `backend`：LangGraph Runtime 驗證主體

### 不受影響套件

- `frontend`：無變更
- `bff`：無變更

### 受影響能力域

- LangGraph Runtime 能力邊界理解
- 後續 Layer 1 自建 Task Runtime 的設計決策基礎

## 風險

| 風險 | 緩解 |
|---|---|
| LangGraph 文件與實際行為不一致 | 以實際執行驗證為準，不以文件推斷 |
| 現有 MemorySaver（非 PG）無法觀察持久化行為 | 記錄 MemorySaver vs PG Checkpointer 的行為差異 |
| 原生能力隨 LangGraph 版本更新而變化 | Decision Record 標註驗證時的 LangGraph 版本 |

## 回滾策略

本 Change 僅產出文件，不修改程式碼，無需回滾。
