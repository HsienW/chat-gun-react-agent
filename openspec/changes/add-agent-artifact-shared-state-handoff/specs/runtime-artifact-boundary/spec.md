# Runtime Artifact Boundary

## ADDED Requirements

### Requirement: .agent-runtime 目錄結構

每個 Change 的 Runtime Artifact MUST 儲存於 `.agent-runtime/<change-id>/`。

#### Scenario: 目錄結構存在

GIVEN 一個正在進行中的 Change
WHEN 檢查 `.agent-runtime/<change-id>/`
THEN MUST 包含 `current-state.json`
AND MUST 包含 `artifacts/` 目錄
AND MUST 包含 `evidence/` 目錄

#### Scenario: artifacts 目錄內容

GIVEN 各階段 Agent 已完成工作
WHEN 檢查 `.agent-runtime/<change-id>/artifacts/`
THEN MAY 包含 `coordinator-result.json`、`implementation-result.json`、`review-result.json`、`readiness-result.json`、`archive-result.json`
AND 每個檔案 MUST 符合 `agent-result.schema.json`

---

### Requirement: .agent-runtime 在 .gitignore 中

`.agent-runtime/` MUST 被 Git 忽略，不成為版本控制的一部分。

#### Scenario: git status 不顯示 .agent-runtime

GIVEN `.agent-runtime/` 目錄存在且有檔案
WHEN 執行 `git status`
THEN `.agent-runtime/` MUST NOT 出現在 untracked files 或 changed files 中

#### Scenario: .gitignore 包含規則

GIVEN 專案根目錄的 `.gitignore`
WHEN 檢查內容
THEN MUST 包含 `.agent-runtime/` 忽略規則

---

### Requirement: 讀取例外規則

Agent MUST 預設遵守 `.gitignore`，只有在符合嚴格例外條件時才可讀取 `.agent-runtime/` 內容。

#### Scenario: 合法讀取

GIVEN `current-state.json` 中 `latestHandoff.to` 為 `"Codex"`
AND `latestHandoff.requiredInputRefs` 包含某個 ArtifactReference 指向 `.agent-runtime/<change-id>/artifacts/coordinator-result.json`
AND 該 reference 的 `changeId` 與當前任務一致
WHEN Codex 讀取該 artifact
THEN MUST 允許讀取

#### Scenario: 拒絕遞迴掃描

GIVEN Agent 嘗試使用 glob 或遞迴掃描整個 `.agent-runtime/`
WHEN 該 Agent 沒有被 Handoff 明確引用所有檔案
THEN Agent MUST NOT 掃描整個目錄
AND MUST 只讀取 Handoff 或 current-state.json 中明確引用的檔案

#### Scenario: 拒絕讀取其他 Change

GIVEN 當前任務的 changeId 為 `"add-agent-artifact-shared-state-handoff"`
WHEN Agent 嘗試讀取 `.agent-runtime/generalize-weather-location-resolution/current-state.json`
THEN Agent MUST 拒絕
AND changeId 不匹配

#### Scenario: 拒絕讀取其他 Run

GIVEN 當前 runId 為 `"run-2026-06-29-001"`
WHEN Agent 嘗試讀取 ArtifactReference 指向 `runId` 為 `"run-2026-06-28-002"` 的 artifact
AND 該 artifact 不在目前 Handoff 的 `requiredInputRefs` 中
THEN Agent MUST 拒絕
AND runId 不匹配且無明確引用

---

### Requirement: Path Traversal 防護

ArtifactReference 的 `relativePath` MUST 通過安全驗證。

#### Scenario: 拒絕 .. 路徑

GIVEN ArtifactReference 的 `relativePath` 為 `".agent-runtime/../../.env"`
WHEN Agent 嘗試讀取
THEN Agent MUST 拒絕
AND `relativePath` 包含 `..`

#### Scenario: 拒絕絕對路徑

GIVEN ArtifactReference 的 `relativePath` 為 `"C:\\Users\\admin\\secret.txt"` 或 `"/etc/passwd"`
WHEN Agent 嘗試讀取
THEN Agent MUST 拒絕
AND `relativePath` 為絕對路徑

#### Scenario: 只允許已知安全前綴

GIVEN ArtifactReference 的 `relativePath`
WHEN 驗證前綴
THEN MUST 以 `openspec/`、`.agent-runtime/` 或專案根目錄下的已知安全前綴開頭
AND 其他前綴 MUST 拒絕

---

### Requirement: Secret 禁止

Runtime Artifact MUST NOT 包含 Secret、API Key、Token 或 Credential。

#### Scenario: 寫入前檢查

GIVEN Agent 準備寫入 Runtime Artifact
WHEN 檢查內容
THEN MUST NOT 包含 Secret、API Key、Token、Password 或 Credential
AND 若發現 MUST 移除或拒絕寫入

#### Scenario: 讀取時檢查

GIVEN Agent 讀取 Runtime Artifact
WHEN 檢查內容
THEN 若發現疑似 Secret 的內容（例如 `sk-...`、`Bearer ...` 長 token）
THEN Agent MUST 停止讀取並回報安全疑慮
AND MUST NOT 將 Secret 傳遞到下游

---

### Requirement: 第一階段不保留歷史版本

第一階段 Runtime Boundary MUST 只保留最新一份 Artifact，不建立歷史版本。

#### Scenario: 覆蓋既有 Artifact

GIVEN `.agent-runtime/<change-id>/artifacts/implementation-result.json` 已存在
AND Codex 重新執行修復（第二輪 IMPLEMENTING）
WHEN Codex 寫入新的 implementation_result
THEN 舊檔案 MAY 被覆蓋
AND 不保留第一輪的歷史版本

#### Scenario: 不建立 events.ndjson

GIVEN 第一階段實作
WHEN 檢查 `.agent-runtime/<change-id>/`
THEN MUST NOT 包含 `events.ndjson`
AND MUST NOT 包含 `token-trace.json`
AND MUST NOT 包含 `llm-trace.json`
AND MUST NOT 包含 SQLite、PostgreSQL 或 Redis 相關檔案

---

### Requirement: 生命週期

Runtime Artifact 的生命週期 MUST 從 Change 開始到 Archive 後手動清理。

#### Scenario: Archive 後可手動清理

GIVEN `currentPhase` 為 `"COMPLETED"`
WHEN 人工決定清理
THEN `.agent-runtime/<change-id>/` 目錄 MAY 被手動刪除
AND 不影響 `openspec/changes/` 中的 Durable Knowledge

#### Scenario: 不自動清理

GIVEN 第一階段 Runtime Boundary
WHEN Change 完成或失敗
THEN MUST NOT 自動刪除 `.agent-runtime/<change-id>/`
AND 清理由人工決定
