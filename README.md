# Chat Gun React Agent

[![LangChain License](https://img.shields.io/github/license/langchain-ai/langchainjs?color=22C55E)](https://github.com/langchain-ai/langchainjs/blob/main/LICENSE)
[![LangGraph](https://img.shields.io/badge/LangGraph-JS-06B6D4)](https://langchain-ai.github.io/langgraphjs/)
[![Source](https://img.shields.io/badge/Source-Ylang--Labs%2Flanggraph--react--agent--studio-F97316)](https://github.com/Ylang-Labs/langgraph-react-agent-studio)

Chat Gun React Agent 是一套以 React、TypeScript 與 LangGraph JS 為核心的全端 Agent Chat 系統，整合 Qwen／OpenAI-compatible 模型供應商、原生 Tools 與可選用的 MCP Tools。

專案涵蓋多階段 Agent Workflow、Tool Calling、Human-in-the-Loop、串流執行事件、圖片輸入、Deep Research、BFF 服務層、工具安全治理與容器化部署，定位為可部署、可擴充，並面向準生產環境驗證的產品化 Agent Chat 實作。

💡 本專案主要用於個人研究、Agent 工程實踐與架構驗證。目前適合在受控環境中部署與試運行，尚不代表已完成公開多租戶、高併發及 SLA 等級的正式生產驗證。


Chat Gun React Agent is a full-stack Agent Chat system built with React, TypeScript, and LangGraph JS. It integrates Qwen and OpenAI-compatible model providers, native tools, and optional MCP tools.

The project includes multi-stage agent workflows, tool calling, human-in-the-loop interactions, streaming execution events, image input, deep research, a BFF service layer, tool security governance, and containerized deployment. It is designed as a deployable and extensible Agent Chat implementation for production-oriented engineering and pre-production validation.

This project is primarily intended for personal research, agent engineering practice, and architecture validation. It is suitable for deployment and evaluation in controlled environments, but it has not yet completed the multi-tenant, high-concurrency, and SLA validation required for a public production service.

## Demo

<p align="center">
  <img src="./chat-gun-demo.gif" alt="Demo Video" width="1280" />
</p>

<p align="center">
  <img src="./chat-gun-01.png" alt="Chat Home Screen" width="1280" />
</p>

<p align="center">
  <img src="./chat-gun-02.png" alt="Chat Agent Results" width="1280" />
</p>

## 目前架構

實際程式碼目前分成三個主要 package：

| 目錄 | 職責 | 本機預設 port |
| --- | --- | --- |
| `frontend/` | Vite React 前端聊天介面 | `5173` |
| `bff/` | BFF / API Gateway，代理前端到 LangGraph 的流量 | `8787` |
| `backend/` | LangGraph JS agent runtime、LLM gateway、tools | `2024` |

本機開發流量：

```text
Browser
  -> http://localhost:5173/app/
  -> /api/langgraph/*
  -> Vite proxy
  -> BFF http://127.0.0.1:8787
  -> LangGraph API http://localhost:2024
```

`frontend/src/App.tsx` 會預設產生絕對 API URL：

```text
http://localhost:5173/api/langgraph
```

`frontend/vite.config.ts` 會把 `/api/*` proxy 到：

```text
http://127.0.0.1:8787
```

## Agent

LangGraph graph ID 定義在 `backend/langgraph.json`：

- `deep_researcher`
- `chatbot`
- `math_agent`
- `mcp_agent`

前端預設 agent 由 `frontend/src/types/agents.ts` 設定，目前是：

```text
deep_researcher
```

前端模型選單由 `frontend/src/types/models.ts` 設定，目前提供：

```text
Qwen Plus
Qwen Max
Qwen Turbo
```

預設模型是：

```text
qwen-plus
```

## 需求

- Node.js 22 建議用於本機開發。LangGraph / Docker runtime 仍有 Node 20 路徑，請以各 package `package.json` 與 Dockerfile 為準。
- npm 10.x 或 Node.js 22 內建 npm
- Qwen / Alibaba Cloud Bailian API Key，或相容的 OpenAI-compatible / CCR runtime 設定
- 選用：Tavily API Key，供 `deep_researcher` 的 `web_search` 使用
- 選用：Docker / Docker Compose
- 選用：make

## 安裝

三個 package 需要分別安裝依賴：

```bash
cd backend
npm install

cd ../bff
npm install

cd ../frontend
npm install
```

PowerShell：

```powershell
cd you-path\chat-gun-react-agent\backend
npm install

cd ..\bff
npm install

cd ..\frontend
npm install
```

## 環境變數

### Backend

建立 `backend/.env`：

```bash
cd backend
cp .env.example .env
```

PowerShell：

```powershell
cd backend
Copy-Item .env.example .env
```

預設 backend runtime 使用 Qwen / Alibaba Cloud Bailian OpenAI-compatible endpoint：

```env
LLM_PROVIDER=qwen
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_API_KEY=your_qwen_api_key
QWEN_CHAT_MODEL=qwen-plus
QWEN_RESEARCH_MODEL=qwen-plus
QWEN_VISION_MODEL=qwen-vl-plus
QWEN_TOOL_MODEL=qwen-plus
DEFAULT_MODEL=qwen-plus
CHAT_MODEL=qwen-plus
MATH_MODEL=qwen-plus
MCP_AGENT_MODEL=qwen-plus
```

Live smoke 預設關閉：

```env
RUN_QWEN_LIVE_SMOKE=false
```

如果要讓 backend planner / synthesis 走 CCR，必須設定 backend 的 `.env`，只設定 Codex/CCR 編排層不會自動影響 LangGraph backend：

```env
LLM_PROVIDER=ccr
CCR_BASE_URL=http://127.0.0.1:3456/v1
CCR_API_KEY=
CCR_PROVIDER=deepseek
CCR_MODEL=your_ccr_model
```

真正的 OpenAI-compatible endpoint 可使用：

```env
LLM_PROVIDER=openai-compatible
OPENAI_COMPATIBLE_BASE_URL=https://your-compatible-endpoint/v1
OPENAI_COMPATIBLE_API_KEY=your_api_key
OPENAI_COMPATIBLE_MODEL=your_model
```

目前 backend 支援的 `LLM_PROVIDER` 為：

```text
qwen
ccr
openai-compatible
```

`deep_researcher` 使用原生 `web_search` 時需要：

```env
TAVILY_API_KEY=your_tavily_api_key
```

Image upload / recognition preflight 相關設定：

```env
BACKEND_IMAGE_UPLOAD_MAX_FILES=6
BACKEND_IMAGE_UPLOAD_MAX_BYTES=5242880
BACKEND_IMAGE_UPLOAD_MAX_PIXELS=24000000
BACKEND_IMAGE_UPLOAD_ALLOWED_EXTENSIONS=.png,.jpg,.jpeg,.webp
BACKEND_IMAGE_UPLOAD_ALLOWED_MIME_TYPES=image/png,image/jpeg,image/webp
BACKEND_IMAGE_UPLOAD_S3_BUCKET_URL=
```

Tool governance 相關設定：

```env
TOOL_AUDIT_ENABLED=true
TOOL_ALLOWLIST=
TOOL_DENYLIST=
TOOL_TIMEOUT_MS=15000
TOOL_MAX_INPUT_CHARS=8000
TOOL_MAX_OUTPUT_CHARS=24000
WEB_FETCH_ALLOWED_PORTS=80,443
```

如果 backend 所在網路無法直連模型供應商或外部 tool API，可以在啟動 backend 前設定 proxy：

```env
HTTPS_PROXY=http://127.0.0.1:7890
HTTP_PROXY=http://127.0.0.1:7890
NO_PROXY=localhost,127.0.0.1
```

`backend/src/platform/network.ts` 會讀取 `HTTPS_PROXY` / `HTTP_PROXY`，並透過 `undici` 設定 Node fetch 的全域 proxy dispatcher。

### BFF

建立 `bff/.env`：

```bash
cd bff
cp .env.example .env
```

預設 BFF 設定：

```env
BFF_PORT=8787
BFF_LANGGRAPH_API_URL=http://localhost:2024
BFF_FRONTEND_DIST=../frontend/dist
BFF_ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
BFF_REQUIRE_AUTH=false
BFF_API_KEYS=
BFF_MAX_BODY_BYTES=52428800
BFF_UPSTREAM_TIMEOUT_MS=120000
BFF_RATE_LIMIT_WINDOW_MS=60000
BFF_RATE_LIMIT_MAX_REQUESTS=120
BFF_IMAGE_UPLOAD_MAX_FILES=6
BFF_IMAGE_UPLOAD_MAX_BYTES=5242880
BFF_IMAGE_UPLOAD_MAX_PIXELS=24000000
BFF_IMAGE_UPLOAD_ALLOWED_EXTENSIONS=.png,.jpg,.jpeg,.webp
BFF_IMAGE_UPLOAD_ALLOWED_MIME_TYPES=image/png,image/jpeg,image/webp
BFF_IMAGE_UPLOAD_S3_BUCKET_URL=
```

BFF 目前提供：

- `/api/health`：BFF process health
- `/api/ready`：檢查 LangGraph upstream `/ok`
- `/api/langgraph/*`：代理到 LangGraph API
- CORS allowlist
- optional API key auth
- request body size limit
- image upload / recognition preflight limits
- upstream timeout
- in-memory rate limit
- JSON audit log

## 本機開發

請開三個 terminal。

Terminal 1：啟動 LangGraph backend

```bash
cd backend
npm run dev
```

Backend 預設 URL：

```text
http://localhost:2024
```

Terminal 2：啟動 BFF

```bash
cd bff
npm run dev
```

BFF 預設 URL：

```text
http://127.0.0.1:8787
```

確認 BFF 能連到 LangGraph：

```powershell
Invoke-RestMethod http://127.0.0.1:8787/api/ready
```

預期會看到：

```json
{
  "status": "ready"
}
```

Terminal 3：啟動前端

```bash
cd frontend
npm run dev
```

開啟：

```text
http://localhost:5173/app/
```

## Makefile

根目錄 `Makefile` 目前提供：

```bash
make dev-backend
make dev-bff
make dev-frontend
make dev
```

在 Windows / PowerShell 環境下，建議三個服務分別用三個 terminal 啟動，除錯會比較清楚。

## Build / Test / Typecheck

Backend：

```bash
cd backend
npm run lint
npm run test
npm run build
```

BFF：

```bash
cd bff
npm run test
npm run build
```

Frontend：

```bash
cd frontend
npm run lint
npm run test
npm run build
```

Frontend build 可能出現 Vite chunk size warning；只要 process exit code 是 0，build 仍是成功。

## Docker Compose

`docker-compose.yml` 目前有：

- `langgraph-redis`
- `langgraph-postgres`
- `langgraph-api`
- `bff`

`langgraph-api` 不對 host 暴露 port，只在 Compose network 內提供 `8000`。

對外暴露的是 BFF：

```text
http://localhost:8123
```

啟動：

```bash
docker compose up --build
```

PowerShell 範例：

```powershell
cd <project-root>
$env:LLM_PROVIDER="qwen"
$env:QWEN_API_KEY="your_qwen_api_key"
$env:QWEN_CHAT_MODEL="qwen-plus"
$env:QWEN_RESEARCH_MODEL="qwen-plus"
$env:QWEN_VISION_MODEL="qwen-vl-plus"
$env:QWEN_TOOL_MODEL="qwen-plus"
$env:LANGSMITH_API_KEY=""
$env:MCP_LOAD_ON_START="false"
$env:DEEP_RESEARCHER_MCP_ENABLED="false"
$env:MCP_FILESYSTEM_ENABLED="true"
$env:MCP_FILESYSTEM_PATH="/app/workspace"
$env:MCP_BRAVE_SEARCH_ENABLED="false"
$env:TAVILY_API_KEY=""
$env:BRAVE_API_KEY=""
docker compose up --build
```

開啟：

```text
http://localhost:8123/app/
```

Docker Compose 流量：

```text
Browser
  -> http://localhost:8123/app/
  -> BFF container
  -> http://langgraph-api:8000
```

注意：Docker Compose 目前將 `BFF_MAX_BODY_BYTES` 預設為 `1048576`。若需要與本機 `bff/.env.example` 的 `52428800` 對齊，請在啟動 Compose 前設定 `BFF_MAX_BODY_BYTES=52428800` 或調整 `docker-compose.yml`。

如果 Docker 內的 backend 也需要 proxy，目前 `docker-compose.yml` 尚未把 `HTTPS_PROXY` / `HTTP_PROXY` 傳給 `langgraph-api`，需要自行加到 `langgraph-api.environment`。

## Tools

原生 tools 由 `backend/src/tools/registry.ts` 載入。

目前包含：

- `calculator_tool`
- `web_search`
- `web_fetch`
- `current_weather`
- `weather_forecast`

注意：

- `web_search` 使用 Tavily API，需要 `TAVILY_API_KEY`。
- `current_weather` 使用 Open-Meteo current weather，不需要 API key。
- `weather_forecast` 使用 Open-Meteo hourly / daily forecast，不需要 API key。
- `web_fetch` 目前限制 HTTP/HTTPS 與允許 port，但不是完整 SSRF sandbox。
- MCP tools 是選用功能，透過 backend env flags 控制。
- Tool governance 可透過 `TOOL_ALLOWLIST`、`TOOL_DENYLIST`、`TOOL_TIMEOUT_MS`、`TOOL_MAX_INPUT_CHARS`、`TOOL_MAX_OUTPUT_CHARS` 控制。

### Weather location resolution and forecast

`current_weather` 使用 Open-Meteo geocoding 與 Open-Meteo current weather；`weather_forecast` 使用 Open-Meteo geocoding 與 hourly / daily forecast。兩者都不需要 API key。

Weather flow 會接收 planner 輸出的地點，保留使用者原始文字於 `requestedLocation.raw`，並只做 trim、Unicode NFKC、空白清理與控制字元移除等不改變語意的 normalization。地理事實仍由 geocoding provider 候選決定。

Forecast flow 由 planner 輸出 `weather.weatherCapability` 與 `weather.timeRange`，目前支援 `hourly` / `daily` forecast，以及 `today`、`tonight`、`tomorrow`、`weekend`、`date_range` 等 time range。`current_weather` 只負責目前觀測；明天、今晚、週末、日期區間或降雨機率等預報問題會走 `weather_forecast`。

Tool 會回傳 structured `WeatherToolResult`：

- `status: "success"`：已解析地點並取得目前天氣觀測。
- `status: "needs_clarification"`：地點有多個合理候選，需要使用者補充 country、region 或其他辨識資訊。
- `status: "not_found"`：provider 沒有可用候選，不捏造座標。
- `status: "error"`：穩定錯誤碼，例如 `weather_geocoding_provider_error`、`weather_forecast_provider_error`、`weather_timeout`、`weather_cancelled`。

中文與混合中文地名由 planner 可選輸出 `weather.queryName`，例如 `台北` 搭配 `Taipei`、`北京市` 搭配 `Beijing`。`queryName` 只是 provider query hint：

- 不覆蓋 `weather.location` 或 `requestedLocation.raw`。
- 不進入 `WeatherToolResult`。
- 不作為地理事實來源。
- Resolver 仍必須送到 Open-Meteo geocoding，由 provider candidate 與 scoring 決定結果。

本專案不得以固定 CJK→Latin 城市 mapping、城市白名單、keyword regex 或 phrase stripping 作為主要解析策略。允許的小型封閉清單僅限 weather code label、country code display name、wind direction label 等穩定 domain constants。

目前 live smoke 已涵蓋的 CJK queryName 情境包含：

- `台北` + `queryName: "Taipei"`。
- `臺北` + `queryName: "Taipei"`，與 `台北` 解析到相容地理實體。
- `高雄鳳山` + `queryName: "Fengshan"` + `region: "Kaohsiung"` + `country: "Taiwan"`。
- `北京市` + `queryName: "Beijing"` + `country: "China"`。
- `新加坡` + `queryName: "Singapore"` + `country: "Singapore"`。

天氣相關 backend 設定：

```env
WEATHER_STRUCTURED_RESULT_ENABLED=true
WEATHER_LOCATION_MAX_CHARS=160
WEATHER_GEOCODING_MAX_QUERIES=6
WEATHER_GEOCODING_MAX_CANDIDATES=10
WEATHER_GEOCODING_MIN_SCORE=35
WEATHER_GEOCODING_AMBIGUITY_DELTA=8
WEATHER_GEOCODING_TIMEOUT_MS=5000
WEATHER_FORECAST_TIMEOUT_MS=8000
# Dev/test-only; ignored when NODE_ENV or APP_ENV is production.
WEATHER_TEST_FORCE_GEOCODING_ERROR=false
WEATHER_TEST_FORCE_FORECAST_ERROR=false
```

Provider failure 手動檢查可在重啟 backend 前只設定其中一個 dev/test fault switch：

- `WEATHER_TEST_FORCE_GEOCODING_ERROR=true` 必須回傳 `status: "error"` 與 `code: "weather_geocoding_provider_error"`，不能回傳 `weather_location_not_found`。
- `WEATHER_TEST_FORCE_FORECAST_ERROR=true` 必須先完成 geocoding，再回傳 `status: "error"` 與 `code: "weather_forecast_provider_error"`，frontend tool panel 必須進入 terminal 狀態。

當 `NODE_ENV=production` 或 `APP_ENV=production` 時，這些 fault switches 會被忽略。

測試預設使用 mock geocoding 與 weather data，不需要 Open-Meteo 網路連線：

```bash
cd backend
npm run test

cd ../frontend
npm run test
```

Live smoke 是 opt-in，需要明確設定環境變數才會打到真實 provider：

```powershell
cd backend
$env:OPEN_METEO_LIVE_SMOKE="true"
npm run test -- src/tools/weather.live-smoke.test.ts
```

限制：

- `current_weather` 回報最新 current observation，不承諾完整日預報或週末預報。
- `weather_forecast` 回報結構化 hourly / daily forecast；不承諾歷史天氣、氣候知識，或超出結構化欄位的獨立天氣建議。
- 歧義地點需要使用者補充 country、region 或其他辨識資訊。
- Provider error 與 timeout 會回報為服務失敗，不會被包裝成地點不存在。
- Cancellation 應以 `weather_cancelled` 結束，frontend 不應停留在 running 狀態。

## MCP

相關 backend env：

```env
MCP_LOAD_ON_START=false
DEEP_RESEARCHER_MCP_ENABLED=false
MCP_FILESYSTEM_ENABLED=true
MCP_FILESYSTEM_PATH=your_filesystem_path
MCP_FILESYSTEM_ALLOWED_ROOTS=
MCP_BRAVE_SEARCH_ENABLED=false
BRAVE_API_KEY=your_brave_api_key_here
```

說明：

- `mcp_agent` 會依設定載入 MCP tools。
- `deep_researcher` 只有在 `DEEP_RESEARCHER_MCP_ENABLED=true` 時才會包含 MCP tools。
- filesystem MCP 應設定 `MCP_FILESYSTEM_ALLOWED_ROOTS` 限制可存取根目錄；多個 root 依作業系統 path delimiter 分隔。
- 生產環境建議把 MCP execution 拆到獨立 Tool Service / container，並加上權限、沙箱、egress policy、timeout 與 audit。

## 疑難排解

### 前端出現 `Invalid URL`

LangGraph SDK 需要 absolute API URL。目前前端預設會用：

```text
window.location.origin + /api/langgraph
```

如果自行設定 `VITE_LANGGRAPH_API_URL`，必須是完整 URL，例如：

```env
VITE_LANGGRAPH_API_URL=http://localhost:5173/api/langgraph
```

### 前端 `/api/langgraph/threads` 回 502

先檢查 BFF readiness：

```powershell
Invoke-RestMethod http://127.0.0.1:8787/api/ready
```

再檢查 backend：

```powershell
Invoke-RestMethod http://localhost:2024/ok
```

### `Research synthesis failed ... fetch failed`

這表示 frontend、BFF、LangGraph 已經通了，但 backend 連不到目前設定的模型供應商或外部 tool provider。

如果使用 Qwen / Alibaba Cloud Bailian，先檢查：

```powershell
Test-NetConnection dashscope.aliyuncs.com -Port 443
```

如果使用自訂 OpenAI-compatible endpoint，請檢查你的 `OPENAI_COMPATIBLE_BASE_URL` host。若網路需要 proxy，請在啟動 `backend` 前設定 `HTTPS_PROXY` / `HTTP_PROXY`。

### Deep Research 回覆「請提供要查詢天氣的城市或地區」

如果 history 裡的 `plan.rationale` 顯示 `Planner unavailable; weather intent detected...`，表示 backend planner LLM 沒有成功執行。天氣地點抽取必須由 planner 輸出 `weather.location`，系統不會用固定 keyword 或標點刪字把完整問句猜成地點。

檢查：

```env
# Qwen path
LLM_PROVIDER=qwen
QWEN_API_KEY=...
QWEN_CHAT_MODEL=qwen-plus
QWEN_RESEARCH_MODEL=qwen-plus

# or CCR path
LLM_PROVIDER=ccr
CCR_BASE_URL=http://127.0.0.1:3456/v1
CCR_PROVIDER=deepseek
CCR_MODEL=...

# or OpenAI-compatible path
LLM_PROVIDER=openai-compatible
OPENAI_COMPATIBLE_BASE_URL=https://your-compatible-endpoint/v1
OPENAI_COMPATIBLE_API_KEY=...
OPENAI_COMPATIBLE_MODEL=...
```

調整 `.env` 後需要重啟 backend。

## 更多文件

BFF 細節請看：

```text
docs/bff.md
```

## License

Apache License 2.0。詳見 [LICENSE](./LICENSE)。
