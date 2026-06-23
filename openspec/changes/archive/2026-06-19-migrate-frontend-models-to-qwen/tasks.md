# Tasks: Migrate Frontend Model Selection To Qwen

## 1. OpenSpec

- [x] 1.1 Create proposal, design, specs, and tasks for frontend Qwen model selection.
- [x] 1.2 Run `openspec validate migrate-frontend-models-to-qwen`.

## 2. Frontend Model Migration

- [x] 2.1 Replace frontend Gemini model IDs with Qwen model IDs in the centralized model definitions.
- [x] 2.2 Set the frontend default model to a Qwen text model.
- [x] 2.3 Confirm model UI labels and icons no longer imply Gemini runtime.
- [x] 2.4 Confirm `reasoning_model` request shape remains unchanged.

## 3. Tests

- [x] 3.1 Add focused frontend tests for valid Qwen model IDs, rejected Gemini IDs, and default model.
- [x] 3.2 Confirm existing cancellation behavior remains covered.

## 4. Validation

- [x] 4.1 Run `cd frontend; npm run lint`.
- [x] 4.2 Run `cd frontend; npm run test`.
- [x] 4.3 Run `cd frontend; npm run build`.
- [x] 4.4 Run `rg -i gemini frontend/src` and confirm no runtime code path remains.
