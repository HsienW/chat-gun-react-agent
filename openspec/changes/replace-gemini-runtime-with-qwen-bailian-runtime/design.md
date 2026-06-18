## Context

Backend 目前透過 LLM Gateway 抽象 Gemini SDK、CCR Anthropic messages 與 OpenAI-compatible Chat Completions。Gemini path 由 `@langchain/google-genai` 提供完整 LangChain chat model 能力；OpenAI-compatible path 目前是本地 fetch adapter，僅支援基本文字 invoke；CCR path 支援 Anthropic messages 基本文字 invoke。MCP Agent 依賴 LangChain `bindTools`，因此非 Gemini provider 若沒有 `bindTools` 會在 runtime 直接失敗。

第一階段要導入正式 Qwen／阿里雲百煉 Runtime，但必須保持相容：

- 不移除 Gemini SDK。
- 不修改 frontend/bff 公開 API。
- 不修改 Graph ID。
- 不改 MCP 執行權責，仍由 Backend MCP Client 與 ToolRegistry 執行。
- 不提交 credential。
- 保留 `OPENAI_COMPATIBLE_*`、`OPENAI_*`、`CCR_*` aliases。
- 保留 Gemini fallback。

Frontend 與 BFF 本階段不需要改動；使用者仍透過既有 BFF 呼叫 LangGraph。Backend 的 provider selection、payload、response parsing、tool calling 與錯誤映射在 LLM Gateway 內收斂。

## Goals / Non-Goals

**Goals:**

- 新增 `qwen` provider，支援 `LLM_PROVIDER=qwen`。
- 使用 Qwen／阿里雲百煉 OpenAI-compatible Chat Completions。
- 對 chat、math、research、vision、tool 五種模型用途建立 capability-aware resolution。
- 支援 Qwen text invoke、vision content parts、JSON mode、tool calling、ToolMessage round-trip、usage metadata 與 response metadata。
- 讓 MCP Agent 在 Qwen provider 下可使用 `bindTools`，不因缺少 `bindTools` 失敗。
- 讓 Deep Research planner、weather extraction、repair、synthesis 與 image analysis 可走 Qwen-capable gateway。
- 保留 Gemini、CCR、OpenAI-compatible 既有行為與 aliases。
- 用 deterministic/mock tests 覆蓋 request payload、response parsing、error mapping、tool calling round-trip、vision payload 與 fallback。
- 如實標示 live Qwen／Bailian smoke 未驗證或缺少真實 `QWEN_API_KEY` 的狀態。

**Non-Goals:**

- 不移除 `@langchain/google-genai`。
- 不將 MCP 改成百煉 Responses API 或 Provider-hosted MCP。
- 不新增 frontend/bff 公開 API。
- 不修改 `deep_researcher`、`chatbot`、`math_agent`、`mcp_agent` Graph ID。
- 不以模型名稱字串包含關係改變 Domain Schema。
- 不重寫天氣地點 resolver，不新增固定自然語言 keyword regex、CJK phrase stripping 或刪字策略。
- 不提交、顯示或記錄真實 API key/token。

## Decisions

### Decision: Qwen 作為獨立 Provider，而不是 OpenAI-compatible alias

新增 `qwen` provider type，使 `LLM_PROVIDER=qwen` 具有自己的環境變數、預設 base URL、模型用途解析與 diagnostics。OpenAI-compatible 與 CCR aliases 繼續存在，但不混用 Qwen credential 名稱。

替代方案是把 Qwen 當作 `openai-compatible` 的一組環境變數文件範例；不採用，因為這會讓 provider diagnostics、error mapping、模型用途與 production rollout 難以區分。

### Decision: OpenAI-compatible Chat Completions adapter 支援 Qwen 與 generic OpenAI-compatible

Qwen adapter 使用相同 Chat Completions payload/response parser，但 provider metadata 標示為 `qwen`。Generic OpenAI-compatible 也可獲得 `response_format`、vision parts、tool calling 與 metadata 的能力擴充，避免兩套相似 fetch adapter 分歧。

Endpoint 組合使用 base URL 去除結尾 slash 後加上 `/chat/completions`，若 base URL 已包含 `/chat/completions` 則保持不重複；若 base URL 為 `/v1` 或百煉 compatible-mode `/v1`，最終 endpoint 必須是 `/v1/chat/completions`。

### Decision: Capability-aware model resolution 收斂在 Gateway

Gateway 增加模型用途概念：

```text
chat
math
research
vision
tool
```

Agent 只傳入用途或相容的既有 model override。Provider adapter 依 provider 與用途解析模型：

- Qwen chat/math 預設 `QWEN_CHAT_MODEL`。
- Qwen research 預設 `QWEN_RESEARCH_MODEL`，再 fallback `QWEN_CHAT_MODEL`。
- Qwen vision 預設 `QWEN_VISION_MODEL`。
- Qwen tool 預設 `QWEN_TOOL_MODEL`，再 fallback `QWEN_CHAT_MODEL`。
- 既有 `CHAT_MODEL`、`MATH_MODEL`、`MCP_AGENT_MODEL`、`DEFAULT_MODEL` 保持相容 override。

模型能力以 provider/purpose 設定，不以 `model.includes("qwen")` 改變 Domain Schema。

### Decision: Tool schema 使用本地最小 Zod-to-JSON Schema adapter

目前 backend 未引入 `zod-to-json-schema` 類依賴。第一階段避免新增大型依賴，先實作本地最小 adapter，覆蓋現有工具常見 schema：

- object
- string
- number/integer
- boolean
- array
- enum
- optional
- unknown fallback

若未來工具 schema 變複雜，再評估新增正式 JSON Schema 轉換依賴。

### Decision: Tool calling round-trip 使用 LangChain message roles 保持穩定

OpenAI-compatible assistant `tool_calls` 轉成 LangChain `AIMessage.tool_calls`，保留 provider 回傳 `id`、function name、parsed JSON args 與 `type: "tool_call"`。下一輪 request 將 AIMessage tool calls 序列化為 assistant `tool_calls`，並將 `ToolMessage` 序列化為 role `tool`，保留 `tool_call_id`，讓模型能識別 tool result。

若 tool call arguments 不是有效 JSON，adapter 會回傳空物件並在 metadata 中保留 parse failure 訊號，避免讓未驗證字串直接進 ToolNode。

### Decision: JSON mode 由 Gateway options 表達

`createChatModel` options 支援 `responseFormat: { type: "json_object" }`，Planner、weather extraction 與 repair 使用此選項。若 provider 不支援 structured output，capability metadata 可保留但不改變 Domain Schema；解析後仍必須通過現有 Runtime Validation。

### Decision: Vision 使用既有 `image_url` content parts

Backend upload security 仍負責圖片數量、大小、MIME type、data URL 與 magic bytes 驗證。Gateway 不重新放寬圖片安全限制，只將既有 LangChain/HumanMessage content parts 轉為 OpenAI-compatible `messages[].content` 陣列格式。若 provider/model capability 不支援 vision，回傳結構化錯誤；不得 silent success。

### Decision: Provider-specific error mapping 以狀態與錯誤類型為主

HTTP response adapter 以 status code 分類：

- 401/403 -> `provider_auth_error`
- 429 -> `quota_or_rate_limit_exceeded`
- 400 -> `provider_bad_request`
- 5xx -> `provider_error`
- JSON parse -> `provider_response_parse_error`
- AbortError -> `timeout`
- fetch/network cause -> `network_error`

不使用自然語言錯誤文字作為主要分類。錯誤 envelope 會記錄 provider、stage、statusCode、endpointKind 與 responseContentLength；不得包含 API key、Authorization header 或完整 response body。

## Risks / Trade-offs

- [Risk] 百煉 Chat Completions 對 `response_format`、`tool_choice` 或部分 usage 欄位可能與 OpenAI 不完全一致。→ Mitigation：payload 與 parser 對 unknown 欄位寬容，metadata normalization 只使用穩定欄位，live smoke 未驗證時如實標示。
- [Risk] 本地 Zod-to-JSON Schema adapter 覆蓋面有限。→ Mitigation：先覆蓋現有工具 schema 並用 mock tests 固定；未支援型別 fallback 到 permissive object/unknown schema，不降低 ToolNode 的 runtime validation。
- [Risk] Vision model capability 配置錯誤可能導致文字模型收到圖片 payload。→ Mitigation：透過 purpose `vision` 與 `supportsVision` 檢查，無能力時回傳結構化錯誤。
- [Risk] 錯誤 response body 可能含敏感資訊。→ Mitigation：error diagnostics 僅保存 status、endpointKind、provider、responseContentLength 與 sanitized details，不保存完整 body。
- [Risk] 完整 live Qwen smoke 需要真實 credential。→ Mitigation：mock integration 作為自動化門檻；live smoke 在完成回報中獨立標示。

## Migration Plan

1. 新增 OpenSpec proposal/design/spec/tasks 並通過 `openspec validate replace-gemini-runtime-with-qwen-bailian-runtime`。
2. 擴充 LLM Gateway provider type、options、model purpose、Qwen env resolution、OpenAI-compatible payload/response parser、tool schema adapter 與 error mapping。
3. 更新 Chatbot、Math Agent、Deep Research、MCP Agent 的模型用途與 JSON mode 使用方式。
4. 新增/更新 gateway、tool calling、planner JSON mode、vision payload、error mapping 與 compatibility tests。
5. 執行 backend lint/test/build。
6. 本機或部署環境設定 `LLM_PROVIDER=qwen` 與 `QWEN_API_KEY` 後再做 live smoke；未執行時不得標示 live 通過。

Rollback：

- 將 `LLM_PROVIDER` 改回 `gemini`、`ccr` 或 `openai-compatible`。
- 保留 Gemini SDK 與既有 aliases，避免 rollback 需要套件還原。
- 若 Qwen tool calling 或 vision 發現 provider 差異，先停用 `LLM_PROVIDER=qwen` rollout，不影響既有 Graph ID 與 frontend/bff API。

## Open Questions

- 真實百煉帳號目前可用的模型清單與 tool-calling/vision support 需 live smoke 確認。
- 是否要在下一階段新增 dedicated live smoke script，避免一般 CI 需要 credential。
- 下一階段是否移除 Gemini SDK，需等 Qwen text、vision、tool calling、MCP Agent 與 Deep Research live smoke 穩定後再提出獨立 change。
