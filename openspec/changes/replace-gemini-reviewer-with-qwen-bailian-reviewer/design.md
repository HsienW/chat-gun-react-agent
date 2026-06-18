# Design：將 Gemini Reviewer 替換為 Qwen Code／百煉 Reviewer

## 1. 現況

```text
Claude Code
  └── Specification Coordinator / Integration Arbiter

Primary Implementer
  └── 程式實作、測試、建置與 Diff 說明

Gemini CLI
  └── Secondary Architecture Reviewer
      ├── GEMINI.md
      └── .gemini/
```

全域工程規則由根目錄與各套件 `AGENTS.md` 管理；Gemini 專屬文件只負責 Reviewer 角色、載入與輸出格式。

## 2. 目標架構

```text
Claude Code
  └── Specification Coordinator / Integration Arbiter

Primary Implementer
  └── 程式實作、測試、建置與 Diff 說明

Qwen Code
  └── Alibaba Cloud Model Studio（百煉）
      └── 千問模型
          └── Secondary Architecture Reviewer
              ├── QWEN.md
              ├── .qwen/settings.json
              ├── .qwen/agents/secondary-architecture-reviewer.md
              └── .qwen/skills/secondary-architecture-reviewer/
                  ├── SKILL.md
                  └── reference.md
```

## 3. 責任邊界

### `AGENTS.md`

保留跨工具、跨套件的工程規則，只更新工具專屬橋接文件範例，不加入 Qwen 實作細節。

### `CLAUDE.md`

保留 Claude 的規格管理與仲裁職責，指定 Qwen Code／百煉為預設 Secondary Architecture Reviewer，並定義指派資料、獨立審查、唯讀模式與 `INCOMPLETE` Gate。

### `QWEN.md`

承接原 `GEMINI.md` 的 Reviewer 契約，定義：

- 載入順序。
- 跨層、LangGraph、Tool、MCP 與安全審查範圍。
- Finding、Severity 與 Verdict。
- 百煉 Provider 與實際模型標示。
- 不執行 Shell 與不修改檔案的強制邊界。

### `.qwen/settings.json`

提供專案級 Qwen Code 設定：

- 以 OpenAI-compatible Provider 連接百煉。
- 從 `QWEN_API_KEY` 環境變數讀取 Credential。
- 預設模型設定為可調整的千問模型。
- `tools.approvalMode` 設為 `plan`。
- `permissions.deny` 阻擋 Edit、Write、Bash、WebFetch。
- 關閉專案 Reviewer 工作階段的自動記憶與使用統計。

設定檔不得包含真實 API Key。

### `.qwen/agents/secondary-architecture-reviewer.md`

使用 Project Subagent 表達 Reviewer 身份：

```yaml
model: inherit
approvalMode: plan
tools:
  - read_file
  - read_many_files
  - grep_search
  - glob
  - list_directory
  - skill
```

Subagent 不持有 Shell、Edit、Write、Web Fetch 或未列入白名單的 MCP Tool。

### `.qwen/skills/secondary-architecture-reviewer/`

`SKILL.md` 定義觸發條件、載入順序、審查流程、Finding、Severity 與 Verdict。

`reference.md` 保存詳細檢查維度，避免 `QWEN.md` 與 Subagent 重複承載全部審查清單。

## 4. 規則載入流程

```text
從專案根目錄啟動 Qwen Code
  ↓
載入 AGENTS.md 與 QWEN.md
  ↓
載入 .qwen/settings.json
  ↓
使用 secondary-architecture-reviewer Subagent
  ↓
載入 secondary-architecture-reviewer Skill
  ↓
依修改範圍讀取套件 AGENTS.md 與能力域規則
  ↓
讀取 OpenSpec、程式、測試、Patch／Diff 與驗證結果
  ↓
輸出 Review Result
```

## 5. 百煉接入

專案設定使用 OpenAI-compatible Provider：

```text
Base URL: https://dashscope.aliyuncs.com/compatible-mode/v1
Credential Environment Variable: QWEN_API_KEY
```

Credential 由使用者環境提供：

```powershell
$env:QWEN_API_KEY="..."
```

或：

```bash
export QWEN_API_KEY="..."
```

也可以使用 Qwen Code `/auth` 完成百煉認證。版本庫只保存 Provider、Model 與環境變數名稱，不保存 Credential。

模型設定屬於工具配置，不屬於 Reviewer Domain Contract。未來模型升級不得改變：

- Reviewer 職責。
- 唯讀權限。
- Finding 欄位。
- Severity。
- Verdict。

## 6. 唯讀安全設計

採用三層控制：

### 第一層：專案設定

```json
{
  "tools": {
    "approvalMode": "plan"
  },
  "permissions": {
    "deny": ["Edit", "Write", "Bash", "WebFetch"]
  }
}
```

### 第二層：Subagent

- `approvalMode: plan`。
- 僅提供讀取、搜尋、Glob、列目錄與 Skill。

### 第三層：Reviewer 契約

`QWEN.md` 與 Skill 明確禁止：

- 修改檔案。
- 執行 Shell。
- 外部網路操作。
- Git 寫操作。
- 安裝與建置。
- 未允許的 MCP Tool。

即使使用者要求直接修正，Reviewer 也只能輸出 Finding 與 Suggested Fix。

## 7. Diff 與驗證資料交接

Reviewer 不執行 Shell，因此 Claude 或 Primary Implementer 必須提供：

```text
Review Target
Base / Merge Base / Commit
Changed Files
完整 Patch 或等價 Git Diff
git status --short
git diff --stat
git diff --check
lint / test / build 真實輸出
Unverified Areas
```

缺少證據時：

- 可局部審查的範圍標示 `Unverified`。
- 無法建立可靠結論時 Verdict 為 `INCOMPLETE`。

## 8. 審查輸出相容性

保留：

```text
Blocker
Major
Minor

APPROVE
REQUEST_CHANGES
COMMENT_ONLY
INCOMPLETE
```

Finding 保留：

```text
Severity
File / Symbol / Line
Status
Trigger
Issue
Impact
Evidence
Suggested Fix
Confidence
```

新增 Runtime 標識：

```text
Host: Qwen Code
Provider: Alibaba Cloud Model Studio (Bailian)
Model
Reviewer Agent
Reviewer Skill
```

## 9. 舊 Reviewer 移除

最終狀態刪除：

```text
GEMINI.md
.gemini/
```

若先前套用未完成的豆包 Reviewer 試作，清理腳本只刪除下列已知專屬 artifacts：

```text
.trae/rules/doubao-reviewer.md
.traecli/skills/secondary-architecture-reviewer/
openspec/changes/replace-gemini-reviewer-with-doubao-reviewer/
```

不刪除其他 TRAE 設定。

由於 ZIP 覆蓋無法刪除既有檔案，交付包提供 Windows 與 macOS/Linux 清理腳本。腳本只有在 Qwen Reviewer 必要檔案存在時才執行。

## 10. 驗證方案

### 結構驗證

- JSON 語法有效。
- Subagent YAML Frontmatter 有效。
- Skill YAML Frontmatter 有效。
- Qwen Reviewer 必要檔案存在。
- ZIP 不包含 frontend、bff、backend 業務程式。

### 載入驗證

1. 從專案根目錄啟動 Qwen Code。
2. 使用 `/memory` 確認 `QWEN.md` 與 `AGENTS.md`。
3. 使用 `/agents manage` 或等價介面確認 `secondary-architecture-reviewer`。
4. 使用 `/skills` 確認同名 Skill。
5. 使用 `/model` 確認千問模型。

### 百煉驗證

- 設定 `QWEN_API_KEY` 或透過 `/auth` 認證。
- 啟動後確認 Provider 與模型可用。
- 不在 Git Diff 中出現 Credential。

### 唯讀驗證

1. 由外部終端記錄 `git status --short`。
2. 指派固定 Patch 給 Reviewer。
3. 要求 Reviewer 直接修改檔案，預期拒絕。
4. 審查後由外部終端再次檢查 Git 狀態。
5. 不得出現 Reviewer 產生的新修改。

### 輸出契約驗證

使用固定 Fixture 驗證：

- 一個 Blocker → `REQUEST_CHANGES`。
- 一個 Major → `REQUEST_CHANGES`。
- 無 Finding 且證據完整 → `APPROVE`。
- 缺 Base、Diff 或模型確認 → `INCOMPLETE`。

## 11. Suggested file changes

新增：

```text
QWEN.md
.qwen/settings.json
.qwen/agents/secondary-architecture-reviewer.md
.qwen/skills/secondary-architecture-reviewer/SKILL.md
.qwen/skills/secondary-architecture-reviewer/reference.md
openspec/changes/replace-gemini-reviewer-with-qwen-bailian-reviewer/proposal.md
openspec/changes/replace-gemini-reviewer-with-qwen-bailian-reviewer/design.md
openspec/changes/replace-gemini-reviewer-with-qwen-bailian-reviewer/tasks.md
openspec/changes/replace-gemini-reviewer-with-qwen-bailian-reviewer/specs/ai-development-collaboration/spec.md
```

修改：

```text
CLAUDE.md
AGENTS.md
```

刪除：

```text
GEMINI.md
.gemini/
```

不修改：

```text
frontend/
bff/
backend/
README.md
docker-compose.yml
openspec/changes/generalize-weather-location-resolution/
```

## 12. Alternatives considered

### 將 `GEMINI.md` 直接改名為 `QWEN.md`

不採用單純改名。它無法建立 Subagent 工具白名單、專案權限、Skill 載入與百煉 Provider 設定。

### 只使用一次性 Prompt

不採用。無法版本控制、無法驗證規則載入，也容易遺漏唯讀、Severity 與 Verdict。

### 把完整 Reviewer 規則寫入 `AGENTS.md`

不採用。會污染 Claude、Codex 與 Primary Implementer 的全域 Context，破壞工具專屬規則邊界。

### 允許 Reviewer 執行唯讀 Shell

不採用。Subagent Tool Allowlist 無法只靠工具名稱精確限制所有 Shell 參數；本設計改由 Coordinator 提供 Patch 與命令輸出。

### 在設定檔寫入 API Key

不採用。Credential 必須來自環境或 Qwen Code 認證流程。

### 同時遷移 Gemini Runtime

不採用。開發協作 Reviewer 與產品 Runtime 是不同責任與風險域，必須拆成獨立 Change。
