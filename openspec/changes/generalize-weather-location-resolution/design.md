# Design：泛化 Deep Research 天氣地點解析

## 1. 現況分析

目前天氣流程具備以下能力：

```text
plan_research
  ↓
targeted_tools
  ↓
invokeTool("current_weather")
  ↓
weather.ts
  ├── buildLocationQueries
  ├── Open-Meteo geocoding
  ├── chooseBestCandidate
  └── Open-Meteo forecast
  ↓
文字格式 ToolMessage
  ↓
buildWeatherToolAnswer
  ↓
以標籤文字提取欄位
```

目前設計的主要風險：

1. Planner Prompt 要求模型把常見非英文地名翻成常用英文形式，地點成功率會受到模型判斷影響。
2. Weather Tool 內部雖然使用 Provider 候選，但輸出仍是人類可讀文字。
3. Deep Research 透過 `Provider:`、`Resolved location:`、`Temperature:` 等標籤解析內容。
4. `shouldRepairWeatherRequest` 仍可能依賴錯誤文字或 Regex。
5. `ambiguous` 被當成 Error，而不是可讓使用者補充資訊的業務狀態。
6. Tool Governance 的 Timeout 使用 Promise Race，但底層 Provider Request 需要自己的 AbortSignal 才能真正停止。
7. 專案目前沒有正式 Test Script，無法鎖定多語言與歧義行為。

---

## 2. 設計原則

### 2.1 Provider 是地理事實來源

LLM 可以：

- 判斷是否為天氣意圖。
- 從使用者問題中抽取 `location`、`country`、`region`。
- 在 `not_found` 後提出一個受限制的查詢文字修復。

LLM 不可以：

- 直接產生或決定 latitude / longitude。
- 在多個候選間自行猜測。
- 因 Prompt 中的範例而限制可查詢地區。
- 將人工城市表當作地理事實來源。

### 2.2 歧義是正常狀態

`Springfield`、`中山`、`新城` 等可能有多個合理候選。

系統不得將這些情況統一包裝成一般錯誤。應回傳：

```text
needs_clarification
```

並提供有限、去重、可顯示的候選資料。

### 2.3 結構化資料與顯示文字分離

Tool Result 必須同時提供：

- 機器可讀欄位。
- 可降級顯示的 `summary`。

Agent 不得再以 `Resolved location:` 這類文字標籤取得核心資料。

### 2.4 不以人工 Mapping 擴充覆蓋率

不新增以下類型的主要流程：

```ts
const CITY_MAP = {
  台北: "Taipei",
  高雄: "Kaohsiung",
  北京: "Beijing",
};
```

可以保留的固定映射僅限於正式標準，例如：

- WMO Weather Code 對應描述。
- ISO Country Code 顯示名稱。
- Compass Wind Direction。

這些不是城市覆蓋 allowlist。

---

## 3. Domain Model

### 3.1 Location Query

```ts
export type LocationQuery = {
  raw: string;
  location: string;
  country?: string;
  region?: string;
};
```

規則：

- `raw` 保留使用者或 Planner 的原始地點文字。
- `location` 是 Trim 與 Unicode Normalization 後的主要查詢。
- 不得因正規化而改寫成另一個城市。
- `country` 與 `region` 是提示，不是座標來源。

### 3.2 Location Candidate

```ts
export type LocationCandidate = {
  provider: "open-meteo";
  providerId?: string;
  name: string;
  displayName: string;
  country?: string;
  countryCode?: string;
  admin1?: string;
  admin2?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
  population?: number;
};
```

### 3.3 Location Resolution Result

```ts
export type LocationResolutionResult =
  | {
      status: "resolved";
      query: LocationQuery;
      candidate: LocationCandidate;
      confidence: number;
      strategy: "original" | "contextual" | "locale_fallback" | "llm_repair";
      attemptedQueries: string[];
    }
  | {
      status: "ambiguous";
      query: LocationQuery;
      candidates: LocationCandidate[];
      reason: "score_too_close" | "missing_country_or_region";
      attemptedQueries: string[];
    }
  | {
      status: "not_found";
      query: LocationQuery;
      attemptedQueries: string[];
    }
  | {
      status: "provider_error";
      query: LocationQuery;
      provider: "open-meteo";
      code: string;
      retryable: boolean;
    };
```

### 3.4 Weather Tool Result

```ts
export type WeatherToolResult =
  | {
      schemaVersion: "1.0";
      tool: "current_weather";
      status: "success";
      requestedLocation: LocationQuery;
      resolvedLocation: LocationCandidate;
      observedAt: string;
      timezone: string;
      current: {
        conditionCode?: number;
        conditionText: string;
        temperature?: number;
        apparentTemperature?: number;
        relativeHumidity?: number;
        precipitation?: number;
        rain?: number;
        cloudCover?: number;
        pressureMsl?: number;
        windSpeed?: number;
        windDirectionDegrees?: number;
        windDirectionText?: string;
        windGusts?: number;
      };
      units: Record<string, string>;
      provider: "Open-Meteo";
      sourceUrl: string;
      summary: string;
    }
  | {
      schemaVersion: "1.0";
      tool: "current_weather";
      status: "needs_clarification";
      requestedLocation: LocationQuery;
      candidates: Array<
        Pick<
          LocationCandidate,
          "name" | "displayName" | "country" | "countryCode" | "admin1" | "admin2"
        >
      >;
      message: string;
      summary: string;
    }
  | {
      schemaVersion: "1.0";
      tool: "current_weather";
      status: "not_found";
      requestedLocation: LocationQuery;
      code: "weather_location_not_found";
      message: string;
      summary: string;
    }
  | {
      schemaVersion: "1.0";
      tool: "current_weather";
      status: "error";
      requestedLocation: LocationQuery;
      code:
        | "weather_invalid_input"
        | "weather_geocoding_provider_error"
        | "weather_forecast_provider_error"
        | "weather_timeout"
        | "weather_cancelled"
        | "weather_unknown_error";
      retryable: boolean;
      message: string;
      summary: string;
    };
```

---

## 4. Location Resolution Pipeline

```text
Input
  ↓
Validate
  ↓
Unicode / Whitespace Normalize
  ↓
Build Query Variants
  ↓
Call Geocoding Provider
  ↓
Deduplicate Candidates
  ↓
Score Candidates
  ↓
Resolved / Ambiguous / Not Found / Provider Error
```

### 4.1 Validation

拒絕：

- 空字串。
- 僅空白。
- 超過設定長度。
- 包含無法接受的控制字元。

建議預設：

```text
WEATHER_LOCATION_MAX_CHARS=160
```

### 4.2 Normalization

只做：

- `trim`
- Unicode `NFKC`
- 多空白合併
- 常見逗號與分隔符空白整理
- 移除不可見控制字元

不做：

- 直接翻譯地名。
- 手動把某城市換成另一個字串。
- 移除可能影響辨識的行政區名稱。
- 產生座標。

### 4.3 Query Variants

建議依序：

1. 原始正規化地點。
2. `location + country`
3. `location + region`
4. `location + region + country`
5. Provider Language 為 `zh`
6. Provider Language 為 `en`
7. Provider Language 不指定

查詢變體必須去重並限制總數。

建議預設：

```text
WEATHER_GEOCODING_MAX_QUERIES=6
WEATHER_GEOCODING_MAX_CANDIDATES=10
```

### 4.4 Provider Adapter

```ts
export interface GeocodingProvider {
  readonly name: string;

  search(
    query: {
      text: string;
      language?: string;
      limit: number;
      signal?: AbortSignal;
    }
  ): Promise<LocationCandidate[]>;
}
```

第一階段只實作：

```text
OpenMeteoGeocodingProvider
```

目的不是立即接第二 Provider，而是避免 `resolveLocation`、URL 建立、Provider Response Type 與候選選擇全部綁在同一個檔案。

### 4.5 Candidate Scoring

評分因素：

- Candidate Name 與 location 完全相同。
- Candidate Name 包含 location。
- Country Code 相同。
- Country 顯示名稱相同。
- Admin1 / Admin2 符合 region。
- Query Variant 是否包含 country / region context。
- Population 僅能作為次要 Tie-breaker。

禁止：

- 只因人口較高就無視 country / region。
- 用 LLM 選擇候選。
- 在無足夠差距時自動選擇第一筆。

建議將閾值設定化：

```text
WEATHER_GEOCODING_MIN_SCORE=35
WEATHER_GEOCODING_AMBIGUITY_DELTA=8
```

結果：

- Best Score 低於 Min Score：`not_found`
- 前兩名差距低於 Ambiguity Delta，且缺少足夠 context：`ambiguous`
- 有 country / region 且唯一明確符合：`resolved`

### 4.6 Candidate Deduplication

Dedup Key 建議：

```text
provider + roundedLatitude + roundedLongitude + normalizedDisplayName
```

不得只以 name 去重，因為同名城市可能位於不同地區。

---

## 5. LLM Repair Policy

### 5.1 使用時機

只有在以下條件全部成立時才可執行一次：

- 第一次 Deterministic Resolver 結果為 `not_found`。
- Planner LLM 可用。
- 本次請求尚未執行過 repair。
- 原始 location 不是空字串。
- 不是 `ambiguous`。
- 不是 Provider Network Error。
- 不是 Timeout 或 Cancel。

### 5.2 輸出限制

LLM 只能回傳：

```json
{
  "location": "string",
  "country": "string optional",
  "region": "string optional"
}
```

不得回傳：

- latitude
- longitude
- providerId
- 自動選擇的候選
- 多輪 Tool 指令

### 5.3 驗證

Repair 後：

1. 驗證 Schema。
2. 驗證長度。
3. 記錄 strategy 為 `llm_repair`。
4. 重新進入相同 Geocoding Resolver。
5. 若仍為 `not_found`，直接回傳 `not_found`。
6. 若為 `ambiguous`，要求使用者補充。
7. 不得再次 Repair。

---

## 6. Timeout、Retry 與 Cancel

### 6.1 Provider Timeout

建議：

```text
WEATHER_GEOCODING_TIMEOUT_MS=5000
WEATHER_FORECAST_TIMEOUT_MS=8000
```

每次 Provider Fetch 使用獨立 AbortController。

如果上游已提供 AbortSignal，應與 Provider Timeout Signal 合併。

### 6.2 Retry

只對下列暫時性錯誤重試一次：

- Network Reset
- DNS Temporary Failure
- HTTP 429
- HTTP 502
- HTTP 503
- HTTP 504

不重試：

- invalid_input
- ambiguous
- not_found
- user_cancelled
- HTTP 400
- HTTP 401
- HTTP 403

建議退避：

```text
250ms + bounded jitter
```

### 6.3 Tool Governance

現有 Tool Governance 的外層 Timeout 保留，作為最後防線。

Weather Tool 內部仍必須真正中止 Provider Fetch，不能只依賴 `Promise.race`。

---

## 7. Deep Research Runtime

### 7.1 State

建議新增：

```ts
type WeatherExecutionState =
  | { status: "idle" }
  | { status: "running"; requestedLocation: LocationQuery }
  | { status: "success"; result: WeatherToolResult }
  | { status: "needs_clarification"; result: WeatherToolResult }
  | { status: "failed"; result: WeatherToolResult };
```

Deep Research State 新增：

```ts
weatherExecution?: WeatherExecutionState;
```

此 State 必須可 JSON Serialize。

### 7.2 targeted_tools Node

新流程：

```text
plan.answerMode === weather
  ↓
weatherExecution = running
  ↓
invoke current_weather
  ↓
parse WeatherToolResult
  ├── success → weatherExecution.success
  ├── needs_clarification → weatherExecution.needs_clarification
  ├── not_found → optional one-time repair
  └── error → weatherExecution.failed
```

### 7.3 Synthesis

`buildWeatherToolAnswer` 不再解析：

```text
Resolved location:
Temperature:
Humidity:
```

改為直接讀取 `WeatherToolResult`。

輸出規則：

- `success`：以使用者語言輸出目前天氣與 resolved location。
- `needs_clarification`：說明地點不明確並列出候選。
- `not_found`：請使用者提供更完整地點，不聲稱 Provider 故障。
- `error`：提供簡潔錯誤，不暴露 Stack Trace、Proxy 設定細節或完整內部 Envelope。

### 7.4 Planner Prompt

修改原本「盡量翻譯為英文」的強依賴，改為：

- 保留使用者提供的地點原文。
- country / region 有明確資訊時才填入。
- 不確定時不要猜測國家。
- 不輸出座標。
- 不限制地區。
- Tool Resolver 負責多語言與歧義。

---

## 8. Frontend

### 8.1 Tool Status

`ToolMessageDisplay` 應區分：

```text
執行中
完成
需補充地點
找不到地點
逾時
錯誤
```

### 8.2 Clarification Display

對 `needs_clarification`：

- 顯示人類可讀 message。
- 顯示最多五個候選。
- 每個候選只顯示：
  - displayName
  - country
  - admin1
  - admin2
- 不直接顯示經緯度，除非 Debug Mode。
- 不自動送出下一次請求。
- 使用者應自行補充地點後重新詢問。

### 8.3 Unknown Schema

若收到未知 `schemaVersion` 或未知 `status`：

- Tool Panel 顯示 `summary`。
- 沒有 summary 時顯示安全 JSON。
- 不造成 Chat View Crash。
- 記錄前端 warning。
- 不將未知狀態視為永遠執行中。

### 8.4 Final Assistant Message

既有 Markdown 顯示路徑保留。

即使 Tool Panel 無法解析新格式，最終 AI Message 仍應可閱讀。

---

## 9. BFF

本 Change 不新增 BFF Domain Logic。

驗證項目：

- Stream Body 不被 BFF 修改。
- `x-request-id` 保留。
- BFF Upstream Timeout 大於單次 Weather Tool 內部 Timeout。
- 使用者取消時，LangGraph Stream 中斷不造成前端永久 loading。
- Structured Tool Result 不超過 BFF Body Limit。

---

## 10. Observability

### 10.1 Audit Events

新增或沿用：

```text
weather.location.resolve.start
weather.location.resolve.success
weather.location.resolve.ambiguous
weather.location.resolve.not_found
weather.location.resolve.failure
weather.provider.forecast.success
weather.provider.forecast.failure
weather.location.repair.attempt
weather.location.repair.result
```

### 10.2 Audit Fields

允許：

```text
provider
strategy
candidateCount
attemptCount
durationMs
resultStatus
errorCode
retryable
```

避免：

- API Key。
- Proxy Credential。
- 完整 Prompt。
- 完整 Conversation。
- Stack Trace 直接回傳前端。

地點文字可在 Debug 或 Research 環境記錄；正式環境建議只記錄 Hash 或截斷值。

### 10.3 Metrics

建議：

```text
weather.location.resolve.duration_ms
weather.location.resolve.success.count
weather.location.resolve.ambiguous.count
weather.location.resolve.not_found.count
weather.location.resolve.failure.count
weather.location.repair.count
weather.provider.forecast.duration_ms
weather.provider.forecast.failure.count
```

---

## 11. Suggested file changes

建議新增：

```text
backend/src/tools/weather-types.ts
backend/src/tools/geocoding/types.ts
backend/src/tools/geocoding/open-meteo-provider.ts
backend/src/tools/geocoding/location-normalizer.ts
backend/src/tools/geocoding/location-resolver.ts
backend/src/tools/geocoding/location-resolver.test.ts
backend/src/tools/weather.test.ts
frontend/src/types/weather.ts
frontend/src/components/WeatherToolResult.tsx
frontend/src/components/WeatherToolResult.test.tsx
```

建議修改：

```text
backend/src/tools/weather.ts
backend/src/agents/deep-researcher.ts
backend/src/platform/errors.ts
backend/src/platform/observability.ts
backend/.env.example
backend/package.json
frontend/src/components/ToolMessageDisplay.tsx
frontend/src/types/tools.ts
frontend/package.json
README.md
```

預期不修改或只驗證：

```text
bff/src/server.ts
backend/langgraph.json
frontend/src/types/agents.ts
```

最終檔案位置可由實作者依現有專案慣例微調，但不得破壞本 Design 的責任邊界。

---

## 12. Compatibility

保持：

- Tool Name：`current_weather`
- Graph ID：`deep_researcher`
- BFF Route：`/api/langgraph/*`
- Frontend API URL 生成方式。
- LangGraph Messages Key：`messages`

新增：

- `schemaVersion`
- Weather Tool Result Union
- Weather Execution State
- Clarification Status

遷移期間：

```text
WEATHER_STRUCTURED_RESULT_ENABLED=true
```

若 Flag 關閉，可走舊版文字結果；Flag 預設在開發環境開啟，在驗證完成後成為正式預設。

---

## 13. Alternatives considered

### A. 繼續擴充城市 Mapping

不採用。

原因：

- 無法覆蓋全球城市。
- 繁簡體、別名、行政區組合無窮。
- 需要持續人工維護。
- 容易把同名城市錯配。
- 讓應用層承擔 Provider 應負責的地理資料。

### B. 全部交給 LLM 產生英文地名

不採用作為主要方案。

原因：

- 結果不穩定。
- 模型不可用時整條流程失效。
- 可能翻成錯誤城市。
- 難以測試與稽核。
- 歧義時容易自動猜測。

### C. 直接加入第二個 Geocoding Provider

第一階段不採用。

原因：

- 會增加 Rate Limit、資料差異、成本與錯誤治理範圍。
- 先建立 Provider Adapter 與契約，再評估第二 Provider。
- 本 Change 的第一目標是解析責任與狀態清楚，不是堆疊更多 API。

### D. 保持文字 Tool Result

不採用。

原因：

- Agent 與 Frontend 會持續依賴字串格式。
- 欄位新增與文案修改可能破壞解析。
- 無法可靠區分狀態。
- 不利於測試與版本演進。

---

## 14. Verification strategy

### Unit Test

- Input normalization。
- Query variants。
- Country / region matching。
- Candidate scoring。
- Candidate deduplication。
- Ambiguity threshold。
- Not-found。
- Provider error。
- Structured Result Parser。
- Frontend unknown schema fallback。

### Integration Test

使用 Mock Provider 驗證：

```text
Deep Research Planner
  → targeted_tools
  → current_weather
  → WeatherToolResult
  → weatherExecution
  → final AI message
```

### Optional live smoke test

對 Open-Meteo 執行少量明確地點測試，不列為預設 CI Gate。

### Manual Test

依 `tasks.md` 的驗收矩陣執行。
