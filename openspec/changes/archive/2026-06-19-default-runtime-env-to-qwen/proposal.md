## Why

Backend runtime and compose examples still default to Gemini even though Qwen/Bailian runtime live smoke and frontend model selection have been migrated. This keeps new deployments pointed at `gemini-*` settings and leaves `docker-compose.yml` without Qwen credential/model passthrough.

## What Changes

- Change backend environment examples to use `LLM_PROVIDER=qwen` and Qwen/Bailian model defaults.
- Keep Qwen credentials as empty placeholders and never commit real API keys.
- Update `docker-compose.yml` so `langgraph-api` receives Qwen env vars and no longer receives `GEMINI_API_KEY`.
- Preserve non-Qwen aliases in comments or optional settings for compatibility, without making Gemini the default.
- Do not modify frontend/bff public API, LangGraph Graph IDs, MCP architecture, or tool governance.

## Capabilities

### New Capabilities

- `runtime-env-defaults`: Deployment environment examples and compose runtime configuration defaults for the backend model provider.

### Modified Capabilities

- None.

## Impact

- Affected files:
  - `backend/.env.example`
  - `docker-compose.yml`
- Affected packages:
  - `backend` runtime configuration examples.
  - root compose deployment configuration.
- API impact:
  - No frontend/bff public API changes.
  - No LangGraph Graph ID changes.
  - No request/response/event schema changes.
- Risk:
  - Existing Gemini-only operators must set their own Gemini configuration outside the new Qwen-default compose example or roll back this example change.
  - Qwen deployments still require a real `QWEN_API_KEY` supplied by environment, not repository files.
- Rollback:
  - Revert `backend/.env.example` and `docker-compose.yml` to Gemini defaults.
  - No data migration is required.
