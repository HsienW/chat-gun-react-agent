## Why

Phase 1 `weather-golden-eval` established that current weather behavior is measurable and stable, but forecast-like prompts remain known gaps owned by Phase 2. Users asking "明天會下雨嗎", "今晚會變冷嗎", or "週末天氣如何" are still at risk of receiving current-observation behavior instead of a forecast-backed answer.

This change adds a first-class forecast capability so the system can distinguish current observation from hourly and daily forecast requests, call an explicit forecast tool, and render forecast data without breaking existing current-weather behavior.

## What Changes

- Add Weather Planner intent fields for `weatherCapability`, `timeRange`, `units`, and `locale`.
- Add an independent `weather_forecast` backend tool instead of expanding `current_weather`.
- Add `WeatherToolResult` schemaVersion `1.1` for forecast results with optional hourly and daily forecast sections.
- Keep `current_weather` input/output behavior backward compatible and correct its description so it no longer claims forecast coverage.
- Extend frontend weather parsing and rendering to support `tool: "weather_forecast"` and forecast result sections.
- Reuse Open-Meteo hourly/daily forecast parameters; do not add or switch to a second provider.
- Run Phase 1 golden baseline regression to prove current weather behavior does not regress.

## Capabilities

### New Capabilities

- `weather-intent-schema`: Defines Planner weather capability classification, time range structure, and runtime validation for current/hourly/daily forecast intent.
- `weather-forecast-tool`: Defines the independent backend `weather_forecast` tool input/output contract, provider behavior, error semantics, and v1.1 forecast result schema.
- `frontend-weather-forecast`: Defines frontend parsing, safe fallback, and rendering behavior for forecast tool results.
- `weather-golden-eval`: Defines Phase 2 regression expectations against the Phase 1 baseline and conversion of forecast known gaps into passing forecast cases.

### Modified Capabilities

- None. Existing main specs remain backward compatible; this change introduces additive Phase 2 capability specs.

## Impact

Affected packages and capabilities:

- `backend`: Planner structured output, WeatherIntent coercion, `weather_forecast` tool, Open-Meteo forecast adapter behavior, tool tests, golden regression tests, live smoke.
- `frontend`: Weather parser/type copy, `ToolMessageDisplay` weather delegation, `WeatherToolResult` rendering, component tests.
- `bff`: No route or proxy behavior change expected; build remains a compatibility gate because frontend must still call backend through BFF.
- `docs/agent-rules/weather.md`: May need a short update documenting forecast capability boundaries once implemented.
- `openspec`: Adds planning artifacts for Phase 2.

## Goals

- Forecast-like user requests are no longer answered by current observation when a forecast is required.
- Planner emits structured `weatherCapability` and `timeRange` fields instead of relying on prompt prose or keyword stripping.
- `weather_forecast` returns structured daily/hourly forecast data with stable statuses and error codes.
- Frontend renders forecast data from structured v1.1 output and safely degrades unknown fields/statuses.
- Phase 1 current-observation baseline remains passing.

## Non-Goals

- No multi-turn clarification workflow, pending candidate state, interrupt/resume, or candidate selection UI.
- No historical weather or climate capability.
- No deep weather advice generation; advice-style prompts may use forecast data only when explicitly modeled as forecast, not as standalone advice.
- No second Weather Provider or second Geocoding Provider.
- No CJK city mapping, natural-language keyword regex, phrase stripping, or hardcoded location allowlist.
- No BFF route, auth, CORS, timeout, or proxy contract changes.
- No breaking change to `current_weather` schemaVersion `1.0`.

## Relationship To Prior Phase

This change depends on archived `weather-golden-eval`:

- Phase 1 baseline report: `openspec/changes/archive/2026-06-23-weather-golden-eval/baseline-report.md`.
- Forecast/advice known gaps from Phase 1 become Phase 2 acceptance targets.
- Multi-turn clarification known gap remains Phase 3 owned and must not be implemented here.

## Risks

- Forecast scope may expand into advice or planning recommendations. Mitigation: this phase exposes structured forecast data and simple forecast synthesis only; standalone advice remains out of scope.
- Adding `weather_forecast` can accidentally break current weather routing. Mitigation: keep `current_weather` contract unchanged and run Phase 1 baseline regression.
- Frontend parser may reject future v1.1 optional fields. Mitigation: parser must accept unknown optional fields and use safe fallback for unknown statuses.
- Open-Meteo response shapes may be incomplete or unavailable for some locations. Mitigation: validate provider response shape at runtime and return stable provider error/timeout/cancel statuses.

## Rollback Strategy

Rollback is additive:

1. Remove `weather_forecast` tool registration and Planner routing to it.
2. Revert Planner prompt/schema additions for forecast intent.
3. Leave `current_weather` unchanged.
4. Frontend parser/render additions can safely remain as forward-compatible fallback or be removed.
5. BFF requires no rollback because no BFF behavior changes are planned.

## Acceptance Criteria

- `openspec validate weather-forecast-capability --strict` passes.
- Planner can distinguish `current`, `hourly`, and `daily` weather capability.
- "明天會下雨嗎" and "週末天氣" route to forecast intent/tool in deterministic/mock tests.
- `weather_forecast` returns structured v1.1 hourly/daily data in mock integration tests.
- Frontend parses and renders forecast v1.1 results without breaking current v1.0 rendering.
- Phase 1 current-weather baseline regression remains passing.
- Live smoke is opt-in and reported honestly.
