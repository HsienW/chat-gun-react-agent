## 0. Spec Gate

- [x] 0.1 Read `AGENTS.md`, `backend/AGENTS.md`, `frontend/AGENTS.md`, `bff/AGENTS.md`, `openspec/config.yaml`, and `docs/agent-rules/weather.md`.
- [x] 0.2 Confirm `openspec/changes/add-cjk-location-transliteration` has been removed and does not conflict with this change.
- [x] 0.3 Confirm archived `weather-cjk-geocoding-query-name` remains archived and is not modified by this change.
- [x] 0.4 Record that archived `weather-cjk-geocoding-query-name` artifacts exist under `openspec/changes/archive/2026-06-23-weather-cjk-geocoding-query-name/`; current git history does not show an archived `.openspec.yaml`, so traceability relies on the archived artifacts and commits.
- [x] 0.5 Run `openspec validate weather-golden-eval --strict` before implementation begins.
- [x] 0.6 Confirm Phase 1 scope excludes forecast tool work, Planner schema changes, frontend candidate UI, BFF behavior changes, and multi-turn clarification workflow.

## 1. Eval Matrix

- [x] 1.1 Define the weather eval case schema with case id, user input, mode, capability category, expected status, expected error or gap classification, and safe diagnostic tags. Verified by 5.2 and 5.8.
- [x] 1.2 Add current-observation cases for CJK, English, Unicode, and mixed-language locations. Verified by 5.2 and 3.1.
- [x] 1.3 Add ambiguous-location and missing-location cases that distinguish `needs_clarification`, `not_found`, provider error, timeout, and cancellation. Verified by 5.2 and 3.1.
- [x] 1.4 Add forecast-like and advice-like cases for today, tomorrow, tonight, weekend, and next-week prompts, marked as current known gaps when runtime support is absent. Verified by 3.3 and 5.2.
- [x] 1.5 Add multi-turn follow-up cases for candidate selection and region/country clarification, marked as current known gaps until Phase 3. Verified by 3.4 and 5.2.
- [x] 1.6 Add relationship cases for equivalent location variants, such as Traditional Chinese variants and English/CJK equivalent names. Verified by 5.2 and 3.1.

## 2. Eval Harness

- [x] 2.1 Implement deterministic eval execution that does not require network, live model calls, or live provider calls. Verified by 5.2.
- [x] 2.2 Implement mock integration execution with controlled model/provider fixtures for success, ambiguity, not found, provider error, timeout, cancellation, malformed Planner output, and synthesis failure. Verified by 5.2.
- [x] 2.3 Implement opt-in live smoke execution guarded by explicit environment configuration. Verified by 6.1 and 6.2.
- [x] 2.4 Ensure live smoke skipped cases are reported as skipped and do not fail default CI. Verified by 3.1, 6.1, and 6.2.
- [x] 2.5 Ensure fixture data remains test-only and is not imported by production resolver, Planner, or tool runtime paths. Verified by 6.3 and code review.

## 3. Baseline Report

- [x] 3.1 Generate and commit `openspec/changes/weather-golden-eval/baseline-report.md` containing case id, mode, expected summary, observed summary, result classification, safe diagnostics, reproduction commands, and live smoke run/skipped status.
- [x] 3.2 Classify results as pass, fail, known gap, or skipped.
- [x] 3.3 Record forecast-like current gaps as Phase 2 ownership without fixing them in this change.
- [x] 3.4 Record multi-turn clarification current gaps as Phase 3 ownership without fixing them in this change.
- [x] 3.5 Ensure reports do not include secrets, authorization headers, raw credentials, full prompts, raw provider bodies, or unbounded tool outputs.

## 4. Documentation

- [x] 4.1 Update `docs/agent-rules/weather.md` Golden Regression Matrix guidance to match the Phase 1 matrix categories.
- [x] 4.2 Document deterministic, mock integration, and opt-in live smoke distinctions.
- [x] 4.3 Document that forecast and multi-turn failures in Phase 1 are baseline gaps, not Phase 1 runtime fixes.

## 5. Regression And Compatibility

The commands in this section are the verification set for Sections 1-4. Individual task notes above identify the primary verification command or report task; all commands below must pass before implementation tasks are marked complete.

- [x] 5.1 Run `cd backend && npm run lint`.
- [x] 5.2 Run `cd backend && npm run test`.
- [x] 5.3 Run `cd backend && npm run build`.
- [x] 5.4 Run `cd frontend && npm run lint`.
- [x] 5.5 Run `cd frontend && npm run test`.
- [x] 5.6 Run `cd frontend && npm run build`.
- [x] 5.7 Run `cd bff && npm run build`.
- [x] 5.8 Run `openspec validate weather-golden-eval --strict`.

## 6. Live Smoke And Review Gates

- [x] 6.1 Run opt-in live smoke only when explicitly enabled and record whether it was run or skipped.
- [x] 6.2 Confirm live smoke pass/fail/skipped results are not represented as deterministic CI results.
- [ ] 6.3 Complete Qwen reviewer gate for scope creep, anti-hardcoding, fixture isolation, baseline coverage, and verification evidence.
- [ ] 6.4 Resolve all Qwen Blocker and Major findings before requesting CCR approval for Phase 2.
- [x] 6.5 Confirm `weather-forecast-capability` and `weather-clarification-workflow` are not started until Phase 1 baseline is complete and accepted.
