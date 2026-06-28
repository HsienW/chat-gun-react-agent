# Qwen Read-only Result Capture

## ADDED Requirements

### Requirement: Qwen 唯讀邊界保留

Qwen 的唯讀邊界 MUST 保持不變：Qwen 不得寫入任何檔案。

#### Scenario: Qwen 不直接寫入 Runtime Artifact

GIVEN Qwen 完成 review-plan 審查
WHEN Qwen 需要產出 review_result
THEN Qwen MUST NOT 呼叫 Write 或 Edit Tool
AND Qwen MUST NOT 直接寫入 `.agent-runtime/` 下的任何檔案
AND Qwen MUST 只輸出到 stdout 或聊天回應

#### Scenario: Qwen 唯讀設定不變

GIVEN `.qwen/settings.json` 的權限設定
WHEN 檢查 `permissions.deny`
THEN MUST 包含 `"Edit"`、`"Write"`、`"Bash"`
AND 本 Change MUST NOT 放寬這些限制

---

### Requirement: Qwen 輸出 Agent Result JSON

Qwen MUST 輸出符合 `agent-result.schema.json` 的 review_result，於標準 markdown 輸出之外提供結構化 JSON。

#### Scenario: review_result JSON 輸出

GIVEN Qwen 完成 review-plan 審查
WHEN Qwen 輸出結果
THEN 除了標準 markdown 格式（依 QWEN.md §11）
AND Qwen MUST 同時輸出一個符合 `agent-result.schema.json` 的 JSON 物件（可包在 markdown code fence 中）
AND JSON 的 `kind` MUST 為 `"review_result"`
AND JSON 的 `producer` MUST 為 `"Qwen"`

#### Scenario: JSON 與 markdown 一致性

GIVEN Qwen 輸出的 review_result JSON 與 markdown Finding
WHEN 人工核對
THEN JSON 中的 `payload.verdict` MUST 與 markdown 中的 Verdict 一致
AND JSON 中的 `payload.findings` MUST 與 markdown 中的 Findings 對應

---

### Requirement: review_result 保存方式（第一階段）

第一階段 MUST 由人工或 CLIHost 輔助保存 Qwen 輸出到 Runtime Artifact 路徑。

#### Scenario: CLIHost stdout capture 保存

GIVEN Qwen 輸出包含 review_result JSON
WHEN CLIHost 擷取 stdout
AND 提取 JSON（從 markdown code fence 或 raw JSON）
AND 驗證符合 `agent-result.schema.json`
THEN CLIHost MAY 寫入 `.agent-runtime/<change-id>/artifacts/review-result.json`
AND 寫入後 `current-state.json` 的 `latestArtifactRefs.reviewResult` MUST 更新為指向該檔案

#### Scenario: 人工複製保存

GIVEN Qwen 輸出 review_result JSON
WHEN 人工從 Qwen 輸出複製 JSON 內容
AND 手動寫入 `.agent-runtime/<change-id>/artifacts/review-result.json`
THEN 寫入後 `current-state.json` 的 `latestArtifactRefs.reviewResult` MUST 更新為指向該檔案

#### Scenario: 輸出格式不合法

GIVEN Qwen 輸出內容不包含有效的 review_result JSON
WHEN CLIHost 或人工嘗試提取或驗證
THEN MUST 拒絕保存
AND MUST 回報格式不合法
AND 不得將不合法內容寫入 artifact 路徑

---

### Requirement: INCOMPLETE 條件

Qwen MUST 在無法完成可靠審查時輸出 INCOMPLETE。

#### Scenario: 缺少 Base/Diff/關鍵驗證

GIVEN Qwen 被指派 review-plan 或 review-result
WHEN Coordinator 沒有提供 Base Ref、Diff 或關鍵驗證證據
THEN Qwen MUST 在 Verdict 中輸出 `INCOMPLETE`
AND MUST 列出所有缺失的輸入

#### Scenario: 百煉認證或模型無法確認

GIVEN Qwen 無法確認百煉認證或千問模型
WHEN Qwen 嘗試開始審查
THEN Qwen MUST 在 Verdict 中輸出 `INCOMPLETE`
AND MUST 在 Scope 中標示 model 為 `unverified`

#### Scenario: 唯讀邊界可能被覆蓋

GIVEN Qwen 的父工作階段權限設定可能覆蓋 Subagent 的 `plan` 邊界
WHEN Qwen 檢測到此情況
THEN Qwen MUST 停止審查並輸出 `INCOMPLETE`
AND MUST 說明權限衝突

---

### Requirement: 不新增 Qwen 的 Tool 或權限

本 Change MUST NOT 為 Qwen 新增任何 Write、Edit、Bash 或網路存取權限。

#### Scenario: 權限白名單不變

GIVEN `.qwen/settings.json` 和 `.qwen/agents/secondary-architecture-reviewer.md`
WHEN 本 Change 完成
THEN Qwen 的 Tool 白名單 MUST 仍僅限 read_file、read_many_files、grep_search、glob、list_directory、skill
AND MUST NOT 新增任何寫入類 Tool
