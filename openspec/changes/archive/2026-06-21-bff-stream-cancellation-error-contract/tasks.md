# Tasks：BFF Stream Cancellation 與 Error Contract

## 0. Spec Gate

- [x] 0.1 確認 CCR Owner 已核准本 Proposal、Design 與 Specs。
- [x] 0.2 執行 `openspec validate bff-stream-cancellation-error-contract --strict`。
- [x] 0.3 編輯 source 前讀取根目錄 `AGENTS.md`、`bff/AGENTS.md`、`frontend/AGENTS.md`、本 change 的 Proposal/Design/Specs/Tasks，以及受影響 source/tests。
- [x] 0.4 確認本 change 不修改 backend runtime、Graph ID、LangGraph upstream route 或 frontend SDK callback signature。

## 1. BFF Runtime And Error Contract

- [x] 1.1 在 `bff/package.json` 新增 `engines.node: ">=22"`。
- [x] 1.2 新增 BFF-local `BffAbortReason` typed union。
- [x] 1.3 將 BFF timeout abort 改為 `abortController.abort({ code: "bff_timeout", ... })`。
- [x] 1.4 更新 error classification，優先使用 `AbortSignal.reason.code`。
- [x] 1.5 更新 error classification，將 `ECONNREFUSED`、`ENOTFOUND`、`ECONNRESET` 等 structured cause code 映射為穩定 code。
- [x] 1.6 移除 `fetch failed|connect|network|timeout` regex 作為公開 error code 主要分類來源；若保留，只能作 internal telemetry hint。

## 2. Client Disconnect Propagation

- [x] 2.1 在 request body 讀取階段偵測 `req.on("close") && !req.complete`。
- [x] 2.2 request body 未完整即 close 時分類為 `client_disconnected`，且不 proxy partial body。
- [x] 2.3 在 upstream streaming 階段以 `res.on("close")` 且未正常完成作為 downstream disconnect 主訊號。
- [x] 2.4 downstream close 時 abort upstream fetch/reader，reason code 為 `client_disconnected`。
- [x] 2.5 確保正常完成、錯誤、timeout、disconnect 路徑都清理 timer、listener 與 reader lock。

## 3. Stream Error Terminal Behavior

- [x] 3.1 headers 未送出時，保留 HTTP 502/504 + `ErrorEnvelope` 回應。
- [x] 3.2 headers 已送出且 content-type 為 SSE 時，送出 trailing `event: error` frame。
- [x] 3.3 trailing SSE error frame 使用 Design 定義的 `ErrorEnvelope` schema。
- [x] 3.4 headers 已送出但非 SSE 時，不注入 JSON，改為安全終止 response 並 audit。
- [x] 3.5 確保 public error response 不包含 stack trace、Authorization、Cookie、API key、完整 prompt 或完整 upstream body。

## 4. Frontend Error Classification

- [x] 4.1 更新 frontend stream error classification，支援 `bff_timeout`。
- [x] 4.2 更新 frontend stream error classification，支援 `client_disconnected`。
- [x] 4.3 更新 frontend stream error classification，支援 `upstream_stream_error`。
- [x] 4.4 確認 frontend 不以顯示文案推斷 timeout、abort 或 generic error。
- [x] 4.5 確認 reducer terminal idempotency 仍阻止 late progress 回到 running。

## 5. Tests

- [x] 5.1 為 BFF 新增可執行 `test` script；優先使用 Node 內建 `node:test` 與 `assert`。
- [x] 5.2 BFF 測試：upstream success proxy preserves chunks。
- [x] 5.3 BFF 測試：`BFF_UPSTREAM_TIMEOUT_MS` 觸發 `bff_timeout`。
- [x] 5.4 BFF 測試：request body close before complete maps to `client_disconnected`。
- [x] 5.5 BFF 測試：response close during streaming aborts upstream with `client_disconnected`。
- [x] 5.6 BFF 測試：headers not sent returns JSON `ErrorEnvelope`。
- [x] 5.7 BFF 測試：headers sent SSE stream error writes trailing `event: error`。
- [x] 5.8 BFF 測試：headers sent non-SSE stream error does not inject JSON。
- [x] 5.9 BFF 測試：message regex does not determine public code。
- [x] 5.10 Frontend 測試：new BFF stream error codes map to `timeout | abort | generic`。
- [x] 5.11 Frontend 測試：late progress after stream error/cancel does not re-enter running。

## 6. Validation

- [x] 6.1 `cd bff && npm run test` 通過。
- [x] 6.2 `cd bff && npm run build` 通過。
- [x] 6.3 `cd frontend && npm run test` 通過。
- [x] 6.4 `cd frontend && npm run lint` 通過。
- [x] 6.5 `cd frontend && npm run build` 通過。
- [x] 6.6 `openspec validate bff-stream-cancellation-error-contract --strict` 通過。
- [x] 6.7 Git diff 不包含 backend source、dependency upgrade、unrelated formatting 或與本 change 無關的重構。
