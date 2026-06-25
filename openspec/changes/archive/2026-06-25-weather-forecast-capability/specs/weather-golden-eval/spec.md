## ADDED Requirements

### Requirement: Phase 2 MUST Regress Phase 1 Current Weather Baseline

Implementation MUST run the Phase 1 golden baseline or equivalent regression coverage before Phase 2 is accepted.

#### Scenario: Current weather baseline remains passing
- **WHEN** Phase 2 implementation is verified
- **THEN** current-observation cases from Phase 1 MUST remain passing
- **AND** `current_weather` v1.0 output MUST remain compatible

#### Scenario: Provider failure baseline remains passing
- **WHEN** Phase 2 implementation is verified
- **THEN** provider error, timeout, cancellation, not_found, and needs_clarification cases MUST remain structurally distinct

### Requirement: Forecast Known Gaps MUST Become Passing Forecast Cases

Forecast known gaps from Phase 1 MUST be converted into passing Phase 2 tests.

#### Scenario: Tomorrow forecast known gap
- **WHEN** the user asks "明天會下雨嗎？"
- **THEN** Phase 2 tests MUST verify routing to forecast capability
- **AND** output MUST be forecast-backed rather than current-observation-only

#### Scenario: Tonight forecast known gap
- **WHEN** the user asks "今晚會變冷嗎？"
- **THEN** Phase 2 tests MUST verify hourly forecast behavior
- **AND** output MUST use forecast data for the relevant time range

#### Scenario: Weekend forecast known gap
- **WHEN** the user asks "週末天氣如何？"
- **THEN** Phase 2 tests MUST verify daily forecast behavior for a weekend range
- **AND** output MUST be forecast-backed

### Requirement: Phase 3 Clarification Gap MUST Remain Out Of Scope

Phase 2 MUST NOT implement or claim completion for Phase 3 multi-turn clarification gaps.

#### Scenario: Candidate follow-up remains Phase 3
- **WHEN** a user replies "第三個" after an ambiguous weather candidate list
- **THEN** Phase 2 MUST NOT claim this as solved
- **AND** any remaining gap MUST still point to `weather-clarification-workflow`

### Requirement: Live Smoke MUST Remain Opt-In

Forecast live smoke MUST be opt-in and reported separately from deterministic/mock acceptance.

#### Scenario: Live smoke skipped
- **WHEN** live smoke is not explicitly enabled
- **THEN** live forecast cases MUST be marked skipped
- **AND** skipped live cases MUST NOT fail default CI

#### Scenario: Live smoke enabled
- **WHEN** live smoke is explicitly enabled
- **THEN** results MUST record whether Open-Meteo daily/hourly forecast calls succeeded
- **AND** mock pass MUST NOT be represented as live pass
