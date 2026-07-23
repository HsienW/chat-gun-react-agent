# Spec：LangGraph Runtime Boundary Verification

## ADDED Requirements

### Requirement: LangGraph Checkpointer 邊界驗證

Coordinator SHALL 透過原始碼分析與實際執行驗證，確認 LangGraph Checkpointer 的覆蓋範圍與限制。

#### Scenario: Checkpointer 儲存範圍確認

GIVEN `deep_researcher` graph 使用 `MemorySaver` 作為 Checkpointer
WHEN 執行一次完整的 graph run（含 interrupt 與 resume）
THEN Coordinator SHALL 記錄以下內容：
- 哪些 State 欄位進入 Checkpoint
- 哪些 State 欄位不進入 Checkpoint（如 reducer-only 的中間狀態）
- Checkpoint 在 interrupt 後的正確性
AND 產出 MemorySaver 與 PostgresSaver 的能力對照表

#### Scenario: Checkpoint 恢復正確性

GIVEN graph 在 `clarifyInterrupt` 節點中斷
WHEN 透過 resume API 恢復執行
THEN 所有 State 欄位 SHALL 正確恢復
AND tool messages SHALL NOT 重複
AND 前置副作用（如天氣查詢）SHALL NOT 重複執行

#### Scenario: Checkpointer 不覆蓋的範圍

GIVEN 一個完整的 Checkpoint
WHEN 分析 Checkpoint 內容
THEN Coordinator SHALL 明確標記以下不在 Checkpointer 範圍內的能力：
- Tool 執行的冪等性（Checkpointer 只管 State，不管副作用）
- 業務 Task/Step 狀態（LangGraph 只管 Graph State，不管業務語義）
- Audit 事件（Checkpointer 不記錄操作歷史）
- Cost / Token 使用量（Checkpointer 不追蹤成本）
- 並行控制（Checkpointer 不做 Distributed Lock）

---

### Requirement: LangGraph Server Queue/Worker 邊界驗證

Coordinator SHALL 驗證 LangGraph Server 自帶的 Queue 與 Worker 能力邊界。

#### Scenario: 同一 Thread 的請求序列化

GIVEN 一個 LangGraph Server 實例
WHEN 對同一 `threadId` 發送兩個並行請求
THEN Server SHALL 序列化執行（不允許並行修改同一 Thread State）
AND Coordinator SHALL 記錄序列化機制的實作方式

#### Scenario: 不同 Thread 的請求並行

GIVEN 一個 LangGraph Server 實例
WHEN 對不同 `threadId` 發送並行請求
THEN Server SHALL 允許並行執行
AND Coordinator SHALL 記錄最大並行度與 Worker Pool 行為

#### Scenario: 原生 Queue 的 Retry 機制

GIVEN 一個 LangGraph Server 實例
WHEN 分析 Queue 與 Worker 的 Retry 行為
THEN Coordinator SHALL 確認：
- 原生是否支援 node-level retry
- 原生 retry 的策略（次數、退避、可配置性）
- 原生 retry 無法覆蓋的場景（如 Tool 層級 retry、跨 Step retry）

---

### Requirement: LangGraph Store 邊界驗證

Coordinator SHALL 驗證 LangGraph Store（跨 Thread 持久化記憶體）API 的能力與限制。

#### Scenario: Store 基本操作

GIVEN 一個已配置的 Store（PostgresStore 或 InMemoryStore）
WHEN 執行 `put`、`get`、`search`、`delete` 操作
THEN Coordinator SHALL 記錄：
- Namespace 隔離機制
- TTL / 過期策略
- 與 Checkpointer 的責任區別

#### Scenario: Store 作為跨 Task Memory

GIVEN 兩個不同 Thread 的 Agent 執行
WHEN Thread A 寫入 Store，Thread B 讀取 Store
THEN Coordinator SHALL 確認跨 Thread 資料共享的可行性
AND 記錄 Store 是否可作為 Layer 1 Memory 的基礎設施

---

### Requirement: HITL Interrupt/Resume 驗證

Coordinator SHALL 以實際執行驗證 LangGraph HITL interrupt/resume 機制的完整性。

#### Scenario: 完整的 Interrupt/Resume 循環

GIVEN `deep_researcher` graph 在 `clarifyInterrupt` 節點中斷
WHEN 使用者提供澄清輸入後 resume
THEN graph SHALL 成功完成天氣查詢
AND Coordinator SHALL 記錄：
- Interrupt payload 結構
- Resume 後的 State 恢復
- 天氣 Tool 的執行次數（不重複）

#### Scenario: Interrupt Timeout 行為

GIVEN graph 在 interrupt 狀態
WHEN 超過 `weatherClarificationTimeoutMs` 時間未 resume
THEN graph SHALL 正確進入 timeout 處理
AND Coordinator SHALL 驗證 timeout 後的補償行為

#### Scenario: Interrupt 期間的並行請求

GIVEN graph 在 interrupt 狀態
WHEN 對同一 Thread 發送另一個請求
THEN Coordinator SHALL 記錄 Server 的行為（拒絕 / 排隊 / 並行）

---

### Requirement: Decision Record 產出

Coordinator SHALL 將所有驗證結果整理為單一 Decision Record 文件。

#### Scenario: Decision Record 完整性

GIVEN T1~T6 的所有驗證結果
WHEN 撰寫 `docs/decisions/langgraph-runtime-boundary.md`
THEN 文件 SHALL 包含：
- 驗證時的 LangGraph 版本資訊
- 能力矩陣（原生 vs 自建 vs 協作）
- 每個能力的詳細分析、驗證方法、原生範圍、自建理由
- 對 Layer 1 實作的具體建議
AND 每個結論 SHALL 有驗證證據或原始碼引用

#### Scenario: 能力矩陣格式

GIVEN 能力矩陣
WHEN 輸出 Decision Record
THEN 矩陣 SHALL 至少包含以下能力維度：
- Graph State 持久化
- HITL interrupt/resume
- 業務 Task/Step 狀態
- Task Queue
- Retry（Step-level / Tool-level）
- Tool Idempotency
- Audit
- Distributed Lock
- 跨 Task Memory
- Cost Tracking
AND 每個維度 SHALL 標記歸屬（LangGraph 原生 / 自建 Task Runtime / 兩者協作）
AND 每個自建項目 SHALL 有明確理由

---

### Requirement: Layer 1 設計對齊

Coordinator SHALL 確保 Decision Record 與 `second-stage-plan.md` Layer 1 的設計假設一致。

#### Scenario: Layer 1 設計假設檢查

GIVEN Decision Record 完成
WHEN 對比 `second-stage-plan.md` 的 Change 1-1 ~ 1-5
THEN Coordinator SHALL：
- 檢查每個 Change 的設計前提是否與原生能力衝突
- 若原生已覆蓋某能力，SHALL 標記該 Change 可簡化或取消
- 若原生部分覆蓋但需自建，SHALL 明確分工邊界
AND 記錄任何需要更新的 `second-stage-plan.md` 章節
