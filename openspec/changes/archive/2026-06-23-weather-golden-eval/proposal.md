## Why

Weather behavior currently has no single golden baseline that separates supported current-observation behavior from unsupported forecast-like and multi-turn clarification requests. That makes later forecast or clarification work hard to review objectively because there is no deterministic matrix showing what already passes, what fails, and which layer owns each failure.

This change establishes `weather-golden-eval` as Phase 1 of the weather parity work. It measures the current system first and records known capability boundaries before any new forecast tool, Planner schema expansion, or multi-turn workflow is introduced.

## What Changes

- Add a golden weather evaluation matrix covering CJK, English, mixed-language, ambiguous, missing-location, current-time, forecast-like, provider-error, timeout, and cancellation scenarios.
- Add a reusable weather eval harness contract that supports deterministic tests, mock integration tests, and opt-in live smoke checks.
- Require a baseline report that honestly records current pass/fail outcomes, including known Phase 2/3 gaps such as forecast-like questions being treated as current observations and ambiguous locations not supporting follow-up selection.
- Require the weather agent rules documentation to reflect the Golden Regression Matrix used by the eval baseline.
- Keep this change measurement-only: no new weather tool, no Planner schema expansion, no frontend candidate UI, no BFF behavior change, and no runtime fixes for failures discovered by the baseline.

## Capabilities

### New Capabilities

- `weather-eval-matrix`: Defines the golden weather evaluation case taxonomy, expected outcome schema, baseline report requirements, and required coverage for current capability boundaries.
- `weather-eval-harness`: Defines the reusable eval runner behavior, deterministic/mock/live modes, provider fixture boundaries, cancellation/timeout simulation, and reporting contract.

### Modified Capabilities

- None. This phase introduces eval capabilities only and does not change runtime product behavior.

## Impact

Affected packages and capabilities:

- `backend`: Future implementation will add weather eval cases, mock fixtures, runner/reporting support, and backend validation commands.
- `frontend`: No source changes in Phase 1; frontend tests may be run as regression evidence because weather tool rendering is a downstream consumer.
- `bff`: No source changes in Phase 1; build may be run as a compatibility check because browser traffic must continue through BFF.
- `docs/agent-rules/weather.md`: Future implementation will update the Golden Regression Matrix section with the final baseline categories.
- `openspec`: This change adds planning artifacts and new specs for the eval matrix and harness.

## Goals

- Establish a deterministic golden baseline before forecast or clarification capabilities are implemented.
- Separate deterministic, mock integration, and opt-in live smoke coverage so CI does not depend on external providers.
- Record current known failures without treating them as Phase 1 implementation failures.
- Make the baseline reusable by `weather-forecast-capability` and `weather-clarification-workflow`.
- Preserve existing `current_weather` behavior and avoid any runtime contract change in this phase.

## Non-Goals

- Do not add `weather_forecast` or modify `current_weather` into a forecast-capable tool.
- Do not modify WeatherIntentSchema, Planner prompt, LangGraph State, Graph edges, or checkpoint behavior.
- Do not implement multi-turn clarification or candidate selection UI.
- Do not add CJK city mappings, keyword regex, phrase stripping, or hardcoded location allowlists.
- Do not reopen or modify the archived `weather-cjk-geocoding-query-name` change.
- Do not treat mock acceptance as live provider acceptance.
- Do not localize weather descriptions or add weather advice generation.

## Relationship To Other Phases

This is Phase 1 in the approved split strategy.

- Phase 2, `weather-forecast-capability`, depends on this baseline to prove current weather behavior does not regress while forecast support is added.
- Phase 3, `weather-clarification-workflow`, depends on this baseline and the Phase 2 outcome to prove ambiguous-location follow-up behavior improves without breaking current or forecast cases.

## Risks

- The matrix may accidentally encode future desired behavior as Phase 1 pass criteria. Mitigation: forecast-like and multi-turn cases must be allowed to fail with explicit current capability boundary labels.
- Live smoke checks may be flaky due to real provider or model availability. Mitigation: live smoke is opt-in and must not be a default CI gate.
- Eval fixtures could become hidden hardcoded behavior. Mitigation: fixtures are test data only and must not be used by runtime resolver or Planner logic.
- Baseline reporting could expose sensitive prompt or provider details. Mitigation: reports must use structured summaries and avoid secrets, raw credentials, or full prompt dumps.

## Rollback Strategy

Rollback is limited to removing the new eval artifacts and any future Phase 1 eval files. Because this phase does not modify runtime behavior, rollback must not require BFF route changes, frontend contract changes, Graph ID migration, or weather tool schema migration.

## Acceptance Criteria

- OpenSpec validates with `openspec validate weather-golden-eval --strict`.
- Specs define deterministic, mock integration, and opt-in live smoke behavior.
- Tasks include verification commands for backend, frontend, bff, and OpenSpec validation.
- Tasks explicitly block Phase 2 and Phase 3 work until the Phase 1 baseline report exists.
- The change contains no runtime forecast, localization, advice, or multi-turn clarification implementation scope.
