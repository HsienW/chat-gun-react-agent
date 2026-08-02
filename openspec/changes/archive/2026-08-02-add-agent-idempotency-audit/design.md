# Design：add-agent-idempotency-audit

## 架構分層

```text
backend/src/runtime/
├── types.ts              (X1 - 既有，不修改)
├── state-machine.ts      (X1 - 既有，不修改)
├── events.ts             (X1 - 既有，不修改)
├── persistence/          (X1 - 既有，不修改)
│   ├── migrations/
│   │   ├── 001-003       (X1 - 既有)
│   │   ├── 004_create_idempotency_records.sql  (X3 - 新增)
│   │   └── 005_create_audit_events.sql        (X3 - 新增)
│   └── ...
├── retry/                (X2 - 既有，不修改)
├── idempotency/          (X3 - 新增)
│   ├── idempotency-key.ts      型別定義（純型別模組）
│   ├── idempotency-guard.ts    鎖定/解鎖邏輯（依賴 DB）
│   └── index.ts                barrel export
└── audit/                (X3 - 新增)
    ├── audit-events.ts         AuditEvent 型別 + 工廠函式
    ├── pg-audit-logger.ts      AuditLogger 實作（PG 寫入）
    ├── redaction.ts            Redaction 規則引擎
    └── index.ts                barrel export

backend/src/platform/
├── observability.ts      (修改：支援 PgAuditLogger，向後相容)
└── tool-governance.ts    (不修改，透過 auditLogger interface 自動獲得持久化)
```

## 模組責任

| 模組 | 責任 | 副作用 |
|------|------|--------|
| `idempotency-key.ts` | 定義 `IdempotencyKey`、`IdempotencyRecord`、`IdempotencyStatus` 型別 | 無 |
| `idempotency-guard.ts` | `acquire` / `release` / `getRecord`，DB unique constraint + TTL | 有（DB 讀寫） |
| `audit-events.ts` | 定義 `AuditEvent` 型別、`AuditAction`、`AuditDecision`、工廠函式 | 無 |
| `pg-audit-logger.ts` | 實作 `AuditLogger` interface，寫入 PostgreSQL `audit_events` | 有（DB 寫入） |
| `redaction.ts` | `redact(payload)` 純函式，白名單過濾敏感欄位 | 無 |

## 資料模型

### Idempotency Key

```typescript
interface IdempotencyKey {
  namespace: string;    // "task" | "tool_execution" — MUST NOT contain ':'
  resourceKey: string;  // composite key: caller-defined — MUST NOT contain '::'
  version: string;      // policy version — prevents cross-version replay — MUST be non-empty
}
```

序列化格式：`{namespace}:{resourceKey}:v{version}`（使用 `:` 分隔）

```typescript
function serializeKey(key: IdempotencyKey): string;
// 驗證規則：
// - namespace MUST NOT contain ':'
// - resourceKey MUST NOT contain '::'（連續分隔符；單一 ':' 是合法的，為 caller 的 composite key 分隔符）
// - namespace、resourceKey、version MUST be non-empty strings
// - 驗證失敗擲出 Error
```

Composite key 格式（caller 自行組合 `resourceKey`）：

```text
{taskId}:{stepId}:{toolName}:{attempt}
```

範例：`task-abc:step-1:current_weather:1`

### Idempotency Record

```typescript
type IdempotencyStatus = "locked" | "completed" | "failed";

interface IdempotencyRecord {
  key: string;           // serialized IdempotencyKey
  status: IdempotencyStatus;
  result?: unknown;      // stored when completed
  createdAt: string;
  expiresAt: string;     // TTL auto-cleanup
}
```

### Idempotency Guard

```typescript
interface IdempotencyGuard {
  acquire(key: IdempotencyKey, ttlMs: number): Promise<AcquireResult>;
  markCompleted(key: IdempotencyKey, result?: unknown): Promise<void>;
  markFailed(key: IdempotencyKey): Promise<void>;
  getRecord(key: IdempotencyKey): Promise<IdempotencyRecord | null>;
}

type AcquireResult =
  | { acquired: true; record: IdempotencyRecord }
  | { acquired: false; existing: IdempotencyRecord; reason: "already_locked" | "already_completed" | "already_failed" };
```

### PostgreSQL Table：`idempotency_records`

```sql
CREATE TABLE IF NOT EXISTS idempotency_records (
  key TEXT PRIMARY KEY,
  namespace TEXT NOT NULL,
  resource_key TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'locked',
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_idempotency_expires ON idempotency_records(expires_at);
```

Acquire 邏輯使用兩步驟確保並發安全：

**Step 1**：嘗試插入（含 TTL）

```sql
INSERT INTO idempotency_records (key, namespace, resource_key, version, status, expires_at)
VALUES ($1, $2, $3, $4, 'locked', NOW() + interval '1 millisecond' * $5)
ON CONFLICT (key) DO NOTHING
RETURNING key, namespace, resource_key, version, status, result, created_at, expires_at;
```

**Step 2**：若 INSERT 沒有回傳 row（record 已存在），查詢現有 record 並判斷是否 reclaim：

```sql
-- 只查詢 key，不鎖定 — caller 根據結果在 application layer 決定行為
SELECT key, namespace, resource_key, version, status, result, created_at, expires_at
FROM idempotency_records
WHERE key = $1;
```

Application layer 邏輯：
1. INSERT 回傳 row → `acquired = true`（全新 record）
2. INSERT 無 row，SELECT 回傳現有 record：
   - 若 `expires_at < NOW()` → 該 record 已過期，DELETE 後重試 INSERT → `acquired = true`
   - 若 `status = 'locked'` 且 `expires_at >= NOW()` → `acquired = false, reason = "already_locked"`
   - 若 `status = 'completed'` → `acquired = false, reason = "already_completed"`, `existing.result` 可用
   - 若 `status = 'failed'` → `acquired = false, reason = "already_failed"`

> **設計決策**：使用兩步驟（INSERT ... ON CONFLICT DO NOTHING + SELECT）而非單一步驟的 ON CONFLICT DO UPDATE。
> - **並發安全**：`INSERT ... ON CONFLICT DO NOTHING` 保證只有第一個 process 成功插入。第二個 process 的 INSERT 回傳 0 rows，再透過 SELECT 發現 record 存在，正確回傳 `already_locked`。
> - **Expired reclaim**：由 application layer 檢查 `expires_at < NOW()`，若過期則先 DELETE 再重試 INSERT。DELETE 可能有並發競爭，但最壞情況只是重試失敗（另一個 process 已 reclaim），不會有兩個 holder。
> - **為什麼不用 ON CONFLICT DO UPDATE**：`ON CONFLICT DO UPDATE ... RETURNING` 即使加上 WHERE 條件，當 WHERE 不匹配時仍會 RETURNING 原有的 row，導致第二個 process 看到 `status = 'locked'` 而誤判為取得 lock。

### Audit Event

```typescript
interface AuditEvent {
  eventId: string;
  taskId?: string;
  stepId?: string;
  toolExecutionId?: string;
  actorType: "system" | "user" | "agent";
  actorId: string;
  action: string;          // e.g. "tool.invoke.start", "step.transition", "idempotency.acquire"
  resourceType: string;    // e.g. "tool", "step", "task", "idempotency"
  resourceId: string;      // e.g. toolName, stepId, taskId
  decision: "allow" | "deny" | "pending_confirmation" | "neutral";
  reasonCode?: string;
  payload?: unknown;       // redacted
  beforeStateRef?: string;
  afterStateRef?: string;
  createdAt: string;
}
```

### PostgreSQL Table：`audit_events`

```sql
CREATE TABLE IF NOT EXISTS audit_events (
  event_id TEXT PRIMARY KEY,
  task_id TEXT,
  step_id TEXT,
  tool_execution_id TEXT,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  decision TEXT NOT NULL,
  reason_code TEXT,
  payload JSONB,
  before_state_ref TEXT,
  after_state_ref TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_events_task_id ON audit_events(task_id);
CREATE INDEX idx_audit_events_action ON audit_events(action);
CREATE INDEX idx_audit_events_created_at ON audit_events(created_at);
CREATE INDEX idx_audit_events_resource ON audit_events(resource_type, resource_id);
```

## Redaction 規則

Redaction 是純函式，在 `PgAuditLogger.record()` 寫入前自動呼叫：

```typescript
function redact(payload: unknown, rules: RedactionRule[]): unknown;
```

### 白名單欄位（允許通過）

| 欄位路徑 | 說明 |
|----------|------|
| `*.toolName` | Tool 名稱 |
| `*.durationMs` | 執行時間 |
| `*.inputChars` | 輸入字元數 |
| `*.outputChars` | 輸出字元數 |
| `*.statusCode` | HTTP status code |
| `*.errorCode` | 錯誤代碼（不含 message） |
| `*.attemptCount` | 重試次數 |
| `*.candidateCount` | 候選數量 |
| `*.strategy` | 策略名稱 |
| `*.provider` | Provider 名稱 |
| `*.resultStatus` | 結果狀態 |
| `*.reason` | 結構化原因代碼 |
| `*.reasonCode` | 結構化原因代碼 |
| `*.stepId` / `*.stepName` / `*.taskId` / `*.taskType` | Runtime identifiers |

### 黑名單欄位（強制移除）

| 欄位路徑 | 說明 |
|----------|------|
| `*.apiKey` / `*.api_key` / `*.token` / `*.secret` | 憑證 |
| `*.prompt` / `*.fullPrompt` | Prompt 內容 |
| `*.conversation` / `*.messages` | 對話內容 |
| `*.raw` | 原始未處理輸入（長度 > 80 時已由既有 `recordWeatherAuditEvent` truncate） |
| `*.input` / `*.output` | Tool 實際輸入輸出（非結構化摘要） |
| `*.password` / `*.credential` | 明確認證 |
| `*.pii` / `*.email` / `*.phone` | PII |

> **設計決策**：Redaction 使用白名單 + 黑名單雙層檢查。先檢查是否匹配黑名單（強制移除），再檢查白名單（允許通過）。不在白名單也不在黑名單的欄位，保留但 truncate 至 256 chars。

## `PgAuditLogger` 與既有 `AuditLogger` Interface

既有的 `AuditLogger` interface：

```typescript
interface AuditLogger {
  record(eventName: string, payload: AuditPayload): Promise<void>;
}
```

`PgAuditLogger` 實作此 interface，並在 `record()` 內部：

1. 呼叫 `redact(payload)` 過濾敏感欄位
2. 建立 `AuditEvent`（自動填入 `eventId`、`action`、`createdAt`）
3. 從 `eventName` 與 `payload` 推斷 `resourceType` 與 `resourceId`（見下表）
4. 寫入 PostgreSQL `audit_events` table（fire-and-forget，失敗不拋出）

### resourceType / resourceId 推斷規則

| eventName 模式 | resourceType | resourceId | 備註 |
|---------------|-------------|------------|------|
| `tool.*` | `"tool"` | `payload.toolName` | Tool Governance audit events |
| `step.*` | `"step"` | `payload.stepId` | Step transition audit |
| `task.*` | `"task"` | `payload.taskId` | Task lifecycle audit |
| `idempotency.*` | `"idempotency"` | `payload.key` | Idempotency guard events |
| 其他（無匹配） | `"unknown"` | `eventName` | Generic fallback |
| caller 顯式傳入 `resourceType` + `resourceId` | `payload.resourceType` | `payload.resourceId` | 優先使用 caller 指定值（若 payload 包含這些欄位） |

> **設計決策**：推斷規則以 `eventName` 前綴為主要判斷。若 caller 在 `payload` 中顯式提供 `resourceType` 與 `resourceId`，則優先使用（caller override）。推斷後從 `payload` 內移除這些 meta 欄位（不與業務資料混淆），但保留在 `reasonCode` 等欄位中（若有）。

### 向後相容策略

```typescript
// observability.ts 修改：
// 既有的 ConsoleAuditLogger 保留
// 新增 CompositeAuditLogger（同時寫入 console + PG）
// 或依環境變數 AUDIT_BACKEND=pg 切換

let auditLogger: AuditLogger;

switch (getEnv("AUDIT_BACKEND", "console")) {
  case "pg":
    auditLogger = new PgAuditLogger(getPool());
    break;
  case "composite":
    auditLogger = new CompositeAuditLogger([
      new ConsoleAuditLogger(),
      new PgAuditLogger(getPool()),
    ]);
    break;
  default:
    auditLogger = new ConsoleAuditLogger();
}
```

> **CompositeAuditLogger 錯誤隔離**：`CompositeAuditLogger` 內每個 backend 的 `record()` 呼叫 MUST 以獨立 `try/catch` 包裹。任一 backend 失敗（擲出錯誤）時 MUST 記錄 warning log 並繼續呼叫下一個 backend，MUST NOT 向上傳播錯誤。此行為 MUST 在實作層級（非僅依賴 spec scenario）強制執行。

## Idempotency Guard 與 Retry Executor 整合

X2 Retry Executor 在每次 operation 呼叫前，由 caller 選擇性地先呼叫 Idempotency Guard：

```text
Caller (Agent Graph Node)
  → acquireIdempotencyLock(key, ttlMs)
    → acquired → 執行 operation()
    → already_completed → 直接回傳 cached result（不重複執行）
    → already_locked → 等待或 fail（由 caller 決定）
  → operation() 成功 → markCompleted(key, result)
  → operation() 失敗 → markFailed(key)
```

> **設計決策**：Idempotency Guard 不內建在 Retry Executor 中，而是由 caller（Agent Graph Node）在呼叫 `executeWithRetry` 之前先進行 idempotency check。這樣保持了 Retry Executor 的單一責任（retry loop），也讓 Idempotency 可以在 retry 之外的場景（如 resume）中獨立使用。

## 與既有系統的互動

```text
Agent Graph Node (caller)
  → 建立 IdempotencyKey
  → IdempotencyGuard.acquire(key, 60_000)
  → (acquired) executeWithRetry(operation, config)
      ← Retry Executor 內每次 attempt 使用相同的 key（caller 傳入）
  → (success) IdempotencyGuard.markCompleted(key, result)
  → (failure) IdempotencyGuard.markFailed(key)
  → Audit: PgAuditLogger.record("idempotency.acquire", { ... })
```

## BFF Idempotency Key Propagation

BFF 不需要產生 idempotency key，只需 pass-through：

1. Frontend 在 request header 中傳入 `x-idempotency-key`（可選）
2. BFF `copyRequestHeaders` 將其轉發至 backend（加入 `FORWARDED_REQUEST_HEADERS`）
3. Backend agent graph node 讀取 header，組合成 `IdempotencyKey`

> **設計決策**：BFF 變更僅限於將 `x-idempotency-key` 加入轉發 header set。不涉及任何邏輯修改。

## 替代方案

| 方案 | 評估 |
|------|------|
| **使用 Redis 作為 Idempotency 後端** | ❌ 增加依賴；X5 Distributed Lock 本就使用 Redis，但 idempotency 需要持久性 > 速度 |
| **在 Retry Executor 內建 Idempotency** | ❌ 混淆責任；Retry Executor 只管 retry loop，idempotency 在更上層 |
| **Redaction 使用 regex** | ❌ 不可靠；結構化路徑檢查更精確且可測試 |
| **Audit 使用 MongoDB / Elasticsearch** | ❌ 過度設計；PG JSONB 足夠，且與既有 persistence 一致 |
