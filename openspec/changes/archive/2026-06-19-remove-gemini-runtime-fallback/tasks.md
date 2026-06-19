# Tasks: Remove Gemini Runtime Fallback

## 1. OpenSpec

- [x] 1.1 Create proposal, design, specs, and tasks for removing Gemini runtime fallback.
- [x] 1.2 Update previous backend runtime delta spec to remove the Gemini fallback requirement/scenario.
- [x] 1.3 Run `openspec validate remove-gemini-runtime-fallback`.
- [x] 1.4 Run `openspec validate replace-gemini-runtime-with-qwen-bailian-runtime`.

## 2. Backend Gateway

- [x] 2.1 Remove `@langchain/google-genai` imports and Gemini-specific type coupling.
- [x] 2.2 Remove `gemini` from provider and endpoint type unions.
- [x] 2.3 Remove `GeminiGateway`, Gemini SDK construction, Gemini capability branch, and `GEMINI_API_KEY` diagnostics.
- [x] 2.4 Make Qwen the default provider when no provider is configured.
- [x] 2.5 Fail fast when `LLM_PROVIDER=gemini` is configured.
- [x] 2.6 Remove Gemini model alias and `gemini-*` model override compatibility branches.

## 3. Backend Tests And Fixtures

- [x] 3.1 Update provider selection tests from Gemini fallback to Qwen default / Gemini unsupported.
- [x] 3.2 Remove test env stubs for `GEMINI_API_KEY`.
- [x] 3.3 Replace backend test fixtures using `gemini-*` model IDs with Qwen model IDs.
- [x] 3.4 Confirm Qwen, CCR, OpenAI-compatible, tool calling, JSON mode, vision, and error mapping tests still cover provider behavior.

## 4. Dependency Cleanup

- [x] 4.1 Remove `@langchain/google-genai` from `backend/package.json`.
- [x] 4.2 Update `backend/package-lock.json`.
- [x] 4.3 Run `cd backend; npm ls @langchain/google-genai` and confirm empty/not installed.

## 5. Env And Residual String Cleanup

- [x] 5.1 Remove Gemini compatibility comments from `backend/.env.example`.
- [x] 5.2 Run `rg -i gemini backend/src` and confirm no runtime code path remains.
- [x] 5.3 Confirm `docker-compose.yml` still has no `GEMINI_API_KEY`.

## 6. Validation

- [x] 6.1 Run `cd backend; npm run lint`.
- [x] 6.2 Run `cd backend; npm run test`.
- [x] 6.3 Run `cd backend; npm run build`.
- [x] 6.4 Run `cd bff; npm run build`.
- [x] 6.5 Run `git diff --check`.
- [x] 6.6 Confirm no frontend/bff public API diff and no `backend/langgraph.json` diff.
