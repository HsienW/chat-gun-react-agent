# Design：Weather Plan Consistency Gate

## 架構決策

### ADR-001：Consistency Gate 位置

**決策**：在 `coercePlan` 函式內部、現有「`answerMode=weather` 但無 location」守衛之後，新增 Consistency Gate。

**替代方案與捨棄理由**：

| 方案 | 位置 | 取捨 |
|------|------|------|
| A. 在 `coercePlan` 內新增 gate（**採用**） | `coercePlan` return 前 | 單一事實來源，所有 call site 自動受惠；`planResearch`、`resumeClarify`、`fallbackPlan` 全部覆蓋 |
| B. 在 `routeAfterPlan` 前新增 gate | `planResearch` return 前 | 只覆蓋 Main Planner 路徑；`resumeClarify` 重建 plan 的路徑需另外處理 |
| C. 修改 `routeAfterPlan` 條件 | 路由函式內 | 破壞 routing 語意純度；`weatherExecution` state 檢查仍會跳過 |
| D. 在 Planner prompt 修正 | prompt 文字 | 不可靠，LLM 仍可能產生矛盾輸出；增加 token 成本 |

**選擇方案 A 的理由**：
1. `coercePlan` 已是所有 Plan 的單一正規化入口
2. 純函式，不增加 LLM Call
3. 所有 plan 產生路徑（Main Planner、fallback、bounded extraction、resumeClarify）都自動受此 gate 保護
4. 最小 diff surface

### ADR-002：Gate 觸發條件

**決策**：只正規化「`answerMode=clarify` + 合法 `weather.location`」的矛盾組合。不擴大正規化其他 answerMode 組合。

**觸發條件（全部必須成立）**：
1. `rawAnswerMode === "clarify"`（Planner 選擇的路由）
2. `weather` 不為 `undefined`（`coerceWeatherRequest` 已通過）
3. `weather.location` 為非空有效字串

**不觸發的情況**：
- `answerMode=weather` + 無 `weather.location` → 現有 `missingWeatherLocationPlan` 守衛處理
- `answerMode=direct` + 有 `weather` → 不處理（非矛盾，Planner 正確判斷非天氣）
- `answerMode=research` + 有 `weather` → 不處理（非矛盾，Planner 正確判斷需要研究）

### ADR-003：Interaction with Bounded Extraction

**現有行為**：`shouldRetryWeatherPlannerExtraction`（line 986-1007）在 Planner 輸出缺 location 時觸發 bounded extraction。

**Consistency Gate 與 Bounded Extraction 的互動**：

```text
Main Planner 輸出 → coercePlan
  ├─ answerMode=weather, 有 location → 直接進入 targeted_tools（現有）
  ├─ answerMode=weather, 無 location → missingWeatherLocationPlan
  │     └─ shouldRetryWeatherPlannerExtraction → bounded extraction（現有）
  ├─ answerMode=clarify, 有 location → **Consistency Gate → answerMode=weather**（新增）
  │     └─ 進入 targeted_tools
  └─ answerMode=clarify, 無 location → 保持 clarify
        └─ shouldRetryWeatherPlannerExtraction 檢查 → bounded extraction（現有）
```

Consistency Gate 在 bounded extraction 之前執行，因此：
- Case A（矛盾 Plan + 有 location）：Gate 先正規化，不觸發 bounded extraction
- Case B（Planner 提前 clarify + 無 location）：Gate 不觸發，然後 `shouldRetryWeatherPlannerExtraction` 觸發 bounded extraction

**`resumeClarify` 路徑交互分析**：`resumeClarify` 會在 `select_candidate`、`filter_candidates`（單一 match）、`new_location` 三種解析成功路徑中透過 `buildPlanFromClarificationCandidate` 或 inline literal 重建 `plan`，且總是設定 `answerMode: "weather"`（line 1742、1909、1913）。唯一的 `answerMode: "clarify"` 路徑是 `resumeClarify` 的 `unrecognized` 分支（line 1928-1940），此時 `plan` 保持 `state.plan`（不變），若原 plan 已是 weather 則仍是 weather，不會產生 `clarify + valid weather.location` 的矛盾組合。因此 Consistency Gate 對 `resumeClarify` 路徑為 no-op。

### ADR-004：不預設修改 queryName

本次 Change 不預設修改 `queryName` 查詢順序或 Resolver ordering。只有在 Phase 3 Live Smoke 證據證明 `queryName` 優先導致錯誤匹配時，才在本 Change 追加受控的 `queryName` fallback task。

### ADR-005：Provider Capability-Aware JSON Planning

**Live finding**：Configured runtime 使用 CCR `anthropic-messages` endpoint，其
`supportsStructuredOutput` capability 為 `false`。原實作仍對 Main Planner、
bounded extraction、weather repair 與 clarification resolution 傳入
`responseFormat: { type: "json_object" }`，導致 `CcrGateway` 在送出 request 前
fail fast，所有 Planner 路徑降級為 missing-location clarification。

**決策**：

1. `llm-gateway` 提供 provider-agnostic capability accessor。
2. Deep Researcher 的 JSON 型 LLM 路徑共用單一 model factory。
3. Provider 支援 native structured output 時保留 `responseFormat`。
4. Provider 不支援時省略 native `responseFormat`，但仍由 Prompt 要求 JSON，
   並使用既有 parser、Runtime Validation 與 coercion。
5. `CcrGateway` 直接收到 unsupported `responseFormat` 時仍維持 fail-fast，
   不假裝 Anthropic endpoint 支援不存在的能力。

此決策不依 provider 名稱分支，不改 Domain Schema，也不降低 Runtime Validation。

### ADR-006：queryName 不得繞過同國行政區歧義

**Live finding**：`大寮 + queryName=Daliao + country=TW` 會取得多個 Open-Meteo
候選，分屬 New Taipei、Miaoli、Chiayi、Tainan 與 Kaohsiung。原 Resolver 將
country 視為足夠 context，並因 queryName候選而跳過 short-CJK ambiguity guard，
造成錯誤自動選擇 New Taipei。

**決策**：當 top candidates 分數接近、country相同、行政區不同，且 query沒有
region時，Resolver MUST 回傳 `ambiguous`。queryName只負責橋接 provider查詢，
不得成為信任第一候選的依據。已有 region或僅有一個候選時維持既有解析行為。

## 資料流

### 修改前（Bug 路徑）

```text
使用者："高雄大寮今天會下雨嗎"
  → Main Planner
  → {"answerMode":"clarify","weather":{"location":"高雄大寮"},"clarification":"..."}
  → coercePlan: answerMode="clarify"（保持），weather 保留但不使用
  → routeAfterPlan: "clarify" → synthesize
  → synthesizeAnswer: clarification text
  → 使用者看到澄清文字（Bug：Weather Tool 未執行）
```

### 修改後（修正路徑）

```text
使用者："高雄大寮今天會下雨嗎"
  → Main Planner
  → {"answerMode":"clarify","weather":{"location":"高雄大寮"},"clarification":"..."}
  → coercePlan: answerMode="clarify" + 合法 weather.location
    → **Consistency Gate: answerMode="weather"**
  → routeAfterPlan: "weather" → targeted_tools
  → targeted_tools: invoke current_weather
  → Weather Tool 執行成功或進入 LLM Repair
  → synthesizeAnswer: 天氣結果
  → 使用者看到天氣資料（修正）
```

## 實作細節

### 新增純函式

```typescript
/**
 * Weather Plan Consistency Gate
 *
 * When the Planner produces a contradictory output where answerMode is "clarify"
 * but weather.location is present and valid, the gate deterministically normalizes
 * answerMode to "weather" so the request reaches targeted_tools → WeatherTool.
 *
 * This is a pure function — no LLM calls, no side effects.
 */
function normalizeWeatherPlanConsistency(
  answerMode: AnswerMode,
  weather: WeatherRequest | undefined
): {
  answerMode: AnswerMode;
  weather: WeatherRequest | undefined;
  /** true when the gate changed answerMode from "clarify" to "weather" */
  gateActivated: boolean;
} {
  if (
    answerMode === "clarify" &&
    weather !== undefined &&
    weather.location.trim().length > 0
  ) {
    return { answerMode: "weather", weather, gateActivated: true };
  }
  return { answerMode, weather, gateActivated: false };
}
```

### 整合點

在 `coercePlan` 函式中，於 `coerceWeatherRequest` 之後、`missingWeatherLocationPlan` 守衛之前，呼叫 `normalizeWeatherPlanConsistency`。因為 Gate 改變 `answerMode` 時需連帶清除 `clarification`，整合邏輯如下：

```typescript
function coercePlan(rawPlan, question, state): ResearchPlan {
  // ... existing code ...
  const weather = coerceWeatherRequest(rawPlan?.weather);
  const calculation = /* ... existing ... */;
  let clarification = /* ... existing extraction ... */;
  let rawAnswerMode = /* ... existing extraction ... */;

  // NEW: Weather Plan Consistency Gate
  const normalized = normalizeWeatherPlanConsistency(rawAnswerMode, weather);
  const answerMode = modes.includes(normalized.answerMode)
    ? normalized.answerMode
    : fallback.answerMode;

  // When the gate activates, discard the stale clarification text
  if (normalized.gateActivated) {
    clarification = undefined;
  }

  // existing guard: answerMode === "weather" && !weather?.location.trim()
  // ... rest unchanged ...
}
```

**Why `clarification` must be cleared**: `coercePlan` 在 line 489-490 獨立提取 `clarification` 變數，並在 line 527 將其放入最終 `ResearchPlan`。若只改變 `answerMode` 而不清除 `clarification`，最終 `plan` 會同時有 `answerMode: "weather"` 和 Planner 的原始澄清文字。雖然 `routeAfterPlan` 和 `targetedTools` 不看 `clarification`，但 `synthesizeAnswer` 的 `plan.answerMode === "clarify"` 分支（line 2471-2476）不會被觸發，而 `buildTargetedToolAnswer`（line 2399-2412）也不會使用 `clarification`。然而，保留殘留 `clarification` 違反 Spec 的明確要求，且在未來 code 演進中可能成為隱患。
```

## 責任邊界

```
完全沒有地點
  → Planner clarification（不變）

Planner 矛盾（有 location 但 clarify）
  → Consistency Gate → targeted_tools（新增）

有地點但 Provider 候選歧義
  → Weather Tool → Resolver → needs_clarification interrupt（不變）

Planner 提前 clarify 且無 location
  → bounded extraction（現有，補 regression test）
```

## 替代方案分析

| 方案 | 優點 | 缺點 |
|------|------|------|
| Consistency Gate（採用） | 純函式、零 LLM Call、最小 diff | 不處理「Planner 根本沒輸出 weather 欄位」的情況（那應由 bounded extraction 處理） |
| 修改 Planner prompt 禁止 clarify+weather | 從源頭解決 | LLM 不可靠；prompt-only 方案無法保證矛盾不出現 |
| 在 routeAfterPlan 檢查 weather.location | 不改變 plan 內容 | 只覆蓋一條路徑；`targetedTools` 內部仍檢查 `plan.answerMode === "weather"` |
| 完全重構 answerMode/weather 為 discriminated union | 型別安全 | 超出本 Change 範圍；破壞性變更 |
