# Tasks: Default Runtime Env To Qwen

## 1. OpenSpec

- [x] 1.1 Create proposal, design, specs, and tasks for Qwen env/default compose migration.
- [x] 1.2 Run `openspec validate default-runtime-env-to-qwen`.

## 2. Backend Env Example

- [x] 2.1 Change `backend/.env.example` to default `LLM_PROVIDER=qwen`.
- [x] 2.2 Replace Gemini model defaults with Qwen model defaults.
- [x] 2.3 Keep Qwen credential placeholder empty and avoid real secrets.
- [x] 2.4 Preserve optional non-Qwen compatibility aliases without making Gemini the default.

## 3. Docker Compose

- [x] 3.1 Add Qwen provider env passthrough to `langgraph-api`.
- [x] 3.2 Remove `GEMINI_API_KEY` from `docker-compose.yml`.
- [x] 3.3 Confirm BFF/frontend env examples do not expose Qwen credentials.

## 4. Validation

- [x] 4.1 Run `rg -n "GEMINI_API_KEY" docker-compose.yml` and confirm no match.
- [x] 4.2 Run `rg -n "QWEN_|LLM_PROVIDER" docker-compose.yml backend/.env.example`.
- [x] 4.3 Run `cd backend; npm run lint`.
- [x] 4.4 Run `cd backend; npm run test`.
- [x] 4.5 Run `cd backend; npm run build`.
- [x] 4.6 Run `cd bff; npm run build`.
- [x] 4.7 Run `git diff --check`.
