# Specs：add-agent-idempotency-audit

## ADDED Requirements

### Requirement: Idempotency Key MUST 正確組成 Composite Key 並防止跨版本 Replay

Idempotency Key MUST 由 namespace、resourceKey 與 version 組成，key 序列化後作為 PostgreSQL primary key。

#### Scenario: 正確建立 Idempotency Key

GIVEN namespace `"tool_execution"`
AND resourceKey `"task-abc:step-1:current_weather:1"`
AND version `"1"`
WHEN 建立 `IdempotencyKey`
THEN `key` MUST 序列化為 `"tool_execution:task-abc:step-1:current_weather:1:v1"`
AND 每個 component 均可獨立讀取

#### Scenario: 不同 version 視為不同 key

GIVEN 兩個 IdempotencyKey，僅 `version` 不同（`"1"` vs `"2"`）
WHEN 分別序列化
THEN 兩個序列化後的 key MUST 不同
AND 舊 version 的 record MUST NOT 阻擋新 version 的執行

#### Scenario: namespace 區隔不同領域

GIVEN 兩個 IdempotencyKey，namespace 分別為 `"task"` 與 `"tool_execution"`
AND resourceKey 與 version 完全相同
WHEN 分別序列化
THEN 兩個序列化後的 key MUST 不同

#### Scenario: serializeKey 拒絕含有分隔符的 namespace

GIVEN namespace 為 `"tool:execution"`（含有分隔符 `:`）
AND resourceKey 為 `"task-abc:step-1"`
AND version 為 `"1"`
WHEN 呼叫 `serializeKey(key)`
THEN MUST 拋出錯誤
AND error message MUST 說明 namespace 不得包含 `:`

#### Scenario: serializeKey 拒絕含有分隔符的 resourceKey

GIVEN namespace 為 `"tool_execution"`
AND resourceKey 為 `"task-abc::step-1"`（含有連續分隔符）
AND version 為 `"1"`
WHEN 呼叫 `serializeKey(key)`
THEN MUST 拋出錯誤
AND error message MUST 說明 resourceKey 不得包含連續 `:`（即 `::`）

#### Scenario: serializeKey 拒絕空字串 component

GIVEN namespace 或 resourceKey 或 version 為空字串
WHEN 呼叫 `serializeKey(key)`
THEN MUST 拋出錯誤
AND error message MUST 指出哪個 component 為空

---

### Requirement: Idempotency Guard MUST 正確實作 Acquire / Release / Mark 生命週期

Idempotency Guard MUST 支援 lock（acquire）、complete（markCompleted）、fail（markFailed）三種操作，並正確處理 TTL 過期與重複 acquire。

#### Scenario: 首次 acquire 成功取得 lock

GIVEN 一個不存在的 IdempotencyKey
AND TTL 為 60000ms
WHEN 呼叫 `guard.acquire(key, 60000)`
THEN `AcquireResult.acquired` MUST 為 `true`
AND record status MUST 為 `"locked"`
AND `expiresAt` MUST 在未來約 60 秒

#### Scenario: 重複 acquire 已 locked 的 key 回傳 already_locked

GIVEN 一個已 locked 且未過期的 IdempotencyKey
WHEN 再次呼叫 `guard.acquire(key, 60000)`
THEN `AcquireResult.acquired` MUST 為 `false`
AND `reason` MUST 為 `"already_locked"`
AND `existing.status` MUST 為 `"locked"`

#### Scenario: 重複 acquire 已 completed 的 key 回傳 already_completed

GIVEN 一個已 completed 的 IdempotencyKey
WHEN 呼叫 `guard.acquire(key, 60000)`
THEN `AcquireResult.acquired` MUST 為 `false`
AND `reason` MUST 為 `"already_completed"`
AND `existing.result` MUST 為先前儲存的 result

#### Scenario: 已過期的 lock 可被 reclaim

GIVEN 一個已 locked 但 `expiresAt` 已過去的 IdempotencyKey
WHEN 呼叫 `guard.acquire(key, 60000)`
THEN `AcquireResult.acquired` MUST 為 `true`
AND record status MUST 更新為 `"locked"`
AND `expiresAt` MUST 更新為新的未來時間

#### Scenario: markCompleted 正確寫入 result

GIVEN 一個已 locked 的 IdempotencyKey
WHEN 呼叫 `guard.markCompleted(key, { output: "result" })`
THEN record status MUST 為 `"completed"`
AND `result` MUST 為 `{ output: "result" }`

#### Scenario: markFailed 不儲存 result

GIVEN 一個已 locked 的 IdempotencyKey
WHEN 呼叫 `guard.markFailed(key)`
THEN record status MUST 為 `"failed"`
AND `result` MUST 為 `null`

---

### Requirement: PgAuditLogger MUST 將 Audit Event 持久化至 PostgreSQL

`PgAuditLogger` MUST 實作既有的 `AuditLogger` interface，並將每個 `record()` 呼叫寫入 `audit_events` table。

#### Scenario: record 寫入 audit_events table

GIVEN 一個已連線的 PostgreSQL
AND `PgAuditLogger` 已初始化
WHEN 呼叫 `auditLogger.record("tool.invoke.start", { toolName: "current_weather", inputChars: 100 })`
THEN `audit_events` table MUST 有一筆新紀錄
AND `action` MUST 為 `"tool.invoke.start"`
AND `payload` MUST 包含 `{ "toolName": "current_weather", "inputChars": 100 }`

#### Scenario: record 寫入失敗不影響 caller

GIVEN PostgreSQL 連線已中斷
WHEN 呼叫 `auditLogger.record("tool.invoke.start", { toolName: "current_weather" })`
THEN MUST NOT 拋出錯誤至 caller
AND console MUST 有 warning log

#### Scenario: getEvents 查詢特定 task 的 audit trail

GIVEN `audit_events` 中有多筆不同 taskId 的 event
WHEN 呼叫 `auditLogger.getEvents({ taskId: "task-abc" })`
THEN MUST 只回傳 `taskId === "task-abc"` 的 events
AND events MUST 按 `created_at` 遞增排序

---

### Requirement: Redaction MUST 防止敏感欄位寫入 Audit

Redaction MUST 在 `PgAuditLogger.record()` 寫入前自動移除或遮蔽 API Key、完整 Prompt、PII 等敏感欄位。

#### Scenario: API Key 被移除

GIVEN payload `{ toolName: "weather", apiKey: "sk-abc123" }`
WHEN 呼叫 `redact(payload)`
THEN `apiKey` MUST 被移除
AND `toolName` MUST 保留

#### Scenario: 巢狀物件中的敏感欄位被移除

GIVEN payload `{ request: { headers: { authorization: "Bearer token" } } }`
WHEN 呼叫 `redact(payload)`
THEN `authorization` MUST 被移除
AND `request` 與 `headers` 的結構 MUST 保留（若仍有其他非敏感欄位）

#### Scenario: 白名單中的欄位安全通過

GIVEN payload `{ toolName: "current_weather", durationMs: 1234, statusCode: 200 }`
WHEN 呼叫 `redact(payload)`
THEN 所有三個欄位 MUST 保留且值不變

#### Scenario: fullPrompt 被移除

GIVEN payload `{ fullPrompt: "You are a helpful assistant...", stepName: "call_weather" }`
WHEN 呼叫 `redact(payload)`
THEN `fullPrompt` MUST 被移除
AND `stepName` MUST 保留

#### Scenario: 不在黑白名單的欄位被 truncate

GIVEN payload `{ description: "a".repeat(1000) }`
WHEN 呼叫 `redact(payload)`
THEN `description` MUST 被 truncate 至 256 chars
AND 結尾 MUST 有 `...[truncated]` 標記

---

### Requirement: 既有 ConsoleAuditLogger MUST 保持向後相容

既有的 `auditLogger` 預設行為 MUST 保持不變，`PgAuditLogger` 為 opt-in。

#### Scenario: 未設定 AUDIT_BACKEND 時使用 ConsoleAuditLogger

GIVEN 環境變數 `AUDIT_BACKEND` 未設定
WHEN 初始化 `auditLogger`
THEN MUST 使用 `ConsoleAuditLogger`
AND 行為與 X1/X2 時期完全一致

#### Scenario: AUDIT_BACKEND=pg 時使用 PgAuditLogger

GIVEN 環境變數 `AUDIT_BACKEND=pg`
AND PostgreSQL 已連線
WHEN 初始化 `auditLogger`
THEN MUST 使用 `PgAuditLogger`
AND audit event MUST 寫入 PostgreSQL

#### Scenario: AUDIT_BACKEND=composite 時雙寫

GIVEN 環境變數 `AUDIT_BACKEND=composite`
WHEN 初始化 `auditLogger`
THEN MUST 同時寫入 console 與 PostgreSQL
AND 任一 backend 失敗 MUST NOT 影響另一個

---

### Requirement: BFF MUST 轉發 x-idempotency-key Header

BFF MUST 將 frontend 傳入的 `x-idempotency-key` header 轉發至 backend，不做任何解析或驗證。

#### Scenario: Frontend 傳入 x-idempotency-key 時轉發

GIVEN frontend request 帶有 header `x-idempotency-key: tool_execution:task-abc:step-1:current_weather:1:v1`
WHEN BFF 轉發 request 至 backend
THEN backend 收到的 request MUST 包含相同的 `x-idempotency-key` header

#### Scenario: 未傳入時不影響正常請求

GIVEN frontend request 沒有 `x-idempotency-key` header
WHEN BFF 轉發 request 至 backend
THEN request MUST 正常轉發
AND MUST NOT 拋出錯誤

---

### Requirement: 全部模組 MUST 不依賴任何業務常數

Idempotency 與 Audit 框架的每個模組 MUST 為純 Runtime，不 import 任何業務 Step 名稱、Domain constant 或業務邏輯。

#### Scenario: 無業務 import

GIVEN `backend/src/runtime/idempotency/` 與 `backend/src/runtime/audit/` 下的所有模組
WHEN 檢查 import 路徑
THEN MUST NOT import 任何來自業務層的模組
AND MUST 只依賴 X1 Runtime 模組、`../../platform/observability.js`（AuditLogger interface）與 `../persistence/`（DB）

#### Scenario: Namespace 為通用字串而非業務常數

GIVEN `IdempotencyKey.namespace` 型別
WHEN 檢查型別定義
THEN MUST 為 `string`（不限制為特定 enum）
AND MUST NOT 包含任何業務相關預設值
