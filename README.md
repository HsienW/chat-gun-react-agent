# Chat Gun React Agent

[![License](https://img.shields.io/github/license/HsienW/chat-gun-react-agent?color=22C55E)](./LICENSE)
[![LangGraph](https://img.shields.io/badge/LangGraph-JS-06B6D4)](https://langchain-ai.github.io/langgraphjs/)
[![Upstream](https://img.shields.io/badge/Upstream-Ylang--Labs%2Flanggraph--react--agent--studio-F97316)](https://github.com/Ylang-Labs/langgraph-react-agent-studio)

Chat Gun React Agent 是一套以 React、TypeScript 與 LangGraph JS 為核心的全端 Agent Chat 系統，整合 Qwen／OpenAI-compatible 模型供應商、原生 Tools 與可選用的 MCP Tools。

主要功能：

- Deep Research、一般對話、數學與 MCP Agent。
- 串流回覆、Tool Calling、Human-in-the-Loop 與圖片輸入。
- 天氣、網路搜尋、網頁擷取與計算工具。
- BFF 代理層，提供 CORS、body limit、timeout、rate limit 與 audit log。
- 本機三服務開發流程與 Docker Compose 部署。

> 預設設定供本機開發使用。若要對外公開服務，請先補上適合部署環境的認證、來源限制與基礎設施設定。

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

<p align="center">
  <img src="./chat-gun-03.png" alt="Chat Agent Results" width="1280" />
</p>

## 架構

實際程式碼目前分成三個主要 package：

| 目錄 | 職責 | 本機預設 port |
| --- | --- | --- |
| `frontend/` | Vite React 前端聊天介面、串流狀態與工具結果呈現 | `5173` |
| `bff/` | BFF / API Gateway，負責代理、驗證、逾時與限流 | `8787` |
| `backend/` | LangGraph JS agent runtime、模型整合與 tools | `2024` |

本機開發流量：

```text
Browser
  -> http://localhost:5173/app/
  -> /api/langgraph/*
  -> Vite proxy
  -> BFF http://127.0.0.1:8787
  -> LangGraph API http://localhost:2024
```

前端預設使用同源的 `/api/langgraph`，開發伺服器會將 `/api/*` 代理到 BFF。

## Agent

| Agent ID | 用途 |
| --- | --- |
| `deep_researcher` | 深度研究、工具調用與圖片理解；前端預設選項 |
| `chatbot` | 一般對話 |
| `math_agent` | 數學與運算任務 |
| `mcp_agent` | 使用已啟用的 MCP tools |

前端模型選單提供 Qwen Plus、Qwen Max 與 Qwen Turbo，預設為 `qwen-plus`。

## 需求

- Node.js 22 或更新版本。
- npm。
- Qwen API Key。也可改用 OpenAI-compatible 或 CCR endpoint。
- 選用：Tavily API Key，供 `deep_researcher` 搜尋網路。
- 選用：Docker 與 Docker Compose。

## Clone 與安裝

```bash
git clone https://github.com/HsienW/chat-gun-react-agent.git
cd chat-gun-react-agent

cd backend && npm ci
cd ../bff && npm ci
cd ../frontend && npm ci
cd ..
```

PowerShell：

```powershell
git clone https://github.com/HsienW/chat-gun-react-agent.git
Set-Location chat-gun-react-agent

Set-Location backend
npm ci
Set-Location ..\bff
npm ci
Set-Location ..\frontend
npm ci
Set-Location ..
```

## 設定

### Backend

從範例建立 `backend/.env`：

```bash
cp backend/.env.example backend/.env
```

PowerShell：

```powershell
Copy-Item backend/.env.example backend/.env
```

最快的啟動方式是使用 Qwen。至少設定：

```env
LLM_PROVIDER=qwen
QWEN_API_KEY=your_qwen_api_key
```

`deep_researcher` 的網路搜尋使用 Tavily；若沒有 API Key，請將範例中的值清空：

```env
TAVILY_API_KEY=
```

也請清除未使用的 `your_*` 與 `*_uri` 佔位值，避免把它們誤認為有效設定。不要提交包含憑證的 `.env`。

Backend 也支援其他 provider：

```env
# OpenAI-compatible
LLM_PROVIDER=openai-compatible
OPENAI_COMPATIBLE_BASE_URL=https://your-endpoint.example/v1
OPENAI_COMPATIBLE_API_KEY=your_api_key
OPENAI_COMPATIBLE_MODEL=your_model

# CCR-compatible Anthropic Messages endpoint
LLM_PROVIDER=ccr
CCR_BASE_URL=http://127.0.0.1:3456/v1
CCR_API_KEY=
CCR_MODEL=your_model
```

前端模型選單預設使用 Qwen model ID。改用其他 provider 時，請同步確認 endpoint 接受選單中的 model 名稱。MCP、圖片限制、Tool Governance、proxy 與天氣 timeout 等選用設定請參考 [`backend/.env.example`](./backend/.env.example)。

### BFF

```bash
cp bff/.env.example bff/.env
```

PowerShell：

```powershell
Copy-Item bff/.env.example bff/.env
```

範例設定已對應本機開發環境：BFF 使用 `8787`，LangGraph API 使用 `http://localhost:2024`，允許 `localhost:5173` 與 `127.0.0.1:5173`。完整設定請參考 [`bff/.env.example`](./bff/.env.example)。

常用設定：

| 環境變數 | 用途 |
| --- | --- |
| `BFF_LANGGRAPH_API_URL` | LangGraph API 位址 |
| `BFF_ALLOWED_ORIGINS` | 瀏覽器來源 allowlist |
| `BFF_MAX_BODY_BYTES` | request body 上限 |
| `BFF_UPSTREAM_TIMEOUT_MS` | 上游請求 timeout |
| `BFF_RATE_LIMIT_REDIS_URI` | 選用 Redis Token Bucket；留空時使用 in-memory limiter |

### Frontend

本機開發不需要建立 `frontend/.env`。若前端要直接連到其他 BFF，可從 [`frontend/.env.example`](./frontend/.env.example) 建立 `.env`，並設定完整 URL：

```env
VITE_LANGGRAPH_API_URL=https://your-bff.example.com/api/langgraph
```

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

```bash
curl http://127.0.0.1:8787/api/ready
```

PowerShell：

```powershell
Invoke-RestMethod http://127.0.0.1:8787/api/ready
```

回應中的 `status` 應為 `ready`。若為 `not_ready`，請先確認 backend 已在 `2024` port 啟動。

Terminal 3：啟動前端

```bash
cd frontend
npm run dev
```

開啟：

```text
http://localhost:5173/app/
```

## 驗證

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

## Docker Compose

Compose 會啟動 PostgreSQL、Redis、LangGraph API 與 BFF，並由 BFF 提供已建置的前端。先在專案根目錄建立 `.env`：

```env
QWEN_API_KEY=your_qwen_api_key
TAVILY_API_KEY=
```

接著啟動：

```bash
docker compose up --build
```

開啟：

```text
http://localhost:8123/app/
```

目前的 Compose 設定以 Qwen 為預設 provider。若要使用 OpenAI-compatible 或 CCR，需將對應環境變數加入 `docker-compose.yml` 的 `langgraph-api.environment`。

Compose 的 `BFF_MAX_BODY_BYTES` 預設為 `1048576`（1 MiB）。需要上傳較大的圖片時，可在根目錄 `.env` 設定較大的值。

未設定 LangSmith 或 MCP 的選用變數時，Compose 可能顯示它們會使用空字串的 warning；這不會阻止預設 Qwen 流程啟動。

## Tools

原生 tools 由 `backend/src/tools/registry.ts` 載入。

| Tool | 用途 | 額外設定 |
| --- | --- | --- |
| `calculator_tool` | 數學運算 | 無 |
| `web_search` | Tavily 網路搜尋 | `TAVILY_API_KEY` |
| `web_fetch` | 擷取 HTTP／HTTPS 網頁 | 無 |
| `current_weather` | Open-Meteo 即時天氣 | 無 API Key |
| `weather_forecast` | Open-Meteo 天氣預報 | 無 API Key |

可透過 `TOOL_ALLOWLIST`、`TOOL_DENYLIST`、`TOOL_TIMEOUT_MS` 與輸入／輸出大小設定限制 tools。`web_fetch` 有 URL 與 port 檢查，但若要公開部署，仍應在網路層加上 egress policy。

## MCP

MCP tools 預設不會在啟動時載入。需要 filesystem MCP 時，可在 `backend/.env` 設定：

```env
MCP_LOAD_ON_START=true
MCP_FILESYSTEM_ENABLED=true
MCP_FILESYSTEM_PATH=/absolute/path/to/workspace
MCP_FILESYSTEM_ALLOWED_ROOTS=/absolute/path/to/workspace
```

若要讓 `deep_researcher` 也使用 MCP tools，再加入：

```env
DEEP_RESEARCHER_MCP_ENABLED=true
```

Brave Search MCP 需要：

```env
MCP_BRAVE_SEARCH_ENABLED=true
BRAVE_API_KEY=your_brave_api_key
```

Filesystem MCP 應使用 `MCP_FILESYSTEM_ALLOWED_ROOTS` 限制可存取目錄；多個路徑使用作業系統的 path delimiter 分隔。

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

這通常表示 backend 無法連到模型供應商或外部 tool provider。先確認 API Key、endpoint 與網路連線。

如果使用 Qwen / Alibaba Cloud Bailian，先檢查：

```powershell
Test-NetConnection dashscope.aliyuncs.com -Port 443
```

如果使用自訂 OpenAI-compatible endpoint，請檢查 `OPENAI_COMPATIBLE_BASE_URL`。網路需要 proxy 時，在 `backend/.env` 設定 `HTTPS_PROXY`／`HTTP_PROXY`，然後重啟 backend。

## 更多文件

BFF 的 API 與安全設定請參考 [docs/bff.md](./docs/bff.md)。

## License

Apache License 2.0。詳見 [LICENSE](./LICENSE)。
