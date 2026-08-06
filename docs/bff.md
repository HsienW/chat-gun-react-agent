# BFF / API Gateway

The frontend now calls the BFF instead of the LangGraph API directly.

## Local Development

Start three processes:

```bash
cd backend && npm run dev
cd bff && npm run dev
cd frontend && npm run dev
```

Default local routing:

- Frontend: `http://localhost:5173/app/`
- BFF: `http://127.0.0.1:8787`
- LangGraph API: `http://localhost:2024`
- Frontend SDK base URL: `/api/langgraph`
- BFF health check: `/api/health`
- BFF readiness check: `/api/ready`

Vite proxies `/api/*` to the BFF during local development.

BFF configuration lives in `bff/.env.example`. Backend agent runtime configuration
stays in `backend/.env.example`.

## Docker Compose

Docker Compose exposes only the BFF on `http://localhost:8123`.

Default container routing:

- Public edge: `bff:8000`, mapped to host `8123`
- Internal LangGraph runtime: `langgraph-api:8000`
- Frontend static assets: served by BFF from `/app/`
- LangGraph proxy: `/api/langgraph/*`

## Governance Hooks

The initial BFF layer includes:

- Request validation for supported HTTP methods.
- Request body size limit through `BFF_MAX_BODY_BYTES`.
- Request correlation through `x-request-id`.
- CORS allowlist through `BFF_ALLOWED_ORIGINS`.
- Optional API key auth through `BFF_REQUIRE_AUTH=true` and `BFF_API_KEYS`.
- Redis-backed Token Bucket rate limiting for independent `userId` and socket-peer IP dimensions through `BFF_RATE_LIMIT_REDIS_URI` and `BFF_RATE_LIMIT_{USER,IP}_*`.
- Backward-compatible in-memory composite-key limiting when Redis is not configured, plus independent in-memory fallback when Redis fails at runtime.
- Standardized 429 responses with `Retry-After`, `x-ratelimit-*`, and `retryAfter` response fields.
- Upstream timeout through `BFF_UPSTREAM_TIMEOUT_MS`.
- JSON audit logs for every request.

This is intentionally a first platform boundary. Production hardening should add OIDC/JWT verification, durable usage ledgers, and OpenTelemetry traces.
