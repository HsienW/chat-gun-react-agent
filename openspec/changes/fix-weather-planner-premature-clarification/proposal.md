# Proposal：修復 Weather Planner 提前產出 Clarification 導致 Weather Tool 未被執行

## 問題

使用者輸入包含地點文字的天氣問題（例如「大寮天氣」或「高雄大寮今天會下雨嗎」）時，`MainPlanner`（`planResearch` node）可能產出 `answerMode: "clarify"` 的 Plan，而非 `answerMode: "weather"`。這導致 `routeAfterPlan` 直接將 Graph 路由至 `synthesizeAnswer`，完全跳過 `targeted_tools` node，`current_weather` / `weather_forecast` Tool 從未被呼叫。

### 已知失敗案例

| 使用者輸入 | Planner 行為 | 預期 | 實際 |
|---|---|---|---|
| 大寮天氣 | 產出 `clarify`（"請提供要查詢天氣的城巿或地區"） | 進入 `targeted_tools`，由 Open-Meteo Resolver 判斷 resolved/ambiguous/not_found | Planner 提前澄清，Tool 未執行 |
| 高雄大寮今天會下雨嗎 | 產出 `weather`（有合法 location） | 正常進入 targeted_tools | 目前正確（但倚賴 LLM 自行判斷，無保證） |
| 明天會下雨嗎（無地點） | 產出 `clarify` | 澄清（正確行為） | 正確 |
| 介紹一下大寮的歷史 | 產出 `research` | research（非天氣意圖） | 正確 |

### 根因分析

1. **Planner Prompt 未強制 Gate**：MainPlanner prompt 指示「If a location is ambiguous, include country or region when the user supplied it; otherwise leave it to the weather tool to request clarification.」但這並非結構化強制規則，LLM 仍可能在 extract location text 時因缺乏信心而選擇 `clarify`。

2. **CoercePlan 無後補邏輯**：`coercePlan()` 中 `answerMode === "weather" && !weather?.location.trim()` 的檢查只防禦「weather 模式但無 location」的情況，不防禦「有提取出 location 但 Planner 選擇了 clarify」的情況。

3. **尚無 bounded extraction retry**：`shouldRetryWeatherPlannerExtraction()` 和 `applyWeatherPlannerExtractionRetry()` 已實作 bounded extraction retry，但其觸發條件目前只覆蓋 `missingWeatherLocationPlan` 和 `clarify` 搭配 `missingWeatherLocation` clarification 文字的情況。實際問題是 Planner 可能回傳 `answerMode: "clarify"` 搭配自訂 clarification 文字（非固定 `missingWeatherLocation`），而 `routeAfterPlan` 只檢查 `plan.answerMode === "clarify"`，會直接合成。

### 問題所屬層級

```
Backend Intent / Planner / Structured Output  ← Planner 過早放棄
Backend LangGraph State / Node / Edge         ← routeAfterPlan 無 weather recovery 路由
```

## 解決方案總覽

本 Change 不會重寫 MainPlanner、不會引入第二個 LLM Call 的強制執行、不會建立固定地名白名單。核心策略分三層：

1. **Planner Gate**：在 `coercePlan` 階段，當 Planner 回傳 `clarify` 但 deterministic routing policy（`createPlannerFailureRoutingDecision`）判定為 weather intent，且使用者原始輸入中存在可追溯地點文字時，觸發 **bounded weather extraction** — 一個僅允許 `weather.location` 保留原始文字的 LLM 呼叫。
2. **Bounded Extraction**：只問「使用者是否提供地點？如果是，請保留原始文字」，不做地理判斷、不翻譯、不捏造座標。每個 Graph Run 最多一次。
3. **queryName 降級為 Fallback Hint**：保留現有 `queryName` 欄位與傳遞，但其語意從「Planner 提供 geocoding-friendly 拉丁名稱」降級為「Resolver 在原始 location 查詢失敗後的 fallback query variant」，不得覆蓋 `requestedLocation.raw`。

## Goals

1. 使用者已提供可追溯地點文字的天氣請求 → Planner 必須輸出具 `weather.location` 的 Plan → `routeAfterPlan` 路由至 `targeted_tools` → Weather Tool 執行 → Open-Meteo Resolver 判斷 resolved / ambiguous / not_found。
2. 不增加第二次 LLM Call 在正常路徑（Planner 已正確回傳 weather + location 時）。
3. Bounded extraction 只在不確定時觸發（Planner 回傳 clarify 但天氣意圖已由 deterministic policy 確認）。
4. Bounded extraction 保留原始地點文字，不做地理判斷。
5. 地點歧義責任歸屬：Planner 判斷**是否**有地點，Provider/Resolver 判斷**哪個**地點。
6. Resolver 回傳 ambiguous 後才進入既有 clarification interrupt。
7. 無地點（「明天會下雨嗎」）→ 維持 clarify。
8. 非天氣意圖（「介紹大寮的歷史」）→ 不觸發 weather recovery。

## Non-Goals

- 不引入 Mapbox 或其他付費 Geocoding Provider。
- 不引入 `PlanningResultV2`、不做 Checkpoint Migration、不做 Temporary Projection。
- 不重構為 ReAct / ToolNode pattern。
- 不重寫 Frontend Weather UI。
- 不建立城市翻譯表。
- 不寫死「大寮」或任何特定地名。
- 不增加固定地名白名單。
- 不使用 Keyword Stripping／Regex 解析地點。
- 不修改已 archive 的 `weather-clarification-workflow`、`weather-golden-eval`、`weather-forecast-capability`。
- 不修改 `current_weather` 或 `weather_forecast` tool schema（唯 `queryName` 語意降級為文件級變更）。

## 受影響套件與能力域

- **backend**：`planResearch` node（Planner Prompt + `coercePlan` + `applyWeatherPlannerExtractionRetry`）、`agent-routing-policy.ts`（fallback 中的 weather intent detection）、`routeAfterPlan`、`deep-researcher.ts`（新增 bounded extraction 條件邏輯）。
- **docs/agent-rules/weather.md**：更新 `queryName` 語意（從 Planner hint 降級為 fallback query variant）、新增 Planner Gate 說明。
- 不影響 frontend、bff。

## 風險與緩解

| 風險 | 緩解 |
|---|---|
| Bounded extraction 增加一次 LLM Call | 僅在 Planner 回傳 clarify 且 deterministic policy 判定 weather intent 時觸發；正常成功路徑不增加 |
| Bounded extraction prompt 可能仍不穩定 | Prompt 限制為「保留原始文字」、不判斷地理、不捏造座標；失敗時 fallback 回 clarify |
| queryName 語意變更影響既有 Resolver 行為 | 保留欄位與傳遞路徑；Resolver 不變更讀取順序（原始 location 優先於 queryName） |
| 「大寮」可能無法被 Open-Meteo 解析 | 由 Resolver 判斷 not_found 或 ambiguous，進入既有 LLM repair → clarification 流程；非本 Change 責任 |

## 回滾策略

1. 移除 `shouldRetryWeatherPlannerExtraction` 中的新條件。
2. 恢復 `coercePlan` 原始邏輯（不呼叫 bounded extraction 前檢查）。
3. 恢復 `queryName` prompt 原始語意。
4. 不影響既有 checkpoint 相容性。

## 驗收條件

- 「大寮天氣」→ 進入 targeted_tools → Weather Tool 被呼叫。
- 「高雄大寮今天會下雨嗎」→ 不增加 LLM Call（Planner 已回傳 weather + location）。
- 「明天會下雨嗎」（無地點）→ 維持 clarify。
- 「介紹一下大寮的歷史」→ 不觸發 weather recovery。
- Provider ambiguity 發生於 Weather Tool 執行後（非 Planner 層）。
- Weather Tool invocation count 可被測試斷言。
- `query.location` 優先於 `queryName`。
- 既有 Golden Eval、mock smoke、unit test 全部維持 passing（無回歸）。
- `openspec validate fix-weather-planner-premature-clarification --strict` passes。
