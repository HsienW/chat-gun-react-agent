## 0. Spec Gate

- [ ] 0.1 Read `AGENTS.md`, `backend/AGENTS.md`, `frontend/AGENTS.md`, `bff/AGENTS.md`, `openspec/config.yaml`, `docs/agent-rules/weather.md`, and Phase 1 `baseline-report.md`.
- [ ] 0.2 Confirm `weather-golden-eval` is archived and Phase 1 forecast known gaps are the target for this change.
- [ ] 0.3 Confirm Phase 3 multi-turn clarification remains out of scope.
- [ ] 0.4 Run `openspec validate weather-forecast-capability --strict` before implementation begins.
- [ ] 0.5 Confirm no BFF route, auth, CORS, or proxy behavior change is planned.

## 1. Backend Intent Schema

- [ ] 1.1 Add deterministic Planner tests for current, tomorrow, tonight, weekend, unknown capability, and missing-location forecast cases.
- [ ] 1.2 Extend weather intent schema/coercion with `weatherCapability`, `timeRange`, `units`, and `locale`.
- [ ] 1.3 Update Planner prompt/schema instructions to classify `current`, `hourly`, and `daily` without adding historical, climate, or standalone advice.
- [ ] 1.4 Runtime-validate unknown capability and invalid time ranges before tool execution.
- [ ] 1.5 Verify existing `queryName` behavior is preserved for forecast intent.

## 2. Backend Forecast Tool

- [ ] 2.1 Add `weather_forecast` tool with validated input schema and stable tool name.
- [ ] 2.2 Define backend forecast result types with `schemaVersion: "1.1"` and `tool: "weather_forecast"`.
- [ ] 2.3 Implement daily forecast provider request and response validation using Open-Meteo daily fields.
- [ ] 2.4 Implement hourly forecast provider request and response validation using Open-Meteo hourly fields.
- [ ] 2.5 Reuse provider-backed location resolution, including `queryName`, without adding city mappings or phrase stripping.
- [ ] 2.6 Return structured `needs_clarification`, `not_found`, invalid input, provider error, timeout, and cancellation outcomes.
- [ ] 2.7 Correct `current_weather` description so it does not claim forecast capability.
- [ ] 2.8 Add mock integration tests for daily success, hourly success, invalid time range, not_found, ambiguity, provider error, timeout, and cancellation.

## 3. Backend Workflow And Synthesis

- [ ] 3.1 Route `weatherCapability: "current"` to `current_weather` and `hourly`/`daily` to `weather_forecast`.
- [ ] 3.2 Ensure forecast tool output is treated as untrusted structured data during synthesis.
- [ ] 3.3 Add tests proving "明天會下雨嗎", "今晚會變冷嗎", and "週末天氣如何" are forecast-backed.
- [ ] 3.4 Add regression tests proving existing current weather behavior remains passing.
- [ ] 3.5 Preserve terminal behavior for timeout and cancellation.

## 4. Frontend Forecast Rendering

- [ ] 4.1 Update frontend weather types and runtime parser to accept `current_weather` v1.0 and `weather_forecast` v1.1.
- [ ] 4.2 Update tool delegation/status badge logic to handle `weather_forecast`.
- [ ] 4.3 Render daily forecast data from structured fields.
- [ ] 4.4 Render hourly forecast data from structured fields.
- [ ] 4.5 Render forecast `needs_clarification`, `not_found`, `error`, timeout, cancelled, unknown status, and non-JSON fallback safely.
- [ ] 4.6 Add frontend tests for parser, daily rendering, hourly rendering, unknown status/schema, missing optional fields, and sensitive error details.

## 5. Golden Regression And Documentation

- [ ] 5.1 Update Phase 2 forecast baseline/regression cases so forecast known gaps become passing mock/deterministic cases.
- [ ] 5.2 Confirm Phase 3 multi-turn known gap remains documented and unclaimed.
- [ ] 5.3 Update `docs/agent-rules/weather.md` only if implementation changes forecast capability boundaries.
- [ ] 5.4 Add opt-in live smoke coverage for Open-Meteo daily and hourly forecast calls.
- [ ] 5.5 Record live smoke as run or skipped; mock pass must not be reported as live pass.

## 6. Verification

- [ ] 6.1 Run `cd backend && npm run lint`.
- [ ] 6.2 Run `cd backend && npm run test`.
- [ ] 6.3 Run `cd backend && npm run build`.
- [ ] 6.4 Run `cd frontend && npm run lint`.
- [ ] 6.5 Run `cd frontend && npm run test`.
- [ ] 6.6 Run `cd frontend && npm run build`.
- [ ] 6.7 Run `cd bff && npm run build`.
- [ ] 6.8 Run `openspec validate weather-forecast-capability --strict`.

## 7. Review Gates

- [ ] 7.1 Complete Qwen reviewer gate for scope creep, anti-hardcoding, schema/runtime validation, provider strategy, frontend compatibility, and regression coverage.
- [ ] 7.2 Resolve all Qwen Blocker and Major findings before requesting CCR approval for implementation completion.
- [ ] 7.3 Confirm `weather-clarification-workflow` is not started until this change is implemented, reviewed, and accepted.
