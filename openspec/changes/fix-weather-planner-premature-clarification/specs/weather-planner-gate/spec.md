# Spec：Weather Planner Gate 與 Bounded Extraction

## 變更範圍

本 Spec 定義 Weather Planner 提前產出 Clarification 的修復行為，涵蓋 Planner Gate、Bounded Extraction 與 queryName 語意降級。

---

## ADDED Requirements

### Requirement：Planner Gate 判定 Clarify Plan 中的 Weather Intent

當 MainPlanner 產出 `answerMode: "clarify"` 的 Plan，但 deterministic routing policy（`createPlannerFailureRoutingDecision`）判定使用者輸入包含天氣意圖時，系統 MUST 觸發 bounded weather extraction retry，不直接將 clarify 送入 synthesis。

#### Scenario：Planner 產出 clarify 但關鍵詞路由檢測到天氣意圖

GIVEN 使用者輸入「大寮天氣」
AND MainPlanner 產出 `{ answerMode: "clarify", clarification: "請提供要查詢天氣的城巿或地區。" }`
AND `createPlannerFailureRoutingDecision("大寮天氣")` 回傳 `answerMode` 不為 `"clarify"`
WHEN `shouldRetryWeatherPlannerExtraction` 被呼叫
THEN the system SHALL return `true`
AND the system SHALL invoke `retryWeatherPlannerExtraction` — a bounded extraction LLM call
AND the extraction MUST ask only whether the user provided a location and preserve the original location text
AND the extraction MUST NOT translate, geocode, or invent coordinates

#### Scenario：Planner 已正確回傳 weather + location 時不觸發

GIVEN 使用者輸入「高雄大寮今天會下雨嗎」
AND MainPlanner 產出 `{ answerMode: "weather", weather: { location: "大寮", ... } }`
AND `coercePlan` 通過 Runtime Validation
WHEN `shouldRetryWeatherPlannerExtraction` 被呼叫
THEN the system SHALL return `false`
AND no additional LLM call SHALL be made

#### Scenario：無地點的 weather 請求維持 clarify

GIVEN 使用者輸入「明天會下雨嗎」
AND MainPlanner 產出 clarify plan
AND deterministic routing 判定天氣意圖
AND `retryWeatherPlannerExtraction` 回傳 clarify（無法提取地點）
WHEN `applyWeatherPlannerExtractionRetry` 完成
THEN `plan.answerMode` SHALL remain `"clarify"`
AND `routeAfterPlan` SHALL route to `synthesizeAnswer`

#### Scenario：非天氣意圖不觸發 weather recovery

GIVEN 使用者輸入「介紹一下大寮的歷史」
AND MainPlanner 產出 `{ answerMode: "research", ... }` 或 `{ answerMode: "direct", ... }`
AND `plan.answerMode` 不為 `"clarify"`
WHEN `shouldRetryWeatherPlannerExtraction` 被呼叫
THEN the system SHALL return `false`
AND `routeAfterPlan` SHALL route to research or synthesis as normal

---

### Requirement：Bounded Extraction 只保留原始地點文字

Bounded extraction MUST NOT perform geographic disambiguation, coordinate generation, or location-name translation. Its sole responsibility is to determine whether the user's input contains a location and to extract the verbatim location text.

#### Scenario：Bounded extraction 成功提取地點

GIVEN `retryWeatherPlannerExtraction` 被呼叫 with user input「大寮天氣」
WHEN the extraction LLM responds
THEN the response SHALL contain `{ answerMode: "weather", weather: { location: "大寮" } }`
AND `location` SHALL be the verbatim location text from the user input
AND the response MUST NOT contain `latitude`, `longitude`, `coordinates`, `providerId`, `providerCandidates`, `candidates`, `sourceUrl`
AND `queryName` SHALL NOT be present

#### Scenario：Bounded extraction 無法找到地點

GIVEN `retryWeatherPlannerExtraction` 被呼叫 with user input「明天會下雨嗎」
WHEN the extraction LLM responds
THEN the response SHALL contain `{ answerMode: "clarify" }`
AND `weather.location` SHALL NOT be present

#### Scenario：Bounded extraction 不超過一次

GIVEN `_weatherExtractionAttempted` flag is set to `true` in the Graph Run config
WHEN `shouldRetryWeatherPlannerExtraction` 被呼叫
THEN the system SHALL return `false` regardless of plan content
AND no additional extraction LLM call SHALL be made

---

### Requirement：Planner 層不判斷地點歧義

The Planner and bounded extraction MUST NOT distinguish between `resolved`, `ambiguous`, and `not_found` for location. These statuses are the exclusive responsibility of the Resolver / Weather Tool.

#### Scenario：Planner 保留「大寮」但不判斷其可解析性

GIVEN 使用者輸入「大寮天氣」
AND bounded extraction 成功提取 `location: "大寮"`
WHEN the Plan is routed to `targeted_tools`
THEN `current_weather` Tool SHALL be called with `location: "大寮"`
AND `current_weather` 內部 SHALL invoke Open-Meteo Geocoding with query "大寮"
AND the Resolver SHALL return `resolved`, `ambiguous`, or `not_found` based on Provider data
AND the Resolver MUST NOT rely on a fixed city mapping for 「大寮」

#### Scenario：Resolver 回傳 ambiguous 後才進入 clarification

GIVEN `current_weather` Tool is called with `location: "Springfield"`
AND Open-Meteo Geocoding returns multiple candidates (Springfield, IL and Springfield, MO)
AND the Resolver determines score delta < ambiguityDelta
WHEN the Weather Tool returns `{ status: "needs_clarification", candidates: [...] }`
THEN `routeAfterTargetedTools` SHALL route to `clarifyInterrupt`
AND the clarification interrupt SHALL present the Provider-backed candidates

---

### Requirement：queryName 降級為 Fallback Hint

`queryName` SHALL be demoted from "Planner-supplied geocoding-friendly name" to "fallback query variant for the Resolver". It MUST NOT replace `requestedLocation.raw`.

#### Scenario：queryName 只在 primary location 查詢失敗時使用

GIVEN `current_weather` is called with `{ location: "大寮", queryName: "Daliao" }`
WHEN Resolver processes the query
THEN the Resolver SHALL first attempt geocoding with `query.location` → "大寮"
AND only if the first attempt returns `not_found` SHALL the Resolver attempt geocoding with `queryName` → "Daliao"
AND `requestedLocation.raw` SHALL remain "大寮"

#### Scenario：queryName 不得覆蓋 requestedLocation.raw

GIVEN a successful weather lookup using `queryName` as a fallback
WHEN the Weather Tool returns `WeatherSuccessResult`
THEN `result.requestedLocation.raw` SHALL equal the original user input location
AND the Resolver MUST NOT replace `requestedLocation.raw` with `queryName`

---

### Requirement：Weather Tool Invocation 可測試斷言

After the Planner Gate and bounded extraction, tests MUST be able to assert that the Weather Tool was invoked.

#### Scenario：測試斷言 Weather Tool 被呼叫次數

GIVEN a deterministic or mock integration test with input「大寮天氣」
AND the system processes through `planResearch` → `routeAfterPlan` → `targetedTools`
WHEN the test inspects the state messages
THEN at least one `ToolMessage` with `name: "current_weather"` or `name: "weather_forecast"` MUST be present
AND the test SHALL be able to assert the exact invocation count

#### Scenario：無地點請求的 Weather Tool 不被呼叫

GIVEN a test with input「明天會下雨嗎」
AND the system processes through `planResearch` → `routeAfterPlan`
WHEN `routeAfterPlan` returns the route to `synthesizeAnswer`
THEN `targetedTools` node MUST NOT be visited
AND no `ToolMessage` with `name: "current_weather"` or `name: "weather_forecast"` SHALL be present

---

## MODIFIED Requirements

### Requirement：MainPlanner `queryName` Prompt 調整

MainPlanner prompt for `queryName` SHALL be updated to reflect that `queryName` is a fallback hint, not a replacement for the original location.

#### Scenario：MainPlanner prompt 中的 queryName 描述

GIVEN the MainPlanner system prompt in `planResearch`
WHEN the prompt describes `queryName`
THEN it SHALL state that `queryName` is used as a fallback if the original location is not found by the geocoding provider
AND it SHALL NOT state that `queryName` replaces or overrides the user's original location text
