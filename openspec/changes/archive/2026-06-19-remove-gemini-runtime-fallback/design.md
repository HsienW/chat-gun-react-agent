## Context

The backend LLM gateway currently supports `gemini`, `qwen`, `ccr`, and `openai-compatible`. Qwen support now covers text, JSON mode, vision, tool calling, ToolMessage round trip, metadata, and live smoke. Frontend and compose defaults have moved to Qwen. The remaining cleanup is removing Gemini runtime fallback and its LangChain dependency.

## Goals / Non-Goals

**Goals:**

- Make `qwen` the default backend provider when `LLM_PROVIDER` is unset.
- Reject or ignore `LLM_PROVIDER=gemini` as unsupported rather than constructing a Gemini model.
- Remove `GeminiGateway`, `ChatGoogleGenerativeAI`, `gemini-sdk` diagnostics, Gemini model aliases, and `GEMINI_API_KEY` runtime checks.
- Remove `@langchain/google-genai` from `backend/package.json` and `backend/package-lock.json`.
- Update backend tests to assert Qwen default and absence of Gemini runtime path.
- Ensure `rg -i gemini backend/src` has no runtime code path matches.

**Non-Goals:**

- Do not modify frontend/bff public API.
- Do not modify LangGraph Graph IDs.
- Do not change MCP Agent architecture; MCP remains backend-executed.
- Do not change tool governance, allowlists, audit, timeout, or cancellation policies.
- Do not add a new provider.
- Do not remove Qwen, CCR, or generic OpenAI-compatible support.

## Decisions

### Decision: Qwen default provider

When `LLM_PROVIDER` is unset, provider selection returns `qwen`. This aligns backend runtime with env examples and frontend model selection. It also avoids silently using a removed provider.

### Decision: Unsupported Gemini selection fails fast

If an operator sets `LLM_PROVIDER=gemini`, backend provider selection throws a clear unsupported-provider error. This is safer than silently falling back because it exposes stale deployments immediately.

### Decision: Keep OpenAI-compatible compatibility, remove Gemini-specific compatibility

The gateway keeps `qwen`, `ccr`, and `openai-compatible` paths and retains generic model override handling. Gemini-specific model alias maps and `gemini-*` exception branches are removed because they only serve the removed provider.

### Decision: Package cleanup via npm

Use `npm uninstall @langchain/google-genai` in `backend` so package and lockfile stay consistent. If the command is blocked by sandbox or registry/network behavior, update package files carefully and validate with `npm ls @langchain/google-genai`.

## Risks / Trade-offs

- [Risk] Existing Gemini-only deployments stop working. -> Mitigation: this is the explicit final migration step; Qwen live smoke and env defaults have already been completed.
- [Risk] LangChain integrations depended on `ChatGoogleGenerativeAI` behavior. -> Mitigation: Qwen adapter has `bindTools`, ToolMessage round trip, JSON mode, vision, and metadata tests; run full backend test/build.
- [Risk] Stale Gemini strings remain in runtime code. -> Mitigation: run `rg -i gemini backend/src` and eliminate runtime matches; test-only fixtures should also be migrated where practical.

## Migration Plan

1. Update OpenSpec and remove the old Gemini fallback requirement from the previous active backend runtime delta.
2. Remove Gemini provider code and diagnostics from LLM gateway.
3. Update backend tests from Gemini assumptions to Qwen/default assumptions.
4. Remove `@langchain/google-genai` from backend package and lockfile.
5. Run backend lint/test/build, `npm ls @langchain/google-genai`, targeted `rg -i gemini backend/src`, BFF build, and OpenSpec validation.
