# Tasks：將產品 Runtime 從 Gemini 路徑遷移到 Qwen／阿里雲百煉第一階段

## 1. OpenSpec 與基線驗證

- [x] 1.1 建立 `proposal.md`，涵蓋目標、非目標、相容性、風險與回滾策略。
- [x] 1.2 建立 `design.md`，涵蓋 provider gateway、model purpose、tool calling、vision、MCP、安全與驗證設計。
- [x] 1.3 建立 `specs/backend-model-runtime/spec.md`，涵蓋 Qwen provider、env vars、Chat Completions、JSON mode、vision、tool calling、MCP、error mapping、metadata、fallback、credential safety 與 live smoke 標示。
- [x] 1.4 執行 `openspec validate replace-gemini-runtime-with-qwen-bailian-runtime` 並通過。
- [x] 1.5 確認本 change 未修改 frontend/bff 公開 API，且未修改 `backend/langgraph.json` Graph ID。

## 2. LLM Gateway Provider 與模型解析

- [x] 2.1 將 provider type 擴充為 `gemini | ccr | openai-compatible | qwen`，並更新 provider diagnostics。
- [x] 2.2 新增 Qwen env resolution，支援 `QWEN_BASE_URL`、`QWEN_API_KEY`、`QWEN_CHAT_MODEL`、`QWEN_RESEARCH_MODEL`、`QWEN_VISION_MODEL`、`QWEN_TOOL_MODEL`。
- [x] 2.3 保留 `OPENAI_COMPATIBLE_*`、`OPENAI_*`、`CCR_*`、`GEMINI_API_KEY`、`DEFAULT_MODEL`、`CHAT_MODEL`、`MATH_MODEL`、`MCP_AGENT_MODEL` aliases 與 Gemini fallback。
- [x] 2.4 新增 capability-aware model purpose resolution：`chat`、`math`、`research`、`vision`、`tool`。
- [x] 2.5 修正 Chat Completions URL builder，確保 base URL 結尾處理與 `/chat/completions` endpoint 正確。

## 3. OpenAI-Compatible／Qwen Chat Completions Adapter

- [x] 3.1 支援 text invoke 與 `choices[0].message.content` response parsing。
- [x] 3.2 支援 `response_format: { type: "json_object" }` request body。
- [x] 3.3 支援 vision `image_url` content parts 與 data URL payload。
- [x] 3.4 支援 provider response `tool_calls` parsing 為 LangChain `AIMessage.tool_calls`。
- [x] 3.5 支援 usage metadata、response metadata、model id、finish reason 與 response id normalization。
- [x] 3.6 解析錯誤時只輸出 sanitized diagnostics，不洩漏 response body 或 credential。

## 4. Tool Calling 與 MCP Round Trip

- [x] 4.1 新增 `bindTools` 支援，將 LangChain structured tools 轉為 OpenAI-compatible `tools` schema。
- [x] 4.2 支援預設 `tool_choice: "auto"`，並保留可選 override 而不破壞既有呼叫端。
- [x] 4.3 序列化 assistant tool calls 與 `ToolMessage`，保留 `tool_call_id` 供下一輪模型識別。
- [x] 4.4 確認 MCP Agent 在 `LLM_PROVIDER=qwen` 下不因缺少 `bindTools` 拋出錯誤。
- [x] 4.5 確認 MCP 仍由 Backend MCP Client、ToolRegistry 與 ToolNode 執行，不改為百煉託管。

## 5. Agent Runtime 遷移

- [x] 5.1 更新 Chatbot，預設模型改走 gateway/env resolution，支援 `QWEN_CHAT_MODEL` 並保留 `CHAT_MODEL`。
- [x] 5.2 更新 Math Agent，calculator deterministic result 優先且不得被模型覆寫；自然語言 fallback 支援 Qwen tool/chat model。
- [x] 5.3 更新 Deep Research text planner、weather extraction、repair 與 synthesis 使用 Qwen-capable gateway 與 JSON mode。
- [x] 5.4 更新 Deep Research vision routing，使用 vision purpose 與 `QWEN_VISION_MODEL`，保留 image upload safety。
- [x] 5.5 更新 image recognition/provider diagnostics，不再將 provider 寫死為 Gemini。
- [x] 5.6 保持天氣地點解析不新增固定 keyword regex、CJK phrase stripping 或刪字策略作為主要修復。

## 6. Error Mapping 與 Credential Safety

- [x] 6.1 更新 provider error mapping，區分 401/403 auth、429 quota/rate limit、400 bad request、5xx provider、network、timeout/abort、invalid JSON。
- [x] 6.2 確認 `formatLlmError()` / error envelope provider 可標示 `qwen`。
- [x] 6.3 確認錯誤 envelope、測試、OpenSpec 與文件不包含真實 API key、token 或 credential。
- [x] 6.4 確認本機 `.env` 未被讀出、提交或寫入測試輸出。

## 7. 測試

- [x] 7.1 更新 `backend/src/platform/llm-gateway.test.ts`，覆蓋 Qwen env、endpoint、authorization、response_format、vision payload、tool schema、tool call parsing、ToolMessage round-trip、error mapping、Gemini fallback、OpenAI-compatible aliases 與 CCR aliases。
- [x] 7.2 新增或更新 MCP/tool-calling mock test，覆蓋 model emits tool call、ToolNode executes、ToolMessage returns、model emits final answer。
- [x] 7.3 新增或更新 Deep Research planner JSON mode test，確認 planner/repair request body 使用 `response_format`。
- [x] 7.4 新增或更新 Vision request payload test，確認 image content parts 進入 OpenAI-compatible payload 且錯誤 provider 不寫死 Gemini。
- [x] 7.5 新增或更新 Math Agent test，確認 calculator result 不被模型覆寫。

## 8. 驗證與完成

- [x] 8.1 執行 `cd backend; npm run lint` 並通過。
- [x] 8.2 執行 `cd backend; npm run test` 並通過。
- [x] 8.3 執行 `cd backend; npm run build` 並通過。
- [x] 8.4 確認未執行 live Qwen／Bailian smoke 時，完成回報明確標示未驗證與是否缺少真實 `QWEN_API_KEY`。
- [x] 8.5 確認仍保留 Gemini fallback 與 `@langchain/google-genai`。
- [x] 8.6 確認最終 Git Diff 不包含無關修改，不包含 credential，不修改 frontend/bff 公開 API，不修改 Graph ID，不將 MCP 改成百煉託管。
