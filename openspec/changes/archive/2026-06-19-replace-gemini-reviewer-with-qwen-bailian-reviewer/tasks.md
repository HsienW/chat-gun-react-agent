# Tasks：將 Gemini Reviewer 替換為 Qwen Code／百煉 Reviewer

## 1. Qwen Reviewer 宿主

- [x] 1.1 新增根目錄 `QWEN.md`，承接 Reviewer 角色、載入、Finding、Severity 與 Verdict 契約。
- [x] 1.2 新增 `.qwen/settings.json`，設定百煉 Provider、千問模型、`plan` 模式與禁止寫入權限。
- [x] 1.3 新增 `.qwen/agents/secondary-architecture-reviewer.md`。
- [x] 1.4 將 Subagent 設為 `approvalMode: plan`。
- [x] 1.5 將 Subagent 工具限制為讀取、搜尋、Glob、列目錄與 Skill。
- [x] 1.6 新增 `.qwen/skills/secondary-architecture-reviewer/SKILL.md`。
- [x] 1.7 新增 `reference.md` 保存詳細審查維度。

## 2. 百煉 Credential 與模型

- [x] 2.1 使用 `QWEN_API_KEY` 環境變數名稱，不提交真實 Credential。
- [x] 2.2 在 Qwen 專案設定中配置百煉 OpenAI-compatible Base URL。
- [x] 2.3 在輸出契約中要求標示 Host、Provider 與實際模型。
- [x] 2.4 無法確認百煉認證或千問模型時要求 `INCOMPLETE`。
- [x] 2.5 在目標環境設定有效的 `QWEN_API_KEY` 或完成 `/auth`。
- [x] 2.6 驗證目前百煉帳號可使用設定的千問模型。

## 3. 協作規則更新

- [x] 3.1 更新 `CLAUDE.md`，指定 Qwen Code／百煉為預設 Secondary Architecture Reviewer。
- [x] 3.2 更新 `CLAUDE.md`，定義 Subagent、Skill、唯讀模式與指派資料。
- [x] 3.3 更新 `CLAUDE.md`，禁止靜默回退 Gemini Reviewer。
- [x] 3.4 更新 `AGENTS.md` 的工具專屬橋接文件範例。
- [x] 3.5 確認未複製或降低根與套件 `AGENTS.md` 工程規則。

## 4. Gemini Reviewer 停用

- [x] 4.1 提供 Windows 清理腳本，安全刪除 `GEMINI.md` 與 `.gemini/`。
- [x] 4.2 提供 macOS/Linux 清理腳本，安全刪除 `GEMINI.md` 與 `.gemini/`。
- [x] 4.3 清理腳本可移除已知的未完成豆包 Reviewer 試作 artifacts，不影響其他 TRAE 設定。
- [x] 4.4 在目標分支實際執行清理腳本。
- [x] 4.5 確認 Git Diff 顯示舊 Gemini Reviewer artifacts 已刪除。

## 5. OpenSpec

- [x] 5.1 建立 Proposal。
- [x] 5.2 建立 Design。
- [x] 5.3 建立 `ai-development-collaboration` Delta Spec。
- [x] 5.4 建立可追溯 Tasks。
- [x] 5.5 執行 `openspec validate replace-gemini-reviewer-with-qwen-bailian-reviewer`。

## 6. 靜態驗證

- [x] 6.1 驗證 `.qwen/settings.json` 是有效 JSON。
- [x] 6.2 驗證 Subagent YAML Frontmatter 必要欄位。
- [x] 6.3 驗證 Skill YAML Frontmatter 必要欄位。
- [x] 6.4 驗證 ZIP 不包含 frontend、bff、backend 業務程式。
- [x] 6.5 驗證 Credential 未寫入交付包。

## 7. Qwen Code 驗證

- [x] 7.1 安裝並啟動 Qwen Code。
- [x] 7.2 使用 `/memory` 確認 `QWEN.md` 與 `AGENTS.md` 已載入。
- [x] 7.3 使用 `/agents manage` 或等價介面確認 `secondary-architecture-reviewer`。
- [x] 7.4 使用 `/skills` 確認 `secondary-architecture-reviewer` Skill。
- [x] 7.5 使用 `/model` 確認實際千問模型。
- [x] 7.6 使用固定 Patch 執行一次完整 Review。
- [x] 7.7 確認輸出包含 Runtime、Scope、Validation、Findings 與 Verdict。
- [x] 7.8 要求 Reviewer 修改檔案，確認拒絕且工作目錄不變。

## 8. 回歸

- [x] 8.1 確認 Claude 仍能遵守 `CLAUDE.md` 與 `AGENTS.md`。
- [x] 8.2 確認 Codex／Primary Implementer 不受 Qwen Reviewer 唯讀設定污染。
- [x] 8.3 確認 frontend、bff、backend、Runtime 模型設定與產品行為沒有 Diff。
- [x] 8.4 確認缺 Base、Diff、OpenSpec、百煉認證或模型確認時輸出 `INCOMPLETE`。
