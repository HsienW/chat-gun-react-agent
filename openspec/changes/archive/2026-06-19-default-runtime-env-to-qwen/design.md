## Context

The backend Qwen provider and live smoke gate are in place, and frontend model selection now sends Qwen model IDs. The remaining deployment mismatch is configuration: `backend/.env.example` defaults to Gemini, and `docker-compose.yml` passes only `GEMINI_API_KEY` into `langgraph-api`.

This change updates examples and compose env passthrough only. It does not remove Gemini code, Gemini dependency, fallback behavior, or provider aliases from the backend implementation.

## Goals / Non-Goals

**Goals:**

- Make Qwen the default provider in backend env examples.
- Provide Qwen base URL and purpose-specific model placeholders in env examples.
- Pass Qwen provider variables into `langgraph-api` in compose.
- Remove `GEMINI_API_KEY` from `docker-compose.yml`.
- Keep credentials empty and untracked.

**Non-Goals:**

- Do not remove Gemini runtime fallback or `@langchain/google-genai`.
- Do not modify frontend/bff public API.
- Do not modify LangGraph Graph ID.
- Do not change MCP execution architecture or tool governance.
- Do not read, write, or commit local `.env` files containing real secrets.

## Decisions

### Decision: Qwen defaults in examples, not hardcoded runtime

`backend/.env.example` will show `LLM_PROVIDER=qwen`, Qwen model variables, and an empty `QWEN_API_KEY`. Runtime code still reads environment variables normally; no provider is hardcoded into business logic.

Alternative considered: keep Gemini defaults and only add comments for Qwen. This does not satisfy the migration gate because new deployments would still start from Gemini.

### Decision: Compose passes Qwen variables explicitly

`docker-compose.yml` will pass `LLM_PROVIDER`, `QWEN_BASE_URL`, `QWEN_API_KEY`, `QWEN_CHAT_MODEL`, `QWEN_RESEARCH_MODEL`, `QWEN_VISION_MODEL`, and `QWEN_TOOL_MODEL` into `langgraph-api`, with safe defaults for non-secret values. It will not pass `GEMINI_API_KEY`.

### Decision: BFF and frontend env examples remain unchanged

BFF and frontend do not own model provider credentials. Their existing env examples should not receive Qwen keys or provider settings.

## Risks / Trade-offs

- [Risk] Compose deployments without `QWEN_API_KEY` will fail when Qwen is selected. -> Mitigation: keep the key placeholder explicit and empty; validation/live errors remain backend-owned.
- [Risk] Gemini-only deployments no longer match compose defaults. -> Mitigation: Gemini removal is a later change; operators can still configure backend runtime manually if needed before final removal.
- [Risk] Accidentally exposing provider credentials to browser env. -> Mitigation: do not add any Qwen variables to `frontend/.env.example` or `VITE_*`.

## Migration Plan

1. Update OpenSpec artifacts and validate the change.
2. Update `backend/.env.example` Qwen defaults and compatibility comments.
3. Update `docker-compose.yml` Qwen env passthrough and remove `GEMINI_API_KEY`.
4. Verify no real credentials are present.
5. Run backend validation and BFF build.
