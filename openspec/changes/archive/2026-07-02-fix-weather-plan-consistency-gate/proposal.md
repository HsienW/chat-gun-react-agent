# Proposal：修復 Weather Plan 一致性 Gate

## 問題描述

當使用者輸入中文地點天氣問題（例如「高雄大寮今天會下雨嗎」），Main Planner 可能產生以下矛盾輸出：

```json
{
  "answerMode": "clarify",
  "weather": { "location": "高雄大寮" },
  "clarification": "請提供更具體的位置"
}
```

目前 `routeAfterPlan` 只根據 `answerMode` 路由：
- `answerMode === "clarify"` → `synthesize`（跳過 `targeted_tools`）
- `answerMode === "weather"` → `targeted_tools`

結果：雖然 Planner 已經成功提取了 `weather.location`，但因為 `answerMode` 被設為 `clarify`，Graph 未進入 `targeted_tools`，Weather Tool 未被執行，使用者看到的是 Planner 的澄清文字而非天氣結果。

## 根因分析

`coercePlan`（`deep-researcher.ts` line 477-530）目前只有一個 weather 相關的守衛：

```typescript
if (answerMode === "weather" && !weather?.location.trim()) {
  return missingWeatherLocationPlan(...)
}
```

這個守衛只處理「`answerMode=weather` 但缺少 location」的情況，沒有處理「`answerMode=clarify` 但已有有效 `weather.location`」的矛盾。

`shouldRetryWeatherPlannerExtraction` 觸發條件也限於「缺少 location 或 clarification 文案正好是 missing-weather-location 字串」，不覆蓋 Planner 自己在有 location 時提前 clarify 的情況。

## 解決方案

### Phase 1：Weather Plan Consistency Gate（純函式正規化）

在 `coercePlan` 或 `routeAfterPlan` 之前新增一個純函式正規化步驟：

當以下條件同時成立：
1. `rawPlan.answerMode === "clarify"`
2. `weather` 通過既有 `coerceWeatherRequest` Runtime Validation
3. `weather.location` 為非空有效字串

則 deterministically 正規化為：
- `answerMode = "weather"`
- `clarification = undefined`

此 Fast Path 不增加任何 LLM Call，不引入新的 Prompt 或模型推論。

### Phase 2：補齊既有 Bounded Extraction 驗證

驗證 Case B（`answerMode=clarify`、無有效 `weather.location`、但 deterministic policy 判定為 Weather Intent）是否已被既有 `retryWeatherPlannerExtraction` 覆蓋。若已覆蓋，只補 regression tests，不修改 production code。

### Phase 3：保持 Clarification 責任邊界

- 完全無地點 → Planner clarification（現有行為，不變）
- 有地點但 Provider 候選歧義 → Weather Tool → Resolver → `needs_clarification` interrupt（現有行為，不變）
- Planner 不負責判斷地名是否唯一或是否為真實行政區

## 受影響套件與能力域

| 套件 | 影響 |
|------|------|
| `backend` | `deep-researcher.ts` — `coercePlan` 或 `routeAfterPlan` 前新增一致性 gate |
| `backend` | `deep-researcher.weather.test.ts` — 新增 Case A～E integration tests |
| `backend` | `deep-researcher.query-workflow.test.ts` — 驗證 routing contract 保持不變 |

## 目標與非目標

### 目標
- 合法 `weather.location` 不再因 `answerMode=clarify` 繞過 Weather Tool
- Fast Path 不增加 LLM Call
- 缺少 location 的 Weather Intent 最多執行一次既有 bounded extraction
- 有地點的天氣請求最終進入 `targeted_tools`
- Weather Tool invocation count 有 integration test 證據

### 非目標（本次明確排除）
- 不引入 Mapbox 或其他 Geocoding Provider
- 不新增 API Key
- 不建立 ProviderFactory
- 不引入 `PlanningResultV2`
- 不重構 ReAct／ToolNode
- 不遷移 Checkpoint
- 不引入 Temporary Projection
- 不建立六態 Resolver 重構
- 不建立 Frontend v2
- 不引入固定城市映射或地名白名單
- 不引入 Regex／Keyword Stripping 地名解析
- 不新增 Weather Intent 關鍵字清單
- 不預設修改 `queryName` 查詢順序

## 風險與回滾策略

- **風險**：正規化後 `weather.location` 可能實際上是無效地名（但 Planner 標為 clarify），導致 Weather Tool 收到無法解析的 location
  - **緩解**：Weather Tool 現有 `not_found` + LLM Repair 流程已處理此情況；這不劣於目前直接跳過 Weather Tool 的行為
- **回滾**：Fast Path 為純函式，可直接移除呼叫或 revert commit，無資料遷移或狀態殘留

## Definition of Done
- 合法 `weather.location` 不再因 `answerMode=clarify` 繞過 Weather Tool
- Fast Path 不增加 LLM Call
- 缺少 location 的 Weather Intent 最多執行一次既有 bounded extraction
- 有地點的天氣請求最終進入 `targeted_tools`
- Weather Tool invocation count 有 integration test 證據
- 真正無地點時仍由 Planner clarification
- Provider ambiguity 仍由 Resolver／interrupt 處理
- 非 Weather Query 不誤觸發
- 無固定地名或地名解析特例
- 未引入 Mapbox 或任何新外部服務
- Backend tests、lint、build 與 OpenSpec validation 通過
