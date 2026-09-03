# project-identity Specification

## Purpose
TBD - created by archiving change project-rename. Update Purpose after archive.
## Requirements
### Requirement:專案 slug 與顯示名稱

專案對外識別名稱 MUST 統一為：slug `chat-gun`、顯示名稱 `Chat Gun`。

#### Scenario:顯示名稱一致

GIVEN 使用者開啟前端頁面或閱讀專案文件
WHEN 檢視瀏覽器頁籤標題與使用者可見專案名稱
THEN 顯示名稱皆為 `Chat Gun`
AND 不再出現 `Chat Gun React Agent`。

#### Scenario:專案設定識別

GIVEN OpenSpec 專案設定記載專案名稱
WHEN 讀取其 context 中的專案名稱
THEN 其值為 `chat-gun`。

### Requirement:Package 命名一致性

backend、bff、frontend 三個 workspace 的 package 名稱與其 lockfile 根名稱 MUST 一致，且使用 `chat-gun-*` 前綴。

#### Scenario:三個 package 名稱符合縮名

GIVEN 三個 workspace 的 package 元資料與 lockfile
WHEN 檢查其根 package 名稱
THEN backend 為 `chat-gun-backend`、bff 為 `chat-gun-bff`、frontend 為 `chat-gun-frontend`
AND 各 package 元資料與其 lockfile 根名稱一致。

#### Scenario:無程式碼依賴舊 package 名稱

GIVEN 縮名完成的程式碼
WHEN 搜尋舊 package 名稱 `chat-gun-react-agent-backend`、`chat-gun-react-agent-bff`、`chat-gun-react-agent-frontend`
THEN 除 archived OpenSpec 外無任何命中。

### Requirement:對外 HTTP User-Agent

backend 對外部 HTTP API 發起工具呼叫時，User-Agent 標頭 MUST 使用 `chat-gun/<version>`，MUST NOT 使用舊名稱。

#### Scenario:HTTP 工具使用新 User-Agent

GIVEN backend 透過 weather、web-fetch、web-search 或 geocoding 能力發起對外 HTTP 請求
WHEN 檢查請求的 User-Agent 標頭
THEN 其值以 `chat-gun/` 為前綴
AND 不含 `chat-gun-react-agent`。

### Requirement:MCP client 識別

backend 連接 MCP Server 時，client name MUST 為 `chat-gun-<serverName>`。

#### Scenario:MCP client name 使用新前綴

GIVEN backend 初始化任一 MCP Server 連線
WHEN 檢查傳遞給 MCP Server 的 client name
THEN 其值為 `chat-gun-<serverName>` 形式
AND 不含 `chat-gun-react-agent`。

### Requirement:Observability 識別

OpenTelemetry service name 與 Opik project name 的預設值 MUST 為 `chat-gun`。

#### Scenario:未覆寫環境變數時的預設值

GIVEN 執行期未以環境變數覆寫 `OTEL_SERVICE_NAME` 或 `OPIK_PROJECT_NAME`
WHEN 讀取 runtime config 的預設值
THEN 兩者皆為 `chat-gun`。

#### Scenario:測試 expectation 與預設值一致

GIVEN runtime config 的單元測試
WHEN 執行測試
THEN 預設值 assertion 為 `chat-gun`，且測試通過。

### Requirement:Docker image 命名

backend 與 bff 的 Docker image 名稱 MUST 分別為 `chat-gun` 與 `chat-gun-bff`。

#### Scenario:compose 引用新 image 名稱

GIVEN Docker compose 設定
WHEN 檢查 backend 與 bff 的 image 欄位
THEN 分別為 `chat-gun` 與 `chat-gun-bff`
AND 不含 `chat-gun-react-agent`。

