# Delta for Backend Tool Contract

## MODIFIED Requirements

### Requirement: current_weather Tool Input Schema MUST Accept Optional queryName

The `current_weather` Tool Zod input schema MUST add an optional `queryName` field alongside existing `location`, `country`, `region`, `resolutionStrategy`, and `raw`.

#### Scenario: Schema validation passes with queryName

- GIVEN Tool input: `{ location: "台北", queryName: "Taipei" }`
- WHEN Zod schema validates input
- THEN validation MUST pass
- AND `queryName` MUST be accessible in tool implementation

#### Scenario: Schema validation passes without queryName

- GIVEN Tool input: `{ location: "Tokyo" }` (no queryName)
- WHEN Zod schema validates input
- THEN validation MUST pass
- AND tool behavior MUST be identical to pre-change

#### Scenario: queryName exceeds max length

- GIVEN `queryName` exceeds `WEATHER_LOCATION_MAX_CHARS`
- WHEN tool validates input
- THEN MUST return `status: "error"`, code: `"weather_invalid_input"`

## ADDED Requirements

### Requirement: buildQueryVariants MUST Prioritize queryName Without Dropping Location Fallback

When `queryName` is provided and differs from `location` after normalization, `buildGeocodingQueryVariants` MUST insert `queryName` as the first variant before `location`. Deduplication MUST still apply.

#### Scenario: queryName variant ordering

- GIVEN `location: "台北"`, `queryName: "Taipei"`
- WHEN `buildGeocodingQueryVariants` is called
- THEN index 0 MUST have text `"Taipei"`, strategy `"original"`
- AND index 1 MUST have text `"台北"`, strategy `"original"` (原文 fallback)
- AND subsequent variants follow existing language fallback order

#### Scenario: queryName absent — no change

- GIVEN `location: "Tokyo"`, `queryName: undefined`
- WHEN `buildGeocodingQueryVariants` is called
- THEN variant list MUST be identical to pre-change behavior

#### Scenario: queryName deduplication

- GIVEN `location: "Tokyo"`, `queryName: "Tokyo"`
- WHEN `buildGeocodingQueryVariants` is called
- THEN variant list MUST contain only one `"Tokyo"` entry
- AND `"Tokyo"` appears only once across all variants

---

### Requirement: Feature Flag MUST Allow Disabling queryName Planner Extraction

`WEATHER_PLANNER_QUERY_NAME_ENABLED` env var (default `true`) MUST gate whether Planner Prompt instructs queryName extraction. When `false`, Planner MUST NOT be asked to produce `queryName`, and `coerceWeatherRequest` MUST ignore any `queryName` in Planner output.

#### Scenario: Flag enabled (default)

- GIVEN `WEATHER_PLANNER_QUERY_NAME_ENABLED=true` (or unset)
- WHEN Planner extracts weather request
- THEN Prompt SHOULD instruct `queryName` extraction for CJK locations
- AND `coerceWeatherRequest` SHOULD extract and validate `queryName`

#### Scenario: Flag disabled

- GIVEN `WEATHER_PLANNER_QUERY_NAME_ENABLED=false`
- WHEN Planner extracts weather request
- THEN Prompt MUST NOT instruct `queryName` extraction
- AND `coerceWeatherRequest` MUST ignore `queryName` even if Planner accidentally emits it
- AND Tool behavior MUST be identical to pre-change
