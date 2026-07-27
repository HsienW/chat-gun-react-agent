# Design：add-agent-task-state-machine

## 架構分層

```text
┌─────────────────────────────────────────────┐
│  frontend                                    │
│  AgentTaskTimeline 元件                            │
│  useTaskEvents hook                          │
│  task-event-reducer.ts（前端事件 reducer）     │
├─────────────────────────────────────────────┤
│  bff                                         │
│  本次不變動（TaskEvent 透傳留待後續 Change）    │
├─────────────────────────────────────────────┤
│  backend                                     │
│  ┌───────────────────────────────────────┐   │
│  │  src/runtime/                         │   │
│  │  ├── types.ts         型別定義         │   │
│  │  ├── state-machine.ts 狀態機純函式     │   │
│  │  ├── events.ts        TaskEvent 建立   │   │
│  │  └── persistence/                     │   │
│  │      ├── connection.ts  PG 連線管理    │   │
│  │      ├── migrations/    SQL migration  │   │
│  │      ├── task-repository.ts            │   │
│  │      ├── step-repository.ts            │   │
│  │      └── event-repository.ts           │   │
│  └───────────────────────────────────────┘   │
│  ┌───────────────────────────────────────┐   │
│  │  PostgreSQL                            │   │
│  │  agent_tasks / task_steps / task_events│   │
│  └───────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
```

## 資料模型

### agent_tasks

```sql
CREATE TABLE agent_tasks (
  task_id       TEXT PRIMARY KEY,
  task_type     TEXT NOT NULL,              -- 由使用方定義（e.g. "recommendation", "weather"）
  status        TEXT NOT NULL DEFAULT 'created',
  metadata      JSONB DEFAULT '{}',         -- 使用方可附加的任意 metadata
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_tasks_status ON agent_tasks(status);
CREATE INDEX idx_agent_tasks_type ON agent_tasks(task_type);
```

### task_steps

```sql
CREATE TABLE task_steps (
  step_id       TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL REFERENCES agent_tasks(task_id) ON DELETE CASCADE,
  step_name     TEXT NOT NULL,              -- 由使用方定義（e.g. "extract_intent", "vector_search"）
  status        TEXT NOT NULL DEFAULT 'pending',
  attempt       INTEGER NOT NULL DEFAULT 1,
  max_attempts  INTEGER NOT NULL DEFAULT 1,
  input         JSONB,
  output        JSONB,
  error_code    TEXT,
  error_message TEXT,
  error_details JSONB,
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_task_steps_task_id ON task_steps(task_id);
CREATE INDEX idx_task_steps_status ON task_steps(status);
```

### task_events

```sql
CREATE TABLE task_events (
  event_id    TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES agent_tasks(task_id) ON DELETE CASCADE,
  step_id     TEXT,                          -- nullable：task-level 事件沒有 step
  event_type  TEXT NOT NULL,
  payload     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_task_events_task_id ON task_events(task_id);
CREATE INDEX idx_task_events_created_at ON task_events(created_at);
```

## 型別設計（TypeScript）

### 核心型別

```typescript
// === Task ===

type TaskStatus =
  | "created"
  | "running"
  | "waiting_confirmation"
  | "completed"
  | "partially_failed"
  | "compensating"
  | "failed"
  | "cancelled";

interface AgentTask<TStep extends string = string> {
  taskId: string;
  taskType: string;
  status: TaskStatus;
  steps: AgentStep<TStep>[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// === Step ===

type StepStatus =
  | "pending"
  | "running"
  | "waiting_confirmation"
  | "succeeded"
  | "retryable_failed"
  | "terminal_failed"
  | "compensating"
  | "compensated"
  | "skipped";

interface AgentStep<TStep extends string = string> {
  stepId: string;
  stepName: TStep;
  status: StepStatus;
  attempt: number;
  maxAttempts: number;
  input?: unknown;
  output?: unknown;
  error?: StepError;
  startedAt?: string;
  completedAt?: string;
}

interface StepError {
  code: string;
  message: string;
  details?: unknown;
}

// === Event ===

type TaskEventType =
  | "task_created"
  | "step_started"
  | "step_completed"
  | "step_failed"
  | "step_retrying"
  | "task_completed"
  | "task_failed"
  | "task_cancelled"
  | "compensation_triggered"
  | "compensation_completed"
  | "waiting_confirmation"
  | "resumed";

interface TaskEvent {
  eventId: string;
  taskId: string;
  stepId?: string;
  eventType: TaskEventType;
  payload?: unknown;
  createdAt: string;
}
```

## 狀態機設計

### Task 狀態轉移

```text
                    ┌──────────────────────────────┐
                    │                              │
                    ┌──────────────────────────────┐
                    │                              │
                    ▼                              │
created ──► running ──► waiting_confirmation ──► completed
              │  │ ▲                      │
              │  │ └──── resumed ─────────┘
              │  │
              │  ├──► failed
              │  │         （無需補償的致命失敗）
              │  │
              │  ├──► partially_failed ──► compensating ──► failed
              │  │         │
              │  │         └──► compensating ──► failed
              │  │
              │  └──► cancelled
              │
              └──► cancelled
```

合法轉移矩陣：

| from \ to | created | running | waiting | completed | partially_failed | compensating | failed | cancelled |
|-----------|---------|---------|---------|-----------|------------------|--------------|--------|-----------|
| created | - | ✅ | - | - | - | - | - | ✅ |
| running | - | - | ✅ | ✅ | ✅ | - | ✅ | ✅ |
| waiting_confirmation | - | ✅ | - | ✅ | - | - | - | ✅ |
| partially_failed | - | - | - | - | - | ✅ | - | - |
| compensating | - | - | - | - | - | - | ✅ | - |
| completed | - | - | - | - | - | - | - | - |
| failed | - | - | - | - | - | - | - | - |
| cancelled | - | - | - | - | - | - | - | - |

> **設計決策：`running → failed` 使用條件** — 當 Task 在 running 狀態遭遇致命錯誤，且沒有任何 Step 已完成（無副作用需補償）時使用此直接轉移。若已有 Step 完成，應走 `running → partially_failed → compensating → failed` 路徑以正確補償已完成步驟。

> **設計決策：`waiting_confirmation → running`（resumed）** — 當 Task 處於 waiting_confirmation 狀態，使用者回覆確認後，若系統需要繼續執行更多 Step（而非直接完成），Task 回到 running。`resumed` 事件標記此轉移。若使用者確認後 Task 無需進一步執行，直接走 `waiting_confirmation → completed`。

### Step 狀態轉移

```text
pending ──► running ──► waiting_confirmation ──► succeeded
              │    │
              │    ├──► retryable_failed ──► pending（retry）
              │    │         │
              │    │         └──► terminal_failed（超過 maxAttempts）
              │    │
              │    ├──► terminal_failed
              │    │
              │    ├──► compensating ──► compensated
              │    │
              │    └──► skipped
```

合法轉移矩陣：

| from \ to | pending | running | waiting | succeeded | retryable_failed | terminal_failed | compensating | compensated | skipped |
|-----------|---------|---------|---------|-----------|------------------|-----------------|--------------|-------------|---------|
| pending | - | ✅ | - | - | - | - | - | - | ✅ |
| running | - | - | ✅ | ✅ | ✅ | ✅ | ✅ | - | ✅ |
| waiting_confirmation | - | - | - | ✅ | - | - | - | - | - |
| retryable_failed | ✅ | - | - | - | - | ✅ | - | - | - |
| succeeded | - | - | - | - | - | - | - | - | - |
| terminal_failed | - | - | - | - | - | - | - | - | - |
| compensating | - | - | - | - | - | - | - | ✅ | - |
| compensated | - | - | - | - | - | - | - | - | - |
| skipped | - | - | - | - | - | - | - | - | - |

## 狀態機實作

```typescript
// 純函式，無副作用
function transitionTask(
  task: AgentTask,
  to: TaskStatus
): { valid: true; next: AgentTask } | { valid: false; reason: string };

function transitionStep(
  step: AgentStep,
  to: StepStatus,
  opts?: { error?: StepError }
): { valid: true; next: AgentStep } | { valid: false; reason: string };
```

- 狀態機本身不寫 DB、不發事件、不碰 LangGraph
- 非法轉移回傳 `{ valid: false, reason: "..." }`
- 不回傳新的 AgentTask/AgentStep 物件，而是回傳轉移後的複製（immutable）
- **Retry Boundary 檢查**：`transitionStep` 在 `retryable_failed → pending` 轉移時，MUST 檢查 `step.attempt < step.maxAttempts`；若 `attempt >= maxAttempts`，回傳 `{ valid: false, reason: "max attempts exceeded" }`。呼叫者應在 attempt 達上限時改走 `retryable_failed → terminal_failed`。

## Persistence 設計

### Repository 介面

```typescript
interface TaskRepository {
  create(task: AgentTask): Promise<AgentTask>;
  findById(taskId: string): Promise<AgentTask | null>;
  updateStatus(taskId: string, status: TaskStatus): Promise<AgentTask>;
  update(taskId: string, patch: Partial<AgentTask>): Promise<AgentTask>;
}

interface StepRepository {
  create(step: AgentStep): Promise<AgentStep>;
  findById(stepId: string): Promise<AgentStep | null>;
  findByTaskId(taskId: string): Promise<AgentStep[]>;
  updateStatus(stepId: string, status: StepStatus, opts?: { error?: StepError; output?: unknown }): Promise<AgentStep>;
}

interface EventRepository {
  append(event: TaskEvent): Promise<TaskEvent>;
  findByTaskId(taskId: string): Promise<TaskEvent[]>;
  streamByTaskId(taskId: string): AsyncIterable<TaskEvent>;
}
```

### Migration 策略

- 使用原始 SQL 檔案（`backend/src/runtime/persistence/migrations/`）
- `001_create_agent_tasks.sql`（up + down）
- `002_create_task_steps.sql`（up + down）
- `003_create_task_events.sql`（up + down）
- Migration runner 使用既有模式（如果有）或簡易 script

### 連線管理

- 使用 `pg` (node-postgres) 或既有的 DB 連線池
- Connection string 從環境變數讀取（`DATABASE_URL`）
- 支援 connection pool

## 前端設計

### 與既有 ActivityTimeline 的關係

`frontend/src/components/ActivityTimeline.tsx` 已存在，以 LangGraph streaming `AgentRuntimeEvent`（plan/tool/context/answer）為驅動粒度。新建的 **AgentTaskTimeline** 元件以 `TaskEvent`（業務 Step 狀態：pending/running/succeeded/failed/compensating）為驅動粒度。兩者並存不衝突：

| | ActivityTimeline（既有） | AgentTaskTimeline（新建） |
|---|---|---|
| 資料源 | `AgentRuntimeEvent`（LangGraph stream） | `TaskEvent`（Task State Machine） |
| 粒度 | Graph node 事件（plan/tool/context/answer） | 業務 Step 狀態（extract_intent、vector_search、rerank...） |
| 用途 | 顯示 LangGraph 內部執行進度 | 顯示業務 Task/Step 生命週期 |
| 依賴 | `AgentRuntimeEvent` type | `TaskEvent` type + `AgentTask` state |

### AgentTaskTimeline 元件

```text
┌──────────────────────────────────────┐
│  Agent Task: recommendation          │
│  Status: running                     │
│                                      │
│  ● extract_intent         succeeded  │
│  ● vector_search          running    │
│  ○ rerank                 pending    │
│  ○ business_policy_gate   pending    │
│  ○ build_card             pending    │
└──────────────────────────────────────┘
```

### 元件樹

```text
AgentTaskTimeline
├── TaskHeader（taskType, status, duration）
└── StepList
    └── StepItem[]（stepName, status, attempt, error, duration）
```

### 狀態驅動

- 使用 `useTaskEvents` hook 從 event stream 重建 Task/Step 狀態
- 前端維護 local TaskState，透過 reducer 處理 incoming events
- 不直接呼叫 backend API（本次 Change 中 event 先以 mock data 驅動）

### Event Reducer（前端）

```typescript
function taskEventReducer(
  state: AgentTask | null,
  event: TaskEvent
): AgentTask | null;
```

- 從 `task_created` 建立初始 AgentTask
- 從 `step_started`、`step_completed`、`step_failed` 更新對應 Step 狀態
- 從 `task_completed`、`task_failed` 更新 Task 終端狀態

## 與既有系統的關係

| 既有系統 | 關係 |
|---------|------|
| LangGraph Checkpointer | 並存，不互相取代。State Machine 管業務 Task/Step 狀態；Checkpointer 管 graph execution state |
| LangGraph Streaming Events | 並存，TaskEvent 是更高層的業務事件。將來可由 LangGraph node 內發出 TaskEvent |
| BFF Stream Proxy | 本次不變動。TaskEvent 串流透傳留待後續 Change |
| 既有 Chat UI | 不修改。Timeline 作為獨立元件，可嵌入 Chat 側邊欄 |

## 替代方案

| 方案 | 評估 |
|------|------|
| **只用 LangGraph Checkpointer，不建 Task State Machine** | ❌ Checkpointer 不懂業務語意（什麼是 Step、什麼是 retryable_failed），無法提供結構化 Task/Step 查詢與 Timeline |
| **Task State Machine 放在 BFF** | ❌ BFF 不應承擔業務狀態機（backend AGENTS.md 明確禁止 BFF 做 Agent Runtime 邏輯） |
| **使用現有 workflow engine（Temporal/Cadence）** | ❌ 引入重型依賴，超出第二階段範圍。Layer 1 先自建，後續可評估遷移 |
| **State Machine 內建 DB 寫入** | ❌ 違反純函式原則。State Machine 只做轉移驗證，DB 寫入由 Repository 層負責 |

## 資料流

```text
backend Agent Graph Node
  → 呼叫 state-machine.transitionStep(step, 'running')
  → 取得 { valid: true, next: updatedStep }
  → 呼叫 stepRepo.updateStatus(stepId, 'running')
  → 呼叫 eventRepo.append(createStepStartedEvent(...))
  → Event 寫入 task_events 表

前端
  → useTaskEvents hook（目前用 mock event stream）
  → taskEventReducer 更新 local state
  → AgentTaskTimeline 根據 state 渲染
```
