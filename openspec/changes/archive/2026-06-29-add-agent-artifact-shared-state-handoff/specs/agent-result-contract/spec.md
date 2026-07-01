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

#### Scenario: Schema Validation 階段拒絕未知 kind

GIVEN 一個 artifact 的 `kind` 欄位值不在 `agent-result.schema.json` 的 `kind` enum 中
WHEN 對該 artifact 執行 Schema Validation
THEN Schema Validation MUST 失敗
AND Agent MUST 回報 Schema Error（`kind` 值不合法）
AND Agent MUST NOT 嘗試以 unknown fallback 解析

#### Scenario: 已知 kind 但 payload 包含未定義欄位

GIVEN `kind` 在 Schema enum 中（例如 `"review_result"`）
WHEN payload 包含 Schema 未定義的額外欄位
THEN 依 `additionalProperties: false`，Schema Validation MUST 失敗
AND Agent MUST 回報 Schema Error
AND 這是向後不相容變更的信號，需檢查 schemaVersion

#### Scenario: Schema 版本演進後新增 kind

GIVEN Schema 的新 major 或 minor 版本新增了 `kind` enum 值（例如 `"future_result"`）
WHEN Agent 使用新版 Schema 解析
THEN 新版 Schema 的 enum 包含 `"future_result"`，Validation 通過
AND 若 Agent 使用舊版 Schema，Validation 失敗（視為 schemaVersion 不相容）
AND 這是 schemaVersion 演進的正確行為

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

Agent Result Schema MUST 使用 `schemaVersion` 欄位支援版本演進。`kind` enum 的變更視為 Schema 變更的一部分，必須伴隨 `schemaVersion` 更新。

#### Scenario: Minor version 向後相容

GIVEN Agent 理解的 schemaVersion 為 `"1.0.0"`
WHEN 讀取到 schemaVersion 為 `"1.1.0"` 的 artifact
THEN Agent SHOULD 盡力解析已知欄位
AND 未知的新增欄位（若 Schema 允許）SHOULD 被保留但不得導致 parse error

#### Scenario: Major version 不相容

GIVEN Agent 理解的 schemaVersion 為 `"1.0.0"`
WHEN 讀取到 schemaVersion 為 `"2.0.0"` 的 artifact
THEN Agent MUST 拒絕處理
AND MUST 報錯說明版本不相容

#### Scenario: 新增 kind 需伴隨 schemaVersion 變更

GIVEN 需要在 agent-result.schema.json 中新增 `kind` enum 值
WHEN 修改 Schema
THEN 若新增的 kind 不改變既有欄位語意（純新增），SHOULD 遞增 minor schemaVersion
AND 若新增的 kind 改變既有 required 欄位或移除欄位，MUST 遞增 major schemaVersion
AND 所有 Agent MUST 先升級 Schema 理解才能處理新 kind
