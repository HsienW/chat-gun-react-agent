## Context

第一階段已新增 `qwen` provider 與 Qwen/Bailian OpenAI-compatible Chat Completions adapter，並以 mock tests 覆蓋 text invoke、JSON mode、vision payload、tool calling、ToolMessage round-trip、metadata 與 error mapping。尚未完成的是以真實 `QWEN_API_KEY` 對百煉 endpoint 執行 live smoke，也尚未形成可交付的 production readiness 缺口矩陣。

第二階段在同一 Backend Runtime 邊界內新增 live smoke gate。Frontend 與 BFF 不變；Graph ID 不變；MCP 不改為 provider-hosted MCP；Gemini SDK 與 fallback 繼續保留。

## Goals / Non-Goals

**Goals:**

- 新增預設 skip 的 Qwen/Bailian live smoke test。
- `RUN_QWEN_LIVE_SMOKE=true` 時執行 live smoke；缺 key 時安全 fail。
- live smoke 驗證 text、JSON mode、vision、tool calling round-trip、MCP Agent 架構、metadata normalization。
- error mapping mock tests 對齊生產語意與錯誤碼命名。
- 所有 smoke output 只包含 provider、model、endpointKind、capability、usage presence 與受限摘要，不列印 API key、headers、完整 prompt 或過長 response。
- 產出 production readiness 矩陣，明確區分 LiveVerified、MockVerified、NotVerified。

**Non-Goals:**

- 不移除 Gemini SDK、Gemini fallback、Gemini env 或 deprecated Gemini aliases。
- 不新增大型依賴或 TypeScript runner。
- 不修改 frontend/bff 公開 API。
- 不修改 `backend/langgraph.json` Graph ID。
- 不改 MCP 架構為 Bailian Responses API 託管。
- 不把 live smoke 當作一般 CI 必跑項目。

## Decisions

### Decision: 使用 Vitest gated live smoke

新增 `*.live-smoke.test.ts`，透過既有 `npm run test` runner 執行，不新增 `tsx` 或其他 runner。一般測試中若 `RUN_QWEN_LIVE_SMOKE` 不是 `true`，live suite 會 skip。若設定為 `true` 但缺 `QWEN_API_KEY`，suite 會 fail 並只輸出 `QWEN_API_KEY=missing` 類安全訊息。

替代方案是新增獨立 script；不採用，因為目前已有 Vitest，新增 runner 會增加依賴與維護面。

### Decision: Live smoke 使用 gateway public contract

Live smoke 只透過 `llmGateway.createChatModel()`、LangChain messages、ToolNode 與既有 upload preflight 呼叫，不繞過 provider adapter，也不直接組私有 request header。這能驗證真實 Runtime path，而不是另寫一份 smoke-only HTTP client。

### Decision: Live smoke 限制輸出與驗證面

Live smoke 只記錄：

- provider。
- endpointKind。
- model id。
- finish_reason。
- response id presence。
- usage metadata presence。
- capability metadata。
- response snippet 長度受限且經敏感資訊遮罩。

不輸出：

- API key。
- Authorization header。
- 完整 request body。
- 完整 prompt。
- 完整 response body。

### Decision: Tool calling live smoke 使用 calculator tool

Tool calling live smoke 使用現有 deterministic calculator tool，問題固定為「請使用工具計算 123*456，不要心算。」流程必須驗證：

1. Qwen 回傳 tool call。
2. Gateway 轉成 LangChain `AIMessage.tool_calls`。
3. Backend ToolNode 執行 calculator。
4. ToolMessage 回填下一輪 Qwen。
5. Qwen 回傳包含 `56088` 的 final answer。
6. tool_call_id 保持一致。

這仍保持 MCP/Tool execution 在 Backend，不交給百煉託管。

### Decision: MCP Agent live boundary 使用架構與 model tool calling 分層驗證

本機可能沒有可用 MCP server。第二階段不強制啟動外部 MCP server；live Qwen 部分至少驗證 model tool calling 能力，MCP Agent 架構部分以 mock/integration 驗證仍使用 Backend ToolRegistry / ToolNode / governance，不因 `LLM_PROVIDER=qwen` 缺 `bindTools` 失敗。

### Decision: Error mapping 以 mock 驗證，不 live 破壞 provider

Auth/quota/5xx/network/timeout/invalid JSON 不以真實 provider 故意打壞。這些使用 mock tests 固化 provider adapter 與 error envelope 行為，避免產生不必要的帳號風險、成本、鎖定或敏感錯誤 payload。

## Risks / Trade-offs

- [Risk] 真實百煉帳號未授權 vision/tool model。→ Mitigation：live smoke 標示 failure 或 unsupported，不宣稱該 capability live verified。
- [Risk] Tool calling 模型可能偶爾直接心算。→ Mitigation：prompt 明確要求用工具；若仍失敗，固定 failing output 後最小修改 tool_choice 或 prompt，不堆疊無證據分支。
- [Risk] Provider usage metadata 可能缺欄位。→ Mitigation：只檢查是否正規化可用欄位，不假造缺失欄位。
- [Risk] Live smoke 造成成本。→ Mitigation：預設 skip，只有顯式 env 開關執行，payload 小且固定。
- [Risk] Network sandbox 或本機代理阻擋。→ Mitigation：將結果標示為 NotVerified / Blocked，mock verification 不等同 live verification。

## Migration Plan

1. 新增第二階段 OpenSpec artifacts 並通過 validate。
2. 新增 gated live smoke test。
3. 補齊 error mapping mock tests 與必要的最小 runtime 修正。
4. 執行 `npm run lint`、`npm run test`、`npm run build`、`git diff --check`。
5. 檢查 `QWEN_API_KEY` present/missing，不輸出值。
6. 若 key present 且允許 live network，執行 `RUN_QWEN_LIVE_SMOKE=true npm run test -- --run live-smoke` 或 PowerShell 等價命令。
7. 完成回報 production readiness matrix。

Rollback：

- live smoke 預設 skip，不影響一般 CI。
- 若 live smoke 暴露問題，可保留第一階段 adapter，暫停 qwen rollout。
- `LLM_PROVIDER=gemini` 仍可回滾到 Gemini。

## Open Questions

- 實際可用 vision model id 需依百煉帳號授權確認。
- 是否將 live smoke 納入 release gate，需要在有穩定 credential 與成本預算後決定。
- Gemini 移除需另開 `remove-gemini-runtime-fallback` change，且以前述 live smoke 穩定通過為前置條件。
