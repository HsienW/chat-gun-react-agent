# Design：Weather Planner Gate 與 Bounded Extraction

## 1. 責任邊界

### 現有責任分配（Phase 2–3）

```text
使用者輸入
  → MainPlanner (planResearch): 意圖分類 + 地點抽取 + answerMode
  → coercePlan: Runtime Validation + 正規化
  → applyWeatherPlannerExtractionRetry: Bounded extraction retry（已存在但觸發條件不足）
  → routeAfterPlan: 根據 answerMode 路由
  → targetedTools: 調用 weather tool
  → Resolver (Open-Meteo Geocoding): 地理實體解析 → resolved / ambiguous / not_found
  → clarifyInterrupt (Phase 3): 歧義候選澄清
```

### 本 Change 調整後的責任邊界

```text
使用者輸入
  → MainPlanner: 意圖分類 + 地點抽取 + answerMode
  → coercePlan: Runtime Validation + 正規化
  → 【NEW】Planner Gate: 當 Plan 為 clarify 但 weather intent detected + 有地點 → 觸發 bounded extraction
  → Bounded Extraction: 只問「使用者是否提供地點？」→ 保留原始文字 → answerMode=weather
  → routeAfterPlan: 根據 plan.answerMode 路由（無變更）
  → targetedTools: 調用 weather tool（無變更）
  → Resolver: 地理實體解析（無變更）
  → clarifyInterrupt: 歧義候選澄清（無變更）
```

## 2. Planner Gate 設計

### 2.1 觸發條件（所有條件必須同時滿足）

1. `plan.answerMode === "clarify"` — Planner 產出 clarify。
2. `createPlannerFailureRoutingDecision(question).answerMode !== "clarify"` — Deterministic routing 判定為 weather 或 research（非 clarify），表示關鍵詞匹配顯示這可能是天氣意圖。
3. 使用者原始輸入（`getLatestUserMessage`）包含非純空白文字 — 存在可能的地點文字。
4. 本 Graph Run 尚未執行過 bounded extraction（`config.configurable._weatherExtractionAttempted !== true`）— 每個 Run 最多一次。

### 2.2 觸發條件程式碼位置

`planResearch` node 內，`coercePlan` 之後、`applyWeatherPlannerExtractionRetry` 之前。現有函數 `shouldRetryWeatherPlannerExtraction()` 擴充條件，或新增專用 gate 函數。

### 2.3 不觸發的條件

- Planner 已回傳 `answerMode: "weather"`（正常路徑，不增加 LLM Call）。
- Planner 回傳 `answerMode: "direct" | "calculation" | "research"`（非天氣意圖，不觸發）。
- `createPlannerFailureRoutingDecision` 也判定為 `clarify`（天氣關鍵詞不存在，可能真的是非天氣請求）。

## 3. Bounded Extraction 設計

### 3.1 與現有 `retryWeatherPlannerExtraction` 的關係

現有 `retryWeatherPlannerExtraction()`（line 1059–1119 of `deep-researcher.ts`）已實作 bounded extraction 的核心邏輯。本 Change 僅擴充其**觸發條件**（`shouldRetryWeatherPlannerExtraction`），不修改 extraction prompt 本身。

現有 prompt 已經符合 bounded extraction 要求：
- 「Do not strip weather words, time words, particles, or punctuation to guess a location.」
- 「If the current request asks for weather and includes a location, return answerMode weather with weather.location.」
- 「If no location is provided, return answerMode clarify with a short clarification.」
- 「Do not invent coordinates.」

### 3.2 新增觸發條件

在 `shouldRetryWeatherPlannerExtraction()` 中新增條件：

```typescript
function shouldRetryWeatherPlannerExtraction(
  rawPlan: Partial<ResearchPlan> | undefined,
  plan: ResearchPlan,
  question: string
): boolean {
  // 既有條件：missingWeatherLocationPlan
  // 既有條件：plannerReturnedWeatherWithoutLocation
  // ...

  // 新增條件：Plan 為 clarify，但詞彙路由判定有 weather intent
  if (
    plan.answerMode === "clarify" &&
    plan.clarification !== BACKEND_ERROR_MESSAGES.planner.missingWeatherLocation
  ) {
    const fallbackDecision = createPlannerFailureRoutingDecision(question);
    if (fallbackDecision.answerMode !== "clarify") {
      // Deterministic policy says this is weather or research — try extraction
      return true;
    }
  }

  return false;
}
```

### 3.3 Run-level Guard

每個 Graph Run 最多觸發一次 bounded extraction。透過 `config.configurable` 中的 flag 控制：

```typescript
// 在 applyWeatherPlannerExtractionRetry 中
if (config?.configurable) {
  (config.configurable as Record<string, unknown>)._weatherExtractionAttempted = true;
}
```

`shouldRetryWeatherPlannerExtraction` 在 flag 已設定時 return false。

### 3.4 失敗時的 Fallback

Bounded extraction 回傳 `undefined`（LLM 失敗或無法判定）時，維持原 clarify plan，不進入 targeted_tools。這確保無地點請求（「明天會下雨嗎」）仍正確 clarify。

## 4. queryName 語意降級

### 現有語意

MainPlanner prompt 說明：「add weather.queryName only when you know a geocoding-friendly Latin name」。

### 調整後的語意

Planner 仍可產生 `queryName`，但：
1. `queryName` 的語意從「Planner 提供的 geocoding-friendly 拉丁名稱」降級為「Resolver 在原始 location 查詢失敗後的 fallback query variant」。
2. Resolver 必須先嘗試 `requestedLocation.location`（原始地點文字），再嘗試 `queryName`。
3. Resolver 不得以 `queryName` 覆蓋 `requestedLocation.raw`。
4. 現有 Resolver 程式碼（`resolveLocation` in `location-resolver.ts`）已支援 `queryName` 作為 query variant 並在 `original` strategy 後嘗試 — 行為不需變更。

### 文件層變更

- `docs/agent-rules/weather.md`：更新 `queryName` 定義。
- MainPlanner prompt：將 `queryName` 的描述從「when you know a geocoding-friendly Latin name」改為「when you know a geocoding-friendly Latin name that may help if the original location is not found」。
- Bounded extraction prompt：不產生 `queryName`（因其目標是盡量保留原始文字）。

## 5. routeAfterPlan 無變更

`routeAfterPlan` 行為不變：

```typescript
function routeAfterPlan(state: typeof DeepResearchState.State): string {
  switch (state.plan?.answerMode) {
    case "clarify":
      return DEEP_RESEARCH_GRAPH_ROUTES.synthesize;
    case "weather":
    case "calculation":
      return DEEP_RESEARCH_GRAPH_ROUTES.targetedTools;
    // ...
  }
}
```

Planner Gate 的責任是在 `routeAfterPlan` 之前確保 `plan.answerMode` 已被正確設為 `"weather"`。若 Bounded extraction 成功，`plan.answerMode` 會被重設為 `"weather"`，`routeAfterPlan` 會自然路由至 `targetedTools`。

## 6. coercePlan 調整

`coercePlan` 中有一個防禦檢查：

```typescript
if (answerMode === "weather" && !weather?.location.trim()) {
  return missingWeatherLocationPlan(...);
}
```

此檢查在 Planner 回傳 `answerMode: "weather"` 但 `weather.location` 為空時觸發。此行為保留不變，因為 Bounded extraction 發生在 `coercePlan` **之後**（在 `applyWeatherPlannerExtractionRetry` 中）。

## 7. 資料流圖

```text
planResearch:
  1. MainPlanner LLM Call → rawPlan
  2. coercePlan(rawPlan) → plan
  3. shouldRetryWeatherPlannerExtraction(rawPlan, plan, question)
     ├── false → return plan as-is
     └── true  → retryWeatherPlannerExtraction(question, state)
                 ├── success (weather + location) → plan = weather plan
                 └── fail → plan = missingWeatherLocationPlan (clarify)
  4. return { plan }

routeAfterPlan(state):
  plan.answerMode === "weather" → targetedTools  ← Planner Gate 確保此路徑
  plan.answerMode === "clarify" → synthesizeAnswer
```

## 8. 替代方案評估

| 方案 | 優點 | 缺點 | 決定 |
|---|---|---|---|
| 修改 MainPlanner prompt 增加強制性 | 無需新增 LLM Call | 無法完全消除 LLM 不穩定性；prompt 膨脹 | 不採用（但可做為輔助） |
| 在 `routeAfterPlan` 中新增 recovery routing | 最簡單 | 無法取得 location；需在 targetedTools 中呼叫 extraction | 不採用（責任漂移到 routing） |
| Bounded extraction in Plan Gate | 只在必要時新增 LLM Call；保留原始文字；責任清楚 | 增加一次 LLM Call | **採用** |
| 強制所有 weather keyword match 都進 targeted_tools | 零 LLM 成本 | 無法處理無地點的請求（「明天會下雨嗎」會進 tool 然後失敗） | 不採用 |

## 9. 安全與相容性

- **Checkpoint 相容**：`plan` 欄位結構不變（`ResearchPlan`）；`weatherExecution` 不變。
- **Event 相容**：無新 event type。
- **Tool Schema 相容**：`current_weather` 和 `weather_forecast` schema 不變。
- **BFF 相容**：無 BFF 變更。
- **Frontend 相容**：無 Frontend 變更。
- **LLM 成本**：僅在 Planner 回傳 clarify 且關鍵詞路由判定為 weather 時增加一次 extraction LLM Call。正常路徑零成本增加。
