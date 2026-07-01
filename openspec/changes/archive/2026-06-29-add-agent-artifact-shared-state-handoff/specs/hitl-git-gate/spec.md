# HITL Git Gate

## ADDED Requirements

### Requirement: Agent 不得執行 Git Commit/Push

任何 Agent MUST NOT 執行 `git commit`、`git push`、`git tag` 或其他修改 Git 歷史的命令。

#### Scenario: Agent 嘗試 commit

GIVEN Agent 完成所有工作並判定 ready
WHEN Agent 考慮執行 git commit
THEN Agent MUST NOT 執行
AND git commit/push 一律由人執行

#### Scenario: Agent 可產生 commit message 建議

GIVEN Change 進入 `ARCHIVED_AWAITING_HUMAN_COMMIT` 狀態
WHEN Agent（Codex/CCR）完成 archive
THEN Agent MAY 產生 commit message 建議
AND 建議格式 MUST 包含 `<type>(<scope>): <description>`、execution-summary 摘要、OpenSpec Change 名稱

---

### Requirement: Archive 狀態等待人工 Commit

狀態機的最終 Agent 狀態 MUST 為 `ARCHIVED_AWAITING_HUMAN_COMMIT`。

#### Scenario: Archive 後等待

GIVEN Codex 完成 archive-change 階段
AND 產生了 execution-summary.md
WHEN 狀態機推進
THEN `currentPhase` MUST 變為 `"ARCHIVED_AWAITING_HUMAN_COMMIT"`
AND MUST NOT 自動變為 `"COMPLETED"`

#### Scenario: 人工 commit 後標記完成

GIVEN `currentPhase` 為 `"ARCHIVED_AWAITING_HUMAN_COMMIT"`
AND 人工執行了 git commit
WHEN 人工更新 current-state.json
THEN `currentPhase` MAY 變為 `"COMPLETED"`
AND `terminalStatus` MUST 變為 `"TERMINAL"`

---

### Requirement: 不可繞過 Gate 產生 Commit 建議

Agent MUST NOT 在 Gate 未滿足時建議 commit。

#### Scenario: Blocker 存在時拒絕建議 commit

GIVEN `blockers` 不為空
WHEN Agent 考慮產生 commit message 建議
THEN Agent MUST NOT 建議 commit
AND MUST 回報仍有 unresolved Blocker

#### Scenario: Gate 未全部通過時拒絕建議 commit

GIVEN `gateStatus` 中任一 Gate 不為 `true`
WHEN Agent 考慮產生 commit message 建議
THEN Agent MUST NOT 建議 commit
AND MUST 列出未通過的 Gate

#### Scenario: 非 Archive 狀態拒絕建議 commit

GIVEN `currentPhase` 不是 `"ARCHIVED_AWAITING_HUMAN_COMMIT"`
WHEN Agent 考慮產生 commit message 建議
THEN Agent MUST NOT 建議 commit
AND MUST 說明目前 phase 不適合 commit

#### Scenario: 只在 ARCHIVED_AWAITING_HUMAN_COMMIT 時建議 commit

GIVEN `currentPhase` 為 `"ARCHIVED_AWAITING_HUMAN_COMMIT"`
WHEN Agent（Codex/CCR）產生 commit message 建議
THEN Agent MAY 產生 commit message 建議
AND `terminalStatus` 在此階段為 `"NON_TERMINAL"`（因為尚未人工 commit）
AND 人工 commit 後 `currentPhase` 變為 `"COMPLETED"` 且 `terminalStatus` 變為 `"TERMINAL"`

---

### Requirement: Commit Message 建議格式

Agent 產生的 commit message 建議 MUST 遵循約定格式。

#### Scenario: 標準 commit message

GIVEN Agent 產生 commit message 建議
WHEN 檢查格式
THEN MUST 包含第一行 `<type>(<scope>): <description>`
AND MUST 包含 `OpenSpec Change: <change-name>`
AND MUST 包含 `Co-Authored-By: Claude <noreply@anthropic.com>`

#### Scenario: Commit 建議摘要包含 execution-summary 關鍵資訊

GIVEN Agent 產生 commit message 建議
WHEN 檢查 body 內容
THEN SHOULD 包含 execution-summary 的關鍵摘要
AND SHOULD 包含主要修改檔案
AND SHOULD 包含驗證結果摘要
