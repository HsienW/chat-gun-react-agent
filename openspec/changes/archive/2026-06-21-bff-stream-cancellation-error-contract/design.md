# Design：BFF Stream Cancellation 與 Error Contract

## 1. 現況分析

目前 BFF `proxyLangGraph` 使用 `fetch()` 代理 `/api/langgraph/*`，並以 `pipeWebResponseBody()` 將 upstream `ReadableStream` 逐 chunk 寫入 `ServerResponse`。

已知現況：

- BFF 使用 `new AbortController()` 搭配 `setTimeout()` abort upstream fetch。
- `abortController.abort()` 目前未設定 reason。
- BFF 沒有在 request body 讀取階段或 response streaming 階段監聽 client disconnect。
- `pipeWebResponseBody()` 若在 headers/body 已送出後失敗，外層 catch 仍可能嘗試 `sendJson()`，但此時已無法可靠改寫 HTTP response。
- `bff/src/errors.ts` 目前以 `fetch failed|connect|network|timeout` regex 推斷部分公開 error code。
- Frontend 目前只在 stream error 分類中判斷 `timeout`、`upstream_timeout` 與 `cause.code === "timeout"`。

問題層級：

```text
BFF Validation / Proxy / Error Mapping
Frontend State / Stream Parser
```

## 2. Runtime baseline

BFF implementation MUST target Node 22.

Implementation MUST add:

```json
{
  "engines": {
    "node": ">=22"
  }
}
```

Rationale:

- 專案目前 `@types/node` 已使用 `^22.15.17`。
- `AbortController.abort(reason)` 與 `AbortSignal.reason` 在 Node 22 可用。
- 本 Change 需要依賴 `AbortSignal.reason` 作為 structured cancellation source，而不是用 error message regex 反推狀態。

## 3. AbortReason contract

新增 BFF-local transport type：

```ts
type BffAbortReason =
  | {
      code: "bff_timeout";
      stage: "langgraph_upstream_proxy" | "langgraph_stream_proxy";
      requestId: string;
    }
  | {
      code: "client_disconnected";
      stage: "request_body" | "langgraph_stream_proxy";
      requestId: string;
    }
  | {
      code: "client_cancelled";
      stage: "langgraph_stream_proxy";
      requestId: string;
    }
  | {
      code: "upstream_error";
      stage: "langgraph_upstream_proxy";
      requestId: string;
    }
  | {
      code: "upstream_stream_error";
      stage: "langgraph_stream_proxy";
      requestId: string;
    };
```

Rules:

- `client_cancelled` is reserved. It MUST NOT be emitted until a future explicit cancel API exists.
- Current frontend `thread.stop()` path is classified as `client_disconnected` when observed by BFF as a downstream close.
- Abort reason MUST be passed via `abortController.abort(reason)`.
- Error classification MUST read `abortController.signal.reason` or equivalent captured signal reason before inspecting error names or cause codes.

## 4. Client cancel and disconnect propagation

採用 Proposal 方案 A：不新增 cancel API。

Current path:

```text
frontend handleCancel
  -> LangGraph SDK thread.stop()
  -> browser closes or aborts the stream request
  -> BFF observes downstream close
  -> BFF aborts upstream fetch with client_disconnected
```

### 4.1 Request body phase

During request body reading:

```text
req.on("close") && !req.complete -> client_disconnected
```

Expected behavior:

- Stop reading body.
- Abort any pending upstream intent.
- Do not attempt to proxy partial body.
- Log audit with `errorCode: "client_disconnected"`.

### 4.2 Upstream streaming phase

During upstream response streaming:

```text
res.on("close") && !normalFinish && !res.writableEnded -> client_disconnected
```

Expected behavior:

- Abort upstream fetch/reader with `client_disconnected`.
- Release stream reader lock.
- Do not attempt to write additional chunks to closed response.
- Log audit with disconnect status and requestId.

`res.close` is the primary streaming disconnect signal. `req.on("aborted")` MUST NOT be used as the primary signal because Node marks it deprecated.

## 5. Stream proxy terminal behavior

Stream errors MUST be handled based on whether the response is still writable as a structured HTTP response.

### 5.1 Headers not sent

When headers have not been sent:

- Return HTTP 504 for `bff_timeout`.
- Return HTTP 499-equivalent semantics in logs for `client_disconnected`; if a response is still possible, use a safe 499-style internal code in audit but do not rely on non-standard HTTP status as public contract unless product approves it.
- Return HTTP 502 for `upstream_error` or `upstream_stream_error`.
- Body MUST be `ErrorEnvelope`.

### 5.2 Headers sent and response is SSE

When headers were sent and `content-type` is SSE-compatible, BFF MUST write a trailing SSE error frame if the response is still writable:

```text
event: error
data: {"error":{"source":"bff","stage":"langgraph_stream_proxy","provider":"LangGraph","code":"upstream_stream_error","message":"LangGraph stream ended with an error","details":{"requestId":"<requestId>"},"cause":{"name":"<safe name>","code":"<safe code>"}}}

```

Schema:

```ts
type BffStreamErrorSseFrame = {
  error: {
    source: "bff";
    stage: "langgraph_stream_proxy";
    provider: "LangGraph";
    code:
      | "bff_timeout"
      | "client_disconnected"
      | "upstream_error"
      | "upstream_stream_error";
    message: string;
    details: {
      requestId: string;
    };
    cause?: {
      name?: string;
      code?: string;
      message?: string;
    };
  };
};
```

Security rules:

- Do not include stack traces.
- Do not include Authorization, Cookie, API keys, full upstream body, prompts, or credentials.
- `message` must be safe for frontend display.

### 5.3 Headers sent and response is not SSE

When headers were sent and response is not SSE:

- Do not inject JSON into the stream.
- Destroy or end the response according to Node writable state.
- Log audit with structured `errorCode`.
- Frontend may see connection close; frontend terminal idempotency must prevent late events from re-entering running.

## 6. Error classification

Public error code classification order:

1. `AbortSignal.reason.code`
2. `error.name === "AbortError"` plus captured signal reason known as `bff_timeout` or `client_disconnected`
3. `error.cause.code`, for example `ECONNREFUSED`, `ENOTFOUND`, `ECONNRESET`
4. Undici/Node structured cause name/code
5. fallback `upstream_error`

Rules:

- Regex such as `fetch failed|connect|network|timeout` MUST NOT determine public `ErrorEnvelope.error.code`.
- Regex MAY be used only as telemetry hint in internal logs, and MUST NOT change public error code.
- Unknown errors MUST degrade to `upstream_error` with safe message and structured audit context.

Recommended mapping:

| Source | Public code |
| --- | --- |
| `AbortSignal.reason.code === "bff_timeout"` | `bff_timeout` |
| `AbortSignal.reason.code === "client_disconnected"` | `client_disconnected` |
| `AbortSignal.reason.code === "upstream_stream_error"` | `upstream_stream_error` |
| `ECONNREFUSED`, `ENOTFOUND`, `ECONNRESET` | `upstream_network_error` |
| unknown upstream failure | `upstream_error` |

## 7. Environment variables

No new BFF environment variable is introduced.

`BFF_UPSTREAM_TIMEOUT_MS` controls upstream fetch and stream lifetime for this Change. If a later implementation needs bounded upstream error body capture, that must be proposed separately with `BFF_MAX_ERROR_BODY_CHARS`.

## 8. Frontend behavior

Frontend MUST classify BFF stream error codes structurally:

```text
bff_timeout -> timeout
upstream_timeout -> timeout
client_disconnected -> abort
upstream_stream_error -> generic
upstream_error -> generic
upstream_network_error -> generic
```

Rules:

- Frontend MUST NOT parse display message text to infer timeout or cancel.
- Frontend reducer terminal idempotency remains the primary protection against late events.
- If SDK surfaces trailing SSE `event: error` through `onError`, frontend should parse `ErrorEnvelope`.
- If SDK surfaces it through `onUpdateEvent`, frontend parser must safely detect the error event or skip it without crashing, depending on SDK behavior verified during implementation.

## 9. Backend impact

Backend source is not expected to change.

Backend may continue producing LangGraph stream events. BFF remains a transport boundary and MUST NOT interpret backend domain semantics or mutate event payloads except for the explicitly defined trailing SSE error frame when transport failure occurs after headers are sent.

## 10. Observability

BFF audit logs should include:

```text
requestId
method
path
statusCode
durationMs
upstreamStatus
errorCode
abortReasonCode
clientDisconnected
streamStarted
headersSent
```

Do not log:

- Authorization header.
- Cookie.
- API keys.
- Full prompt.
- Full upstream response body.
- Stack trace in public response.

## 11. Testing strategy

BFF currently has no stable `test` script. Implementation MUST add one using Node built-in `node:test` and `assert` unless a separate approved test framework already exists.

Required BFF tests:

- Upstream success proxy preserves stream chunks and backpressure behavior.
- Upstream timeout aborts with `bff_timeout`.
- Request body close before complete maps to `client_disconnected`.
- Response close during streaming aborts upstream with `client_disconnected`.
- Headers not sent returns JSON `ErrorEnvelope`.
- Headers sent SSE error writes trailing `event: error`.
- Headers sent non-SSE error does not inject JSON and logs audit.
- Error classification ignores message regex for public code.

Required frontend tests:

- New BFF error codes map to `timeout | abort | generic`.
- Late progress after stream error/cancel does not re-enter running.

## 12. Rollout and compatibility

This Change is backward compatible at route level:

- `/api/langgraph/*` remains unchanged.
- Request payloads remain unchanged.
- Existing `ErrorEnvelope` is extended by new code values.
- Frontend existing cancel button still calls `thread.stop()`.

Rollout should land in small slices:

1. Add Node 22 engines and BFF test harness.
2. Add structured abort reason and classification.
3. Add downstream disconnect propagation.
4. Add stream terminal error split and SSE trailing error frame.
5. Add frontend code mapping and reducer regression tests.
