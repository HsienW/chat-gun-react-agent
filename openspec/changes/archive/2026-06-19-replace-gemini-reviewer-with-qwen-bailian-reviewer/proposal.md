# Proposal：將 Gemini Reviewer 替換為 Qwen Code／百煉 Reviewer

## Intent

將開發協作流程中的 Secondary Architecture Reviewer 從 Gemini CLI 遷移至 Qwen Code，並由阿里雲百煉提供千問模型服務，同時保持既有唯讀權限、審查範圍、Finding 品質、Severity 與 Verdict 契約。

## Goals

1. 使用 Qwen Code 搭配阿里雲百煉千問模型承擔 Secondary Architecture Reviewer。
2. 以 Qwen Code 原生 `QWEN.md`、Project Subagent 與 Project Skill 載入 Reviewer 規則。
3. Reviewer 預設唯讀，不修改程式碼、OpenSpec、設定、測試、文件與 Git 歷史。
4. 以專案設定與 Subagent Tool Allowlist 雙重限制寫入、Shell 與外部操作。
5. 保持既有 `Blocker`、`Major`、`Minor` 與 `APPROVE`、`REQUEST_CHANGES`、`COMMENT_ONLY`、`INCOMPLETE` 語意。
6. 保持 frontend、bff、backend、LangGraph、Tool、MCP、安全與跨層契約的審查範圍。
7. Claude 仍擔任 Specification Coordinator 與 Integration Arbiter。
8. 根與套件 `AGENTS.md` 仍是工程規則來源。
9. 停用 Gemini Reviewer，不把 Gemini 當成 Qwen Reviewer 的自動回退。
10. 百煉 Credential 只能由使用者環境或 Qwen Code 認證流程提供，不得提交版本庫。

## Non-goals

本 Change 不處理：

- Backend Runtime 的 Gemini 模型供應商替換。
- `chatbot`、`deep_researcher`、`math_agent` 或 `mcp_agent` 的模型遷移。
- frontend、bff、backend 業務程式修改。
- LangGraph Graph、Tool、MCP、API、Stream Event 或 Error Contract 修改。
- 將 Qwen Code 設為 Primary Implementer。
- 自動執行 Lint、Test、Build 或 Git 命令。
- 把 API Key、Token、Workspace ID 或其他 Credential 寫入版本庫。
- 建立百煉帳號、購買 Coding Plan 或管理模型額度。

## Scope

### 新增

```text
QWEN.md
.qwen/settings.json
.qwen/agents/secondary-architecture-reviewer.md
.qwen/skills/secondary-architecture-reviewer/SKILL.md
.qwen/skills/secondary-architecture-reviewer/reference.md
```

### 修改

```text
CLAUDE.md
AGENTS.md
```

### 停用與移除

```text
GEMINI.md
.gemini/
```

若先前曾套用未完成的豆包 Reviewer 試作，遷移時也移除該試作的專屬 Rule、Skill 與未完成 Change。

### OpenSpec

新增：

```text
replace-gemini-reviewer-with-qwen-bailian-reviewer
```

新增能力域 Delta Spec：

```text
ai-development-collaboration
```

## Compatibility

- 不改變產品 Runtime、Graph ID、BFF Route、API、事件、錯誤碼或資料格式。
- 不改變 Claude 與 Primary Implementer 的既有職責。
- 不降低根與套件 `AGENTS.md`、OpenSpec、安全與驗證門檻。
- Reviewer Finding、Severity 與 Verdict 保持向後相容。
- 百煉模型 ID 可透過 Qwen Code 設定調整，不得影響 Reviewer Domain Contract。

## Risks

### Qwen Code 未載入專案規則

若 Qwen Code 未從專案根目錄啟動，可能無法載入 `QWEN.md`、`AGENTS.md`、Project Subagent 或 Project Skill。

緩解：

- 從專案根目錄啟動。
- 使用 `/memory` 確認 `QWEN.md` 與 `AGENTS.md` 已載入。
- 使用 `/agents manage` 或等價介面確認 Subagent。
- 使用 `/skills` 確認 Skill。
- 任一必要載入無法確認時輸出 `INCOMPLETE`。

### 權限模式被放寬

Qwen Code 的父工作階段若以 `auto-edit` 或 `yolo` 啟動，可能破壞 Reviewer 唯讀假設。

緩解：

- `.qwen/settings.json` 設定 `tools.approvalMode: plan`。
- 專案 `permissions.deny` 阻擋 Edit、Write、Bash、WebFetch。
- Subagent 設定 `approvalMode: plan` 與讀取工具白名單。
- 偵測到權限可能被覆蓋時停止審查並輸出 `INCOMPLETE`。

### 百煉認證或模型不可用

API Key、地域、模型權限、限流或額度可能使 Reviewer 無法完成。

緩解：

- Credential 僅由環境變數或 `/auth` 提供。
- 輸出中標示實際 Provider 與 Model。
- 無法確認百煉認證或千問模型時輸出 `INCOMPLETE`。
- 不自動回退 Gemini。

### Reviewer 無法自行取得 Git Diff 與驗證結果

唯讀工具白名單不包含 Shell，Reviewer 無法自行執行 Git、Lint、Test 或 Build。

緩解：

- Claude 或 Primary Implementer 在指派時提供完整 Patch／Diff 與真實命令輸出。
- Reviewer 對缺少證據的區域標記 `Unverified`。
- 缺少關鍵證據時輸出 `INCOMPLETE`。

### 舊 Gemini Reviewer 殘留

若 `GEMINI.md` 或 `.gemini/` 保留，使用者可能誤啟動舊 Reviewer。

緩解：

- 套用變更時執行清理腳本。
- Claude 不得將 Gemini 作為自動回退。

## Rollback strategy

若 Qwen Code／百煉 Reviewer 無法達到既有審查品質：

1. 保留本 Change 與驗證紀錄。
2. 暫停將 Qwen Reviewer 作為必要 Gate。
3. 從 Git 恢復上一版 `GEMINI.md` 與 `.gemini/`。
4. 還原 `CLAUDE.md`、`AGENTS.md` 的 Reviewer 宿主設定。
5. 移除 `QWEN.md` 與 `.qwen/` Reviewer artifacts。
6. 不修改任何產品 Runtime 程式或 Gemini Runtime 設定。

## Success criteria

1. Qwen Code 能載入根目錄 `QWEN.md` 與 `AGENTS.md`。
2. Qwen Code 能發現 `secondary-architecture-reviewer` Subagent 與 Skill。
3. Qwen Code 透過百煉認證使用可確認的千問模型。
4. Reviewer 只能使用讀取類工具，無法寫檔、執行 Shell 或 Web Fetch。
5. 同一份 Fixture Diff 能輸出既定 Finding 欄位、Severity 與 Verdict。
6. 缺 Base、Diff、OpenSpec、關鍵驗證、百煉認證或模型確認時輸出 `INCOMPLETE`。
7. `GEMINI.md` 與 `.gemini/` 已移除。
8. frontend、bff、backend 與 Runtime 設定沒有 Diff。
9. `openspec validate replace-gemini-reviewer-with-qwen-bailian-reviewer` 通過。
