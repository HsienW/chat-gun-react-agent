# Proposal：add-agent-task-state-machine

## 變更定位

純 Runtime，零業務依賴。建立通用 Agent Task/Step State Machine、事件流與 PostgreSQL Persistence，是所有後續 Runtime 能力（Retry、Idempotency、Audit、Compensation）的共用基礎。

## 問題描述

目前 backend 使用 LangGraph 原生 Checkpointer 管理 graph state，但沒有業務層級的 Task/Step 狀態模型。具體缺失：

1. **沒有 Task 生命週期追蹤** — 目前只知道 LangGraph run 是否完成，無法知道 Task 處於 created/running/waiting_confirmation/completed 哪個階段
2. **沒有 Step 層級狀態** — 無法區分單一 Step 是 pending/running/succeeded/failed/compensating
3. **沒有 Task/Step 事件流** — 前端無法即時得知 Task/Step 的狀態變化；目前靠 LangGraph streaming events 間接推斷
4. **沒有結構化持久層** — Task/Step 狀態只存在 LangGraph Checkpoint 中，無法跨 Run 查詢、分析與恢復
5. **前端缺少 Timeline 元件** — 使用者看不到 Agent 執行步驟的進度與狀態

## 解決方案

建立三層結構：

1. **型別系統** — 通用泛型 `AgentTask<TStep>`、`AgentStep<TStep>`、`TaskEvent`，不寫死任何業務 Step 名稱
2. **狀態機引擎** — 純函式 State Machine，負責驗證狀態轉移合法性
3. **PostgreSQL Persistence** — `agent_tasks`、`task_steps`、`task_events` 三張表與讀寫層
4. **前端 Timeline 元件** — 基於 TaskEvent 串流的即時進度渲染

## 目標

- ✅ 通用 Task/Step 型別系統，可被任何業務 Adapter 使用
- ✅ 完整狀態機：Task 8 狀態、Step 9 狀態、合法轉移矩陣
- ✅ PostgreSQL 持久層：三張表、migration、讀寫 repository
- ✅ TaskEvent 事件流：12 種事件類型
- ✅ 前端 Streaming Activity Timeline 元件
- ✅ 純 Runtime，不 import 任何業務常數

## 非目標

- ❌ Retry Policy（屬於 Change 1-2）
- ❌ Idempotency（屬於 Change 1-3）
- ❌ Audit（屬於 Change 1-3）
- ❌ Compensation（屬於 Change 1-4）
- ❌ Distributed Lock（屬於 Change 1-5）
- ❌ 與 LangGraph Checkpointer 整合（State Machine 是獨立層，整合留待後續 Change）
- ❌ API endpoint 暴露（BFF route 變更屬於後續 Change）

## 受影響範圍

| 套件 | 影響 |
|------|------|
| backend | 新增 `src/runtime/` 目錄：state-machine、types、events、persistence（repository + migration） |
| frontend | 新增 AgentTaskTimeline 元件、task-event 處理邏輯 |
| bff | 本次不變動（TaskEvent 先作為 backend 內部事件；BFF 透傳留待後續 Change） |

## 風險

| 風險 | 緩解 |
|------|------|
| PostgreSQL schema 設計不夠通用，導致後續 Change 需要 migration | 使用 JSONB metadata 欄位 + 明確 core columns；Step type 使用泛型 string |
| 狀態機與 LangGraph state 重疊 | 明確區分：Task State Machine 是業務層，LangGraph Checkpoint 是 graph execution 層，兩者不互相取代 |
| 前端 Timeline 元件與既有 streaming UI 衝突 | 作為獨立元件開發，不修改既有 Chat UI；透過 event 串流驅動 |

## 回滾策略

- `backend/src/runtime/` 為全新目錄，刪除即可回滾
- 前端 Timeline 元件為獨立元件，移除 import 即可回滾
- PostgreSQL migration 提供 down migration
