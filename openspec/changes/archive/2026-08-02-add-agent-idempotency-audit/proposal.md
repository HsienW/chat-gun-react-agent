# Proposal：add-agent-idempotency-audit

## 變更定位

純 Runtime，零業務依賴。在 X1 Task/Step State Machine 與既有 Tool Governance Console Audit 之上，建立通用的 Idempotency 框架與 PostgreSQL 持久化 Audit。

## 為什麼（Why）

目前 `backend/src/platform/observability.ts` 的 `auditLogger` 僅為 `ConsoleAuditLogger`，所有 audit event 輸出至 console，無法追溯歷史操作序列。`tool-governance.ts` 的 `auditToolEvent` 會記錄 `tool.invoke.start` / `tool.invoke.success` / `tool.invoke.failure`，但這些事件僅存在 console log 中，沒有持久化。

同時 X2 Retry 框架已能重試失敗的 Step，但沒有 Idempotency 保護——如果重試發生在 side effect（外部 API call、資料庫寫入）已成功但回應超時的情況下，side effect 可能被重複執行。X1 的 resume 機制也存在類似風險：中斷恢復後可能重新執行已完成的步驟。

## 問題描述

1. **沒有 Idempotency 保護** — 重試（X2）、resume（X1 waiting_confirmation）與外部重送可能導致 side effect 重複執行
2. **沒有持久化 Audit** — console-only audit 無法在事後重建操作歷史
3. **沒有 Redaction 規則** — 無結構化規則阻止 API Key、完整 Prompt、PII 寫入 Audit
4. **Tool Governance audit 與未來的 Runtime audit 共用同一 Logger 但無持久層** — 兩者應共用同一個 Audit 後端

## 解決方案

建立三層架構：

1. **Idempotency 框架** — namespace + resourceKey + version 的 composite key，PostgreSQL 持久化，支援 lock/complete/failed 狀態與 TTL 過期
2. **持久化 Audit** — PostgreSQL `audit_events` table，接收既有 `auditLogger` 事件 + 新的 runtime audit 事件
3. **Redaction 規則** — 結構化檢查，在 audit event 寫入前過濾敏感欄位

## 目標

- ✅ Idempotency 框架：`IdempotencyKey`（namespace / resourceKey / version），`IdempotencyRecord`（locked / completed / failed + TTL）
- ✅ Idempotency Guard：`acquire`（取得 lock）/ `markCompleted` 或 `markFailed`（釋放 lock），DB unique constraint 為第一層防線
- ✅ 持久化 Audit：`audit_events` table + `PgAuditLogger` 實作 `AuditLogger` interface
- ✅ Redaction 規則：結構化檢查，MUST NOT 持久化 API Keys、完整 Prompt、PII
- ✅ 向後相容：既有的 `auditLogger` interface 不變，`ConsoleAuditLogger` 與 `PgAuditLogger` 可並行（dual-write），或依環境切換
- ✅ 純 Runtime，不 import 任何業務常數

## 非目標

- ❌ Compensation（X4）
- ❌ Distributed Lock（X5）
- ❌ Idempotency 跨 Task 全域管理（僅管理 Tool Execution 層級）
- ❌ Audit 的即時串流或 Dashboard（屬於 X8 Observability）
- ❌ 既有 `tool-governance.ts` 的邏輯修改（僅替換其 audit logger backend）
- ❌ 修改 X1 狀態機、事件系統或 persistence 邏輯

## 受影響範圍

| 套件 | 影響 |
|------|------|
| backend | 新增 `src/runtime/idempotency/`：idempotency-key、idempotency-guard、對應測試 |
| backend | 新增 `src/runtime/audit/`：audit-events、pg-audit-logger、redaction、對應測試 |
| backend | 新增 persistence migration：`004_create_idempotency_records.sql`、`005_create_audit_events.sql` |
| backend | 修改 `src/platform/observability.ts`：支援 `PgAuditLogger`（向後相容） |
| bff | Idempotency key propagation：request header → backend（最小變更，pass-through） |
| frontend | 本次不變動 |

## 與既有系統的關係

| 既有系統 | 關係 |
|---------|------|
| X1 State Machine / Events / Persistence | 被引用，不修改。Idempotency Guard 在 Step 執行前被呼叫 |
| X2 Retry | Idempotency 為 Retry 提供 side-effect 重複防護；Retry 內每次 attempt 帶相同 idempotency key |
| Tool Governance | `auditLogger` interface 已有；新增 `PgAuditLogger` 實作；`auditToolEvent` 自動獲得持久化 |
| Console Audit Logger | 保留，可與 `PgAuditLogger` 並行（dual-write），或依 `AUDIT_BACKEND` 環境變數切換 |

## 風險

| 風險 | 緩解 |
|------|------|
| Idempotency lock 永不過期導致死鎖 | TTL 自動過期；`expiresAt` 強制檢查 |
| DB unique constraint 衝突時 race condition | `INSERT ... ON CONFLICT DO NOTHING` + 回傳 `locked` status |
| Audit table 無限增長 | 後續 change（X8）可加入 retention policy；本次只確保 schema 可擴充 |
| Redaction 遺漏敏感欄位 | 結構化白名單檢查 + 預設 deny；測試涵蓋已知敏感欄位 |
| `PgAuditLogger` 寫入失敗影響主流程 | async write、fire-and-forget 模式；audit 寫入失敗不拋出錯誤至 caller |

## 回滾策略

- `backend/src/runtime/idempotency/` 與 `backend/src/runtime/audit/` 為全新目錄，刪除即可回滾
- 新增 migration 有 down script，可透過 migration runner 回滾
- `observability.ts` 的變更為 additive（新增 optional backend），移除 initialization 即可回到 console-only
