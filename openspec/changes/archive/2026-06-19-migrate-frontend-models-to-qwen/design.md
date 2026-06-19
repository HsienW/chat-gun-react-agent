## Context

The backend now supports the Qwen provider and Qwen/Bailian live smoke has passed for text, JSON mode, vision, tool calling, and MCP architecture. The frontend still presents Gemini options and sends the selected model ID as `reasoning_model` for Deep Research. This phase aligns frontend model selection with the Qwen runtime without changing request shape or credentials.

Frontend remains a presentation and interaction layer. It must not call Qwen/Bailian directly, store provider credentials, or infer backend capabilities from model response text.

## Goals / Non-Goals

**Goals:**

- Replace Gemini model IDs in frontend model selection with Qwen model IDs.
- Make the default frontend model a Qwen model.
- Keep `reasoning_model` submission as the existing string field.
- Add focused tests covering model validation and default selection.
- Run `frontend` lint, test, and build.

**Non-Goals:**

- Do not modify frontend/bff public API shape.
- Do not modify LangGraph Graph ID.
- Do not add Qwen API keys or any credential to frontend code or `VITE_*`.
- Do not modify backend provider selection, MCP architecture, or tool governance.
- Do not remove Gemini from backend runtime in this change.

## Decisions

### Decision: Use stable Qwen model IDs in the existing model selector

The frontend model selector already validates against a centralized `ModelId` enum and renders from `AVAILABLE_MODELS`. This change updates that single source to Qwen options instead of adding provider-specific branching in components.

Alternative considered: hide the model selector and let backend choose all models. This is not used because the existing UI intentionally supports a user-selected Deep Research reasoning model and the acceptance item asks for frontend Qwen model type/UI migration.

### Decision: Preserve request shape

`App.tsx` continues to submit `reasoning_model: model` for Deep Research. Only the values change from Gemini IDs to Qwen IDs. This avoids BFF/API changes and keeps rollback straightforward.

### Decision: Test model utilities rather than model-provider behavior

Frontend tests should verify user-facing selection state and validation. Provider availability is verified by backend live smoke, not by frontend tests.

## Risks / Trade-offs

- [Risk] Some Qwen/Bailian accounts may not have every displayed model enabled. -> Mitigation: use common Qwen-compatible defaults and keep backend error mapping responsible for provider failures.
- [Risk] Frontend default model can diverge from backend environment defaults. -> Mitigation: keep model IDs explicit and validate them in frontend tests; deployment can override backend env independently.
- [Risk] Users with Gemini-only deployments lose matching UI options. -> Mitigation: this is intentional for the Qwen migration acceptance path; rollback is a single frontend model list revert.

## Migration Plan

1. Update frontend model enum, list, labels, and default model to Qwen.
2. Add focused tests for allowed Qwen IDs, rejected Gemini IDs, and default model.
3. Run `cd frontend; npm run lint`, `npm run test`, and `npm run build`.
4. Confirm no `gemini` string remains in `frontend/src`.
