## Why

Frontend model selection still exposes Gemini model IDs and sends `gemini-*` as the Deep Research `reasoning_model`. After the backend Qwen/Bailian runtime live smoke passed, this creates a UI-to-backend model-name mismatch and blocks removing Gemini fallback later.

## What Changes

- Replace frontend model IDs and labels with Qwen/Bailian model options.
- Set the frontend default model to a Qwen text model.
- Keep the existing BFF/LangGraph request shape unchanged; Deep Research continues to send `reasoning_model` as a string.
- Ensure frontend does not introduce Qwen API keys, provider credentials, or direct model calls.
- Add focused frontend tests for model validation and default selection behavior.

## Capabilities

### New Capabilities

- `frontend-model-selection`: Frontend model selection options, validation, default model, and safe submission of selected model IDs.

### Modified Capabilities

- None.

## Impact

- Affected package: `frontend`.
- Affected capability domains: Frontend Rendering, Frontend State.
- Expected affected files:
  - `frontend/src/types/models.ts`
  - `frontend/src/lib/models.ts`
  - focused frontend model tests
- Public API impact:
  - No frontend/bff public API shape changes.
  - No LangGraph Graph ID changes.
  - No MCP execution or governance changes.
- Dependency impact:
  - No new runtime or dev dependencies.
- Risks:
  - If deployed backend configuration does not support the selected Qwen model IDs, Deep Research requests can fail at runtime.
  - Removing Gemini labels may surprise deployments still configured around Gemini fallback.
- Rollback:
  - Revert the model list/default model changes in `frontend/src/types/models.ts`.
  - No data migration is required because the model selection is per request.
