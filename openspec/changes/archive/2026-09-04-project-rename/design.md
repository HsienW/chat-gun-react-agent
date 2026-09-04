# Design：project-rename

## 責任邊界

### Backend

- package 元資料根名稱 → `chat-gun-backend`（lockfile 同步）。
- `runtime-config`：`OTEL_SERVICE_NAME`、`OPIK_PROJECT_NAME` 預設值 → `chat-gun`。
- 四個 HTTP 工具（weather / web-fetch / web-search / geocoding）：User-Agent → `chat-gun/0.1`。
- `mcp-loader`：MCP client name → `chat-gun-<serverName>`。

### BFF

- package 元資料根名稱 → `chat-gun-bff`（lockfile 同步）。
- Docker image → `chat-gun-bff`（於 Docker compose 設定）。

### Frontend

- package 元資料根名稱 → `chat-gun-frontend`（lockfile 同步）。
- 頁籤 `<title>` → `Chat Gun`。

### 專案根（文件／規則／設定）

- README ×3、架構文件 ×4、Agent 規則 ×7、`openspec/config.yaml`：專案全名與 clone URL／目錄指令更新。

## 名稱轉換表

| 用途 | 舊名稱 | 新名稱 |
| --- | --- | --- |
| 專案 slug | `chat-gun-react-agent` | `chat-gun` |
| 顯示名稱 | `Chat Gun React Agent` | `Chat Gun` |
| Backend package | `chat-gun-react-agent-backend` | `chat-gun-backend` |
| BFF package | `chat-gun-react-agent-bff` | `chat-gun-bff` |
| Frontend package | `chat-gun-react-agent-frontend` | `chat-gun-frontend` |
| Backend Docker image | `chat-gun-react-agent` | `chat-gun` |
| BFF Docker image | `chat-gun-react-agent-bff` | `chat-gun-bff` |
| HTTP User-Agent | `chat-gun-react-agent/0.1` | `chat-gun/0.1` |
| MCP client name | `chat-gun-react-agent-<serverName>` | `chat-gun-<serverName>` |
| GitHub repository | `HsienW/chat-gun-react-agent` | `HsienW/chat-gun` |
| 本機資料夾 | `C:\D\ai-agent\chat-gun-react-agent` | `C:\D\ai-agent\chat-gun` |

## Lockfile 更新策略

三個 workspace 皆為 private package。改 package 元資料名稱後，一律以 npm 指令重新產生／更新 lockfile（`npm install --package-lock-only` 或 `npm install`），不以手動編輯 lockfile，避免 `name` 不一致。

## Archived OpenSpec 保留策略

5 個 archived 檔案／7 處保留舊名稱：

- `agent-result.schema.json`、`current-state.schema.json`、`handoff.schema.json` 的 `$id` 是契約識別碼，無 migration 需求前不更換。
- `2026-08-09-add-observability-metrics-tracing/design.md`、`2026-08-13-integrate-opik-agent-tracing-evaluation/design.md` 維持當時決策與預設值歷史原貌。

因此完成後 `git grep` 預期仍會命中這 5 個檔案／7 處，屬預期結果。

## 外部項目（Human-owned，Codex 不執行）

| 項目 | 動作 | 責任 |
| --- | --- | --- |
| GitHub repository | `HsienW/chat-gun-react-agent` → `HsienW/chat-gun` | 人工 |
| 本機 git remote | `git remote set-url origin https://github.com/HsienW/chat-gun.git` | 人工 |
| 本機資料夾 | 停服務／關 IDE 後 `Rename-Item` | 人工 |
| 部署環境變數 | `OTEL_SERVICE_NAME`、`OPIK_PROJECT_NAME`、Docker image 名稱 | 人工 |

## 資料流

無執行期資料流變更。本 change 僅變更「身分 token」的字面值，不改動 LangGraph State、BFF 路由、Frontend 串流承接或任何呼叫鏈路，因此不存在逾時／取消／重試／降級語意需要重新定義。

## 替代方案

| 方案 | 優點 | 缺點 | 決策 |
| --- | --- | --- | --- |
| 全量改名（含 archived OpenSpec `$id`） | 名稱完全一致 | 破壞既有契約識別碼、需 migration、歷史紀錄失真 | 不採用 |
| 只改程式不改文件／規則 | 減少改動量 | 文件與實際名稱不一致、README clone URL 失效 | 不採用 |
| 依本指南 31 檔案／60 處精準改名 + 保留 archived | 範圍明確、可驗證、不破壞歷史契約 | 需同步外部項目 | **採用** |
