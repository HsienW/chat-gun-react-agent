## Context

The existing weather path supports current observation through backend Planner output, `current_weather`, provider-backed geocoding, resolver scoring, structured weather results, BFF streaming, and frontend tool rendering. The archived `weather-cjk-geocoding-query-name` change added `queryName` as an optional Planner-to-tool hint and confirmed that CJK transliteration support is no longer the blocker for weather parity.

The remaining parity gaps are broader:

- Forecast-like prompts such as "明天會下雨嗎" and "週末適合爬山嗎" are not backed by a forecast tool in the current product capability.
- Ambiguous locations can produce candidate lists, but there is no Phase 1 goal to implement follow-up selection or multi-turn continuation.
- There is no complete baseline matrix that records which current observation, geocoding, provider, timeout, cancellation, and unsupported capability cases are already passing.

This design creates the evaluation foundation only. It intentionally avoids any runtime feature expansion.

## Goals / Non-Goals

**Goals:**

- Define a weather golden eval matrix that measures current capabilities and known gaps.
- Define a reusable eval harness for deterministic, mock integration, and opt-in live smoke modes.
- Produce a baseline report that future phases can compare against.
- Keep fixture ownership test-only and separate from runtime resolver/provider logic.
- Preserve backend/frontend/bff contracts in Phase 1.

**Non-Goals:**

- No new weather tool or forecast provider implementation.
- No WeatherIntentSchema changes.
- No Planner prompt changes.
- No LangGraph state, edge, checkpoint, or interrupt/resume changes.
- No frontend weather card or candidate UI changes.
- No BFF proxy, timeout, auth, CORS, or error mapping changes.
- No CJK city mapping, keyword regex, phrase stripping, or location allowlist in runtime code.

## Current Architecture Inventory

Backend owns weather intent extraction, resolver/provider interaction, tool execution, structured result generation, runtime event emission, timeout/cancellation handling, and tests. Phase 1 implementation should place the eval runner and fixtures near backend weather tests so the baseline can exercise Planner/tool/resolver boundaries without depending on frontend state.

Frontend owns stream parsing and weather tool result rendering. Phase 1 does not change frontend source, but frontend lint/test/build remains a regression gate because future phases may extend tool result rendering.

BFF owns browser-to-backend transport, cancellation, timeout, auth, CORS, and error mapping. Phase 1 does not change BFF source, but BFF build remains a compatibility gate.

Docs own the cross-layer weather rules. The Golden Regression Matrix section should be updated during implementation to match the baseline categories, not to document any new runtime feature.

## Decisions

### Decision 1: Split Eval Matrix From Eval Harness

Use two capabilities:

- `weather-eval-matrix` defines cases, expected outcomes, current capability labels, and baseline report semantics.
- `weather-eval-harness` defines how cases are executed in deterministic, mock integration, and live smoke modes.

Alternative considered: one combined capability. Rejected because matrix ownership and runner mechanics will evolve at different speeds in Phase 2 and Phase 3.

### Decision 2: Baseline Failures Are Valid Results

Forecast-like and multi-turn clarification cases must be represented in the matrix even when the current system fails them. The baseline report should classify them as known capability gaps rather than forcing Phase 1 to fix them.

Alternative considered: include only currently supported current weather cases. Rejected because it would not prove the exact gaps Phase 2 and Phase 3 are meant to close.

### Decision 3: Live Smoke Is Opt-In

Live smoke must be available for real provider/model confidence, but it must not be required by default CI or standard test runs.

Alternative considered: make live smoke a required gate. Rejected because external provider and model availability can introduce nondeterminism unrelated to code correctness.

### Decision 4: No Runtime Contract Change

Phase 1 must not add fields to WeatherIntentSchema, WeatherToolResult, stream events, BFF payloads, or frontend types. The eval should observe current behavior and report it.

Alternative considered: add forecast-related schema now to make eval cases easier to express. Rejected because that belongs to Phase 2 and would make the baseline no longer describe the existing system.

### Decision 5: Fixtures Remain Test Data Only

Mock geocoding/weather/provider fixtures may include stable city examples and error simulations, but they must never become runtime resolver mappings or Planner fallback data.

Alternative considered: reuse fixtures as a runtime fallback for known cities. Rejected because project rules prohibit hardcoded city mappings as primary resolver strategy.

### Decision 6: Commit The Baseline Report As A Change Artifact

The Phase 1 baseline report should be committed at:

```text
openspec/changes/weather-golden-eval/baseline-report.md
```

The committed report should contain stable case summaries, pass/fail/known_gap/skipped classifications, safe diagnostics, and reproduction commands. Raw provider payloads, full prompts, credentials, large transcripts, and nondeterministic live smoke dumps must not be committed.

Alternative considered: generate the report locally without committing it. Rejected because Phase 2 and Phase 3 need a durable regression comparison target that reviewers can inspect without rerunning live or model-dependent checks.

## Data Flow

The Phase 1 implementation should follow this evaluation flow:

```text
Eval case
  -> mode selector: deterministic | mock integration | opt-in live smoke
  -> backend weather entrypoint or isolated domain function under test
  -> structured observed outcome
  -> expected outcome comparison
  -> baseline report with pass/fail/known_gap/unsupported labels
```

The observed outcome should capture structured facts such as status, error code, selected capability, resolved-location summary, provider mode, and terminal behavior. It must avoid relying on display text as the source of truth.

## Failure Handling

The harness must distinguish at least:

- invalid input
- missing location
- ambiguous location
- provider not found
- provider error
- weather provider error
- timeout
- cancellation
- unsupported forecast capability
- unsupported multi-turn clarification
- malformed Planner output
- synthesis failure after successful tool execution

Failures must converge to structured baseline report entries. The harness must not hide failures by retrying indefinitely or by coercing every error into a generic failure.

## Security And Anti-Hardcoding

Phase 1 must not introduce runtime city mappings, keyword stripping, phrase stripping, punctuation-based entity extraction, or model-specific behavior. Mock fixtures are allowed only as test fixtures and must be isolated from production code paths.

Reports and logs must not include API keys, credentials, full prompts, authorization headers, or unbounded provider responses. Live smoke configuration must be opt-in through environment configuration and safe to skip when credentials or network access are unavailable.

## Migration Plan

1. Add OpenSpec planning artifacts for the eval matrix and harness.
2. Implement the Phase 1 eval suite and baseline report in a follow-up apply step.
3. Commit `baseline-report.md` with reproducible deterministic/mock results and explicit live smoke run/skipped status.
4. Run backend lint/test/build, frontend lint/test/build, bff build, and strict OpenSpec validation.
5. Run live smoke only when explicitly enabled.
6. Use the committed baseline report as the prerequisite for Phase 2.

Rollback is to remove the Phase 1 eval files and report. No runtime migrations are required.

## Open Questions

- Exact backend file/module names for the eval runner should be chosen during implementation after reading the current weather test layout.
- Qwen reviewer gate must be performed before CCR approval to execute later phases.
