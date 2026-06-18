## Why

第一階段已完成 Qwen／阿里雲百煉 Runtime 的 mock-verified provider adapter、tool calling、JSON mode、vision routing 與相容 fallback，但尚未用真實百煉 credential 做 live smoke。若沒有可重複且安全的 live smoke gate，就無法判斷目前實作是否已脫離 mock-only 狀態，也無法形成進入生產化 Agent Chat 的缺口矩陣。

第二階段要新增安全、預設不執行的 Qwen／Bailian live smoke 測試入口，並補齊 production readiness 所需的錯誤碼、metadata 與風險盤點；本階段仍不移除 Gemini SDK 或 fallback。

## What Changes

- 新增 gated live smoke 測試，預設在一般 `npm run test` 中 skip。
- live smoke 只有在 `RUN_QWEN_LIVE_SMOKE=true` 時才會嘗試連線百煉。
- `RUN_QWEN_LIVE_SMOKE=true` 但缺少 `QWEN_API_KEY` 時，測試必須 fail 且只輸出 safe missing message，不輸出 key。
- live smoke 覆蓋：
  - Chat text。
  - Planner JSON / `response_format: { type: "json_object" }`。
  - Vision capability routing 與小型 data URL preflight。
  - Tool calling、`tool_choice`、`tool_calls`、ToolMessage round-trip。
  - MCP Agent 架構不被百煉託管替代。
  - Provider-specific error mapping。
  - Usage / model metadata normalization。
- 補齊 mock tests，使 error mapping 名稱與生產化要求對齊：
  - 401/403 -> auth/permission。
  - 429 -> quota/rate limit。
  - 400 -> provider request validation。
  - 5xx -> provider unavailable / HTTP。
  - network -> network error。
  - timeout/abort -> timeout。
  - invalid JSON -> LLM response JSON parse failure。
- 新增 production readiness 矩陣，區分 live verified、mock verified、not verified 與 remaining risk。
- 不讀取、列印、提交或回報真實 API key、token 或 credential。
- 不修改 frontend/bff 公開 API。
- 不修改 `backend/langgraph.json` Graph ID。
- 不將 MCP 改成 Bailian Responses API 或 provider-hosted MCP。
- 不移除 `@langchain/google-genai`、Gemini fallback 或 Gemini SDK。

## Capabilities

### New Capabilities

- `backend-model-runtime`: 第二階段擴充同一 Backend Runtime capability，新增 Qwen/Bailian live smoke gate、production readiness reporting、live/mock evidence 分層與更精準的 provider error mapping。

### Modified Capabilities

- 無既有 main spec 可修改；本 repository 目前以 OpenSpec change delta 描述 Backend Runtime capability。

## Impact

- 受影響套件：
  - `backend`
- 受影響能力域：
  - Model Provider
  - Backend Intent / Planner / Structured Output
  - Tool Execution
  - MCP Tool Calling
  - Vision model routing
  - Provider error mapping
  - Observability / diagnostics
  - Credential handling
- 預期受影響檔案：
  - `backend/src/platform/llm-gateway.ts`
  - `backend/src/platform/errors.ts`
  - `backend/src/platform/llm-gateway.test.ts`
  - 新增 live smoke 測試檔
  - 新增第二階段 OpenSpec artifacts
- API 與 Graph 相容性：
  - frontend/bff 公開 API 不變。
  - Graph ID 不變。
  - MCP 仍由 Backend ToolRegistry / ToolNode / MCP Client 執行。
- 風險：
  - 需要真實 `QWEN_API_KEY` 與網路連線才可完成 live verification；缺少時必須標示 NotVerified。
  - Qwen vision model id 可能因帳號可用模型不同而不同；live smoke 必須回報使用的 model id，但不得輸出 key。
  - Tool calling live 行為可能因模型版本而不穩定；若失敗，需先固化 failing test，再做最小修改。
- 回滾策略：
  - live smoke 測試預設 skip，不會影響一般 CI。
  - 若 live smoke 暴露 provider 差異，可保留第一階段 mock-verified adapter 並暫停 `LLM_PROVIDER=qwen` rollout。
  - Gemini SDK 與 fallback 仍保留，可透過 `LLM_PROVIDER=gemini` 回滾 runtime provider。
