# Proposal：add-agent-compensation-runtime

## 變更定位

純 Runtime，零業務依賴。在 X1 Task/Step State Machine 與 X3 Idempotency/Audit 之上，建立通用的 Compensation/Saga 框架，支援可註冊的補償動作、不可逆標記與補償失敗升級。

## 為什麼（Why）

目前 X1 定義了 Step 狀態機中的 `compensating` 與 `compensated` 狀態，X2 提供 Retry 框架，X3 提供 Idempotency 保護與 Audit 持久化，但缺少 Compensation 執行層：

1. **Multi-step Task 中途失敗後無法復原已完成的 Side Effect** — 若 Task 有 A → B → C 三個 Step，C 失敗後已完成 side effect 的 A 與 B 無法被補償（例如釋放資源、還原狀態、發送更正通知）
2. **User Cancel（X2 Retry 中的 non-retryable 類型）缺少結構化補償路徑** — 使用者取消後，已完成的操作需要正規的補償而非靜默丟棄
3. **Step 狀態機中 `compensating`/`compensated` 狀態已定義但無執行層** — X1 的型別系統預留了狀態，但缺少實際執行 Compensation 的 Runtime
4. **補償失敗需要正規的升級機制** — 補償本身也可能失敗（例如外部系統不可用），需要有結構化的升級路徑而非靜默吞掉錯誤

## 問題描述

1. **沒有補償執行層** — X1 State Machine 有 `compensating`/`compensated` 狀態，但沒有對應的 `CompensationAction` 介面、Registry 或 Saga Orchestrator
2. **沒有 Saga 編排邏輯** — 缺少從失敗點決定補償範圍與執行順序的 Orchestrator
3. **沒有不可逆標記** — 無法區分「可以自動補償」與「需要人工介入」的操作
4. **沒有補償失敗升級** — 補償操作本身失敗時，沒有正規的記錄與升級路徑

## 解決方案

建立三層架構：

1. **Compensation Action 介面與 Registry** — `CompensationAction` interface（actionId、description、execute、isReversible）、`CompensationRegistry`（register/deregister）
2. **Saga Orchestrator** — 從失敗點決定補償範圍（只補償已完成的 Step），逆序執行補償動作，處理不可逆操作的標記與跳過
3. **Compensation 失敗升級** — 補償失敗時寫入 Audit、記錄 error detail，MUST NOT 靜默成功

## 目標

- ✅ Compensation Action 介面：`CompensationAction`（actionId / description / execute / isReversible）
- ✅ Compensation Registry：註冊、查詢、移除補償動作
- ✅ Saga Orchestrator：從失敗點逆序補償已完成的 Step，MUST NOT 觸及未執行的 Step
- ✅ 不可逆標記：`isReversible: false` 的 action MUST 標記為需要人工介入，MUST NOT 嘗試自動執行
- ✅ 補償失敗升級：記錄完整的 error context 至 Audit、MUST NOT 靜默成功
- ✅ Compensation Event 進入 X3 Audit：所有補償事件透過既有的 `auditLogger` 寫入 `audit_events`
- ✅ 純 Runtime，不 import 任何業務常數
- ✅ 不修改 X1 State Machine、X1 Types、X1 Events、X3 Idempotency/Audit 的核心邏輯

## 非目標

- ❌ Compensation Action 的自動註冊（caller 必須在 application bootstrap 階段靜態註冊）
- ❌ CompensationRegistry 的持久化（純記憶體，process 重啟後需重新靜態註冊）
- ❌ 跨 Task 的全域補償協調（每個 Task 獨立管理自己的 Compensation Plan）
- ❌ 補償動作的自動推導（caller 定義每個 Step 的對應補償動作）
- ❌ 分散式鎖定（X5 Distributed Lock 的責任）
- ❌ Compensation Dashboard（屬於 X8 Observability）
- ❌ 修改 X1 State Machine transition 規則（僅讀取 X1 的 Step/Task 狀態，不修改）
- ❌ 修改 X3 Idempotency/Audit 模組（僅透過既有 interface 使用）

## 受影響範圍

| 套件 | 影響 |
|------|------|
| backend | 新增 `src/runtime/compensation/`：compensation-action.ts、compensation-registry.ts、saga-orchestrator.ts、對應測試 |
| backend | 不新增 migration（使用既有的 `task_events` table 記錄補償事件，不建立獨立 table） |
| backend | 不修改 `observability.ts`（透過既有的 `auditLogger` interface 寫入 Audit） |
| bff | 本次不變動 |
| frontend | 本次不變動 |

## 與既有系統的關係

| 既有系統 | 關係 |
|---------|------|
| X1 State Machine / Types / Events | 唯讀引用。Compensation 讀取 Task/Step 狀態以決定補償範圍。Task 遵循 X1 既有 transition 路徑：`partially_failed` → `compensating` → `failed`。Step 透過 `StepRepository.updateStatus()` 直接 SQL UPDATE：`succeeded` → `compensating` → `compensated`（繞過 X1 `transitionStep()`，因 `succeeded` 為 terminal state） |
| X1 Task Events | Compensation 事件寫入既有的 `task_events` table（eventType: `compensation_triggered`、`compensation_completed`）。Per-action 失敗僅記錄至 X3 Audit（`audit_events`），不新增 `compensation_failed` eventType（X1 未定義此類型） |
| X2 Retry | Compensation 在 Retry 耗盡且 Step 標記為 `terminal_failed` 或 Task `partially_failed` 後觸發。User Cancel（non-retryable）時也可能需要補償 |
| X3 Idempotency/Audit | Compensation 事件透過既有的 `auditLogger.record()` 寫入 `audit_events`。Idempotency Key 可在補償操作中使用以防止重複補償 |
| Tool Governance | 不直接互動。補償動作若涉及 Tool 呼叫，由 caller 在 `execute()` 內部處理 |

## 風險

| 風險 | 緩解 |
|------|------|
| 補償動作本身失敗導致無法完整復原 | 失敗升級機制：寫入 Audit + 標記需要人工介入 + 不回滾已成功的補償 |
| 補償動作耗時過長導致 Task 鎖定 | Compensation 不持有 X5 lock；補償本身為 non-blocking |
| 補償過程中 Task 被並發修改 | Compensation 讀取 Step 狀態的快照，不阻止並發操作；最終由 X5 Distributed Lock 保護 |
| 補償動作被重複執行 | 使用 X3 Idempotency Key 保護每個補償動作的 execute() |
| 不可逆操作的補償需求無法滿足 | `isReversible: false` 標記強制人工介入；Audit 記錄完整上下文供人工處理 |

## 回滾策略

- `backend/src/runtime/compensation/` 為全新目錄，刪除即可回滾
- 不新增 migration，無 DB schema 變更
- 無既有模組修改，無相容性風險
