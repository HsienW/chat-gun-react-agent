## 0. Spec Gate

- [x] 0.1 Read `AGENTS.md`, `backend/AGENTS.md`, `frontend/AGENTS.md`, `bff/AGENTS.md`, `openspec/config.yaml`, `docs/agent-rules/weather.md`, and Phase 1 `baseline-report.md`.
- [x] 0.2 Confirm `weather-forecast-capability` is archived at `openspec/changes/archive/2026-06-25-weather-forecast-capability/` and Phase 3 multi-turn clarification is the target for this change.
- [x] 0.3 Confirm no historical weather, climate, or advice capability is claimed.
- [x] 0.4 Run `openspec validate weather-clarification-workflow --strict` before implementation begins.
- [x] 0.5 Confirm no BFF route, auth, CORS, or proxy behavior change is planned, and verify BFF stream proxy passes LangGraph interrupt/unknown event payloads through without filtering or rewriting.

## 1. Backend Clarification State and Interrupt

- [x] 1.1 Add `WeatherClarificationState` type with candidates, originalQuery, weatherCapability, timeRange, summary, and interruptCheckpointStep to `weather-types.ts`.
- [x] 1.2 Add `clarification` field to `DeepResearchState` in `deep-researcher.ts`.
- [x] 1.3 Implement `clarifyInterrupt` node: build interrupt payload from `weatherExecution.needs_clarification`, call `interrupt()`, persist clarification state.
- [x] 1.4 Implement `resumeClarify` node: read clarification state + user reply, invoke Planner with clarification prompt, emit structured resolution.
- [x] 1.5 Add `routeAfterTargetedTools` edge condition: route to `clarifyInterrupt` when `needs_clarification` with candidates, else route to `synthesize`.
- [x] 1.6 Add edge from `clarifyInterrupt` to END (interrupt point) and from `resumeClarify` to `targetedTools` or `synthesize`.
- [x] 1.7 Implement resolution dispatch: `select_candidate` uses candidate coordinates directly; `filter_candidates` filters and re-resolves; `new_location` triggers full new geocoding; `cancel` terminates; `unrecognized` interrupts again or errors after 2 rounds.
- [x] 1.8 Implement interrupt timeout (default 5 minutes configurable via runtime config).
- [x] 1.9 Add idempotency guard: geocoding not repeated on resume when candidate is selected directly.

## 2. Planner Clarification Prompt

- [x] 2.1 Extend weather Planner prompt with clarification context section (pending candidates, original query, user reply).
- [x] 2.2 Define structured clarification resolution schema (resolutionType, candidateIndex, filter, newLocationText, cancel).
- [x] 2.3 Add deterministic Planner clarification tests: candidate index selection, region filter, location change, cancel, unrecognizable reply.
- [x] 2.4 Verify existing weather Planner behavior is not regressed by prompt changes.

## 3. Backend Clarification Tests

- [x] 3.1 Add deterministic tests for `clarifyInterrupt` node: payload construction, state persistence, interrupt call.
- [x] 3.2 Add deterministic tests for `resumeClarify` node: all resolution types, empty reply rejection, over-length reply rejection.
- [x] 3.3 Add deterministic tests for resolution dispatch: select_candidate, filter_candidates, new_location, cancel, unrecognized.
- [x] 3.4 Add deterministic tests for max clarification rounds (2 rounds ??exhausted error).
- [x] 3.5 Add mock integration test: ambiguous location ??interrupt ??select by index ??weather success.
- [x] 3.6 Add mock integration test: ambiguous location ??interrupt ??filter by region ??weather success.
- [x] 3.7 Add mock integration test: ambiguous location ??interrupt ??change location ??geocoding ??weather success.
- [x] 3.8 Add mock integration test: ambiguous location ??interrupt ??cancel ??terminal cancelled.
- [x] 3.9 Add mock integration test: interrupt timeout ??terminal timeout.
- [x] 3.10 Verify Phase 1 and Phase 2 backend tests pass without modification.

## 4. Frontend Clarification UI

- [x] 4.1 Add `WeatherClarificationInteractive` component with candidate list, editable input, submit button, cancel button.
- [x] 4.2 Implement candidate click ??populate input field (not auto-submit).
- [x] 4.3 Implement submit: validate non-empty, call resume with edited text on same threadId.
- [x] 4.4 Implement cancel: send cancel signal, transition to terminal cancelled state.
- [x] 4.5 Implement loading/disabled state during resume in progress.
- [x] 4.6 Update `WeatherToolResult` to use `WeatherClarificationInteractive` when in clarification context.
- [x] 4.7 Update `ToolMessageDisplay` to recognize interrupt state and not show generic tool-in-progress.
- [x] 4.8 Handle interrupt event in stream parser: set `isLoading=false`, extract clarification payload.

## 5. Frontend Clarification Tests

- [x] 5.1 Add component test: candidates render as selectable items.
- [x] 5.2 Add component test: clicking candidate populates input but does not auto-submit.
- [x] 5.3 Add component test: empty input prevents submission.
- [x] 5.4 Add component test: submit with edited text triggers resume callback.
- [x] 5.5 Add component test: cancel button triggers cancel callback.
- [x] 5.6 Add component test: loading state disables all interactions.
- [x] 5.7 Add component test: interrupt event recognized (stream not closed).
- [x] 5.8 Add component test: empty candidates shows fallback input prompt.
- [x] 5.9 Add component test: clarification card does not affect other messages.

## 6. Golden Regression And Documentation

- [x] 6.1 Add golden eval cases: clarification-candidate-index, clarification-region-supplement, clarification-location-change, clarification-cancel, clarification-unrecognizable-reply, clarification-ambiguous-forecast.
- [x] 6.2 Update `WGE-MULTITURN-CANDIDATE-KNOWN-GAP` from `known_gap` to `pass` in baseline report.
- [x] 6.3 Update baseline report summary stats after Phase 3.
- [x] 6.4 Run full golden eval and confirm all Phase 1 and Phase 2 cases remain passing.
- [x] 6.5 Update `docs/agent-rules/weather.md` Section 7 (憭憚銝??? to reflect clarification is now supported.
- [x] 6.6 Record live smoke as run or skipped; mock pass must not be reported as live pass.

## 7. Verification

- [x] 7.1 Run `cd backend && npm run lint`.
- [x] 7.2 Run `cd backend && npm run test`.
- [x] 7.3 Run `cd backend && npm run build`.
- [x] 7.4 Run `cd frontend && npm run lint`.
- [x] 7.5 Run `cd frontend && npm run test`.
- [x] 7.6 Run `cd frontend && npm run build`.
- [x] 7.7 Run `cd bff && npm run build`.
- [x] 7.8 Run `openspec validate weather-clarification-workflow --strict`.

## 8. Review Gates

- [x] 8.1 Complete Qwen reviewer gate for multi-turn clarification scope, interrupt/resume correctness, anti-hardcoding, schema/runtime validation, frontend compatibility, and regression coverage. — **APPROVED (0 Blocker, 0 Major, 3 Minor)**
- [x] 8.2 Resolve all Qwen Blocker and Major findings before requesting CCR approval. — **Zero Blocker/Major to resolve**
- [x] 8.3 Confirm no subsequent OpenSpec change is blocked by this change. — Phase 3 是 weather-golden-eval 最後一個 known gap
