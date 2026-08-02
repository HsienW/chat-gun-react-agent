# Tasks：add-agent-idempotency-audit

## Phase 1：Idempotency 框架（backend）

### Task 1.1：建立 Idempotency Key 型別模組

- [x] 建立 `backend/src/runtime/idempotency/idempotency-key.ts`
- [x] 定義 `IdempotencyKey` 介面（namespace、resourceKey、version）
- [x] 定義 `IdempotencyStatus` union type（`"locked"` | `"completed"` | `"failed"`）
- [x] 定義 `IdempotencyRecord` 介面（key、status、result?、createdAt、expiresAt）
- [x] 實作 `serializeKey(key: IdempotencyKey): string`（格式：`{namespace}:{resourceKey}:v{version}`）
- [x] `serializeKey` MUST 驗證：namespace 不含 `:`、resourceKey 不含 `::`、所有 component 非空字串；驗證失敗擲出 Error
- [x] 實作 `parseKey(serialized: string): IdempotencyKey`

**驗收：** `cd backend && npx vitest run src/runtime/idempotency/idempotency-key.test.ts` 全部通過

---

### Task 1.2：建立 Idempotency Guard

- [x] 建立 `backend/src/runtime/idempotency/idempotency-guard.ts`
- [x] 定義 `AcquireResult` discriminated union
- [x] 定義 `IdempotencyGuard` 介面（acquire、markCompleted、markFailed、getRecord）
- [x] 實作 `PgIdempotencyGuard` class，接收 `Queryable`（DB connection）
- [x] 實作 `acquire(key, ttlMs)` — 兩步驟策略：Step 1 `INSERT ... ON CONFLICT DO NOTHING`（原子性），Step 2 若無 row 則 `SELECT` 檢查 expired status；expired 時 DELETE + 重試 INSERT
- [x] 實作 `markCompleted(key, result?)` — 更新 status 為 completed，寫入 result
- [x] 實作 `markFailed(key)` — 更新 status 為 failed
- [x] 實作 `getRecord(key)` — 查詢 key 目前的 record
- [x] 處理 expired TTL：`acquire` 時若 existing record `expires_at < NOW()`，原子性 reclaim
- [x] 單元測試：首次 acquire、重複 acquire（locked/completed/failed）、expired reclaim、markCompleted、markFailed、getRecord

**驗收：** `cd backend && npx vitest run src/runtime/idempotency/idempotency-guard.test.ts` 全部通過

---

### Task 1.3：建立 Idempotency Barrel Export

- [x] 建立 `backend/src/runtime/idempotency/index.ts`
- [x] 匯出所有公開型別：`IdempotencyKey`、`IdempotencyStatus`、`IdempotencyRecord`、`AcquireResult`、`IdempotencyGuard`
- [x] 匯出所有公開函式：`serializeKey`、`parseKey`
- [x] 匯出 `PgIdempotencyGuard`

**驗收：** TypeScript 編譯通過，其他模組可 import from `../idempotency`

---

### Task 1.4：建立 Idempotency Records Migration

- [x] 建立 `backend/src/runtime/persistence/migrations/004_create_idempotency_records.sql`
- [x] Table `idempotency_records`（key TEXT PK、namespace、resource_key、version、status、result JSONB、created_at、expires_at）
- [x] Index `idx_idempotency_expires` on `expires_at`
- [x] 加入 `MIGRATION_FILES` 陣列

**驗收：** Migration 可執行（`npm run test` 中的 migration test 通過）

---

## Phase 2：Audit 持久化（backend）

### Task 2.1：建立 Audit Events 型別與工廠函式

- [x] 建立 `backend/src/runtime/audit/audit-events.ts`
- [x] 定義 `AuditActorType` union（`"system"` | `"user"` | `"agent"`）
- [x] 定義 `AuditDecision` union（`"allow"` | `"deny"` | `"pending_confirmation"` | `"neutral"`）
- [x] 定義 `AuditEvent` 介面（eventId、taskId?、stepId?、toolExecutionId?、actorType、actorId、action、resourceType、resourceId、decision、reasonCode?、payload?、beforeStateRef?、afterStateRef?、createdAt）
- [x] 定義 `AuditEventInput` 介面（建立 AuditEvent 所需的必填欄位，不含 eventId 與 createdAt）
- [x] 實作 `createAuditEvent(input: AuditEventInput): AuditEvent`（自動填入 eventId 與 createdAt）

**驗收：** TypeScript 編譯通過，型別可被其他模組正確引用

---

### Task 2.2：建立 Redaction 規則引擎

- [x] 建立 `backend/src/runtime/audit/redaction.ts`
- [x] 定義 `REDACTED_MARKER = "[REDACTED]"`
- [x] 定義黑名單欄位模式（`apiKey`、`api_key`、`token`、`secret`、`prompt`、`fullPrompt`、`conversation`、`messages`、`raw`、`input`、`output`、`password`、`credential`、`authorization`、`pii`、`email`、`phone`）
- [x] 定義白名單欄位模式（`toolName`、`durationMs`、`inputChars`、`outputChars`、`statusCode`、`errorCode`、`attemptCount`、`candidateCount`、`strategy`、`provider`、`resultStatus`、`reason`、`reasonCode`、`stepId`、`stepName`、`taskId`、`taskType`）
- [x] 實作 `redact(payload: unknown): unknown` — 遞迴處理 object/array
- [x] 黑名單匹配 → 移除欄位
- [x] 白名單匹配 → 保留
- [x] 其餘 → truncate 至 256 chars，結尾加 `...[truncated]`
- [x] 單元測試：API Key 移除、巢狀敏感欄位移除、白名單保留、truncation

**驗收：** `cd backend && npx vitest run src/runtime/audit/redaction.test.ts` 全部通過

---

### Task 2.3：建立 PgAuditLogger

- [x] 建立 `backend/src/runtime/audit/pg-audit-logger.ts`
- [x] 實作 `AuditLogger` interface（`record(eventName, payload)`）
- [x] 建構子接收 `Queryable`（DB connection）+ 可選的 `redactEnabled: boolean`（預設 true）
- [x] `record()` 內部：
  1. 呼叫 `redact(payload)`（若 enabled）
  2. 建立 `AuditEvent`（actorType = `"system"`、actorId = `"backend"`、decision = `"neutral"`、resourceType/Id 從 payload 推斷）
  3. 寫入 `audit_events` table
  4. 失敗時 console.warn，不拋出錯誤
- [x] 實作 `getEvents(filters): Promise<AuditEvent[]>` 查詢方法
- [x] 整合測試：寫入 → 查詢

**驗收：** `cd backend && npx vitest run src/runtime/audit/pg-audit-logger.test.ts` 全部通過

---

### Task 2.4：建立 Audit Events Migration

- [x] 建立 `backend/src/runtime/persistence/migrations/005_create_audit_events.sql`
- [x] Table `audit_events`（event_id PK、task_id、step_id、tool_execution_id、actor_type、actor_id、action、resource_type、resource_id、decision、reason_code、payload JSONB、before_state_ref、after_state_ref、created_at）
- [x] Index：`idx_audit_events_task_id`、`idx_audit_events_action`、`idx_audit_events_created_at`、`idx_audit_events_resource`
- [x] 加入 `MIGRATION_FILES` 陣列

**驗收：** Migration 可執行（`npm run test` 中的 migration test 通過）

---

### Task 2.5：建立 Audit Barrel Export

- [x] 建立 `backend/src/runtime/audit/index.ts`
- [x] 匯出所有公開型別：`AuditEvent`、`AuditEventInput`、`AuditActorType`、`AuditDecision`
- [x] 匯出 `createAuditEvent`、`redact`
- [x] 匯出 `PgAuditLogger`

**驗收：** TypeScript 編譯通過

---

## Phase 3：Observability 整合（backend）

### Task 3.1：支援 PgAuditLogger 並保持向後相容

- [x] 修改 `backend/src/platform/observability.ts`
- [x] 保留既有的 `ConsoleAuditLogger` class 與 `auditLogger` singleton 初始化邏輯
- [x] 新增 `CompositeAuditLogger` class（接收 `AuditLogger[]`，依序寫入每個 backend；每個 backend 用獨立 `try/catch`，任一失敗 MUST 只記錄 warning 並繼續下一個，MUST NOT 向上傳播錯誤）
- [x] 新增 `getAuditLogger(): AuditLogger` 函式：依 `AUDIT_BACKEND` 環境變數回傳對應 logger
  - `"console"`（預設）→ `ConsoleAuditLogger`
  - `"pg"` → `PgAuditLogger`（若 DB 未連線，fallback 到 `ConsoleAuditLogger`）
  - `"composite"` → `CompositeAuditLogger([ConsoleAuditLogger, PgAuditLogger])`
- [x] 不修改既有 export `auditLogger` 的型別（保持 `AuditLogger` interface）
- [x] 不修改既有 `recordMetric`、`recordWeatherAuditEvent`、`recordWeatherMetric` 的行為
- [x] 單元測試：各 backend 切換、composite 並行寫入、PG 未連線 fallback

**驗收：** `cd backend && npm run test` 全部通過（含既有 observability test + 新增測試）

---

## Phase 4：BFF Header Pass-through

### Task 4.1：BFF 轉發 x-idempotency-key Header

- [x] 修改 `bff/src/server.ts`
- [x] 在 `FORWARDED_REQUEST_HEADERS` 中加入 `"x-idempotency-key"`
- [x] 無其他邏輯修改

**驗收：** BFF test 通過，`x-idempotency-key` header 可被轉發

---

## Phase 5：合規檢查

### Task 5.1：合規檢查

- [x] `cd backend && npm run lint` 通過
- [x] `cd backend && npm run test` 全部通過（含所有新增 idempotency + audit + redaction + migration 測試）
- [x] `cd backend && npm run build` 通過
- [x] `cd bff && npm run build` 通過
- [x] 確認無 `any` 濫用
- [x] 確認無硬編碼業務 Step 名稱
- [x] 確認 Idempotency / Audit 模組不 import 任何業務模組（僅依賴 X1 types/state-machine/events、platform/observability interface、persistence DB）
- [x] 確認所有公開函式有正確的 TypeScript 型別標註
- [x] `openspec validate add-agent-idempotency-audit --strict` 通過

**驗收：** Backend + BFF lint/test/build 全部通過，OpenSpec strict validation 0 issues
