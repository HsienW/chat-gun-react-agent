## Purpose

Defines Planner weather capability classification, time range structure, and runtime validation for current, hourly, and daily weather intent.

## Requirements

### Requirement: Weather Planner MUST Classify Current, Hourly, And Daily Capability

Planner weather intent MUST include a structured weather capability when the user asks for weather.

#### Scenario: Current observation request
- **WHEN** the user asks "台北現在幾度？"
- **THEN** Planner output MUST classify the weather capability as `current`
- **AND** the request MUST remain routable to the current weather path

#### Scenario: Tomorrow forecast request
- **WHEN** the user asks "明天會下雨嗎？"
- **THEN** Planner output MUST classify the weather capability as `daily`
- **AND** Planner output MUST include a `timeRange` representing tomorrow

#### Scenario: Tonight forecast request
- **WHEN** the user asks "今晚會變冷嗎？"
- **THEN** Planner output MUST classify the weather capability as `hourly`
- **AND** Planner output MUST include a `timeRange` representing tonight

### Requirement: Weather Time Range MUST Be Structured

Weather intent time range MUST be represented as structured data rather than natural-language display text.

#### Scenario: Weekend range
- **WHEN** the user asks "週末天氣如何？"
- **THEN** Planner output MUST include a `timeRange.kind` of `weekend`
- **AND** runtime validation MUST accept the time range without parsing answer text

#### Scenario: Explicit date range
- **WHEN** Planner can determine explicit ISO dates for a forecast request
- **THEN** it MAY include `startDate` and `endDate`
- **AND** runtime validation MUST reject invalid date strings

### Requirement: Planner MUST Preserve Location Fields And queryName Semantics

Forecast intent MUST preserve existing location, country, region, and queryName behavior.

#### Scenario: Chinese forecast with queryName
- **WHEN** the user asks "台北明天會下雨嗎？"
- **THEN** Planner output MUST preserve `location: "台北"`
- **AND** Planner output MAY include `queryName: "Taipei"`
- **AND** `queryName` MUST NOT replace raw location text

### Requirement: Unsupported Weather Capabilities MUST Not Be Fabricated

Planner MUST NOT emit historical, climate, or standalone advice capabilities in Phase 2.

#### Scenario: Historical weather request
- **WHEN** the user asks for historical weather
- **THEN** Planner/runtime MUST classify it as unsupported or clarification-required
- **AND** it MUST NOT route to `weather_forecast`

#### Scenario: Standalone advice request
- **WHEN** the user asks for broad advice that cannot be answered from forecast data alone
- **THEN** Planner/runtime MUST NOT invent a standalone `advice` weather capability
- **AND** it MUST either request clarification or use forecast only for forecast-backed parts

### Requirement: Weather Intent Validation MUST Be Runtime Enforced

Weather intent additions MUST pass runtime validation before tool execution.

#### Scenario: Unknown capability
- **WHEN** model output contains an unknown `weatherCapability`
- **THEN** runtime validation MUST reject or safely fall back without invoking an incorrect weather tool

#### Scenario: Missing location for forecast
- **WHEN** model output contains forecast capability but no usable location
- **THEN** runtime validation MUST not invoke `weather_forecast`
- **AND** the workflow MUST converge to clarification or safe terminal output
