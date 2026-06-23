## Why

目前產品 Runtime 的主要預設路徑仍偏向 Gemini，OpenAI-compatible 與 CCR 只覆蓋部分文字呼叫，尚未形成正式的 Qwen／阿里雲百煉 Provider 契約。這會限制正式付費 Qwen 模型在 Chat、Deep Research、Vision、Tool Calling 與 MCP Agent 中的生產級使用，也讓錯誤映射、模型能力與 metadata normalization 難以一致驗證。

第一階段需要以最小且向後相容的方式導入正式 `qwen` Provider，讓 Backend Runtime 可以透過阿里雲百煉 OpenAI-compatible Chat Completions 使用 Qwen text、vision 與 tool-calling 模型，同時保留 Gemini fallback、Gemini SDK、既有 OpenAI-compatible aliases 與 CCR aliases。

## What Changes

- 新增正式 `qwen` LLM Provider selection，支援 `LLM_PROVIDER=qwen`。
- 新增 Qwen／阿里雲百煉環境變數：
  - `QWEN_BASE_URL`
  - `QWEN_API_KEY`
  - `QWEN_CHAT_MODEL`
  - `QWEN_RESEARCH_MODEL`
  - `QWEN_VISION_MODEL`
  - `QWEN_TOOL_MODEL`
- Qwen Provider 使用 OpenAI-compatible Chat Completions endpoint，預設 base URL 為 `https://dashscope.aliyuncs.com/compatible-mode/v1`，最終 endpoint 為 `/chat/completions`。
- 擴充 Backend LLM Gateway，使 Qwen／OpenAI-compatible 路徑支援：
  - text invoke
  - vision `image_url` content parts 與 data URL
  - `response_format: { type: "json_object" }`
  - `bindTools`
  - OpenAI-compatible `tool_calls` 解析為 LangChain `AIMessage.tool_calls`
  - ToolMessage round-trip
  - usage 與 response metadata normalization
- Backend agents 改由 gateway/env resolution 選擇模型用途，不在 agent 內硬塞 Qwen 模型名稱。
- Chatbot、Math Agent、Deep Research text/planner/repair/synthesis 與 Vision analysis 可走 Qwen-capable gateway。
- MCP Agent 保持 Backend `MCPClient -> ToolRegistry -> Model bindTools` 路徑，不改為百煉 Responses API 直接託管 MCP。
- Provider-specific error mapping 區分 auth、quota/rate limit、bad request、provider 5xx、network、timeout/abort 與 JSON parse error，且不得洩漏 API key。
- 保留既有 `OPENAI_COMPATIBLE_*`、`OPENAI_*`、`CCR_*` aliases 與 Gemini fallback。
- 不提交任何真實 API key、token 或 credential。
- 不修改 frontend/bff 公開 API。
- 不修改既有 Graph ID。
- 不移除 `@langchain/google-genai`。

## Capabilities

### New Capabilities

- `backend-model-runtime`: Backend 模型 Runtime Provider selection、Qwen/Bailian Chat Completions、模型用途解析、tool calling、vision routing、錯誤映射、metadata normalization 與相容 fallback。

### Modified Capabilities

- 無。此 repository 目前沒有既有 main spec 需要修改；本 change 以新增 Backend Runtime capability delta spec 描述第一階段行為。

## Impact

- 受影響套件：
  - `backend`
- 受影響能力域：
  - Model Provider
  - Resolver / Provider Adapter
  - Backend Intent / Planner / Structured Output
  - Tool Execution
  - MCP Tool Calling
  - Vision model routing
  - Provider error mapping
- 預期受影響檔案：
  - `backend/src/platform/llm-gateway.ts`
  - `backend/src/platform/errors.ts`
  - `backend/src/agents/chatbot.ts`
  - `backend/src/agents/math-agent.ts`
  - `backend/src/agents/deep-researcher.ts`
  - `backend/src/agents/mcp-agent.ts`
  - `backend/src/agents/message-normalization.ts`
  - 相關 backend 測試
- API 與 Graph 相容性：
  - frontend/bff 公開 API 不變。
  - `backend/langgraph.json` Graph ID 不變。
  - MCP 仍由 Backend 執行與治理。
- 依賴影響：
  - 第一階段不移除 Gemini SDK。
  - 若現有依賴無法將 Zod schema 轉成 OpenAI tool JSON schema，需優先採用本地最小 schema adapter；只有必要時才新增依賴並在 design/tasks 說明。
- 風險：
  - Qwen／百煉 OpenAI-compatible tool calling 與 vision payload 需用 mock test 固定契約；未提供真實 `QWEN_API_KEY` 時不得宣稱 live smoke 通過。
  - 不同 OpenAI-compatible endpoint 對 `tool_choice`、`response_format` 或 usage 欄位支援可能不同，需保留 unknown 欄位與可降級 metadata。
  - Provider error 內容可能包含敏感 header 或 request body，錯誤 envelope 必須遮罩 credential。
- 回滾策略：
  - 將 `LLM_PROVIDER` 改回 `gemini`、`ccr` 或 `openai-compatible`。
  - 保留 Gemini SDK 與 fallback，避免 Qwen rollout 失敗時破壞既有 Runtime。
  - 若 Qwen live smoke 未通過，保持 mock-verified implementation，但將 live 驗證標記為未完成。
