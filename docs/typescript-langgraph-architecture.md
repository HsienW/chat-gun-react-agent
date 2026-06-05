# TypeScript + LangGraph Architecture

本文件說明本次改寫後的 backend 架構，以及後續對齊大廠模式時的擴充方向。

## 改寫後架構

```txt
React Frontend
  |
  | @langchain/langgraph-sdk / useStream
  | VITE_LANGGRAPH_API_URL 可指向 BFF
  v
LangGraph Agent Server
  |
  | 讀取 backend/langgraph.json
  v
TypeScript LangGraph Graphs
  |
  |-- backend/src/agents/chatbot.ts
  |-- backend/src/agents/math-agent.ts
  |-- backend/src/agents/deep-researcher.ts
  |-- backend/src/agents/mcp-agent.ts
  |
  v
Platform Extension Points
  |
  |-- LLM Gateway: backend/src/platform/llm-gateway.ts
  |-- Tool Governance: backend/src/platform/tool-governance.ts
  |-- Observability: backend/src/platform/observability.ts
  |
  v
LLM / Tools / MCP Servers
  |
  |-- Gemini 或公司內部 LLM Gateway
  |-- calculator tool
  |-- filesystem MCP
  |-- search MCP
  |
  v
Redis / PostgreSQL / LangSmith / Audit / Metrics
```

## 改寫前後差異

| 項目 | 改寫前 | 改寫後 |
|---|---|---|
| Agent language | Python | TypeScript |
| Graph runtime | LangGraph Python | LangGraph.js |
| Server 承接 | LangGraph Python API + FastAPI static app | LangGraph Agent Server |
| Graph config | `.py:export` | `.ts:export` |
| Tools | Python function / Python MCP adapter | TypeScript function / JS MCP adapter |
| Model access | 直接呼叫 Gemini Python SDK | 透過 `llm-gateway.ts` 建立 model |
| Tool governance | 未集中抽象 | `tool-governance.ts` 預留 policy/audit/rate limit |
| Observability | console/log 為主 | `observability.ts` 預留 metrics/audit/trace |
| Frontend API URL | 固定 dev/prod URL | 支援 `VITE_LANGGRAPH_API_URL` 指向 BFF |
| Static frontend | FastAPI serve `/app` | 建議 CDN/Nginx/BFF serve |

## 承擔者差異

| 職責 | 改寫前承擔者 | 改寫後承擔者 |
|---|---|---|
| threads/runs/streaming | LangGraph Python runtime | LangGraph Agent Server |
| agent orchestration | Python graph code | TypeScript graph code |
| LLM provider selection | agent 內直接決定 | `llm-gateway.ts` |
| tool permission/audit | 分散或未實作 | `tool-governance.ts` |
| frontend hosting | FastAPI app | CDN/Nginx/BFF |
| external API policy | tools 自行處理 | Tool Service / BFF / Gateway |

## 對齊大廠模式的下一步

```txt
React Frontend
  |
Frontend CDN
  |
BFF / API Gateway
  |
LangGraph Agent Runtime
  |
Tool Service / MCP Servers
  |
LLM Gateway
  |
Internal Models / External Models

Redis / PostgreSQL / Trace / Audit / Metrics / Alerting
```

建議後續分階段補齊：

1. **BFF / API Gateway**：統一 authentication、authorization、tenant context、request validation、rate limiting。
2. **LLM Gateway**：集中 model routing、fallback、quota、cost control、safety policy。
3. **Tool Service**：將 high-risk tools 從 agent runtime 拆出，加入 permission、audit、限流、熔斷。
4. **Observability**：接 trace、metrics、audit events、alerting。
5. **Gray Release**：對 graph version、tools、prompt、model routing 做灰度。
