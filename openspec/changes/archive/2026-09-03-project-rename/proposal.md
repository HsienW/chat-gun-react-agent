# Proposal：project-rename

## 問題描述

專案名稱 `chat-gun-react-agent` 已決定縮名為 `chat-gun`。目前舊名稱散布在 Git tracked files 的下列層面：

- 三個 workspace 的 package 名稱與 lockfile（`chat-gun-react-agent-backend`／`-bff`／`-frontend`）。
- 對外 HTTP User-Agent（`chat-gun-react-agent/0.1`）。
- MCP client name（`chat-gun-react-agent-<serverName>`）。
- Observability 識別（`OTEL_SERVICE_NAME`、`OPIK_PROJECT_NAME` 預設值）。
- Docker image 名稱（backend `chat-gun-react-agent`、bff `chat-gun-react-agent-bff`）。
- 前端頁籤顯示名稱（`Chat Gun React Agent`）。
- README、架構文件、Agent 規則與 OpenSpec 專案設定的專案全名。

若只在部分檔案改名，會造成 package 名稱不一致、Docker image 引用失效、Observability 新舊資料分離、外部 API／MCP allowlist 誤判等契約破壞。

範圍盤點以 `RENAME_TO_CHAT_GUN_GUIDE.md` 為事實來源，基準為：建議修改 31 個 tracked files／60 處；保留 archived OpenSpec 5 個檔案／7 處；另有 GitHub repository、本機 git remote、本機資料夾與部署環境變數等外部項目（Human-owned）。

## 解決方案

將「專案身分」的各種對外 token 統一從 `chat-gun-react-agent` 縮名為 `chat-gun`，涵蓋：

1. **Package 命名**：backend / bff / frontend 的 package 元資料與 lockfile 根名稱一致更新為 `chat-gun-*`，以 npm 正常更新 lockfile。
2. **對外 HTTP User-Agent**：四個對外 HTTP 工具改用 `chat-gun/0.1`。
3. **MCP client name**：改用 `chat-gun-<serverName>`。
4. **Observability**：`OTEL_SERVICE_NAME` 與 `OPIK_PROJECT_NAME` 預設值改為 `chat-gun`。
5. **Docker image**：backend → `chat-gun`、bff → `chat-gun-bff`。
6. **顯示名稱**：前端頁籤標題與所有使用者可見文件改用 `Chat Gun`。
7. **專案設定**：OpenSpec 專案設定（config.yaml）專案名稱改為 `chat-gun`。
8. **外部項目（Human-owned）**：GitHub repository 改名、本機 git remote URL、本機資料夾、部署環境變數與 image 引用。

Archived OpenSpec（3 個 JSON Schema `$id` + 2 份 design）為歷史契約與決策紀錄，原則上保留舊名稱，不做品牌改名 migration。

## 受影響套件與能力域

| 套件 | 能力域 | 變更類型 |
|------|--------|---------|
| backend | Package 命名、Observability、HTTP Tool、MCP | 修改 |
| bff | Package 命名、Docker image | 修改 |
| frontend | Package 命名、顯示名稱 | 修改 |
| 專案根 | README、架構文件、Agent 規則、OpenSpec 設定 | 修改 |
| 部署環境 | OTel/Opik 環境變數、Docker image 引用 | 外部（Human-owned） |
| GitHub | Repository 名稱、本機 git remote | 外部（Human-owned） |

## 目標

- 三個 workspace 的 package 元資料與各自 lockfile 根名稱一致為 `chat-gun-*`。
- 排除本指南後，`git grep` 舊名稱只剩明確保留的 archived OpenSpec（5 檔案／7 處）。
- 對外 HTTP User-Agent、MCP client name、OTel service name、Opik project name、Docker image 全數改為 `chat-gun` 系列。
- 前端頁籤與使用者可見文件顯示 `Chat Gun`。
- 三個 workspace 的 lint、test、build 全數通過（BFF 無既有 test script 時如實標示）。
- 外部項目（GitHub、git remote、資料夾、部署環境）由人工執行並記錄於完成清單。

## 非目標

- 不變更 archived OpenSpec 的 JSON Schema `$id` 與歷史 design 文字（除非另有核准的 migration）。
- 不變更 `assets/chat-gun-demo.webp`（檔名已是縮寫形式）。
- 不重建 `node_modules/`、`dist/`、`build/`、`coverage/`。
- 不觸碰 `.agent-runtime/` 既有 Change／Run 的歷史。
- 不升級任何 package 版本、不做無關重構或格式調整。

## 風險與回滾策略

- **風險**：Observability 新名稱被 OTel／Opik 視為新 service/project，既有歷史資料不自動合併 → 於 proposal/design 明確記錄；不改動資料 migration。
- **風險**：外部 API／代理／allowlist 依賴舊 `User-Agent` 或舊 MCP client name → apply-change 前盤點並由人工確認外部設定同步。
- **風險**：lockfile 手動編輯造成 package 元資料與 lockfile 不一致 → 一律以 npm 指令更新 lockfile，不手改。
- **風險**：GitHub repo 改名後舊 URL 短暫失效、本機 remote 未同步 → 外部項目由人工按順序執行（先 GitHub 改名，再更新 remote，最後改資料夾）。
- **回滾**：全部變更為可逆的文字／名稱替換，commit 為單一 rename change；出問題時 revert 該 commit 即可回復舊名稱。
