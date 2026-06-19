## Why

Qwen/Bailian live smoke has passed, frontend model selection is Qwen-based, and deployment examples now default to Qwen. Keeping Gemini fallback and `@langchain/google-genai` in backend runtime leaves a second provider path that conflicts with the final Qwen-only runtime target and blocks dependency cleanup.

## What Changes

- Remove Gemini as a selectable backend LLM provider.
- Remove Gemini fallback when no provider is configured; the default provider becomes Qwen.
- Remove `@langchain/google-genai` from backend dependencies and lockfile.
- Remove Gemini-specific runtime code paths, diagnostics, model alias handling, env example references, and backend tests.
- Keep Qwen, CCR, and generic OpenAI-compatible provider paths.
- Keep frontend/bff public APIs unchanged.
- Keep LangGraph Graph IDs unchanged.
- Keep MCP execution in backend and do not change tool governance.

## Capabilities

### New Capabilities

- `backend-model-runtime`: Backend model runtime provider selection after Gemini removal, including Qwen default, supported providers, dependency cleanup, and credential safety.

### Modified Capabilities

- None. There is no archived main spec for this capability yet; this change supplies the updated runtime behavior and resolves the previous active delta by removing Gemini fallback from that delta.

## Impact

- Affected package: `backend`.
- Affected files:
  - `backend/src/platform/llm-gateway.ts`
  - `backend/src/platform/llm-gateway.test.ts`
  - `backend/src/agents/*.test.ts` where test fixtures still use Gemini model IDs
  - `backend/package.json`
  - `backend/package-lock.json`
  - `backend/.env.example`
  - related OpenSpec artifacts
- API impact:
  - No frontend/bff public API shape changes.
  - No LangGraph Graph ID changes.
  - No event schema changes.
- Risk:
  - Deployments that only have Gemini credentials will no longer work after this change.
  - Any hidden dependency on `ChatGoogleGenerativeAI` behavior must be caught by backend tests and Qwen live smoke.
- Rollback:
  - Reintroduce `@langchain/google-genai`, Gemini gateway implementation, and Gemini provider selection.
  - Set deployment env back to Gemini only if the dedicated rollback is accepted.
