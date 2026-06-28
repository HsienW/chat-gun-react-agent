# Agent Result Contract

## ADDED Requirements

### Requirement: Agent Result Envelope 共同結構

所有 Agent 輸出 MUST 使用統一的 Agent Result Envelope，包含共同欄位與 discriminated union。

#### Scenario: 正常 coordinator_result 產生

GIVEN CCR 完成 plan-change 階段
WHEN CCR 產生 coordinator_result
THEN 輸出 MUST 包含 `schemaVersion`、`artifactId`、`changeId`、`runId`、`producer`、`stage`、`kind`、`status`、`createdAt`、`summary`、`inputRefs`、`outputRefs`、`verification`、`risks`、`nextHandoff` 欄位
AND `kind` MUST 為 `"coordinator_result"`
AND `producer` MUST 為 `"CCR"`

#### Scenario: 正常 review_result 產生

GIVEN Qwen 完成 review-plan 審查
WHEN Qwen 輸出 review_result
THEN 輸出 MUST 包含共同 Envelope 欄位
AND `kind` MUST 為 `"review_result"`
AND `producer` MUST 為 `"Qwen"`
AND `payload.verdict` MUST 為 `APPROVE` | `REQUEST_CHANGES` | `COMMENT_ONLY` | `INCOMPLETE`

#### Scenario: schemaVersion 不匹配

GIVEN Agent 讀取到一個 schemaVersion 為 `"2.0.0"` 的 artifact（與 Agent 理解的 `"1.0.0"` major 不同）
WHEN Agent 嘗試解析
THEN Agent MUST 拒絕處理並報錯
AND 不得 silent ignore 或以錯誤 shape 解析

#### Scenario: 未知 kind 處理

GIVEN Agent 讀取到 `kind` 為 `"unknown_future_kind"` 的 artifact
WHEN Agent 嘗試解析
THEN Agent MUST 將 payload 視為 `unknown`
AND MUST 保留原始 payload 供人類檢查
AND MUST NOT 假設 payload shape

#### Scenario: 必要欄位缺失

GIVEN 一個 artifact 缺少 `changeId` 或 `artifactId` 欄位
WHEN 任何 Agent 嘗試讀取
THEN Agent MUST 拒絕該 artifact
AND MUST 回報 Schema Validation Error

---

### Requirement: Discriminated Union 定義

`kind` 欄位 MUST 使用 discriminated union，不同 kind 有各自的 payload 定義。

#### Scenario: 各 kind 的 producer 對應

GIVEN Agent Result 的 `kind` 欄位
WHEN kind 為 `coordinator_result`
THEN `producer` MUST 為 `"CCR"`
WHEN kind 為 `implementation_result`
THEN `producer` MUST 為 `"Codex"`
WHEN kind 為 `review_result`
THEN `producer` MUST 為 `"Qwen"`
WHEN kind 為 `readiness_result`
THEN `producer` MUST 為 `"CCR"`
WHEN kind 為 `archive_result`
THEN `producer` MUST 為 `"Codex"`
WHEN kind 為 `handoff`
THEN `producer` MUST 為 `"CCR"`

#### Scenario: review_result 的 payload 結構

GIVEN `kind` 為 `"review_result"`
WHEN 檢查 payload
THEN payload MUST 包含 `verdict`（enum: APPROVE | REQUEST_CHANGES | COMMENT_ONLY | INCOMPLETE）
AND payload MUST 包含 `findings`（包含 blocker、major、minor 陣列）
AND payload MUST 包含 `crossLayerContractCheck`
AND payload MUST 包含 `residualRisks`
AND payload MUST 包含 `positiveNotes`

---

### Requirement: Verification 欄位結構

每個 Agent Result MUST 包含 `verification` 欄位，記錄已執行、通過、失敗、未執行的驗證。

#### Scenario: 完整驗證記錄

GIVEN Codex 完成實作並執行 lint、test、build
WHEN Codex 產生 implementation_result
THEN `verification.executed` MUST 包含實際執行的命令
AND `verification.passed` MUST 包含通過的項目
AND `verification.failed` MUST 包含失敗的項目
AND `verification.notExecuted` MUST 包含未執行的項目

#### Scenario: 未執行項目標示

GIVEN Qwen 無法自行執行 test 或 build
WHEN Qwen 輸出 review_result
THEN `verification.notExecuted` MUST 明確列出所有未執行的驗證
AND Qwen MUST NOT 標示未執行的驗證為 passed

---

### Requirement: inputRefs 與 outputRefs 結構

Agent Result MUST 記錄引用了哪些上游 Artifact（inputRefs），以及產生了哪些可供下游引用的 Artifact（outputRefs）。

#### Scenario: 引用上游 artifact

GIVEN Codex 從 current-state.json 的 latestArtifactRefs 取得 proposal/design/tasks
WHEN Codex 產生 implementation_result
THEN `inputRefs` MUST 包含 proposal、design、tasks 的 ArtifactReference
AND 每個 reference MUST 包含 `artifactId`、`changeId`、`relativePath`

#### Scenario: 產出下游 artifact

GIVEN Codex 完成實作並更新 OpenSpec tasks.md
WHEN Codex 產生 implementation_result
THEN `outputRefs` MUST 包含更新後的 tasks.md 與 implementation_result 本身的 reference
AND `outputRefs` 中的每個項目都可供下游 Agent 引用

---

### Requirement: Artifact 版本演進

Agent Result Schema MUST 使用 `schemaVersion` 欄位支援版本演進。

#### Scenario: Minor version 向後相容

GIVEN Agent 理解的 schemaVersion 為 `"1.0.0"`
WHEN 讀取到 schemaVersion 為 `"1.1.0"` 的 artifact
THEN Agent SHOULD 盡力解析已知欄位
AND 未知的新增欄位 SHOULD 被保留但不得導致 parse error

#### Scenario: Major version 不相容

GIVEN Agent 理解的 schemaVersion 為 `"1.0.0"`
WHEN 讀取到 schemaVersion 為 `"2.0.0"` 的 artifact
THEN Agent MUST 拒絕處理
AND MUST 報錯說明版本不相容
