# ai-development-collaboration Specification

## Purpose
TBD - created by archiving change replace-gemini-reviewer-with-qwen-bailian-reviewer. Update Purpose after archive.
## Requirements
### Requirement: Secondary Architecture Reviewer 使用 Qwen Code 與阿里雲百煉千問模型

開發協作流程 MUST 使用 Qwen Code 搭配阿里雲百煉千問模型執行 Secondary Architecture Reviewer，且 MUST NOT 將其他 Provider 或模型的輸出誤標為 Qwen／百煉 Reviewer 結論。

#### Scenario: 使用 Qwen／百煉 Reviewer 執行完整審查

- GIVEN Qwen Code 已透過阿里雲百煉完成認證
- AND 實際使用的千問模型 ID 已確認
- AND `secondary-architecture-reviewer` Subagent 與 Skill 已載入
- WHEN 使用者要求審查指定 OpenSpec Change 與 Patch
- THEN Reviewer MUST 標示 `Host: Qwen Code`
- AND MUST 標示 `Provider: Alibaba Cloud Model Studio (Bailian)`
- AND MUST 標示實際模型 ID
- AND MUST 使用既定 Finding、Severity 與 Verdict 契約

#### Scenario: 無法確認百煉認證或千問模型

- GIVEN Reviewer 無法確認目前 Provider 或模型
- WHEN 使用者要求完整審查
- THEN Reviewer MUST NOT 將結果標記為完整 Qwen／百煉 Reviewer 結論
- AND Verdict MUST 為 `INCOMPLETE`
- AND MUST 列出認證或模型確認缺口

### Requirement: Reviewer 規則使用 Qwen Code 原生載入機制

系統 MUST 透過根目錄 `QWEN.md`、Qwen Project Subagent 與 Project Skill 載入 Reviewer 規則，並 MUST 保留根與套件 `AGENTS.md` 的工程規則作用域。

#### Scenario: 從專案根目錄啟動 Qwen Code

- GIVEN 專案包含 `QWEN.md`
- AND 專案包含 `.qwen/agents/secondary-architecture-reviewer.md`
- AND 專案包含 `.qwen/skills/secondary-architecture-reviewer/SKILL.md`
- WHEN Qwen Code 從專案根目錄啟動
- THEN Qwen Code MUST 載入根目錄 `QWEN.md`
- AND MUST 讀取根目錄 `AGENTS.md`
- AND MUST 能發現 `secondary-architecture-reviewer` Subagent
- AND MUST 能發現 `secondary-architecture-reviewer` Skill

#### Scenario: 必要 Reviewer Artifact 未載入

- GIVEN `QWEN.md`、Subagent、Skill 或必要 `AGENTS.md` 任一無法確認已載入
- WHEN 使用者要求完整審查
- THEN Reviewer MUST NOT 假裝已套用完整審查契約
- AND Verdict MUST 為 `INCOMPLETE`

### Requirement: Reviewer 使用雙重唯讀權限控制

Secondary Architecture Reviewer MUST 使用專案級權限限制與 Subagent Tool Allowlist 保持唯讀，MUST NOT 修改程式碼、OpenSpec、設定、測試、文件或 Git 歷史。

#### Scenario: Reviewer 讀取指定 Patch

- GIVEN `.qwen/settings.json` 使用 `plan` 模式並禁止 Edit、Write、Bash、WebFetch
- AND Subagent 只允許讀取、搜尋、Glob、列目錄與 Skill
- WHEN Reviewer 讀取規格、程式、測試與 Coordinator 提供的 Patch
- THEN Reviewer MUST NOT 新增、修改或刪除工作目錄檔案
- AND MUST NOT 執行 Shell 或外部網路操作

#### Scenario: Reviewer 被要求直接修正程式

- GIVEN Reviewer 正在唯讀審查工作階段
- WHEN 使用者要求 Reviewer 直接修改檔案或執行命令
- THEN Reviewer MUST 拒絕該操作
- AND MUST 以 Finding 或 Suggested Fix 回覆
- AND MUST NOT 放寬 `plan` 模式或 Tool Allowlist

#### Scenario: 父工作階段使用寬鬆權限

- GIVEN 父 Qwen Code 工作階段以 `auto-edit` 或 `yolo` 啟動
- WHEN Reviewer 無法證明專案 deny 規則與 Subagent 白名單仍有效
- THEN Reviewer MUST 停止完整審查
- AND Verdict MUST 為 `INCOMPLETE`

### Requirement: Reviewer Credential 不得進入版本庫

專案 MUST NOT 在 `QWEN.md`、`.qwen/settings.json`、Subagent、Skill、OpenSpec 或其他版本控制檔案中保存真實百煉 API Key、Token 或 Workspace Credential。

#### Scenario: 使用環境變數提供百煉 API Key

- GIVEN `.qwen/settings.json` 將 Provider Credential 指向 `QWEN_API_KEY`
- WHEN 使用者啟動 Qwen Code
- THEN Qwen Code MUST 從使用者環境或認證流程取得 Credential
- AND Git Diff MUST NOT 包含真實 Credential

#### Scenario: 缺少百煉 Credential

- GIVEN 使用者環境未提供有效 Credential
- WHEN Qwen Code 無法完成百煉認證
- THEN Reviewer MUST 將該次審查標記為 `INCOMPLETE`
- AND MUST NOT 將 Credential 寫入專案檔案作為修復方式

### Requirement: Reviewer 輸出契約保持相容

Qwen／百煉 Reviewer MUST 保持既有審查 Severity、Finding 欄位與 Verdict 語意。

#### Scenario: 發現 Blocker

- GIVEN Reviewer 確認本次 Patch 存在安全漏洞、公開契約破壞或主要流程必然失敗
- WHEN Reviewer 產生審查結果
- THEN Finding Severity MUST 為 `Blocker`
- AND Verdict MUST 為 `REQUEST_CHANGES`

#### Scenario: 無確認問題且證據完整

- GIVEN Reviewer 已取得可靠 Base、Patch、OpenSpec 與必要驗證結果
- AND 沒有確認的 Blocker、Major 或 Minor Finding
- WHEN Reviewer 完成審查
- THEN Reviewer MUST 輸出 `No confirmed findings`
- AND Verdict MUST 為 `APPROVE`

#### Scenario: 缺少審查基礎資料

- GIVEN 缺少可靠 Base、Patch、OpenSpec 或關鍵驗證結果
- WHEN Reviewer 無法完成完整審查
- THEN Verdict MUST 為 `INCOMPLETE`
- AND MUST 列出未驗證區域

### Requirement: Reviewer 保持獨立

Qwen／百煉 Reviewer MUST 在第一次審查前獨立閱讀規格、程式與 Patch，不得直接以 Claude、Codex 或其他 Reviewer 的既有結論作為主要證據。

#### Scenario: Claude 已取得另一份審查結論

- GIVEN Claude 已取得其他 Reviewer 的結果
- WHEN Claude 指派 Qwen／百煉 Reviewer 進行第一次獨立審查
- THEN Claude MUST 提供 Target、Base、OpenSpec、Patch 與驗證結果
- BUT MUST NOT 將其他 Reviewer 結論作為主要輸入
- AND Qwen／百煉 Reviewer MUST 先產生獨立 Findings

### Requirement: Diff 與驗證證據由 Coordinator 提供

由於 Reviewer 不具有 Shell 權限，Claude 或 Primary Implementer MUST 提供審查所需 Patch、Git 狀態與驗證結果，Reviewer MUST 如實標示未提供的證據。

#### Scenario: Coordinator 提供完整證據

- GIVEN Coordinator 提供 Base、完整 Patch、Changed Files、Git 檢查與受影響套件驗證結果
- WHEN Reviewer 執行審查
- THEN Reviewer MUST 核對規格、程式、測試與證據
- AND MUST 在 Validation 區塊列出已提供與未提供項目

#### Scenario: 關鍵證據缺失

- GIVEN Coordinator 未提供完整 Patch 或關鍵驗證結果
- WHEN 缺口會影響 Reviewer 結論
- THEN Reviewer MUST 將相關區域標記為 `Unverified`
- AND 完整 Verdict MUST 為 `INCOMPLETE`

### Requirement: Gemini Reviewer 完成停用

完成遷移後，專案 MUST 移除 Gemini Reviewer 專屬橋接文件與整合目錄，且 Claude MUST NOT 自動回退使用 Gemini Reviewer。

#### Scenario: 套用 Reviewer 遷移

- GIVEN Qwen Reviewer 的 QWEN.md、設定、Subagent、Skill 與 OpenSpec Change 已存在
- WHEN 執行遷移清理
- THEN `GEMINI.md` MUST 被刪除
- AND `.gemini/` MUST 被刪除
- AND Claude 的 Reviewer 指派 MUST 指向 Qwen Code／百煉

#### Scenario: Qwen／百煉 Reviewer 暫時不可用

- GIVEN Qwen Reviewer 因安裝、Credential、模型、Subagent 或 Skill 問題不可用
- WHEN Claude 需要獨立架構審查
- THEN Claude MUST 將審查狀態標記為未完成
- AND MUST NOT 未經明確決策自動回退至 Gemini Reviewer

### Requirement: 產品 Runtime 不受 Reviewer 遷移影響

本 Change MUST NOT 修改 frontend、bff、backend、LangGraph Graph、Runtime Model Provider、API、事件、錯誤碼或資料格式。

#### Scenario: 檢查最終 Git Diff

- GIVEN Reviewer 遷移檔案已套用
- WHEN 檢查最終 Git Diff
- THEN Diff MUST 只包含協作規則、Qwen Reviewer 設定、Subagent、Skill、OpenSpec Change 與舊 Reviewer 清理
- AND MUST NOT 包含 `frontend/`、`bff/` 或 `backend/` 業務程式修改
- AND MUST NOT 修改 Runtime Gemini Provider 或 Credential 設定

