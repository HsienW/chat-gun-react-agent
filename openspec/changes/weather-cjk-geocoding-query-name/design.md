# Design：CJK 地名轉寫支援

## 1. Current Failure

### Open-Meteo CJK Input Limitation

Live smoke 2026-06-21 證實：`geocoding-api.open-meteo.com/v1/search` 的 `name` 參數只接受 Latin-script 文字。查詢 `台北`、`臺北`、`高雄鳳山`、`北京市` 全部回傳空 `results`。

- `?language=zh` 只控制回傳 metadata 語言（例如 `country: "中国"`），不影響輸入查詢的接受度。
- `?language=en` 同樣不影響輸入接受度。
- 既有 `buildQueryVariants` 的 `language=zh`/`language=en` 策略無法繞過此限制。

### Why This Was Not Caught Earlier

Mock smoke test 使用硬編碼的 `candidates[searchTerm]` lookup table（`backend/src/tools/weather.mock-smoke.test.ts:39-269`），其中台北、臺北、高雄鳳山、北京市 都預先映射了預期結果。Mock 宣稱成功，但真實 API 從不支援這些查詢。

### Provider Constraint

- 本 Change 不替換 Open-Meteo（已有 Rate Limit、資料格式、成本與穩定性的投資）。
- 不引入第二 Geocoding Provider（增加複雜度與不一致風險）。
- 因此必須在 Query 層解決 CJK→Latin 轉寫。

---

## 2. Target Flow

```text
使用者輸入：「台北現在幾度？」

Planner (plan_research Node):
  answerMode: "weather"
  weather:
    location: "台北"           ← 使用者原文，保留 (不變)
    queryName: "Taipei"        ← 新增，geocoding-friendly Latin
    country: undefined

current_weather Tool input:
  location: "台北"
  queryName: "Taipei"          ← 新增 optional 參數

buildQueryVariants (優先順序):
  1. "Taipei"                  ← queryName 優先 (strategy: "original")
  2. "台北"                    ← location fallback
  3. "Taipei [language=en]"
  4. "台北 [language=zh]"
  5. "台北 [language=en]"
  6. ... (去重後最多 6 個 variant)

Open-Meteo Geocoding:
  search("Taipei") → [Taipei, TW, ...] → resolved

WeatherToolResult:
  schemaVersion: "1.0"
  status: "success"
  requestedLocation: { raw: "台北", location: "台北" }
  resolvedLocation: { name: "Taipei", countryCode: "TW", ... }
  current: { ... }
```

---

## 3. Contract Decisions

### 3.1 Planner Owns Semantic Transliteration

Planner LLM 具備多語言理解能力，能將繁體/簡體中文地名語意轉寫為 Latin name，例如 `台北`→`Taipei`、`北京市`→`Beijing`、`高雄鳳山`→`Kaohsiung Fengshan`。混合中英文輸入（如 `台北101`）一併涵蓋。

範圍僅限繁體中文與簡體中文。日文（漢字/仮名）、韓文（Hangul）不在本次 scope，後續可擴張。

這不是固定 mapping，是 LLM 的語意理解能力。每次 Planner 調用都是獨立判斷，可涵蓋未見過的城市名稱。

Planner Prompt 指引：
- 保留使用者原文於 `location`。
- 若 `location` 為繁體中文、簡體中文，或含中文的混合輸入，且你知道對應的 geocoding-friendly Latin name，填入 `queryName`。
- 不確定時不填 `queryName`（讓 Resolver fallback）。
- 不為純英文/拉丁輸入填 `queryName`（減少冗余）。

### 3.2 Resolver Owns Provider-Backed Geographic Validation

Resolver 仍以 Provider 候選作為唯一地理事實來源。`queryName` 只是查詢變體的輸入，Provider 回傳結果後 Resolver 仍執行完整評分、去重、歧義判斷。

Planner 提供的 `queryName` 不等於已解析地點。Provider 回 `not_found` 時 `queryName` 的路徑和其他 variant 一樣會失敗。

### 3.3 queryName Is Optional

- Tool Schema 中 `queryName` 為 optional。不填時行為完全向後相容。
- 英文/拉丁輸入時 Planner 可不填 `queryName`。
- 不引入 Feature Flag — `queryName` 本身已是 optional 且完全向後相容，無需額外開關。若 Planner 大量 hallucinate 錯誤 `queryName`，可直接修改 Planner Prompt 移除 extraction instruction。

### 3.4 queryName Is Query Acceleration, Not Authority

`queryName` 的唯一作用是改善查詢變體順序。Resolved location 來自 Provider 候選，不是 `queryName` 的直接映射。

### 3.5 Raw CJK Input Is Preserved

`raw` 和 `location` 永遠保留使用者原始地點文字。`queryName` 出現在 Tool input、Audit log 和 Query Variant 中，但不出現在 User-facing UI（WeatherToolResultCard 顯示 `resolvedLocation.displayName`，來自 Provider）。

---

## 4. Schema Decisions

### 4.1 Planner Output Schema（修改）

現狀 (`deep-researcher.ts:1064` 的 JSON schema instruction)：
```json
{
  "answerMode": "weather",
  "weather": {
    "location": "string",
    "country": "string optional",
    "region": "string optional"
  }
}
```

新增：
```json
{
  "answerMode": "weather",
  "weather": {
    "location": "string",
    "queryName": "string optional",
    "country": "string optional",
    "region": "string optional"
  }
}
```

### 4.2 Tool Input Schema（修改）

現狀 (`weather.ts:670-688` 的 Zod schema)：
```ts
schema: z.object({
  location: z.string().min(1).describe("City or location name."),
  country: z.string().optional().describe("..."),
  region: z.string().optional().describe("..."),
  resolutionStrategy: z.enum(["llm_repair"]).optional().describe("..."),
  raw: z.string().optional().describe("..."),
})
```

新增：
```ts
queryName: z.string().optional().describe(
  "Geocoding-friendly Latin name, e.g. 'Taipei' for '台北'. " +
  "Callers should normally populate this only for CJK locations."
)
```

### 4.3 Query Variant Input（修改）

`buildGeocodingQueryVariants` 將新增 optional `queryName` 參數：

```ts
export function buildGeocodingQueryVariants(
  query: LocationQuery,
  maxVariants: number = 6,
  queryName?: string   // 新增
): GeocodingQueryVariant[]
```

當 `queryName` 存在且 `normalizeComparable(queryName) !== normalizeComparable(query.location)` 時，將 `queryName` 作為第一個 variant（`strategy: "original"`），原 `query.location` 退為第二 variant。

### 4.4 Audit Metadata

Resolve audit event 記錄 `queryName` 是否存在（不記錄完整字串，Debug 環境除外）。

---

## 5. Failure Handling

| Scenario | Planner Output | Resolver Behavior | Result Status |
|---|---|---|---|
| CJK with correct queryName | `location: 台北, queryName: Taipei` | "Taipei" matches → resolved | `success` |
| CJK with wrong queryName | `location: 台北, queryName: Taibei` | "Taibei" not found; fallback "台北" also not found → not_found | `not_found`, can trigger LLM Repair |
| CJK without queryName | `location: 台北, queryName: undefined` | "台北" not found → not_found | `not_found` (same as current behavior) |
| Ambiguous CJK (queryName alone insufficient) | `location: 中山, queryName: Zhongshan` | "Zhongshan" returns CN+TW candidates → ambiguous | `needs_clarification` |
| English (no queryName needed) | `location: Tokyo, queryName: undefined` | "Tokyo" matches → resolved | `success` |
| Provider error | any | Provider fetch fails | `error`, `provider_error` |
| User cancel | any | AbortSignal fires | `error`, `weather_cancelled` |

---

## 6. Compatibility

### Unchanged

- `WeatherToolResult` schemaVersion 仍為 `"1.0"`
- Tool Name: `current_weather`
- Graph ID: `deep_researcher`
- BFF Route: `/api/langgraph/*`
- Frontend API URL 生成方式
- Frontend WeatherToolResultCard（`queryName` 不出現在 UI）
- Existing mock smoke tests for Latin/Unicode cases

### Changed

- Planner Prompt: 新增 `queryName` extraction instruction
- Tool Input Schema: 新增 optional `queryName`
- Query Variant Builder: 接受 optional `queryName`，插入優先 variant
- No Feature Flag — `queryName` 已是 optional

### Migration

- 舊 Planner（不產出 `queryName`）：行為不變
- 舊 Tool Caller（不傳 `queryName`）：行為不變
- 新 Planner 產出 `queryName` 時無需 BFF/Frontend 配合

---

## 7. Anti-Hardcoding Guarantee

以下策略**不出現**在本 Change 中：

- ✗ 固定城市 CJK→Latin alias map（`{ 台北: "Taipei", 北京: "Beijing" }`）
- ✗ Keyword regex 或 CJK phrase stripping
- ✗ 固定問題標點刪除
- ✗ 依模型名稱套用不同轉寫規則
- ✗ 硬寫 URL、Credential 或正式環境設定

`queryName` 的來源是 Planner LLM 的語意判斷，不是 lookup table。Resolver 的最終輸出仍由 Provider 候選決定。

---

## 8. Test Strategy

### Deterministic Unit Tests

- Tool input schema: `queryName` optional, validated
- Query variant ordering: `queryName` before `location`, dedup preserved
- `queryName === location` 時不產生重複 variant
- `queryName` 不存在時行為不變

### Mock Smoke Tests（backend）

- `台北` + `queryName: "Taipei"` → mock geocoding "Taipei" → `success`
- `臺北` + `queryName: "Taipei"` → same entity
- `高雄鳳山` + `queryName: "Kaohsiung Fengshan"` → `success`
- `北京市` + `queryName: "Beijing"` → `success`
- `中山` + no queryName → `needs_clarification`
- `Springfield` → `needs_clarification` (unchanged)
- Not found + no queryName → `not_found` (unchanged)
- Provider failure → `error` (unchanged)
- Cancel → `weather_cancelled` (unchanged)

### Live Smoke Tests（backend, opt-in）

- `OPEN_METEO_LIVE_SMOKE=true` 時，使用真實 Open-Meteo API：
  - `台北` + `queryName: "Taipei"` → `success`
  - `臺北` + `queryName: "Taipei"` → 與 `台北` 相同 entity
  - `新加坡` + `queryName: "Singapore"` → `success`
  - `北京市` + `queryName: "Beijing"` → `success`
  - Latin cases unchanged regression

### Frontend Tests

- 不修改 frontend，確認 42 tests 仍通過（contract 相容性證明）。

---

## 9. Suggested File Changes

### 新增

```text
(無新增檔案；所有變更在現有檔案內)
```

### 修改

```text
backend/src/agents/deep-researcher.ts   ← Planner Prompt + weather extraction
backend/src/tools/weather.ts            ← Tool schema + queryName passthrough
backend/src/tools/geocoding/location-normalizer.ts ← buildQueryVariants 接受 queryName
backend/src/tools/weather.mock-smoke.test.ts      ← CJK mock cases
backend/src/tools/weather.live-smoke.test.ts      ← CJK live cases
```

### 不修改

```text
backend/src/tools/weather-types.ts       ← WeatherToolResult unchanged
backend/src/tools/geocoding/location-resolver.ts ← core logic unchanged
backend/src/tools/geocoding/open-meteo-provider.ts
frontend/src/types/weather.ts
frontend/src/components/WeatherToolResult.tsx
frontend/src/components/ToolMessageDisplay.tsx
bff/**
.env.example                            ← feature flag added if needed
```
