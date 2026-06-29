# Workflow State Transition

## Purpose

本規格定義 workflow-state-transition 能力的正式需求，涵蓋其資料契約、狀態邊界、角色責任、失敗處理與驗證情境，作為實作、審查及後續演進的主要行為依據。

## Requirements

### Requirement: 完整狀態定義

Workflow State Machine MUST 定義所有合法 Phase 及其語意。

#### Scenario: Phase 為已知合法值

GIVEN current-state.json 的 `currentPhase`
WHEN 檢查該值
THEN MUST 為以下之一：`PLAN_DRAFT` | `PLAN_REVIEW` | `PLAN_APPROVED` | `READY_FOR_IMPLEMENTATION` | `IMPLEMENTING` | `READY_FOR_REVIEW` | `REVIEWING` | `CHANGES_REQUESTED` | `NEEDS_COORDINATOR_ARBITRATION` | `READY_FOR_READINESS_CHECK` | `READY_FOR_ARCHIVE` | `ARCHIVED_AWAITING_HUMAN_COMMIT` | `COMPLETED` | `FAILED` | `INCOMPLETE`

#### Scenario: 未知 Phase 拒絕

GIVEN current-state.json 的 `currentPhase` 為未定義的值（例如 `"UNKNOWN_FUTURE_PHASE"`）
WHEN Agent 嘗試依 Phase 決定行為
THEN Agent MUST 報錯
AND MUST NOT 假設等價於某個已知 Phase

---

### Requirement: 合法狀態轉移

狀態機 MUST 只允許明確定義的狀態轉移。

#### Scenario: PLAN_DRAFT → PLAN_REVIEW

GIVEN `currentPhase` 為 `"PLAN_DRAFT"`
AND CCR 完成 proposal/design/tasks
WHEN CCR 更新 current-state.json
THEN `currentPhase` MAY 變為 `"PLAN_REVIEW"`
AND `currentOwner` MUST 變為 `"Qwen"`

#### Scenario: PLAN_REVIEW → PLAN_APPROVED

GIVEN `currentPhase` 為 `"PLAN_REVIEW"`
AND Qwen review-plan 通過（APPROVE 或 COMMENT_ONLY 且無 Blocker）
AND CCR 已完成仲裁確認
WHEN CCR 更新 current-state.json
THEN `currentPhase` MAY 變為 `"PLAN_APPROVED"`
AND `gateStatus.proposalApproved` MUST 變為 `true`

#### Scenario: IMPLEMENTING → READY_FOR_REVIEW

GIVEN `currentPhase` 為 `"IMPLEMENTING"`
AND Codex 完成實作並收集所有 Evidence
WHEN Codex 更新 current-state.json
THEN `currentPhase` MAY 變為 `"READY_FOR_REVIEW"`
AND `latestArtifactRefs.implementationResult` MUST 指向新的 implementation_result

#### Scenario: READY_FOR_REVIEW → REVIEWING

GIVEN `currentPhase` 為 `"READY_FOR_REVIEW"`
AND `latestArtifactRefs.implementationResult` 指向有效的 implementation_result
AND Coordinator 已完成交給 Qwen 的 review-result handoff
WHEN 人工或 CLIHost 更新 current-state.json
THEN `currentPhase` MAY 變為 `"REVIEWING"`
AND `currentOwner` MUST 變為 `"Qwen"`

#### Scenario: REVIEWING → CHANGES_REQUESTED

GIVEN `currentPhase` 為 `"REVIEWING"`
AND Qwen 回報 Verdict 為 `REQUEST_CHANGES`
WHEN current-state.json 更新
THEN `currentPhase` MAY 變為 `"CHANGES_REQUESTED"`
AND `blockers` MUST 包含 Qwen 回報的 Blocker findings

#### Scenario: REVIEWING → READY_FOR_READINESS_CHECK

GIVEN `currentPhase` 為 `"REVIEWING"`
AND Qwen 回報 Verdict 為 `APPROVE` 或無 Blocker 的 `COMMENT_ONLY`
WHEN current-state.json 更新
THEN `currentPhase` MAY 變為 `"READY_FOR_READINESS_CHECK"`
AND `gateStatus.reviewPassed` MUST 變為 `true`

#### Scenario: CHANGES_REQUESTED → IMPLEMENTING

GIVEN `currentPhase` 為 `"CHANGES_REQUESTED"`
AND Codex 完成修復
WHEN Codex 更新 current-state.json
THEN `currentPhase` MAY 變為 `"IMPLEMENTING"`
AND `attempt` MUST 遞增

#### Scenario: READY_FOR_READINESS_CHECK → READY_FOR_ARCHIVE

GIVEN `currentPhase` 為 `"READY_FOR_READINESS_CHECK"`
AND CCR 完成 readiness-check 並判定 ready
WHEN CCR 更新 current-state.json
THEN `currentPhase` MAY 變為 `"READY_FOR_ARCHIVE"`
AND `gateStatus.readinessConfirmed` MUST 變為 `true`

#### Scenario: READY_FOR_ARCHIVE → ARCHIVED_AWAITING_HUMAN_COMMIT

GIVEN `currentPhase` 為 `"READY_FOR_ARCHIVE"`
AND Codex 完成 archive-change 並產生 execution-summary 與 archive_result
WHEN Codex 更新 current-state.json
THEN `currentPhase` MAY 變為 `"ARCHIVED_AWAITING_HUMAN_COMMIT"`
AND `currentOwner` MUST 變為 `"Human"`

#### Scenario: ARCHIVED_AWAITING_HUMAN_COMMIT → COMPLETED

GIVEN `currentPhase` 為 `"ARCHIVED_AWAITING_HUMAN_COMMIT"`
AND `terminalStatus` 為 `"NON_TERMINAL"`（仍在等待人工操作）
AND 人工完成 git commit
WHEN 人工更新 current-state.json
THEN `currentPhase` MAY 變為 `"COMPLETED"`
AND `terminalStatus` MUST 變為 `"TERMINAL"`
AND `ARCHIVED_AWAITING_HUMAN_COMMIT` 階段的 `terminalStatus` 在人工 commit 前 MUST 為 `"NON_TERMINAL"`（因為 Agent 不得自行完成 COMPLETED）

#### Scenario: 任何 NON_TERMINAL → FAILED

GIVEN Change 遇到不可恢復的失敗
AND `terminalStatus` 為 `"NON_TERMINAL"`
WHEN 人工或 CCR 判定失敗
THEN `currentPhase` MAY 變為 `"FAILED"`
AND `terminalStatus` MUST 變為 `"TERMINAL"`

#### Scenario: PLAN_REVIEW → PLAN_DRAFT（Qwen REQUEST_CHANGES）

GIVEN `currentPhase` 為 `"PLAN_REVIEW"`
AND Qwen review-plan 回報 Verdict 為 `REQUEST_CHANGES`
WHEN CCR 仲裁確認需要修改 plan
THEN `currentPhase` MAY 變為 `"PLAN_DRAFT"`
AND `currentOwner` MUST 變為 `"CCR"`
AND `attempt` MUST 遞增

#### Scenario: PLAN_APPROVED → READY_FOR_IMPLEMENTATION

GIVEN `currentPhase` 為 `"PLAN_APPROVED"`
AND `gateStatus.proposalApproved` 為 `true`
WHEN CCR 更新 current-state.json
THEN `currentPhase` MAY 變為 `"READY_FOR_IMPLEMENTATION"`
AND `currentOwner` MUST 變為 `"Codex"`

#### Scenario: READY_FOR_IMPLEMENTATION → IMPLEMENTING

GIVEN `currentPhase` 為 `"READY_FOR_IMPLEMENTATION"`
AND Codex 確認承接實作任務
WHEN Codex 開始實作
THEN `currentPhase` MAY 變為 `"IMPLEMENTING"`
AND `currentOwner` MUST 保持為 `"Codex"`

#### Scenario: IMPLEMENTING → PLAN_DRAFT（實作中發現規格問題）

GIVEN `currentPhase` 為 `"IMPLEMENTING"`
AND Codex 發現 OpenSpec 規格有根本性問題無法繼續
WHEN Codex 回報規格問題
THEN `currentPhase` MAY 變為 `"PLAN_DRAFT"`
AND `currentOwner` MUST 變為 `"CCR"`
AND Codex MUST 在 implementation_result 中說明問題

#### Scenario: REVIEWING → INCOMPLETE

GIVEN `currentPhase` 為 `"REVIEWING"`
AND Qwen 無法完成審查（缺少 Base/Diff/關鍵驗證證據）
WHEN Qwen 輸出 Verdict 為 `INCOMPLETE`
THEN `currentPhase` MAY 變為 `"INCOMPLETE"`
AND `currentOwner` MUST 變為 `"CCR"`
AND `terminalStatus` MUST 保持為 `"NON_TERMINAL"`
AND Qwen MUST 列出所有缺失的輸入

#### Scenario: CHANGES_REQUESTED → NEEDS_COORDINATOR_ARBITRATION

GIVEN `currentPhase` 為 `"CHANGES_REQUESTED"`
AND Codex 認為 Qwen Finding 為誤判或與 OpenSpec 衝突
WHEN Codex 與 Qwen 判斷衝突且無法自行解決
THEN `currentPhase` MAY 變為 `"NEEDS_COORDINATOR_ARBITRATION"`
AND `currentOwner` MUST 變為 `"CCR"`

#### Scenario: NEEDS_COORDINATOR_ARBITRATION → PLAN_DRAFT

GIVEN `currentPhase` 為 `"NEEDS_COORDINATOR_ARBITRATION"`
AND CCR 仲裁後決定需要修改規格
WHEN CCR 更新 current-state.json
THEN `currentPhase` MAY 變為 `"PLAN_DRAFT"`
AND `currentOwner` MUST 變為 `"CCR"`

#### Scenario: NEEDS_COORDINATOR_ARBITRATION → IMPLEMENTING

GIVEN `currentPhase` 為 `"NEEDS_COORDINATOR_ARBITRATION"`
AND CCR 仲裁後判定 Codex 正確，繼續修復
WHEN CCR 更新 current-state.json
THEN `currentPhase` MAY 變為 `"IMPLEMENTING"`
AND `currentOwner` MUST 變為 `"Codex"`
AND `attempt` MUST 遞增

#### Scenario: NEEDS_COORDINATOR_ARBITRATION → READY_FOR_READINESS_CHECK

GIVEN `currentPhase` 為 `"NEEDS_COORDINATOR_ARBITRATION"`
AND CCR 仲裁後接受風險，判定不需要進一步修復
WHEN CCR 更新 current-state.json
THEN `currentPhase` MAY 變為 `"READY_FOR_READINESS_CHECK"`
AND `currentOwner` MUST 變為 `"CCR"`
AND CCR MUST 在 blockers 或 nextActions 中記錄接受的風險

#### Scenario: READY_FOR_READINESS_CHECK → IMPLEMENTING

GIVEN `currentPhase` 為 `"READY_FOR_READINESS_CHECK"`
AND CCR 在 readiness-check 中發現問題需要修復
WHEN CCR 判定不 ready
THEN `currentPhase` MAY 變為 `"IMPLEMENTING"`
AND `currentOwner` MUST 變為 `"Codex"`
AND `attempt` MUST 遞增

#### Scenario: INCOMPLETE → PLAN_REVIEW

GIVEN `currentPhase` 為 `"INCOMPLETE"`
AND `terminalStatus` 為 `"NON_TERMINAL"`
AND Coordinator 已補齊 Qwen 所需的缺失輸入
WHEN CCR 重新提交審查
THEN `currentPhase` MAY 變為 `"PLAN_REVIEW"`（若為 review-plan 階段）
AND `currentOwner` MUST 變為 `"Qwen"`
AND `attempt` MUST 遞增

---

### Requirement: 禁止的狀態轉移

狀態機 MUST 拒絕未定義的狀態轉移。

#### Scenario: Qwen APPROVE 後自動 COMPLETED

GIVEN `currentPhase` 為 `"REVIEWING"`
AND Qwen Verdict 為 `APPROVE`
WHEN 檢查是否可以進入 `COMPLETED`
THEN 狀態機 MUST 拒絕
AND MUST 先經過 `READY_FOR_READINESS_CHECK` → `READY_FOR_ARCHIVE` → `ARCHIVED_AWAITING_HUMAN_COMMIT`（CCR readiness-check 未完成）

#### Scenario: 測試失敗仍進入 READY_FOR_ARCHIVE

GIVEN `gateStatus.implementationVerified` 為 `false`
AND 有失敗的 test 或 build
WHEN 檢查是否可以進入 `READY_FOR_ARCHIVE`
THEN 狀態機 MUST 拒絕

#### Scenario: 有 Blocker 仍標記 READY

GIVEN `blockers` 不為空（存在 unresolved Blocker）
WHEN 檢查是否可以標記 `gateStatus.readinessConfirmed` 為 `true`
THEN 狀態機 MUST 拒絕

#### Scenario: Codex 自行改變 Requirement

GIVEN `currentPhase` 為 `"IMPLEMENTING"`
AND Codex 認為需要修改 Requirement
WHEN Codex 嘗試直接進入 `PLAN_APPROVED` 跳過 CCR
THEN 狀態機 MUST 拒絕
AND Codex MUST 回到 `PLAN_DRAFT` 並將 `currentOwner` 設為 `"CCR"`

#### Scenario: Reviewer 自行修改 OpenSpec

GIVEN `currentOwner` 為 `"Qwen"`
WHEN Qwen 嘗試修改任何 OpenSpec 檔案
THEN 依 QWEN.md 唯讀邊界，Qwen MUST NOT 執行修改
AND 狀態機 MUST 拒絕此操作

#### Scenario: Agent 跳過必要前置 Gate

GIVEN `currentPhase` 為 `"PLAN_DRAFT"`
AND `gateStatus.proposalApproved` 為 `false`
WHEN Agent 嘗試直接進入 `"IMPLEMENTING"`
THEN 狀態機 MUST 拒絕
AND MUST 先經過 `PLAN_REVIEW` → `PLAN_APPROVED` → `READY_FOR_IMPLEMENTATION`

#### Scenario: 從 ARCHIVED_AWAITING_HUMAN_COMMIT 回退

GIVEN `currentPhase` 為 `"ARCHIVED_AWAITING_HUMAN_COMMIT"`
WHEN Agent 嘗試回到 `IMPLEMENTING` 或任何其他 NON_TERMINAL phase
THEN 狀態機 MUST 拒絕
AND 只有人工可以手動重置狀態

---

### Requirement: attempt 計數

`attempt` 欄位 MUST 追蹤同一 Phase 的嘗試次數。

#### Scenario: Review→Fix→Review 遞增

GIVEN 第一輪 REVIEWING 完成後進入 CHANGES_REQUESTED
AND `attempt` 為 `1`
WHEN Codex 修復後重新進入 IMPLEMENTING
THEN `attempt` MUST 變為 `2`
AND 每次修復循環 `attempt` 遞增

#### Scenario: 反覆失敗停止線

GIVEN `attempt` 已達高值（例如大於等於 3）
AND 仍未通過審查
WHEN 下一步判斷
THEN 必須觸發反覆失敗停止線（依 AGENTS.md §9）
AND 不得繼續進行第三輪無證據微調

---

### Requirement: Gate 條件

四個 Gate MUST 各有明確通過條件。

#### Scenario: proposalApproved Gate

GIVEN `gateStatus.proposalApproved` 需要變為 `true`
WHEN 檢查條件
THEN Qwen review-plan 必須完成且 Verdict 為 `APPROVE` 或 `COMMENT_ONLY`（無 Blocker）
AND CCR 已仲裁確認

#### Scenario: reviewPassed Gate

GIVEN `gateStatus.reviewPassed` 需要變為 `true`
WHEN 檢查條件
THEN Qwen review-result 必須完成
AND Verdict 為 `APPROVE` 或無 Blocker 的 `COMMENT_ONLY`
AND 不得有 unresolved Blocker

#### Scenario: implementationVerified Gate

GIVEN `gateStatus.implementationVerified` 需要變為 `true`
WHEN 檢查條件
THEN 必須有實際執行的 lint/test/build 輸出
AND 全部通過（exit code = 0）
AND 輸出路徑記錄在 evidence/ 中

#### Scenario: readinessConfirmed Gate

GIVEN `gateStatus.readinessConfirmed` 需要變為 `true`
WHEN 檢查條件
THEN CCR 必須完成 readiness-check
AND 所有其他三個 Gate 必須為 `true`
AND `blockers` 必須為空
AND OpenSpec Requirement 全部被覆蓋
