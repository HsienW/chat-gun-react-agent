## Why

Backend Deep Research Agent 目前將查詢工作流（plan→route→tool execution→synthesis）的行為契約隱含在 1800+ 行的單一 agent 檔案中。LangGraph State（14 個 Annotation）、ResearchPlan 型別、Tool 契約、Structured Output Validation 流程與 Terminal State 規則沒有抽成可複用的顯式契約。當未來需要新增或修改查詢能力時，任何改動都可能透過共享的 State 欄位、共用型別或 synthesis prompt 間接影響不相關的查詢路徑，形成「改 A 壞 B」的回歸。

前面 3 步 Change 已分別為 frontend rendering（Change 1）、frontend stream state（Change 2）與 BFF stream cancellation（Change 3）建立穩固的傳輸層與狀態管理地基。現在需要在 Backend 層建立同等的結構契約，讓前端改善的收益不會被後端隱含行為的回歸抵銷。

## What Changes

- 定義 Query Workflow Invariant：明確定義查詢工作流的 lifecycle states（idle→plan→route→tool_execution→synthesis→done）、transitions、terminal state 不可逆規則與 error convergence 路徑。
- 顯式化 LangGraph State 契約：現有 DeepResearchState 的 14 個 Annotation 欄位歸類為通用查詢欄位與 domain-specific 擴充欄位，定義每個欄位的 owner node、write timing、readers、checkpoint 行為。
- 強化 Tool 契約：Tool input 必須有 Runtime Validation（Zod schema），Tool output 必須走 structured discriminated union（`status` + `errorCode`）。
- Provider Capability Enforcement：將 `LlmCapabilities` 從資訊型改為 enforcement gate。CCR provider 不支援 tool calling 或 structured output 時必須 fail fast，而非 silent skip。
- Structured Output Validation 正規化：定義三級處理流程（parse fail→retry once→repair/fallback），區分 JSON parse error、schema mismatch 與 total failure。
- Error Code 規範化：backend `inferErrorCode` 的 regex fallback 降級為 telemetry-only，公開 error code 必須來自結構化來源。
- Runtime Event 同步契約：定義 `AgentRuntimeEvent` 的擴充規則與 backend↔frontend 同步機制。
- 新增測試矩陣：success、invalid input、validation error、provider error、timeout、cancel、unknown event/status、checkpoint/resume。
- 不修改既有產品行為：所有變更僅顯式化隱含契約或增加 enforcement gate。

## Capabilities

### New Capabilities

- `backend-query-workflow`: 定義 Backend 查詢類能力的通用工作流不變量、State 契約、Tool 契約、Provider Capability 邊界、Structured Output Validation 規則、Runtime Event 同步契約與 Terminal State 規則。

### Modified Capabilities

- `backend-model-runtime`: 新增 Provider Capability enforcement 的 requirement：capability 不足時必須 fail fast 而非 silent degradation。修改 `LlmCapabilities` 的角色從資訊型變為 enforcement gate。

## Impact

- 受影響套件：`backend`。
- 預計受影響檔案：
  - `backend/src/agents/deep-researcher.ts`（State 欄位契約文件化、不變量顯式化）
  - `backend/src/platform/llm-gateway.ts`（LlmCapabilities enforcement）
  - `backend/src/platform/errors.ts`（inferErrorCode regex 降級）
  - `backend/src/platform/agent-runtime-events.ts`（同步契約）
  - `backend/src/tools/registry.ts`（Tool 契約文件化）
  - 新增 `backend/src/**` query workflow invariant tests
  - `docs/architecture.md`（新增查詢契約文件）
- 明確排除：
  - `backend/src/tools/weather*.ts`（天氣功能不納入）
  - `backend/src/tools/geocoding/**`（地理解析不納入）
  - `bff/**`（BFF 確認相容但不修改）
  - `frontend/**`（frontend 確認相容但不修改，除非 event type 同步）
- Public API 與跨層契約：
  - 不修改 Graph ID、Graph input/output shape、BFF route、Tool Result schema。
  - 不修改 `useStream` callback signatures。

## Non-goals

- 不處理天氣功能、不修改 weather tool、不修改地理解析。
- 不取代或合併 `generalize-weather-location-resolution` Change。
- 不以天氣案例作為主要設計目標。
- 不更換主要 model provider。
- 不新增未核准的 provider。
- 不改 frontend UI 視覺設計。
- 不重寫 BFF proxy。
- 不移除 MCP 能力。
- 不做 production live provider 驗證。

## Risks

- Capability enforcement（CCR provider 對 `bindTools`/`structuredOutput` fail fast）可能暴露既有 silent degradation 路徑。緩解：enforcement 只加在 model creation 階段，不影響成功路徑。
- Query Workflow Invariant 若定義過嚴，可能限制未來查詢模式的靈活性。緩解：invariant 聚焦 terminal state 不可逆、Tool 契約與 error convergence，不規範具體 Node 實作。
- `AgentRuntimeEvent` 同步機制若沒有一致 enforcement，backend/frontend type drift 仍會發生。緩解：在 spec 中定義同步規則，並在 verification 階段做 cross-package type check。

## Rollback strategy

- Capability enforcement：回滾 `llm-gateway.ts` 的 enforcement gate，恢復為資訊型 capabilities。
- Error code：回滾 `errors.ts` 的 regex 降級（恢復為既有 inferCode 行為）。
- Query Workflow Invariant：純文件與 spec 層面的變更，不影響執行期行為。
