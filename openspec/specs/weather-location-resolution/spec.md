# Weather Location Resolution

## Purpose

Defines how weather location intent, query hints, provider-backed geocoding, ambiguity handling, and weather result compatibility must behave.

## Requirements

### Requirement: Weather Planner MUST Preserve Raw User Location Text

Planner `weather.location` MUST retain user-provided text as-is. `weather.queryName` MUST NOT overwrite `raw` or `location`.

#### Scenario: CJK location with queryName

- GIVEN 使用者輸入「台北現在幾度？」
- WHEN Planner 產生 weather extraction
- THEN `weather.location` MUST 為 `"台北"`
- AND `weather.queryName` MAY 為 `"Taipei"`
- AND `weather.queryName` MUST NOT 覆蓋 `weather.location`

#### Scenario: English location without queryName

- GIVEN 使用者輸入 "Tokyo weather"
- WHEN Planner 產生 weather extraction
- THEN `weather.location` MUST 為 `"Tokyo"`
- AND `weather.queryName` SHOULD 為 undefined（無需轉寫）

### Requirement: Weather Planner SHOULD Provide Geocoding-Friendly queryName for Chinese or Mixed-Chinese Locations

Planner SHOULD populate `weather.queryName` with a Latin-script geocoding-friendly name when `weather.location` contains traditional Chinese, simplified Chinese, or mixed Chinese-Latin characters and the Planner knows the corresponding Latin name. Planner MUST NOT fabricate `queryName` when uncertain.

#### Scenario: Known Chinese city with queryName

- GIVEN 使用者查詢已知繁體/簡體中文城市（例如 台北、北京、高雄鳳山）
- WHEN Planner 知道對應 Latin name
- THEN Planner SHOULD 提供 `queryName`（例如 `"Taipei"`, `"Beijing"`, `"Kaohsiung Fengshan"`）

#### Scenario: Mixed Chinese-Latin input

- GIVEN 使用者輸入混合中文與英文的地點（例如 `台北101`、`北京CBD`）
- WHEN Planner 知道該地點的 geocoding-friendly Latin name
- THEN Planner SHOULD 提供 `queryName`

#### Scenario: Unknown or uncertain Chinese location

- GIVEN Planner 不確定中文地點的對應 Latin name
- WHEN Planner 產生 weather extraction
- THEN Planner MUST NOT 猜測 `queryName`
- AND Resolver fallback 到原 `location` 查詢

#### Scenario: Non-Chinese CJK out of scope

- GIVEN 使用者以日文（例如 `東京`）或韓文（例如 `서울`）提供地點
- WHEN Planner 產生 weather extraction
- THEN Planner MAY 產出 `queryName` 但無強制要求
- AND 本次 Change 的 test coverage 不要求覆蓋日文/韓文案例

### Requirement: Current Weather Tool Input MUST Accept Optional queryName

`current_weather` Tool input schema MUST accept an optional `queryName` string field.

#### Scenario: Tool invoked with queryName

- GIVEN Tool caller 傳入 `queryName: "Taipei"`
- WHEN Tool 執行
- THEN Tool MUST 將 `queryName` 傳給 `buildQueryVariants`
- AND `location` 仍保留原文

#### Scenario: Tool invoked without queryName

- GIVEN Tool caller 未傳入 `queryName`
- WHEN Tool 執行
- THEN Tool MUST 行為與變更前完全一致

### Requirement: Resolver MUST Prioritize Validated queryName Variant Without Dropping Original Location Fallback

`buildQueryVariants` MUST insert `queryName` as the first query variant when it differs from `location`. The original `location` MUST remain as a fallback variant.

#### Scenario: queryName different from location

- GIVEN `queryName: "Taipei"` 與 `location: "台北"` 不同
- WHEN `buildQueryVariants` 建立 variant list
- THEN 第一 variant MUST 為 `"Taipei"` (strategy: `"original"`)
- AND 第二 variant MUST 為 `"台北"` (原文 fallback)
- AND 後續 language fallback variants 照舊

#### Scenario: queryName same as location

- GIVEN `queryName: "Tokyo"` 與 `location: "Tokyo"` 相同
- WHEN `buildQueryVariants` 建立 variant list
- THEN variant list MUST NOT 包含重複的 `"Tokyo"`
- AND variant list 與未傳 `queryName` 時完全一致

#### Scenario: queryName absent

- GIVEN `queryName` 為 undefined
- WHEN `buildQueryVariants` 建立 variant list
- THEN variant list MUST 與變更前完全一致

### Requirement: Resolver MUST NOT Treat queryName as Geographic Truth Without Provider Validation

`queryName` is a query acceleration hint. The Resolver MUST still submit queryName-based variants to the Geocoding Provider and MUST rely on Provider candidates as the sole source of geographic truth.

#### Scenario: Correct queryName

- GIVEN `queryName: "Taipei"` matches Provider index
- WHEN Resolver submits variant to Provider
- THEN Provider returns Taipei, TW candidates
- AND Resolver selects best candidate per normal scoring rules

#### Scenario: Incorrect queryName

- GIVEN `queryName: "Taibei"` does not match Provider index
- WHEN Resolver submits variant to Provider
- THEN Provider returns empty results for that variant
- AND Resolver falls back to `location: "台北"` variant（may also fail if CJK）
- AND `not_found` is returned; LLM Repair may attempt correction

### Requirement: Resolver MUST NOT Rely on Fixed CJK City Alias Maps as Primary Strategy

The system MUST NOT include a hardcoded CJK→Latin city alias lookup table. `queryName` MUST come from Planner LLM semantic understanding only.

#### Scenario: No fixed alias map in codebase

- GIVEN 本 Change 完成後的程式碼
- WHEN 審查 `backend/src/` 目錄
- THEN MUST NOT 存在固定 CJK→Latin city mapping（例如 `{ 台北: "Taipei" }` 等超過 WMO code / ISO code 以外的地名 mapping）

### Requirement: Ambiguous CJK Inputs MUST Return needs_clarification

When a CJK location with or without `queryName` returns multiple candidates with close scores and no country/region context, the Resolver MUST return `ambiguous`.

#### Scenario: 中山 without country context

- GIVEN location: `"中山"`, no country, no region
- AND queryName 存在或不存在
- WHEN Resolver evaluates Provider results
- THEN result status MUST 為 `ambiguous` 或 `needs_clarification`
- AND MUST NOT auto-select first candidate

### Requirement: Unknown CJK Inputs MUST Return not_found Without Fabricated Coordinates

When all query variants (including queryName and location) fail to match any Provider candidate, the tool MUST return `not_found` and MUST NOT fabricate latitude/longitude.

#### Scenario: Unknown CJK location

- GIVEN location: `"不存在的城市"`
- AND queryName may or may not exist
- WHEN all variants return no Provider candidates
- THEN result status MUST 為 `not_found`
- AND result MUST NOT contain fabricated coordinates

### Requirement: WeatherToolResult schemaVersion 1.0 MUST Remain Backward Compatible

The `queryName` field is internal to Tool input. It MUST NOT appear in `WeatherToolResult` output. schemaVersion MUST remain `"1.0"`.

#### Scenario: Success result unchanged

- GIVEN `current_weather` returns `status: "success"`
- WHEN inspecting `WeatherToolResult`
- THEN MUST NOT contain `queryName` field
- AND schemaVersion MUST 為 `"1.0"`
- AND 所有既有欄位保持不變

### Requirement: Mock and Live Smoke Coverage MUST Include CJK Success, Ambiguity, Not Found, Cancellation, and No Sensitive Leakage

Test coverage MUST extend to CJK-specific scenarios without regressing existing Latin/Unicode cases.

#### Scenario: Mock smoke CJK success

- GIVEN mock Geocoding Provider 回傳 Taipei 候選
- WHEN Tool 被調用 with `location: "台北"`, `queryName: "Taipei"`
- THEN result status MUST 為 `"success"`

#### Scenario: Live smoke CJK success (opt-in)

- GIVEN `OPEN_METEO_LIVE_SMOKE=true`
- WHEN Tool 被調用 with `location: "台北"`, `queryName: "Taipei"` against real Open-Meteo
- THEN result status MUST 為 `"success"`

#### Scenario: Live smoke 臺北 same entity as 台北

- GIVEN `OPEN_METEO_LIVE_SMOKE=true`
- WHEN Tool 被調用 separately with `location: "台北"` and `location: "臺北"`（both with appropriate queryName）
- THEN resolved countryCode MUST match
- AND resolved coordinates MUST be compatible（相近經緯度）
