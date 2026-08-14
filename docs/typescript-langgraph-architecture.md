# TypeScript + LangGraph 程式碼架構

<p>
  <a href="./typescript-langgraph-architecture.en.md">English</a> |
  <a href="./typescript-langgraph-architecture.md">繁體中文</a>
</p>

Chat Gun React Agent 採用 TypeScript monorepo。Frontend、BFF 與 LangGraph backend 各自有清楚的責任邊界，可獨立開發與部署。

## 套件分工

```text
frontend/                 React UI 與 LangGraph 串流客戶端
bff/                      對外 API Gateway 與靜態網站入口
backend/                  LangGraph graphs、模型與工具執行環境
docs/                     對外使用與架構文件
```

| 套件 | 主要責任 | 不應承擔的責任 |
| --- | --- | --- |
| `frontend` | 對話 UI、附件、串流事件解析、狀態與結構化結果呈現 | 模型或工具憑證、後端語意判斷 |
| `bff` | 認證、CORS、限流、大小限制、逾時、取消、錯誤映射與稽核 | Prompt、planner 或 Agent workflow |
| `backend` | LangGraph state/node/edge、LLM、tools、MCP 與 runtime events | 瀏覽器認證或 UI 呈現邏輯 |

## Backend 目錄

```text
backend/
├─ langgraph.json                 Graph 與 HTTP app 註冊
└─ src/
   ├─ agents/                     可由 LangGraph Server 執行的 graphs
   ├─ tools/                      Native tools、MCP loader 與 registry
   ├─ platform/                   LLM Gateway、設定、事件、metrics 與 tracing
   ├─ context/                    Context 組裝、預算與壓縮策略
   ├─ runtime/                    可重用的執行期基礎元件
   ├─ evaluation/                 Opik datasets、experiments 與 scoring
   ├─ prompts.ts                  Agent prompts
   └─ state.ts                    共用訊息與 context helpers
```

### `agents/`

每個 graph 都匯出一個已編譯的 LangGraph instance，再由 `langgraph.json` 指定公開 Graph ID。目前註冊：

```json
{
  "deep_researcher": "./src/agents/deep-researcher.ts:deepResearcherGraph",
  "chatbot": "./src/agents/chatbot.ts:chatbotGraph",
  "math_agent": "./src/agents/math-agent.ts:mathAgentGraph",
  "mcp_agent": "./src/agents/mcp-agent.ts:mcpAgentGraph"
}
```

Graph node 接收 state 與 `RunnableConfig`，回傳 state update。路由判斷集中在 conditional edge function，避免 node 同時處理業務工作與流程跳轉。需要持續對話或 human-in-the-loop 的 graph 必須配置 checkpointer，並由呼叫端維持穩定的 `thread_id`。

### `platform/`

`platform` 是 graph 共用的外部能力邊界：

- `llm-gateway.ts`：Provider 建立、能力檢查、模型呼叫與可選 fallback。
- `runtime-config.ts`：語系、時區、context budget、metrics 與 tracing 設定。
- `agent-runtime-events.ts`：Backend 對 Frontend 的事件 union。
- `tool-governance.ts`：工具權限、輸入／輸出限制、逾時與 audit event。
- `metrics/`：Task、step、tool、token、成本與延遲統計，以及 JSON metrics endpoint。
- `tracing/`：OpenTelemetry spans 與 Opik integration。

Graph 不直接依賴特定 Provider SDK。新增 Provider 時，應在 LLM Gateway 實作共用介面並宣告能力，不能在 graph 內依模型名稱分支。

### `tools/`

Deep Researcher 與 MCP Agent 透過 registry 載入 native tools 與 MCP tools。Registry 負責：

1. 提供共用 native tool 集合。
2. 套用 tool governance policy。
3. 依呼叫選項與環境設定載入 MCP server。
4. 回傳 LangChain-compatible tools 給 graph 或 `ToolNode`。

Math Agent 目前直接匯入 calculator，不經 registry。工具的輸入與輸出必須有明確 schema；直接匯入的工具也必須由呼叫端處理權限與資源限制。涉及網路、檔案或第三方服務的工具，還必須限制目的地、路徑、逾時與資料大小。

### `context/`

Context assembler 先整理訊息與候選資料，再依 token budget 分配空間。當內容超出預算時，compression strategy 會產生較短版本；graph 只接收組裝完成的 context，不需要各自重做截斷規則。

### `runtime/`

`runtime` 提供可由 workflow 明確採用的基礎元件，包括：

- task／step state machine 與 domain events
- PostgreSQL repositories 與 migrations
- retry policy、backoff 與 retry budget
- idempotency guard
- Redis step lock 與 transition guard
- audit logging 與敏感資料遮蔽
- compensation registry 與 saga orchestrator

這些模組是 library，不會因為存在於目錄中就自動套用到所有 graph。Agent 或服務需要透過匯入與設定，明確選擇所需能力。

## Frontend 串流邊界

Frontend 使用 `@langchain/langgraph-sdk` 建立 thread、啟動 run 並接收串流。主要邊界如下：

```text
App.tsx
  ├─ lib/agent-run-config.ts       組裝 graph 執行設定
  ├─ lib/agent-runtime-events.ts   驗證與正規化 runtime events
  ├─ lib/task-event-reducer.ts     合併 task 狀態
  └─ components/                   顯示訊息、活動與工具結果
```

Backend 事件型別定義在 `backend/src/platform/agent-runtime-events.ts`，Frontend 對應型別位於 `frontend/src/types/agent-runtime-events.ts`。新增或修改事件時必須同步更新兩側型別、normalizer、reducer 與測試。Frontend 不應從顯示文字反推事件狀態。

`VITE_LANGGRAPH_API_URL` 只控制瀏覽器連線位置。正式環境建議使用同 origin `/api/langgraph`，由 BFF 隱藏 backend 位址並套用外部 API policy。

## BFF 邊界

`bff/src/server.ts` 是對外入口，負責：

- `/api/langgraph/*` 的 request／stream proxy
- `/api/metrics` 的受保護 metrics proxy
- `/api/health` 與 `/api/ready`
- `/app/*` 的 frontend 靜態檔案
- request ID、trace context、認證、CORS、限流、body/image validation、timeout 與取消

BFF 不解析 LangGraph state，也不修改 model、tool 或 planner 的語意。路由與設定細節請參閱 [BFF API Gateway](./bff.md)。

## 部署拓撲

本機開發可分別啟動三個套件；Docker Compose 則提供以下服務：

```text
Browser
  │
  ▼
BFF :8123
  ├─ /app/*            frontend static files
  ├─ /api/langgraph/*  → langgraph-api :8000
  └─ /api/metrics      → backend metrics app

langgraph-api
  ├─ Redis
  ├─ PostgreSQL
  ├─ LLM providers
  └─ Native / MCP tools
```

憑證只放在負責使用它的 server process：Provider 與工具金鑰屬於 backend，BFF API key 屬於 BFF，Frontend 只使用 `VITE_*` 公開設定。

## 擴充方式

### 新增 Agent

1. 在 `backend/src/agents/` 建立 graph 並匯出編譯結果。
2. 在 `backend/langgraph.json` 註冊穩定的 Graph ID。
3. 若要讓 UI 選取，更新 Frontend 的 Agent 型別與清單。
4. 為 state reducer、conditional routes、錯誤與取消路徑加入測試。

### 新增工具

1. 定義具 runtime validation 的輸入 schema。
2. 實作 LangChain-compatible tool。
3. 在 Tool Registry 註冊；若只開放給部分 Agent，應在 registry 建立明確的可見性規則。
4. 設定 governance policy、逾時、資料大小與 audit 行為。
5. 測試成功、輸入錯誤、拒絕、逾時與上游失敗。

### 新增 Provider

1. 實作 LLM Gateway 介面。
2. 宣告 structured output、tool calling 與 vision 能力。
3. 將外部錯誤正規化為安全且穩定的錯誤分類。
4. 測試一般輸入、多模態、tool calling、逾時、取消與可選 fallback。

## 驗證

修改單一套件時，至少執行該套件的完整檢查：

```bash
cd frontend
npm run lint
npm run test
npm run build
```

```bash
cd backend
npm run lint
npm run test
npm run build
```

```bash
cd bff
npm run build
```

跨層契約變更需要同時驗證所有受影響套件，特別是 Graph ID、request schema、runtime event、terminal state 與錯誤碼。
