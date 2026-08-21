# BFF API Gateway

<p>
  <a href="./bff.en.md">English</a> |
  <a href="./bff.md">繁體中文</a>
</p>

The BFF is the browser-facing HTTP entry point. The frontend accesses the LangGraph API through the BFF, so model and tool credentials never enter the browser bundle.

## Local Routes

```text
Frontend  http://localhost:5173/app/
  -> Vite proxy /api/*
BFF       http://127.0.0.1:8787
  -> /api/langgraph/*
Backend   http://localhost:2024
```

Start the services:

```bash
cd backend && npm run dev
cd bff && npm run dev
cd frontend && npm run dev
```

Docker Compose exposes `http://localhost:8123`. The BFF serves the `/app/` static files and `/api/*` from the same origin, so the LangGraph API, Redis, and PostgreSQL do not need to be exposed directly to the browser.

## Endpoints

| Endpoint | Methods | Description |
| --- | --- | --- |
| `/api/health` | `GET` | BFF process health; does not check the backend |
| `/api/bff/health` | `GET` | Alias for `/api/health` |
| `/api/ready` | `GET` | Checks whether the BFF can connect to the LangGraph backend |
| `/api/bff/ready` | `GET` | Alias for `/api/ready` |
| `/api/langgraph/*` | `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD` | LangGraph API proxy |
| `/api/metrics` | `GET`, `HEAD` | Backend metrics proxy |
| `/app/*` | `GET` | Built frontend and SPA fallback |

Every response includes `x-request-id`. Clients may supply their own `x-request-id`; otherwise, the BFF generates one.

## Configuration

Create the local configuration from the example file:

```bash
cp bff/.env.example bff/.env
```

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `BFF_PORT` | `8787` | BFF listening port |
| `BFF_LANGGRAPH_API_URL` | `http://localhost:2024` | LangGraph API URL |
| `BFF_FRONTEND_DIST` | `../frontend/dist` | Frontend build directory |
| `BFF_ALLOWED_ORIGINS` | Empty | CORS allowlist |
| `BFF_REQUIRE_AUTH` | `false` | Whether an API key or Bearer token is required; principal profiles are required when enabled |
| `BFF_API_KEYS` | Empty | Usually left empty; when set, every key still needs a corresponding principal profile |
| `BFF_API_KEY_PRINCIPALS_JSON` | Empty | API-key-indexed principal profile JSON |
| `BFF_LEGACY_HEADER_MODE` | `true` | Whether to also forward `x-bff-user-id` to the Backend |
| `BFF_MAX_BODY_BYTES` | `52428800` | Request body size limit |
| `BFF_UPSTREAM_TIMEOUT_MS` | `120000` | Upstream timeout for LangGraph and metrics requests |
| `BFF_RATE_LIMIT_REDIS_URI` | Empty | Redis rate limiter URL |
| `AGENT_METRICS_BACKEND_URL` | Same as `BFF_LANGGRAPH_API_URL` | Metrics backend URL |

Image inputs are also restricted by the `BFF_IMAGE_UPLOAD_*` settings. See [`bff/.env.example`](../bff/.env.example) for common configuration examples.

Docker Compose overrides `BFF_MAX_BODY_BYTES` to `1048576` (1 MiB) by default. Set an appropriate limit explicitly before starting Compose if larger image payloads are required.

## Authentication

Enable authentication:

```env
BFF_REQUIRE_AUTH=true
BFF_API_KEY_PRINCIPALS_JSON={"replace-with-a-long-random-key":{"principalId":"local-user","principalType":"user","tenantId":"local","roles":[],"scopes":[]}}
```

`BFF_API_KEY_PRINCIPALS_JSON` must be a single-line JSON object. Each top-level key is an API key used by a client, and its profile supplies the trusted principal and tenant context forwarded to the Backend. API keys are credentials; provide them through environment variables or a secret manager and never commit real values.

Clients may use either format:

```http
X-API-Key: replace-with-a-long-random-key
```

```http
Authorization: Bearer replace-with-a-long-random-key
```

Authentication applies to `/api/langgraph/*` and `/api/metrics`. Health, readiness, and frontend static files do not require an API key.

When authentication is enabled, every API key must have a matching profile in `BFF_API_KEY_PRINCIPALS_JSON`; setting only `BFF_API_KEYS` returns `401`. A typical setup leaves `BFF_API_KEYS` empty.

The BFF neither trusts nor forwards client-supplied `x-user-id` or `x-tenant-id`. It derives `x-bff-principal-id`, `x-bff-principal-type`, `x-bff-tenant-id`, `x-bff-roles`, `x-bff-scopes`, `x-bff-auth-source`, and `x-bff-authenticated-at` from the authenticated profile. Keep `BFF_LEGACY_HEADER_MODE=true` only when `x-bff-user-id` is required.

## CORS

`BFF_ALLOWED_ORIGINS` accepts a comma-separated list of complete origins:

```env
BFF_ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com
```

When `BFF_ALLOWED_ORIGINS` is empty, the BFF accepts any origin. Production deployments should define an explicit allowlist. If the frontend and BFF are deployed separately, include the frontend origin. The BFF allows `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, and `OPTIONS`.

## Rate Limiting

When `BFF_RATE_LIMIT_REDIS_URI` is configured, the BFF tracks separate quotas for the resolved principal and the socket peer IP. A request returns `429` when either quota is exceeded.

```env
BFF_RATE_LIMIT_REDIS_URI=redis://localhost:6379
BFF_RATE_LIMIT_USER_MAX_REQUESTS=30
BFF_RATE_LIMIT_USER_WINDOW_MS=60000
BFF_RATE_LIMIT_IP_MAX_REQUESTS=20
BFF_RATE_LIMIT_IP_WINDOW_MS=60000
```

Without Redis, the BFF uses a process-local in-memory limiter. If Redis fails during operation, that dimension falls back to an independent in-memory bucket. Configure Redis when multiple instances must share quotas.

Rate-limit responses include:

- `Retry-After`
- `x-ratelimit-limit`
- `x-ratelimit-remaining`
- `x-ratelimit-reset`
- The JSON fields `error` and `retryAfter`

## Request Forwarding

The BFF removes hop-by-hop headers and forwards only explicitly allowed request headers. Common entries include:

- `accept`, `accept-language`, `content-type`, `user-agent`
- `authorization`, `x-api-key`
- `x-idempotency-key`
- `traceparent`, `tracestate`

The BFF sets `x-request-id` and the authenticated `x-bff-*` identity headers; clients cannot override these values with same-name headers. W3C Trace Context is forwarded unchanged to the Backend so OpenTelemetry can create cross-service traces.

## Upload Validation

The BFF checks the overall size of request bodies sent to LangGraph. If a payload contains images, it also validates:

- File count
- Encoded bytes per image
- Image dimensions and total pixels
- File extension and MIME type
- Optional object-storage URLs

Invalid payloads return `400`; bodies larger than `BFF_MAX_BODY_BYTES` return `413`. The frontend and backend also perform their own image preflight checks, and the limits across all three layers should remain aligned.

## Timeouts, Streaming, and Cancellation

`BFF_UPSTREAM_TIMEOUT_MS` limits regular LangGraph requests, stream consumption, and the metrics proxy. When the client disconnects, the BFF cancels the upstream fetch.

If an error occurs before an SSE stream starts, the BFF returns a JSON error envelope. If the stream has already started, the BFF writes an SSE error frame whenever possible. Structured errors contain `source`, `stage`, `code`, `message`, and optional `details` or `cause`, while retaining the same `requestId` for log lookup.

## Audit Logs

When a request completes, the BFF writes a JSON audit log containing the request ID, method, path, status, duration, resolved principal, tenant, and client IP. Logs must not include authorization headers, API keys, or complete request bodies.
