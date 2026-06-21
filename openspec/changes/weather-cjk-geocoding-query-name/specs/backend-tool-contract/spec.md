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

### Requirement: queryName Rollback MUST Be Achievable via Prompt Change Without Feature Flag

The system MUST NOT introduce an env-based feature flag for `queryName`. Rollback MUST be achievable by modifying the Planner Prompt to remove `queryName` extraction instruction. The Tool MUST accept `queryName` as optional regardless.

#### Scenario: Planner prompt includes queryName instruction

- GIVEN Planner Prompt 包含 `queryName` extraction instruction
- WHEN Planner 處理中文輸入
- THEN Planner MAY 產出 `queryName`

#### Scenario: Rollback via prompt change

- GIVEN Planner Prompt 不含 `queryName` extraction instruction（rollback 後）
- WHEN Planner 處理中文輸入
- THEN Planner SHALL NOT 產出 `queryName`
- AND queryName 即使被 Planner 意外產出，`coerceWeatherRequest` SHALL 保留它（Tool 為 optional no-op）
