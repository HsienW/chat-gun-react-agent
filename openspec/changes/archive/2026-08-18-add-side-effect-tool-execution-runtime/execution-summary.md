# Execution Summary：add-side-effect-tool-execution-runtime

## 實際完成內容與 Design 差異

完全依 design.md 實作，無偏差。核心成果為 durable side-effect execution runtime：

- **backend/src/runtime/side-effect/identity.ts**：四種 identity（`replayKey`、`toolExecutionAttemptId`、`businessEffectKey`、`requestDedupKey`）+ `TrustedScope` 最小介面
- **backend/src/runtime/side-effect/side-effect-descriptor.ts**：`SideEffectToolDescriptor`、`ResultReferencePolicy`、`SideEffectReconciler` 三態 contract
- **backend/src/platform/tool-governance.ts**：新增 `executeTyped()` 回傳 `GovernedToolOutcome` discriminated union，保留 `governedInvoke` legacy adapter
- **backend/src/runtime/side-effect/business-effect-ledger.ts**：durable prepare + effect claim，fail-closed
- **backend/src/runtime/side-effect/tool-execution-runner.ts**：replayKey 查詢 → requestHash 比對 → 分類 → prepare → dispatch → reconcile
- **backend/src/runtime/side-effect/reconciler.ts**：committed / not_committed / unknown 三態處理
- **backend/src/runtime/side-effect/result-reference-store.ts**：payload_ref / result_hash / cache_state 儲存與 resolver
- **backend/src/runtime/compensation/saga-orchestrator.ts**：補償 plan 查詢 committed ToolExecution、`compensation_execution` prepared record、失敗轉 `manual_intervention_required`
- **backend/migrations 006–010**：`business_effects`、`tool_executions`、`tool_execution_attempts`、`compensation_executions`、`result_references`
- **bff/src/server.ts**：CORS 加入 `x-idempotency-key`、header 驗證、trusted namespace、TTL 設定

## 主要修改檔案

| 套件 | 檔案 | 類型 |
|------|------|------|
| backend | `src/runtime/side-effect/`（多檔） | 新增 |
| backend | `src/platform/tool-governance.ts` | 修改（additive typed outcome） |
| backend | `src/runtime/compensation/saga-orchestrator.ts` | 修改（manual_intervention_required） |
| backend | `migrations/006–010_*.sql` | 新增 |
| bff | `src/server.ts` | 修改（idempotency header CORS/驗證） |
| openspec | `specs/side-effect-tool-execution-runtime/spec.md` | 新增（17 Requirements） |

## 驗證結果

| 項目 | 結果 |
|------|------|
| Backend lint | ✅ PASSED |
| Backend test | ✅ 600 passed, 29 skipped |
| Backend build | ✅ PASSED |
| PostgreSQL integration | ✅ 9 passed |
| BFF build | ✅ PASSED |
| BFF test | ✅ 48 passed |
| OpenSpec strict validation | ✅ 0 issues |
| git diff --check | ✅ PASSED |
| Qwen review | ✅ APPROVE (0 Blocker, 0 Major, 3 Minor 已解決) |
| Tasks | ✅ 82/82 |

## 接受的風險與理由

| 風險 | 理由 |
|------|------|
| 真實外部 provider commit+response-loss E2E 未執行 | 以 PostgreSQL transaction + fault-injection integration（9 tests）覆蓋 |
| TrustedScope 僅最小 trusted identity 邊界 | 完整 principal/tenant/scope 模型歸屬 X8.7，不提前實作 |
| Hosted Opik live evaluation 未執行 | 外部服務不可用；deterministic 測試已覆蓋，live eval 為 opt-in |

## 未完成項目

- 真實外部 side-effect provider response-loss E2E（環境限制）
- Hosted Opik live evaluation（外部服務不可用）
- 完整 TrustedScope principal/tenant/scope 模型（歸屬 X8.7）

## 重要決策與取捨

1. **replayKey 為 logical identity**：`replayKey = hash(runId + stepId + logicalToolCallId + callIndex + toolName + toolVersion)`，MUST NOT 含 `attempt`；physical retry 由獨立 `toolExecutionAttemptId`／`executionAttempt` 記錄
2. **資料模型分離四層**：`business_effects`（業務效果）→ `tool_executions`（logical replay）→ `tool_execution_attempts`（physical，append-only）→ `compensation_executions`
3. **ledger fail-closed**：durable prepare 失敗即回傳 `SIDE_EFFECT_LEDGER_UNAVAILABLE`，不 dispatch 下游
4. **Governance typed outcome**：Runner 一律使用 `executeTyped()`，錯誤字串 mapping 只在最外層 legacy adapter 產生
5. **reconcile 三態**：`committed` 不重試、`not_committed` 依 Retry Budget、`unknown` 停止自動 replay 轉 persisted defer
6. **補償失敗語意**：`manual_intervention_required`，action 失敗不再標 step 為 `compensated`

## Commit 建議

```text
docs(openspec): archive add-side-effect-tool-execution-runtime (X8.6)

Archive X8.6 side-effect tool execution runtime change，並將
17 條 Requirements（14 ADDED + 3 MODIFIED）同步至
openspec/specs/side-effect-tool-execution-runtime/spec.md。

- 建立 side-effect-tool-execution-runtime 主要 spec
- 移動 change 目錄至 openspec/changes/archive/2026-08-18-add-side-effect-tool-execution-runtime/

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

> ⚠️ git commit / push 由人手動執行。Commit 後請將 current-state.json 的 `terminalStatus` 更新為 `COMPLETED/TERMINAL`。
