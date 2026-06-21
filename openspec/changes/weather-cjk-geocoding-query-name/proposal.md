# Proposal：CJK 地名轉寫支援

## Intent

`generalize-weather-location-resolution` change 建立了 Provider-driven 的地點解析 pipeline（LocationResolver、WeatherToolResult Discriminated Union、Frontend WeatherToolResultCard），但 2026-06-21 live smoke 證實 **Open-Meteo Geocoding API 不支援 CJK 字元查詢**。`台北`、`臺北`、`北京市`、`高雄鳳山` 等純中文地名全部回傳 `not_found`。拉丁/Unicode 地名（Tokyo、São Paulo、München）正常。

本 Change 的唯一目標：在不可替換 Open-Meteo Provider 的前提下，讓 CJK 地名能正確解析為地理實體。策略是讓 **Planner LLM 在抽取天氣意圖時，同時產出 geocoding-friendly 的 Latin 查詢字串（`queryName`）**，協助 Provider 跨越 CJK 文字索引障礙。

所有舊 change 已驗證的資產（Resolver pipeline、WeatherToolResult schema、Frontend card、mock smoke test、live smoke harness）全部繼承，不重做、不重構、不降級。

---

## Goals

1. Planner `weather.location` 保留使用者原文（中文、英文、混合語言），行為不變。
2. Planner 新增可選的 `weather.queryName` 欄位，承載 geocoding-friendly Latin 地名。
3. `current_weather` Tool input schema 新增可選的 `queryName` 參數。
4. `buildQueryVariants` 在 `queryName` 存在且與 `location` 不同時，將 `queryName` 作為第一優先查詢變體；`location`（原文）仍保留為 fallback。
5. `raw` 永遠保留使用者原始地點文字；`queryName` 不得覆蓋 `raw` 或 `location`。
6. 系統不得以固定城市 mapping、CJK phrase stripping、keyword regex 或固定詞表取代 Planner 的語意轉寫判斷。
7. 所有既有拉丁/Unicode 測試繼續通過（不回歸）。
8. CJK 地名 live smoke（台北、臺北、高雄鳳山、北京市）從 `not_found` 轉為 `success`。
9. 不替換 Geocoding Provider，不新增 Provider Adapter，不修改 Resolver 核心邏輯。
10. 不改變 Graph ID、Tool Name、BFF Route、Frontend API URL。
11. 不重新打開或修改已封存的 `generalize-weather-location-resolution` change。

---

## Non-goals

- 不建立人工 CJK→Latin 城市對照表。
- 不引入第二個 Geocoding Provider。
- 不將 CJK→Latin 轉寫邏輯寫死在 normalizer 或 resolver 中。
- 不修改 WeatherToolResult schema version（仍為 `1.0`）。
- 不修改 Frontend WeatherToolResultCard（`queryName` 不出現在 UI）。
- 不修改 BFF Proxy 行為。
- 不處理 weather advice、forecast、historical weather 能力缺口。
- 不以 keyword regex、phrase stripping、固定詞表或城市白名單作為主要解析策略。

---

## Scope

### Backend

- **Planner Prompt**：在 weather extraction 時額外產出 `queryName`（geocoding-friendly Latin name）。
- **Planner Schema**：`weather.queryName` 為 optional string。
- **Tool Schema**：`current_weather` input 新增 optional `queryName`。
- **Query Variant**：`buildQueryVariants` 在 `queryName` 存在且與 `location` 不同時，插入為第一優先變體；保留去重。
- **Runtime Validation**：Planner 產出的 `queryName` 經 Schema validation；不繞過 Provider 驗證。
- **Feature Flag**：`WEATHER_PLANNER_QUERY_NAME_ENABLED`（預設 `true`），關閉時 Planner 不產出 `queryName`。
- **Tests**：mock smoke + live smoke 覆蓋 CJK 案例；既有拉丁案例不回歸。

### Frontend

- 不修改。`queryName` 不出現在 UI；`raw` / `location` 保留原文供顯示。

### BFF

- 不修改。

---

## Affected capabilities

- `tool-execution`
- `agent-runtime`

---

## Approach

```
使用者輸入：「台北現在幾度？」
  ↓
Planner 抽取:
  location: "台北"           ← 保留原文 (不變)
  queryName: "Taipei"        ← 新增，geocoding-friendly Latin
  country: undefined
  ↓
current_weather Tool input:
  { location: "台北", queryName: "Taipei" }
  ↓
buildQueryVariants with queryName:
  1. "Taipei"                ← queryName 優先
  2. "台北"                  ← location fallback
  3. "Taipei [language=en]"
  4. "台北 [language=zh]"
  5. ... (其他組合)
  ↓
Open-Meteo Geocoding: "Taipei" → 命中 TW → resolved
  ↓
WeatherToolResult:
  status: "success"
  requestedLocation: { raw: "台北", location: "台北" }
  resolvedLocation: { name: "Taipei", countryCode: "TW", ... }
```

關鍵設計原則：

1. **Planner 負責語意轉寫，Resolver 負責地理事實驗證。** Planner 提供 `queryName`，Resolver 拿它去 Provider 驗證。如果 Planner 轉錯了（例如 `台北` → `Taipei, Japan`），Provider 不匹配，Resolver 回 `not_found`，由 LLM Repair 修正。
2. **`queryName` 是查詢加速器，不是權威來源。** 沒有 `queryName` 時行為完全向後相容；有 `queryName` 時只是查詢變體順序更優。Provider 回傳的候選仍是唯一地理事實來源。
3. **原始文字永不丟失。** `raw` 和 `location` 永遠保留使用者原文；`queryName` 只出現在 Tool input 和 Audit log。

---

## Risks

### Planner 轉寫錯誤

模型可能把 `高雄鳳山` 轉成拼音 `Gaoxiong Fengshan`（Provider 不認得）而非 `Kaohsiung Fengshan`。

緩解：Resolver 仍是終判；錯誤的 `queryName` 會 fallback 到原文查詢或觸發 LLM Repair。不因 `queryName` 存在而繞過 Provider 驗證。

### queryName 與 location 相同時的冗余

英文輸入（`Tokyo`）時 Planner 可能產出 `queryName: "Tokyo"` 與 `location: "Tokyo"` 相同。

緩解：`buildQueryVariants` 去重邏輯已存在，不會重複查詢。

---

## Rollback strategy

- `queryName` 是 optional 欄位。若 Planner 不產出，行為等價現狀。
- 可透過 `WEATHER_PLANNER_QUERY_NAME_ENABLED=false` 關閉 Planner `queryName` 產出。
- 關閉後，Tool 仍接受 `queryName` 參數（no-op），不破壞向後相容。

---

## Success criteria

1. `台北` 透過 `queryName: "Taipei"` 或等價 Latin query 解析成功。
2. `臺北` 與 `台北` 解析至相同地理實體（Taipei, TW）。
3. `高雄鳳山` 解析成功或合理要求補充。
4. `北京市` 解析成功。
5. 拉丁地名不回歸：Tokyo、Singapore、São Paulo、München 仍正常。
6. `Springfield` 仍回傳歧義候選，不自動選擇。
7. 不存在地點仍回傳 `not_found`，不捏造座標。
8. 不新增固定 CJK 城市 mapping 或 phrase stripping。
9. Backend lint/test/build 全通過。
10. Frontend lint/test/build 全通過（即使 frontend 未修改）。
