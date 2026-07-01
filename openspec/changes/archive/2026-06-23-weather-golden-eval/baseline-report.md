# Weather Golden Eval Baseline Report

## Scope

Change: `weather-golden-eval`

This report records the weather golden baseline. It was originally created in Phase 1 and updated after Phase 2 forecast capability and Phase 3 multi-turn clarification workflow implementation. It is measurement-only and does not change runtime behavior.

## Reproduction Commands

Deterministic and mock integration baseline:

```bash
cd backend
npm run test -- src/tools/weather-golden-eval.test.ts
```

Full backend regression:

```bash
cd backend
npm run test
```

Opt-in live smoke:

```bash
cd backend
$env:OPEN_METEO_LIVE_SMOKE="true"
npm run test -- src/tools/weather.live-smoke.test.ts
```

Live smoke is not a default CI gate. A skipped live smoke case is not a deterministic failure.

## Summary

- Total cases: 24
- Pass: 23
- Fail: 0
- Known gaps: 0
- Skipped: 1

## Layer Summary

- Deterministic: matrix structure, missing-location classification, forecast routing, multi-turn clarification, live-smoke skip behavior, sensitive diagnostic redaction.
- Mock integration: current weather success, ambiguous location, provider not found, geocoding provider error, timeout, cancellation.
- Live smoke: not run by default; `WGE-LIVE-TAIPEI-OPT-IN` is recorded as skipped unless `OPEN_METEO_LIVE_SMOKE=true`.

## Case Results

| Case | Mode | Classification | Owner | Observed |
| --- | --- | --- | --- | --- |
| WGE-CURRENT-CJK-TAIPEI | mock_integration | pass |  | `current_weather` resolves Taipei with `queryName: "Taipei"` and returns current observation. |
| WGE-CURRENT-EN-TOKYO | mock_integration | pass |  | `current_weather` resolves `Tokyo` and returns current observation. |
| WGE-CURRENT-MIXED-SINGAPORE | mock_integration | pass |  | `current_weather` resolves Singapore with `queryName: "Singapore"` and returns current observation. |
| WGE-CURRENT-UNICODE-SAO-PAULO | mock_integration | pass |  | `current_weather` resolves `Sao Paulo` and returns current observation. |
| WGE-AMBIGUOUS-SPRINGFIELD | mock_integration | pass |  | Ambiguous same-name location returns `needs_clarification` candidates. |
| WGE-MISSING-LOCATION | deterministic | pass |  | Missing usable location is represented as invalid input or planner clarification before tool execution. |
| WGE-NOT-FOUND | mock_integration | pass |  | Provider returns no candidates and the tool returns `not_found` with `weather_location_not_found`. |
| WGE-PROVIDER-ERROR | mock_integration | pass |  | Geocoding provider failure returns `error` with `weather_geocoding_provider_error`, not `not_found`. |
| WGE-TIMEOUT | mock_integration | pass |  | Geocoding timeout returns `error` with `weather_timeout`. |
| WGE-CANCELLED | mock_integration | pass |  | User cancellation returns `error` with `weather_cancelled`. |
| WGE-MALFORMED-PLANNER-OUTPUT | deterministic | pass |  | Malformed Planner output is recorded as a structured planning failure. |
| WGE-SYNTHESIS-FAILURE-AFTER-TOOL-SUCCESS | deterministic | pass |  | Tool success followed by synthesis failure is recorded as terminal failure. |
| WGE-FORECAST-TOMORROW | deterministic | pass |  | Tomorrow forecast request routes to daily `weather_forecast`. |
| WGE-FORECAST-TONIGHT | deterministic | pass |  | Tonight forecast request routes to hourly `weather_forecast`. |
| WGE-FORECAST-WEEKEND | deterministic | pass |  | Weekend forecast request routes to daily `weather_forecast`. |
| WGE-MULTITURN-CANDIDATE-KNOWN-GAP | deterministic | pass |  | Candidate follow-up selection is handled by the Phase 3 clarification workflow. |
| clarification-candidate-index | deterministic | pass |  | Clarification resume selects a provider-backed candidate by index. |
| clarification-region-supplement | deterministic | pass |  | Clarification resume filters ambiguous candidates by supplied region. |
| clarification-location-change | deterministic | pass |  | Clarification resume switches to a newly supplied location. |
| clarification-cancel | deterministic | pass |  | Clarification resume terminates as a user cancellation. |
| clarification-unrecognizable-reply | deterministic | pass |  | Unrecognizable clarification replies re-enter clarification without becoming `not_found`. |
| clarification-ambiguous-forecast | mock_integration | pass |  | Ambiguous forecast requests clarify location and resume `weather_forecast`. |
| WGE-RELATION-TAIPEI-VARIANTS | deterministic | pass |  | Taipei variants are tracked as compatibility-equivalent relationship cases. |
| WGE-LIVE-TAIPEI-OPT-IN | live_smoke | skipped |  | Live smoke was not run for this baseline unless explicitly enabled. |

## Known Gaps

- No deterministic golden eval case is classified as `known_gap` after Phase 3.
- Historical weather, climate knowledge, and weather advice remain out of scope unless covered by a future OpenSpec change.
- This baseline must not be interpreted as live provider acceptance unless the live smoke command is explicitly run and recorded.

## Safety Notes

- No API keys, authorization headers, credentials, full prompts, raw provider bodies, or unbounded tool outputs are included in this report.
- Mock fixtures are test-only and must not be imported by runtime resolver, Planner, or tool execution paths.
- The archived `weather-cjk-geocoding-query-name` artifacts exist under `openspec/changes/archive/2026-06-23-weather-cjk-geocoding-query-name/`; no archived `.openspec.yaml` is present in current git history.
