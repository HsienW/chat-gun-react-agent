# Design：add-agent-compensation-runtime

## 架構分層

```text
backend/src/runtime/
├── types.ts              (X1 - 既有，不修改)
├── state-machine.ts      (X1 - 既有，不修改)
├── events.ts             (X1 - 既有，不修改)
├── persistence/          (X1 - 既有，不修改)
├── retry/                (X2 - 既有，不修改)
├── idempotency/          (X3 - 既有，不修改)
├── audit/                (X3 - 既有，不修改)
└── compensation/         (X4 - 新增)
    ├── compensation-action.ts      型別定義（純型別模組）
    ├── compensation-registry.ts    補償動作註冊與查詢（純 Runtime）
    ├── saga-orchestrator.ts        Saga 編排邏輯（依賴 X1/X3）
    └── index.ts                    barrel export

backend/src/platform/
├── observability.ts      (X3 - 既有，不修改，透過 auditLogger interface 使用)
└── tool-governance.ts    (不修改)
```

## 模組責任

| 模組 | 責任 | 副作用 |
|------|------|--------|
| `compensation-action.ts` | 定義 `CompensationAction`、`CompensationPlan`、`CompensationResult` 型別 | 無 |
| `compensation-registry.ts` | 提供 `CompensationRegistry`：register/deregister/getActions | 無（純記憶體）。補償動作應在 application bootstrap 階段靜態註冊（不依賴 process 生命週期內的動態狀態） |
| `saga-orchestrator.ts` | SagaOrchestrator：決定補償範圍、逆序執行、處理不可逆、失敗升級、寫入 Audit/TaskEvents | 有（讀取 X1 Step 狀態、寫入 Audit/TaskEvents） |

> **設計決策**：`CompensationRegistry` 為純記憶體實作（`Map<string, CompensationAction[]>`）。補償動作應在 application bootstrap 階段由 caller 靜態註冊（例如 `registry.register("call_weather_api", weatherCompensationAction)`），而非在 Task 執行期間動態註冊。process 重啟後需重新執行靜態註冊。這避免了補償動作依賴 process 執行期狀態，也避免了持久化 Registry 的複雜性。

## 資料模型

### CompensationAction

```typescript
interface CompensationAction<TContext = unknown> {
  actionId: string;
  description: string;
  execute: (context: TContext) => Promise<CompensationActionResult>;
  isReversible: boolean;  // false = 無法自動回滾，需要人工介入
}

interface CompensationActionResult {
  status: "compensated" | "failed";
  error?: CompensationError;
}

interface CompensationError {
  message: string;
  code?: string;
  detail?: unknown;
}
```

### CompensationPlan

```typescript
interface CompensationPlan {
  taskId: string;
  failureStepId: string;         // 觸發補償的失敗 Step
  failureReason: string;         // "terminal_failed" | "user_cancelled" | "partially_failed"
  completedSteps: CompensationStepEntry[];  // 需要補償的已完成 Step（由 Orchestrator 決定）
  irreversibleSteps: string[];   // isReversible: false 的 action 所屬 stepId
}

interface CompensationStepEntry {
  stepId: string;
  stepName: string;
  actions: CompensationAction[];
}
```

### CompensationResult

```typescript
interface CompensationResult {
  taskId: string;
  totalActions: number;
  succeeded: number;
  failed: number;
  skippedIrreversible: number;
  overallStatus: "all_compensated" | "partial_failure" | "no_actions_needed";
  failures: CompensationFailureEntry[];
  skippedIrreversibleActions: SkippedIrreversibleEntry[];
}

interface CompensationFailureEntry {
  stepId: string;
  actionId: string;
  error: CompensationError;
}

interface SkippedIrreversibleEntry {
  stepId: string;
  actionId: string;
  reason: "irreversible_requires_manual_intervention";
}
```

## Saga Orchestrator 設計

### 核心流程

```text
orchestrator.compensate(taskId, opts?)
  │
  ├─ 0. 驗證 Task status 為 "partially_failed" 或 "cancelled"（X1 定義的合法前置狀態）
  │
  ├─ 1. 讀取 Task 與 Steps（透過既有 TaskRepository.findById + StepRepository.findByTaskId）
  │     └─ 決定補償範圍：
  │        - 收集所有 status = "succeeded" 的 Step
  │        - 排除失敗點 Step 本身（不補償自己）
  │        - 排除 pending/running/skipped 的 Step（從未執行）
  │
  ├─ 2. Task status 轉至 "compensating"（透過 TaskRepository.updateStatus，X1 合法 transition）
  │    寫入 compensation_triggered event（Audit + TaskEvents，使用 X1 createCompensationTriggeredEvent）
  │
  ├─ 3. 逆序迭代 completedSteps（每個 Step 先轉至 "compensating"）：
  │     │
  │     ├─ Step 從 "succeeded" 轉至 "compensating"（透過 StepRepository.updateStatus）
  │     │
  │     ├─ 查詢 CompensationRegistry.getActions(stepName)
  │     │
  │     ├─ 若無註冊 action → 跳過，Step 直接轉 "compensated"
  │     │
  │     ├─ 迭代每個 action：
  │     │   ├─ 若 isReversible === false：
  │     │   │   ├─ 記錄 compensation.action_skipped_irreversible 至 Audit
  │     │   │   └─ continue（不執行 execute()）
  │     │   │
  │     │   └─ 若 isReversible === true：
  │     │       ├─ try { action.execute(context) }
  │     │       │   ├─ 成功 → 記錄 compensation.action_succeeded 至 Audit
  │     │       │   └─ 失敗 → 記錄 compensation.action_failed 至 Audit（僅 Audit，不寫 TaskEvents）
  │     │       │        不中斷補償鏈，繼續下一個 action
  │     │       └─ catch (error) → CompensationFailureEntry
  │     │
  │     └─ Step 轉至 "compensated"（透過 StepRepository.updateStatus）
  │
  ├─ 4. 彙總 CompensationResult
  │
  └─ 5. Task status 轉至 "failed"（X1 compensating → failed 合法 transition）
        寫入 compensation_completed event（Audit + TaskEvents，使用 X1 createCompensationCompletedEvent）
```

### 並發安全

> **設計決策**：Compensation 本身不實作分散式鎖定。並發保護依賴：
> - X5 Distributed Lock（後續）：在 Step transition 時加鎖
> - X3 Idempotency：caller 可在 `CompensationAction.execute()` 內部使用 Idempotency Key 防止重複執行
> - Step 狀態在 compensation 成功後才更新為 `"compensated"`，避免 partial update 下的狀態不一致

### 與 X1 State Machine 的關係

Compensation 透過 X1 既有的 persistence repository（`TaskRepository`、`StepRepository`、`EventRepository`）讀取與寫入 Task/Step 狀態，不透過 X1 `transitionStep()`/`transitionTask()` 驗證函式。這是因為 X1 的 `STEP_TRANSITIONS` 中 `"succeeded"` 的合法目標為空 Set（terminal state），沒有直接到 `"compensating"` 的路徑。

Step 補償的狀態路徑：
```text
X1 既有 transition：
  running → compensating → compensated（合法路徑）

X4 Compensation 使用的路徑（透過直接 SQL UPDATE，不經 transitionStep()）：
  succeeded ──[StepRepository.updateStatus]──→ compensating ──[action.execute()]──→ compensated
```

Task 補償的狀態路徑（遵循 X1 既有 TASK_TRANSITIONS）：
```text
X1 既有：
  partially_failed → compensating → failed（合法路徑）

X4 Compensation 遵循此路徑（透過 TaskRepository.updateStatus）：
  partially_failed ──→ compensating ──→ failed
```

> **設計決策**：使用 `StepRepository.updateStatus()` 直接更新 Step 狀態而非經由 `transitionStep()`，因為 X1 State Machine 將 `"succeeded"` 定義為 terminal state（無 outgoing transition）。這不修改 X1 State Machine 規則，而是接受 `"succeeded"` 為 terminal 的設計——Compensation 從 persistence layer 層級覆蓋此限制，並在 Audit 中留下完整記錄。

### 與 X3 Audit 的整合

所有補償事件透過既有的 `auditLogger` 寫入：

| 事件名稱 | resourceType | 觸發時機 |
|---------|-------------|---------|
| `compensation.triggered` | `"compensation"` | 補償開始 |
| `compensation.action_succeeded` | `"compensation_action"` | 單一 action 成功 |
| `compensation.action_failed` | `"compensation_action"` | 單一 action 失敗 |
| `compensation.action_skipped_irreversible` | `"compensation_action"` | 跳過不可逆 action |
| `compensation.completed` | `"compensation"` | 補償鏈結束 |

## API 設計

### CompensationRegistry

```typescript
interface CompensationRegistry {
  register(stepName: string, action: CompensationAction): void;
  deregister(stepName: string, actionId: string): void;
  getActions(stepName: string): CompensationAction[];
  hasActions(stepName: string): boolean;
}
```

### SagaOrchestrator

```typescript
interface SagaOrchestrator {
  compensate(taskId: string, opts?: CompensateOptions): Promise<CompensationResult>;
}

interface CompensateOptions {
  reason?: "terminal_failed" | "user_cancelled" | "partially_failed";
  context?: Record<string, unknown>;  // 傳遞給每個 execute() 的額外上下文
}
```

### 建構子依賴注入

```typescript
class SagaOrchestratorImpl implements SagaOrchestrator {
  constructor(
    private registry: CompensationRegistry,
    private taskRepo: TaskRepository,          // X1 既有 TaskRepository interface
    private stepRepo: StepRepository,          // X1 既有 StepRepository interface
    private eventRepo: EventRepository,        // X1 既有 EventRepository interface
    private auditLogger: AuditLogger,          // X3 audit logger
  ) {}
}
```

> **設計決策**：`SagaOrchestratorImpl` 直接依賴 X1 既有的 `TaskRepository`、`StepRepository`、`EventRepository` interface（定義於 `backend/src/runtime/persistence/`），而非自訂 `TaskReader`/`TaskEventWriter` 抽象層。這避免了重複定義相同語意的介面，也確保與既有 persistence 實作完全相容。所有外部依賴透過建構子注入，使單元測試可以用 mock 替換所有依賴，不需要真實 DB 連線。`CompensationRegistry` 為純記憶體實作，無外部依賴。

## 替代方案

| 方案 | 評估 |
|------|------|
| **在 X1 State Machine 內建 Compensation** | ❌ 混淆責任；State Machine 只管 transition 合法性，Compensation 是獨立的執行層 |
| **每個 Step 自動推導補償動作** | ❌ 不可行；補償語意由業務決定（「發送更正通知」vs「釋放資源」），無法自動推導 |
| **使用 Event Sourcing 重播補償** | ❌ 過度設計；補償為少數情境（失敗/取消），不需要完整的 Event Sourcing |
| **補償失敗時回滾已補償的 Step** | ❌ 不可行；已補償的 side effect 本身可能不可逆（例如已發送的更正通知無法撤回） |
| **Compensation 寫入獨立 table** | ❌ 不必要的 schema 變更；既有的 `task_events` + `audit_events` 已足夠儲存補償事件 |
