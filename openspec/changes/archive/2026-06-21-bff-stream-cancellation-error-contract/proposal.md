# Proposal：BFF Stream Cancellation 與 Error Contract

## Why

目前 BFF 的 LangGraph proxy 已具備 upstream timeout 與基本 stream pipe，但 cancellation、client disconnect、stream 中途錯誤與 Error Code 分類仍缺少明確契約。這會造成兩個風險：client 已停止接收後 upstream 仍可能繼續執行，以及 response header 已送出後的 stream error 可能被前端視為正常結束。

本 Change 將 BFF stream proxy 的取消、斷線、timeout 與中途錯誤收斂成結構化、可測試、可觀測的傳輸契約，並明確要求 Node 22 runtime 以使用 `AbortSignal.reason`。

## What Changes

- BFF runtime baseline 明確要求 Node 22，並在實作階段於 `bff/package.json` 新增 `engines.node: ">=22"`。
- BFF MUST 使用結構化 `AbortReason`，並透過 `AbortController.abort(reason)` / `AbortSignal.reason` 區分：
  - `bff_timeout`
  - `client_disconnected`
  - `client_cancelled`，僅在未來有明確 cancel API 時使用
  - `upstream_error`
  - `upstream_stream_error`
- Frontend deliberate cancel 目前採既有 `thread.stop()` 路徑；Proposal 採方案 A：BFF 以 downstream connection close 感知，並歸類為 `client_disconnected`，不新增 cancel API。
- BFF MUST 在 request body 讀取階段偵測 `req.on("close") && !req.complete`，並終止 upstream intent。
- BFF MUST 在 upstream streaming 階段以 `res.on("close")` 且尚未正常完成作為主要 downstream disconnect 訊號，並 abort upstream fetch。
- Stream proxy error MUST 依 response 狀態分流：
  - headers 尚未送出：回傳 HTTP 502/504 與 `ErrorEnvelope`。
  - headers 已送出且 response 是 SSE：送出 trailing `event: error` frame 後結束 stream。
  - headers 已送出但不是 SSE：中止連線並寫入 audit log，不嘗試注入 JSON。
- BFF error classification MUST 以結構化來源為主，取代目前 `fetch failed|connect|network|timeout` regex 作為公開 error code 主要來源。
- 不新增 BFF 環境變數；沿用既有 `BFF_UPSTREAM_TIMEOUT_MS` 控制 upstream fetch/stream 全生命週期。
- Frontend MUST 將新增 BFF stream error code 映射到 `timeout | abort | generic`，並維持 reducer terminal idempotency。

## Capabilities

### New Capabilities

- `bff-stream-proxy`: 定義 BFF LangGraph stream proxy 的 cancellation、disconnect、timeout、stream error 與 structured ErrorEnvelope/SSE error frame 契約。

### Modified Capabilities

- `frontend-chat`: 新增 frontend 對 BFF stream error code 的分類要求，確保 timeout、abort 與 generic error 不依賴顯示文案，且 terminal state 不回退。

## Impact

- Affected packages:
  - `bff`
  - `frontend`
- Affected files expected during implementation:
  - `bff/package.json`
  - `bff/src/server.ts`
  - `bff/src/errors.ts`
  - `bff/src/config.ts` only if config validation needs to document existing `BFF_UPSTREAM_TIMEOUT_MS`
  - `bff/.env.example` only to confirm no new env is introduced
  - `frontend/src/App.tsx`
  - `frontend/src/types/errors.ts`
  - focused BFF and frontend tests
- Public compatibility:
  - `/api/langgraph/*` route remains unchanged.
  - Existing `ErrorEnvelope` shape remains backward compatible through additive code values.
  - Existing frontend `thread.stop()` usage remains unchanged.
  - No BFF/backend credential exposure is introduced.

## Non-goals

- 不新增獨立 cancel API。
- 不修改 LangGraph upstream route、Graph ID 或 SDK callback signature。
- 不重寫 LangGraph SDK `useStream` integration。
- 不修改 backend agent runtime event production。
- 不新增 BFF environment variable。
- 不以錯誤文字 regex 作為公開 error code 主要分類來源。

## Risks

- 若 LangGraph SDK 的 `thread.stop()` 不會關閉 browser stream request，BFF 只能觀測到一般 disconnect，而無法辨識 deliberate cancel。此 Change 明確接受此限制，並將其歸類為 `client_disconnected`。
- 若 upstream response 不是 SSE 且 headers 已送出，BFF 無法再安全回傳 JSON error envelope。此情境只能中止連線並 audit。
- 若 frontend 或 SDK 不會處理 trailing SSE `event: error`，需要在 implementation inventory 中補 parser 或 callback bridge，避免 stream error 被誤判為正常 finish。
- 新增 `engines.node` 可能讓低於 Node 22 的 local/CI 環境提早失敗；這是預期的 runtime contract 收斂。

## Rollback strategy

- 若 disconnect propagation 造成 regression，可回滾 BFF stream close listener 與 AbortReason wiring，保留既有 upstream timeout 行為。
- 若 trailing SSE error frame 與 SDK 不相容，可先停用 SSE trailing frame，保留 audit 與 connection abort，再以後續 change 補 frontend parser。
- `engines.node` 可在 emergency rollback 中移除，但必須同步回退任何依賴 `AbortSignal.reason` 的 implementation。
