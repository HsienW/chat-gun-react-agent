## Purpose

Defines the independent backend `weather_forecast` tool contract, provider behavior, error semantics, and v1.1 forecast result schema.

## Requirements

### Requirement: Backend MUST Provide Independent weather_forecast Tool

Backend MUST add an independent `weather_forecast` tool for hourly and daily forecast requests.

#### Scenario: Current weather remains unchanged
- **WHEN** the user asks for current temperature
- **THEN** the system MUST continue using `current_weather`
- **AND** `current_weather` result schemaVersion MUST remain `1.0`

#### Scenario: Daily forecast uses weather_forecast
- **WHEN** the user asks "明天會下雨嗎？"
- **THEN** the system MUST invoke `weather_forecast`
- **AND** it MUST NOT answer using only current observation

#### Scenario: Hourly forecast uses weather_forecast
- **WHEN** the user asks "今晚會變冷嗎？"
- **THEN** the system MUST invoke `weather_forecast`
- **AND** forecast granularity MUST be hourly

### Requirement: weather_forecast Input MUST Be Runtime Validated

`weather_forecast` input MUST validate location fields, weather capability, time range, units, locale, and queryName.

#### Scenario: Valid daily input
- **WHEN** tool input includes location, `weatherCapability: "daily"`, and a valid time range
- **THEN** validation MUST pass
- **AND** provider request construction MAY proceed

#### Scenario: Invalid time range
- **WHEN** tool input includes an invalid date or unsupported time range kind
- **THEN** validation MUST return a structured `error`
- **AND** the provider MUST NOT be called

#### Scenario: queryName is present
- **WHEN** forecast input includes `queryName`
- **THEN** location resolution MUST treat it as a provider query hint only
- **AND** provider-backed candidates remain the geographic authority

### Requirement: weather_forecast Output MUST Use schemaVersion 1.1

Forecast result output MUST use schemaVersion `1.1`, `tool: "weather_forecast"`, and existing stable status discriminants.

#### Scenario: Daily forecast success
- **WHEN** daily forecast succeeds
- **THEN** output MUST include `status: "success"`
- **AND** output MUST include daily entries with date, temperature range, precipitation probability, condition code or text, and units

#### Scenario: Hourly forecast success
- **WHEN** hourly forecast succeeds
- **THEN** output MUST include `status: "success"`
- **AND** output MUST include hourly entries with time, temperature, precipitation probability or precipitation amount, condition code or text, and units

#### Scenario: Unknown optional fields
- **WHEN** output contains future optional forecast fields
- **THEN** consumers MUST be able to ignore them without crashing

### Requirement: Forecast Provider Errors MUST Preserve Stable Semantics

Forecast execution MUST distinguish invalid input, needs_clarification, not_found, provider error, timeout, and cancellation.

#### Scenario: Geocoding not found
- **WHEN** location resolution has no provider candidates
- **THEN** `weather_forecast` MUST return `status: "not_found"`
- **AND** it MUST NOT fabricate coordinates

#### Scenario: Ambiguous location
- **WHEN** location resolution returns close candidates without enough context
- **THEN** `weather_forecast` MUST return `status: "needs_clarification"`
- **AND** it MUST NOT auto-select the first candidate

#### Scenario: Weather provider error
- **WHEN** Open-Meteo forecast API fails
- **THEN** `weather_forecast` MUST return `status: "error"` with a stable weather-provider error code
- **AND** the error MUST NOT be mapped to `not_found`

#### Scenario: Timeout
- **WHEN** forecast provider call times out
- **THEN** `weather_forecast` MUST return a timeout terminal error
- **AND** retryability MUST be represented structurally

#### Scenario: Cancellation
- **WHEN** the user cancels a forecast request
- **THEN** `weather_forecast` MUST return or converge to a cancelled terminal state
- **AND** cancellation MUST remain distinct from timeout

### Requirement: Forecast Tool MUST Use Open-Meteo Hourly And Daily Parameters

Forecast data MUST be retrieved through Open-Meteo hourly/daily forecast parameters in Phase 2.

#### Scenario: Daily provider query
- **WHEN** daily forecast is requested
- **THEN** provider request MUST include daily forecast fields
- **AND** it MUST include enough fields to compute temperature range, precipitation probability, and condition

#### Scenario: Hourly provider query
- **WHEN** hourly forecast is requested
- **THEN** provider request MUST include hourly forecast fields
- **AND** it MUST be bounded to the requested time range

#### Scenario: No second provider
- **WHEN** implementing Phase 2
- **THEN** no second weather provider MUST be required
- **AND** provider abstraction MAY remain extensible for future changes
