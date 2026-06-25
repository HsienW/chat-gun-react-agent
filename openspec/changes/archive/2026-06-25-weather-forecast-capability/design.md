## Context

The current backend has `current_weather`, provider-backed geocoding, structured `WeatherToolResult` v1.0, and frontend rendering for current observations. Phase 1 `weather-golden-eval` recorded forecast/advice prompts as known gaps and preserved multi-turn clarification as a separate Phase 3 gap.

This phase adds forecast capability only. It crosses backend Planner, backend tool execution, provider response validation, frontend type/parser/rendering, and regression coverage. BFF remains a pass-through boundary and should not need source changes.

## Goals / Non-Goals

**Goals:**

- Add structured Planner intent fields for current/hourly/daily weather capability.
- Add independent `weather_forecast` tool using Open-Meteo hourly/daily parameters.
- Add `WeatherToolResult` v1.1 forecast output with daily and hourly sections.
- Render forecast results in the frontend using structured data.
- Keep `current_weather` v1.0 backward compatible.
- Convert Phase 1 forecast known gaps into passing Phase 2 regression cases.

**Non-Goals:**

- Multi-turn clarification or candidate selection UI.
- Historical weather, climate knowledge, or second provider.
- Standalone advice generation beyond forecast-backed summary.
- BFF proxy behavior changes.
- Runtime city mappings, keyword stripping, or phrase stripping.

## Current Architecture Inventory

Backend:

- `current_weather` owns current observation lookup and returns v1.0 result.
- Weather location resolution is provider-backed and accepts optional `queryName`.
- Planner weather extraction currently carries location/country/region/queryName but no formal forecast capability or time range.
- Open-Meteo forecast endpoint is already used for current data, but current parameters only request `current`.

Frontend:

- `frontend/src/types/weather.ts` parses only `tool === "current_weather"`.
- `WeatherToolResult.tsx` renders v1.0 current observation, clarification, not_found, and error.
- `ToolMessageDisplay.tsx` delegates only `current_weather` structured results.

BFF:

- BFF should remain a transport boundary. It must not parse weather intent or transform forecast payloads.

## Decisions

### Decision 1: Add Independent `weather_forecast` Tool

Add a new backend tool named `weather_forecast` rather than expanding `current_weather`.

Rationale: this preserves current-weather behavior and lets tool descriptions make capability boundaries explicit. `current_weather` can remain v1.0; forecast can use v1.1.

Alternative considered: expand `current_weather` to handle all modes. Rejected because it increases compatibility risk and blurs current versus forecast ownership.

### Decision 2: Use `WeatherToolResult` schemaVersion `1.1` For Forecast

Forecast results use `schemaVersion: "1.1"` and `tool: "weather_forecast"`. The result keeps existing status discriminants (`success`, `needs_clarification`, `not_found`, `error`) and adds forecast-specific data only on success.

Rationale: minor version signals additive compatibility while allowing frontend parser to identify forecast sections.

Alternative considered: keep `1.0`. Rejected because forecast data sections materially extend the structured result contract and should be visible to consumers.

### Decision 3: Planner Weather Capability Enum Is `current | hourly | daily`

Planner output should classify weather intent as:

```text
current
hourly
daily
```

`forecast`, `historical`, `climate`, and `advice` are not v1 enum values. Advice-style prompts can be modeled as `daily` or `hourly` only when the requested answer is directly forecast-backed.

Rationale: this keeps Phase 2 small and executable while avoiding fake advice/climate capabilities.

### Decision 4: Time Range Is Structured And Relative-Anchor Friendly

Use a structured `timeRange` object rather than keyword-specific fields. It should support:

- `kind`: `now`, `today`, `tonight`, `tomorrow`, `weekend`, or `date_range`.
- optional `startDate` / `endDate` in ISO date format when deterministic dates are available.
- optional `timezone`.
- optional `granularity`: `hourly` or `daily`.

Rationale: the runtime can compute provider query parameters deterministically while Planner remains responsible for semantic extraction, not provider-specific URLs.

### Decision 5: Open-Meteo Remains Primary Provider

Implement forecast with Open-Meteo hourly/daily parameters and runtime validation. Do not add a second provider in V1.

Rationale: Open-Meteo already supports hourly/daily forecast fields needed for Phase 2.

### Decision 6: Frontend Parses Both Current v1.0 And Forecast v1.1

Frontend parser should accept `current_weather` v1.0 and `weather_forecast` v1.1. Tool delegation should route both weather tools to weather rendering while retaining unknown fallback.

Rationale: current cards must remain compatible and forecast cards need structured rendering without parsing display text.

### Decision 7: Simple Localization Only

Frontend may use existing UI language for labels and date/time display. Backend should preserve structured units/timezone. Do not add deep LLM-generated Chinese forecast descriptions.

Rationale: simple labels improve usability without expanding into localization or advice work.

## Data Flow

```text
User weather prompt
  -> Planner structured weather intent
  -> weatherCapability current/hourly/daily
  -> current_weather OR weather_forecast
  -> Location resolver with location/country/region/queryName
  -> Open-Meteo current OR hourly/daily request
  -> WeatherToolResult v1.0 or v1.1
  -> Frontend parser
  -> Current or forecast card rendering
```

## Backend Contract Sketch

Planner weather intent additions:

```ts
weatherCapability?: "current" | "hourly" | "daily";
timeRange?: {
  kind: "now" | "today" | "tonight" | "tomorrow" | "weekend" | "date_range";
  startDate?: string;
  endDate?: string;
  timezone?: string;
  granularity?: "hourly" | "daily";
};
units?: "metric";
locale?: string;
```

Forecast tool input should include location fields, `queryName`, `weatherCapability`, `timeRange`, `units`, and `locale`. It must reject invalid capability/time ranges through runtime validation.

Forecast success output should include:

- requested location and resolved location.
- forecast generated time/timezone/provider/sourceUrl.
- `daily` entries when daily forecast is requested.
- `hourly` entries when hourly forecast is requested.
- units keyed by provider field.
- summary.

## Frontend/BFF Compatibility

Frontend:

- Extend local weather types, parser, display status mapping, and component rendering.
- Unknown `schemaVersion`, tool, status, or optional fields must safely degrade.
- Do not import backend types directly.

BFF:

- No source change expected.
- Must continue to proxy stream/tool payloads without inspecting forecast content.

## Failure Handling

The forecast tool must distinguish:

- invalid input
- needs_clarification
- not_found
- geocoding provider error
- weather provider error
- timeout
- cancelled
- provider response validation failure

Provider errors must not become `not_found`, and cancelled/timeout must remain distinct terminal outcomes.

## Security And Anti-Hardcoding

- No city maps, keyword regex intent routing, phrase stripping, or provider-specific business schema branching.
- Tool output is untrusted data to frontend and synthesis.
- Provider responses require runtime validation before entering domain result.
- Do not expose API keys, stack traces, proxy credentials, full prompts, or raw provider bodies.

## Migration Plan

1. Add deterministic tests for Planner forecast intent and timeRange.
2. Add `weather_forecast` input/output types and runtime validation.
3. Implement Open-Meteo hourly/daily request mapping.
4. Add mock integration tests for daily/hourly success, provider failure, timeout, cancellation, invalid input, not_found, and needs_clarification.
5. Extend frontend parser/rendering and tests.
6. Run Phase 1 baseline regression and all affected package validations.
7. Run opt-in live smoke only when explicitly enabled.

## Open Questions

- Exact day-boundary handling for `weekend` should be deterministic in tests and may use runtime date injection or fixed clock.
- Exact forecast fields should be finalized during implementation, but must include temperature range, precipitation probability, and condition code/text for daily forecasts.
