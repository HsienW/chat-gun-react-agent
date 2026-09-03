# Tasks：project-rename

## Phase 0：前置檢查

### Task 0.1：確認工作樹乾淨且無無關變更

- [x] `git status` 確認無進行中的未提交改名或無關變更。
- [x] 確認目前分支為 rename 專用分支（`feat/2.8.2-feat/update-project-name` 或同義分支）。

**驗證：** `git status --short` 只剩預期檔案。

---

## Phase 1：Package metadata（6 檔案／9 處）

### Task 1.1：更新 backend / bff / frontend 的 package 名稱

- [x] `backend/package.json` → `chat-gun-backend`
- [x] `bff/package.json` → `chat-gun-bff`
- [x] `frontend/package.json` → `chat-gun-frontend`
- [x] 三個 lockfile 以 npm 更新，不手改

**對應 Spec：** `project-identity` / Package 命名一致性
**驗證：** `git grep -n -I -E 'chat-gun-react-agent' -- backend/package.json backend/package-lock.json bff/package.json bff/package-lock.json frontend/package.json frontend/package-lock.json` 回傳空。

---

## Phase 2：Observability（3 檔案／6 處）

### Task 2.1：更新 OTel / Opik 預設值與測試 expectation

- [x] `backend/src/platform/runtime-config.ts`：`OTEL_SERVICE_NAME`、`OPIK_PROJECT_NAME` 預設值 → `chat-gun`
- [x] `backend/src/platform/runtime-config.test.ts`：同步 expectation
- [x] `backend/.env.example`：`OPIK_PROJECT_NAME` 與 Windows 路徑範例

**對應 Spec：** `project-identity` / Observability 識別
**驗證：** `cd backend && npm run test` 中 runtime-config 相關測試通過。

---

## Phase 3：對外 HTTP User-Agent（4 檔案／4 處）

### Task 3.1：更新四個對外 HTTP 工具的 User-Agent

- [x] `backend/src/tools/weather.ts`
- [x] `backend/src/tools/web-fetch.ts`
- [x] `backend/src/tools/web-search.ts`
- [x] `backend/src/tools/geocoding/open-meteo-provider.ts`
- [x] 全部改為 `chat-gun/0.1`

**對應 Spec：** `project-identity` / 對外 HTTP User-Agent
**驗證：** `git grep -n -I 'chat-gun-react-agent/0.1' -- backend/src/tools` 回傳空。

---

## Phase 4：MCP client（1 檔案／1 處）

### Task 4.1：更新 MCP client name

- [x] `backend/src/tools/mcp-loader.ts` → `chat-gun-<serverName>`

**對應 Spec：** `project-identity` / MCP client 識別
**驗證：** `git grep -n -I 'chat-gun-react-agent-' -- backend/src/tools/mcp-loader.ts` 回傳空。

---

## Phase 5：Docker image（1 檔案／2 處）

### Task 5.1：更新 Docker compose image 名稱

- [x] `docker-compose.yml`：backend → `chat-gun`、bff → `chat-gun-bff`

**對應 Spec：** `project-identity` / Docker image 命名
**驗證：** `git grep -n -I 'chat-gun-react-agent' -- docker-compose.yml` 回傳空。

---

## Phase 6：前端顯示名稱（1 檔案／1 處）

### Task 6.1：更新前端頁籤標題

- [x] `frontend/index.html` `<title>` → `Chat Gun`

**驗證：** `git grep -n -I 'Chat Gun React Agent' -- frontend/index.html` 回傳空。

---

## Phase 7：文件、規則與專案設定（15 檔案／37 處）

### Task 7.1：README ×3

- [x] `README.md`、`README.en.md`、`README.zh-CN.md`：標題、描述、alt text、clone URL、`cd`／`Set-Location`、`OTEL_SERVICE_NAME` 範例

### Task 7.2：架構文件 ×4

- [x] `docs/architecture.md`、`docs/architecture.en.md`、`docs/typescript-langgraph-architecture.md`、`docs/typescript-langgraph-architecture.en.md`

### Task 7.3：Agent 規則 ×7

- [x] `AGENTS.md`、`CLAUDE.md`、`QWEN.md`、`.qwen/agents/secondary-architecture-reviewer.md`
- [x] `.agents/skills/chat-gun-{backend,bff,frontend}-contract/SKILL.md`（只改內容，不改 skill 目錄名）

### Task 7.4：OpenSpec 專案設定

- [x] `openspec/config.yaml` 專案名稱 → `chat-gun`

**對應 Spec：** `project-identity` / 顯示名稱、專案 slug
**驗證：** `git grep -n -I -E 'chat-gun-react-agent|Chat Gun React Agent' -- README.md README.en.md README.zh-CN.md docs AGENTS.md CLAUDE.md QWEN.md .qwen .agents openspec/config.yaml` 回傳空。

---

## Phase 8：整體驗證

### Task 8.1：舊名稱全域搜尋

- [x] `git grep -n -I -E 'chat-gun-react-agent|Chat Gun React Agent' -- . ':(exclude)RENAME_TO_CHAT_GUN_GUIDE.md'`
- [x] 預期只剩 5 個 archived 檔案／7 處，其餘逐一說明或修正。

### Task 8.2：Package 一致性

- [x] 三個 package 元資料與各自 lockfile 根名稱一致，無 import 依賴舊 package 名稱。

### Task 8.3：三 workspace 驗證

- [x] `cd frontend && npm run lint && npm run test && npm run build`
- [x] `cd bff && npm run build`（bff 無既有 test script；如有則一併執行）
- [x] `cd backend && npm run lint && npm run test && npm run build`

---

## Phase 9：外部項目（Human-owned，不列入自動化驗證）

### Task 9.1：GitHub repository 改名

- [ ] 在 GitHub 將 `HsienW/chat-gun-react-agent` 改為 `HsienW/chat-gun`。

### Task 9.2：本機 git remote 更新

- [ ] `git remote set-url origin https://github.com/HsienW/chat-gun.git`，確認 fetch/push。

### Task 9.3：本機資料夾改名

- [ ] 停服務、關 IDE 後 `Rename-Item` 資料夾，並重開專案確認 Git/npm/Docker/MCP 正常。

### Task 9.4：部署環境變數與 image

- [ ] 每套部署環境更新 `OTEL_SERVICE_NAME`、`OPIK_PROJECT_NAME`、Docker image 名稱。

**驗證：** 人工確認，不列入自動化。

---

## 相依性

| Task | 依賴 |
|------|------|
| 1.1 | 0.1 |
| 2.1 | 0.1（可與 1.1 平行） |
| 3.1–6.1 | 0.1（可平行） |
| 7.x | 0.1（可平行） |
| 8.x | 1.x–7.x 完成 |
| 9.x | 8.x 完成（Human-owned） |

## 建議執行順序

1. 0.1（前置檢查）
2. 1.1 → 2.1 → 3.1 → 4.1 → 5.1 → 6.1 → 7.x（可部分平行）
3. 8.1 → 8.2 → 8.3（整體驗證）
4. 9.1 → 9.2 → 9.3 → 9.4（Human-owned，順序不可顛倒）
