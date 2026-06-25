## ADDED Requirements

### Requirement: Frontend MUST Parse weather_forecast v1.1 Results

Frontend weather parser MUST accept structured `weather_forecast` results with schemaVersion `1.1`.

#### Scenario: Parse daily forecast result
- **WHEN** frontend receives JSON with `tool: "weather_forecast"`, `schemaVersion: "1.1"`, and `status: "success"`
- **THEN** parser MUST return a structured forecast result
- **AND** daily forecast entries MUST be available to the renderer

#### Scenario: Parse hourly forecast result
- **WHEN** frontend receives hourly forecast data
- **THEN** parser MUST return a structured forecast result
- **AND** hourly entries MUST be available to the renderer

#### Scenario: Current weather v1.0 remains compatible
- **WHEN** frontend receives existing `current_weather` v1.0 result
- **THEN** existing current weather rendering MUST continue to work

### Requirement: Frontend MUST Render Forecast Data From Structured Fields

Frontend forecast UI MUST render forecast data from structured fields, not from summary text.

#### Scenario: Daily forecast rendering
- **WHEN** a daily forecast success result is rendered
- **THEN** UI MUST show location, date, temperature range, precipitation probability, and condition when available

#### Scenario: Hourly forecast rendering
- **WHEN** an hourly forecast success result is rendered
- **THEN** UI MUST show hourly time buckets with temperature and precipitation data when available

#### Scenario: Missing optional forecast fields
- **WHEN** optional forecast fields are missing
- **THEN** UI MUST omit or safely fallback for those fields
- **AND** it MUST NOT crash

### Requirement: Frontend MUST Preserve Terminal And Error Semantics

Frontend MUST display forecast `needs_clarification`, `not_found`, `error`, `timeout`, and `cancelled` outcomes distinctly.

#### Scenario: Forecast needs clarification
- **WHEN** forecast result status is `needs_clarification`
- **THEN** UI MUST show candidate clarification state
- **AND** it MUST NOT render the result as generic error

#### Scenario: Forecast timeout
- **WHEN** forecast result error code indicates timeout
- **THEN** UI MUST show timeout semantics
- **AND** it MUST NOT treat timeout as successful completion

#### Scenario: Forecast cancellation
- **WHEN** forecast result error code indicates cancellation
- **THEN** UI MUST show cancellation semantics
- **AND** late progress MUST NOT move a terminal result back to running

### Requirement: Frontend MUST Safely Degrade Unknown Forecast Results

Frontend MUST safely handle unknown forecast schema versions, statuses, or extra fields.

#### Scenario: Unknown status
- **WHEN** forecast result has an unknown status
- **THEN** UI MUST display a safe fallback
- **AND** it MUST preserve inspectable summary or safe JSON

#### Scenario: Non-JSON content
- **WHEN** tool output is not valid JSON
- **THEN** UI MUST use generic tool output fallback
- **AND** it MUST NOT execute or trust the content as markup

#### Scenario: Sensitive details
- **WHEN** forecast error result contains internal message fields
- **THEN** UI MUST not display stack traces, API keys, proxy credentials, or raw provider bodies

### Requirement: Tool Delegation MUST Include weather_forecast

Frontend tool display MUST delegate `weather_forecast` structured results to weather rendering.

#### Scenario: weather_forecast tool message
- **WHEN** ToolMessageDisplay receives a `weather_forecast` tool call and structured forecast output
- **THEN** it MUST use the weather forecast renderer
- **AND** status badge MUST be derived from structured status

#### Scenario: Unknown weather-like tool
- **WHEN** an unknown future weather tool result is received
- **THEN** frontend MUST safely fallback rather than hard-crashing
