# Tasks: Qwen/Bailian Runtime Second-Stage Live Smoke And Production Readiness

## 1. OpenSpec

- [x] 1.1 Create second-stage `proposal.md` covering live smoke / production readiness beyond mock implementation.
- [x] 1.2 Create second-stage `design.md` covering gated live smoke, credential safety, tool calling, MCP architecture checks, and readiness matrix.
- [x] 1.3 Create `specs/backend-model-runtime/spec.md` covering live smoke, JSON mode, vision, tool calling, MCP, error mapping, metadata, and readiness matrix.
- [x] 1.4 Run `openspec validate qwen-bailian-runtime-live-smoke-and-production-readiness` successfully.

## 2. Live Smoke Harness

- [x] 2.1 Add a Qwen/Bailian live smoke test harness that is skipped by default.
- [x] 2.2 Add `RUN_QWEN_LIVE_SMOKE=true` gating and safe failure when `QWEN_API_KEY` is missing.
- [x] 2.3 Ensure live smoke output does not print API keys, authorization headers, full prompts, or large raw responses.
- [x] 2.4 Emit safe metadata summaries for provider, model, endpointKind, capabilities, usage presence, and finish reason.

## 3. Live Smoke Cases

- [x] 3.1 Chat text live smoke: call Qwen/Bailian and verify non-empty text plus provider/endpoint metadata.
- [x] 3.2 Planner JSON live smoke: verify `response_format: { type: "json_object" }`, JSON parse, and runtime validation.
- [x] 3.3 Vision live smoke: use a small data URL through backend preflight and vision routing, with explicit unsupported/provider errors.
- [x] 3.4 Tool calling live smoke: calculator tool, `tool_calls`, ToolNode, ToolMessage round-trip, final `56088`, and stable `tool_call_id`.
- [x] 3.5 MCP Agent architecture smoke with Qwen provider using backend ToolRegistry / ToolNode / governance, not provider-hosted MCP.

## 4. Production Hardening

- [x] 4.1 Strengthen mock error mapping tests for 401/403, 429, 400, 5xx, network, timeout/abort, and invalid JSON.
- [x] 4.2 Adjust provider error codes for request validation, provider unavailable/http, and JSON parse failure semantics.
- [x] 4.3 Add explicit `tool_choice` mock coverage.
- [x] 4.4 Add safe Qwen placeholders to `.env.example` without real credentials.

## 5. Validation

- [x] 5.1 Run `openspec validate qwen-bailian-runtime-live-smoke-and-production-readiness`.
- [x] 5.2 Run `cd backend; npm run lint` successfully.
- [x] 5.3 Run `cd backend; npm run test` successfully.
- [x] 5.4 Run `cd backend; npm run build` successfully.
- [x] 5.5 Run `git diff --check` with no whitespace errors.
- [x] 5.6 Run `git diff --name-only -- frontend bff backend/langgraph.json` with no diff.
- [x] 5.7 Check `QWEN_API_KEY` using present/missing output only.
- [x] 5.8 If key is present, run live network smoke; if not, run the PowerShell live smoke command and report NotVerified.

## 6. Final Report

- [x] 6.1 Report LiveSmoke status with live verified, mock verified, and NotVerified split.
- [x] 6.2 Report production readiness gap matrix.
- [x] 6.3 Confirm Gemini fallback and `@langchain/google-genai` remain retained.
- [x] 6.4 Confirm no frontend/bff public API diff, no Graph ID diff, and MCP was not moved to provider-hosted execution.
