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
  ├── Mapbox Geocoding v6
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
8. 實測失敗顯示，使用固定天氣問句詞表、CJK phrase stripping 或固定標點清除來萃取地點，會把自然語言理解退化成刪字猜測，且容易刪掉行政區、同名地點 context 或非中文語言線索。

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

### 2.5 不以固定自然語言刪字規則抽取地點

不新增以下類型的主要流程：

```ts
const WEATHER_QUERY_WORDS = ["weather", "天氣", "氣溫", "幾度"];
const CJK_WEATHER_QUERY_PARTS = ["現在", "今天", "如何", "會下雨嗎"];
const QUESTION_PUNCTUATION = /[?？。嗎呢]/g;

const guessedLocation = userText
  .replace(QUESTION_PUNCTUATION, "")
  .replace(new RegExp(WEATHER_QUERY_WORDS.join("|"), "g"), "")
  .replace(new RegExp(CJK_WEATHER_QUERY_PARTS.join("|"), "g"), "")
  .trim();
```

原因：

- 不同語言與語序無法靠固定詞表穩定覆蓋。
- CJK 片段可能同時是地名、行政區、路名或上下文的一部分。
- 固定標點與助詞清除容易產生空字串或語意殘缺字串。
- 該策略會繞過 Planner schema、Runtime Validation、LLM Repair 與 Provider Resolver 的責任邊界。
- 測試通常只能覆蓋已知詞表，無法證明全球地點泛化能力。

允許的低風險文字清理僅限於不改變地點語意的 normalization，例如 trim、Unicode NFKC、多空白合併與控制字元移除。任何可能改寫、刪除或猜測地點核心內容的策略，都必須改由 Planner schema/prompt 改善、Runtime Validation、受限制 LLM Repair 或 Provider-driven resolver 承擔。

### 2.6 Planner 與 Resolver 的跨語言責任邊界

Planner 只負責：

- 判斷結構化天氣意圖與能力。
- 從目前使用者輸入抽取可追溯的完整原始地點 span。
- 保留使用者提供的所有洲際、國家、行政區與鄰里層級文字，不預設固定層級數量。

Planner 不負責：

- 保證地點名稱符合特定 Geocoding Provider 的索引語言。
- 翻譯、羅馬化或轉寫地名作為 Tool 執行前置條件。
- 因缺少 Latin／provider-friendly 名稱而將非空地點改判為缺失。
- 排除日文、韓文、阿拉伯文、西里爾文或任何其他 Unicode 文字系統。

`rawLocation` 是新流程唯一正式地點欄位。`PlanningResultV2` 與 Weather Tool v2 input 不接受 legacy `queryName`／`queryNameHint`；Provider-facing query transformation 完全由 Location Resolver／Provider Adapter 所有。

### 2.7 Machine Status 與顯示文案分離

Weather planning 與 retry 必須以 Runtime Validation 後的穩定結構分流。`PlanningResultV2` 是完整 planning contract，不是只包裝 Weather extraction：

```ts
type PlanningBase = {
  schemaVersion: 2;
  question: string;
  rationale: string;
};

type PlanningResultV2 =
  | (PlanningBase & {
      kind: "direct";
    })
  | {
      schemaVersion: 2;
      kind: "weather";
      question: string;
      rationale: string;
      weather: {
        rawLocation: string;
        country?: string;
        region?: string;
        weatherCapability: "current" | "hourly" | "daily";
        timeRange?: WeatherTimeRange;
        units: "metric";
        locale?: string;
      };
    }
  | (PlanningBase & {
      kind: "calculation";
      calculation: { expression: string };
    })
  | (PlanningBase & {
      kind: "research";
      queries: string[];
      urls: string[];
      freshness?: "pd" | "pw" | "pm" | "py";
      requiredSourceCount: number;
    })
  | (PlanningBase & {
      kind: "missing_location";
      clarification: string;
    })
  | (PlanningBase & {
      kind: "clarify";
      reason: "missing_calculation" | "insufficient_context";
      clarification: string;
    })
  | (PlanningBase & {
      kind: "extraction_error";
      errorCode:
        | "planner_parse_error"
        | "planner_schema_rejected"
        | "planner_invoke_error"
        | "planner_model_refusal"
        | "planner_capability_unsupported";
      retryable: boolean;
    });
```

其中 `weather` 是完整 union 的 Weather extraction 分支；`PlanningResultV2` 正式取代既有 `ResearchPlan`，不是其前置結果。Graph ID 與公開 BFF Route 不變，但 Runtime 不得在同一條新流程同時維護兩套 planning contract。必須維持以下不變量：

- `missing_location` 只能代表使用者沒有提供可驗證的地點 span。
- 非空 `rawLocation` 不得產生 `missing_location`。
- Graph Routing 不得比對「請提供要查詢天氣的城市或地區」或任何其他 localized 文案。
- Planner unavailable／parse error／schema rejection 不得偽裝成使用者缺少地點。
- 固定自然語言 keyword 可用於非權威 telemetry，但不得決定 Weather Tool 是否執行或抽取地點。
- 非 Weather 輸入不得回傳泛化的 `not_weather` 後再由 Runtime 猜測；模型必須直接產生 `direct`、`calculation`、`research` 或 `clarify`。
- `plan_research` 是唯一 writer，State 預設為 `undefined`，reducer 採 overwrite；routing、targeted tools、query generation 與 synthesis 只讀取已驗證的 v2 union。
- `direct` 不得攜帶 queries、urls 或 tool request；`weather` 與 `calculation` 只能攜帶各自 request；`research.queries` 必須至少一筆且 `requiredSourceCount >= 1`。

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
  provider: string;
  providerFeatureId?: string;
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

export type ResolutionStrategy =
  | "original"
  | "contextual"
  | "transformed"
  | "provider_fallback"
  | "llm_repair";

export type ResolutionAttempt = {
  provider: string;
  strategy: ResolutionStrategy;
  outcome:
    | "candidates"
    | "not_found"
    | "provider_error"
    | "timeout"
    | "cancelled"
    | "circuit_open"
    | "rate_limited";
  durationMs: number;
};
```

`provider` 必須通過 provider-neutral Runtime Schema（非空、長度受限、只允許穩定 identifier 字元），不得以 `"open-meteo"` literal 假冒 Geocoding Provider。Mapbox transport feature ID 僅可映射到 `providerFeatureId`，且 Temporary 模式不得持久化。

### 3.3 Location Resolution Result

```ts
export type LocationResolutionResult =
  | {
      status: "resolved";
      query: LocationQuery;
      candidate: LocationCandidate;
      confidence: number;
      strategy: ResolutionStrategy;
      attempts: ResolutionAttempt[];
    }
  | {
      status: "ambiguous";
      query: LocationQuery;
      candidates: LocationCandidate[];
      reason: "score_too_close" | "missing_country_or_region";
      attempts: ResolutionAttempt[];
    }
  | {
      status: "not_found";
      query: LocationQuery;
      attempts: ResolutionAttempt[];
    }
  | {
      status: "provider_error";
      query: LocationQuery;
      provider: string;
      reason: "network" | "rate_limited" | "circuit_open" | "configuration";
      code: string;
      retryable: boolean;
      attempts: ResolutionAttempt[];
    }
  | {
      status: "timeout";
      query: LocationQuery;
      provider?: string;
      attempts: ResolutionAttempt[];
    }
  | {
      status: "cancelled";
      query: LocationQuery;
      attempts: ResolutionAttempt[];
    };
```

多次 attempt 的聚合優先序固定如下：

1. `cancelled` 立即終止，不再 fallback。
2. 任一合法且唯一候選產生 `resolved`。
3. 有合理但接近的候選產生 `ambiguous`。
4. 總 budget 到期且尚無語意結果時產生 `timeout`。
5. 存在 network、rate-limit、circuit 或 configuration failure 且無語意結果時產生 `provider_error`。
6. 只有所有允許的 Provider／query attempt 都正常完成且無候選時，才產生 `not_found`。

### 3.4 Weather Tool Result

```ts
export type WeatherToolResultV2 =
  | {
      schemaVersion: "2.0";
      tool: "current_weather";
      status: "success";
      geocodingStorageMode: "temporary";
      requestedLocation: LocationQuery;
      displayLocation: string; // 必須等於使用者原始地點，不得使用 Mapbox 衍生 label
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
      providerAttributionUrl: "https://open-meteo.com/";
      summary: string;
    }
  | {
      schemaVersion: "2.0";
      tool: "current_weather";
      status: "success";
      geocodingStorageMode: "permanent";
      requestedLocation: LocationQuery;
      resolvedLocation: LocationCandidate;
      observedAt: string;
      timezone: string;
      current: WeatherCurrentData;
      units: Record<string, string>;
      provider: "Open-Meteo";
      sourceUrl: string;
      summary: string;
    }
  | {
      schemaVersion: "2.0";
      tool: "current_weather";
      status: "needs_clarification";
      geocodingStorageMode: "temporary";
      requestedLocation: LocationQuery;
      message: string;
      summary: string;
    }
  | {
      schemaVersion: "2.0";
      tool: "current_weather";
      status: "needs_clarification";
      geocodingStorageMode: "permanent";
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
      schemaVersion: "2.0";
      tool: "current_weather";
      status: "not_found";
      requestedLocation: LocationQuery;
      code: "weather_location_not_found";
      message: string;
      summary: string;
    }
  | {
      schemaVersion: "2.0";
      tool: "current_weather";
      status: "error";
      requestedLocation: LocationQuery;
      code:
        | "weather_invalid_input"
        | "weather_geocoding_provider_error"
        | "weather_forecast_provider_error"
        | "weather_timeout"
        | "weather_cancelled"
        | "weather_temporary_projection_violation"
        | "weather_unknown_error";
      retryable: boolean;
      message: string;
      summary: string;
    };
```

Temporary 模式不傳送任何 Mapbox candidate event。`needs_clarification` 的 `message` 與 `summary` 只能根據使用者原始 `rawLocation` 產生通用補充提示，例如要求自行輸入國家、州或行政區，不得包含 Provider candidate、resolved label、feature ID 或座標。Permanent 模式才可沿用版本化 durable candidates。

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
Resolved / Ambiguous / Not Found / Provider Error / Timeout / Cancelled
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

Mapbox transport request 另需通過 Provider-specific Runtime Schema：

- `q` 最多 256 字元。
- `q` 最多 20 個 words／numbers。
- `q` 不得包含 `;`。
- `worldview` 僅接受 `ar | cn | in | jp | ma | rs | ru | tr | us` 或空值。

Provider constraint validation 不得用刪字或標點清理偷偷改寫地點；不符合時回穩定 `weather_invalid_input`／configuration outcome，並保留原始 `rawLocation` 供安全提示。

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
- 透過 hard-coded 自然語言 keyword regex、CJK phrase stripping 或固定問題標點刪除來推測地點。
- 使用 `WEATHER_QUERY_WORDS`、`CJK_WEATHER_QUERY_PARTS`、`QUESTION_PUNCTUATION` 或等價固定詞表作為主要 location extraction。
- 產生座標。

### 4.3 Query Variants

建議依序：

1. 原始正規化地點。
2. `location + country`
3. `location + region`
4. `location + region + country`
5. 使用已驗證的使用者／系統 locale（若 Provider 支援）。
6. Provider Language 不指定。

查詢變體必須去重並限制總數。

Provider-facing query 來源依序由 Resolver 管理：

1. 原始 Unicode 地點與使用者明確提供的 context。
2. Geocoding Provider 原生 locale／language capability。
3. 設定化的通用 transliteration／translation adapter 產生的候選文字。
4. 下一個具相容 capability 的 Geocoding Provider。

Resolver 不得：

- 以固定語言、國家、城市或行政區清單選擇變體。
- 假設地點一定是「國家＋城市」或固定三層行政區。
- 將整句天氣問句直接當作 location；傳入 Resolver 的必須是 Planner 抽取並驗證後的地點 span。
- 將轉寫或翻譯結果視為最終地理事實。

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

本 Change 正式實作並啟用：

```text
MapboxGeocodingProvider
```

Mapbox 使用 Geocoding API v6 forward geocoding；Provider response 必須先經 Runtime Schema Validation，再轉換成 `LocationCandidate`。Open-Meteo 不再負責 Geocoding，只保留 forecast/current weather。

Adapter 邊界必須保持 provider-neutral，並允許未來透過設定加入自架 Nominatim；本 Change 不使用公共 Nominatim 作為自動 fallback，也不要求 Planner 產生 Latin hint：

```ts
export type GeocodingProviderCapabilities = {
  supportedLocales?: string[];
  acceptsUnicode: boolean;
  supportsAdministrativeHierarchy: boolean;
};

export interface GeocodingProvider {
  readonly name: string;
  readonly capabilities: GeocodingProviderCapabilities;
  search(query: GeocodingSearchRequest): Promise<LocationCandidate[]>;
}
```

Capability 只描述 Provider 能力，不得轉化為產品層語言 allowlist。Resolver 應依設定順序、成功候選與穩定錯誤語意執行 bounded fallback；不得因第一個 Provider 對某文字系統無候選就要求 Planner 猜測英文地名。

Mapbox 設定：

```text
MAPBOX_ACCESS_TOKEN=<backend secret>
MAPBOX_GEOCODING_STORAGE_MODE=temporary
MAPBOX_WORLDVIEW=
WEATHER_GEOCODING_MAX_PROVIDERS=1
WEATHER_GEOCODING_MAX_QUERIES=3
WEATHER_GEOCODING_MAX_ATTEMPTS=4
WEATHER_GEOCODING_TOTAL_BUDGET_MS=8000
WEATHER_GEOCODING_TIMEOUT_MS=5000
WEATHER_GEOCODING_CIRCUIT_FAILURE_THRESHOLD=5
WEATHER_GEOCODING_CIRCUIT_COOLDOWN_MS=60000
WEATHER_GEOCODING_RATE_LIMIT_PER_INSTANCE_PER_MINUTE=100
WEATHER_GEOCODING_MAX_CONCURRENCY=10
WEATHER_GEOCODING_QUEUE_MAX=100
```

- `MAPBOX_GEOCODING_STORAGE_MODE` 僅接受 `temporary | permanent`；`permanent` 才可送出 `permanent=true`。
- 切換 `permanent` 前，部署 owner 必須確認 token／帳戶已取得 Permanent Geocoding entitlement；若 Provider 拒絕，Adapter 回 `provider_error.reason = "configuration"`，不得降級 Temporary。
- `MAPBOX_WORLDVIEW` 是產品／部署設定。空值表示不傳該參數並使用 Provider 預設；不得依使用者語言、locale、國家名稱或文字系統推斷。
- `MAPBOX_ACCESS_TOKEN` 僅由 Backend secret store 注入。Platform／Operations owner 負責最小權限、輪替、撤銷與 `api.mapbox.com` egress；Product／FinOps owner 負責用量預算與告警。
- Rate limiter 的限制值由設定提供，並以 Provider 回傳的 429／rate-limit metadata 為權威，不得把外部方案目前額度寫成不可變業務常數。
- 所有 Mapbox request 只可送至固定核准的 `https://api.mapbox.com/search/geocode/v6/forward` endpoint；不得讓使用者輸入控制 host、path 或 protocol。

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
  "candidates": [
    {
      "location": "string",
      "country": "string optional",
      "region": "string optional",
      "reason": "string optional"
    }
  ]
}
```

LLM Repair remains a single bounded invocation. It MAY return up to three textual LocationQuery candidates. Backward-compatible single-object repair output MAY be accepted and treated as one candidate:

```json
{
  "location": "string",
  "country": "string optional",
  "region": "string optional",
  "reason": "string optional"
}
```

Runtime MUST validate each candidate, preserve the original raw location, set `resolutionStrategy = "llm_repair"`, and re-run the same Provider Resolver for each candidate in order. The first provider-resolved weather success MAY be used. If a repair candidate returns `ambiguous`, Runtime MUST NOT ask the LLM to choose a provider candidate; it MAY continue to the next repair candidate, and otherwise MUST preserve the clarification result. Runtime MUST NOT run a second LLM Repair invocation.

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
WEATHER_GEOCODING_TOTAL_BUDGET_MS=8000
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
exponential backoff + bounded jitter，並優先遵守 Retry-After
```

每個暫時性失敗最多重試一次；每次解析最多 3 個 query variants、1 個目前啟用的 Provider、4 次總網路嘗試，且不得超過 8 秒總預算。任一上限先到即停止。

Circuit breaker 依 Provider 分開計數：連續 5 次可重試失敗後開啟 60 秒；cooldown 後進入 half-open 並只放行 1 次探測。成功後關閉並歸零；`invalid_input`、`ambiguous`、`not_found` 與 user cancel 不計入失敗門檻，也不得觸發 retry。這裡的「5 次」是跨請求熔斷門檻，不是單一使用者請求重試五次。

### 6.3 Rate limiter 與多 instance 狀態

目前實作採每個 Backend process 各自持有：

- per-provider token bucket。
- concurrency semaphore。
- bounded FIFO queue。
- circuit breaker state。

每個 process 使用 `WEATHER_GEOCODING_RATE_LIMIT_PER_INSTANCE_PER_MINUTE` 作為獨立 token bucket 額度，預設 100/min。此數值是 per-instance admission limit，不宣稱在沒有共享 coordinator 時提供跨 replica 全域上限。queue 等待時間必須計入 8 秒總解析預算；queue 超過 100 或 budget 不足時立即回 `provider_error.reason = "rate_limited"`。429 必須依 `Retry-After` 暫停該 process 的 bucket。

Circuit breaker 明確為 process-local，restart 後歸零；half-open 的「1 次」是每個 process 各 1 次。此選擇避免本 Change 引入新的共享基礎設施，代價是多 instance 會各自計數、限流與探測。Platform／Operations 必須依核准的最大 replica 數設定較低的 per-instance limit 並監控 token 級 Mapbox 用量；若未來需要嚴格全域上限或全域 breaker，必須在獨立 Change 選定共享 traffic governor，不得在本 Change 隱式依賴不存在的 Redis。

### 6.4 Tool Governance

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
  | { status: "success"; result: WeatherToolResultV2 }
  | { status: "needs_clarification"; result: WeatherToolResultV2 }
  | { status: "failed"; result: WeatherToolResultV2 };
```

Deep Research State 新增：

```ts
weatherExecution?: WeatherExecutionState;
```

此 State 必須可 JSON Serialize。

當 `MAPBOX_GEOCODING_STORAGE_MODE=temporary` 時，上述可序列化 State 不得包含 Mapbox response、candidate、座標、Mapbox feature ID、衍生 resolved label、含座標／query string 的 Provider request URL，或可重建該 Provider 結果的 payload。這些資料只能存在於單次 node 執行的 ephemeral memory；持久化的 Weather Result 只能保留使用者原始地點、固定無 query 的 Provider attribution URL 與非 Mapbox 衍生的 Weather Provider 資料。

Backend 必須以 `prepareTemporaryDurableBundle` 先建立所有可能持久化或離開 node 的投影，並使用 sink-specific closed schema：

- `TemporaryWeatherResultSchema`：Weather Tool Result／ToolMessage。
- `TemporaryWeatherExecutionStateSchema`：State 與 checkpoint 的 `weatherExecution` slice；checkpoint 其他欄位仍使用既有 State Schema。
- `TemporaryLocationAuditSchema`：允許 provider identifier、strategy、candidateCount、attemptCount、durationMs、resultStatus、errorCode、requestId、runId；不允許 candidate value、原始／轉換 query、座標、feature ID、resolved label、Provider URL／body。
- `TemporaryWeatherLogTraceMetadataSchema`：只允許 correlation ID、phase、duration、count、status、error code 與 retryable，不允許 Provider request／response 或地理值。

每個 sink schema 再組合共用 `assertNoTemporaryMapboxDerivedFields` guard，拒絕 candidate／candidates、latitude／longitude、feature ID、resolved label、Provider body、含 query 的 URL 與其他 Mapbox 衍生地理值。`provider: "mapbox"` identifier 本身可以出現在 Audit，不等同 Provider response。

若偵測 candidates、latitude、longitude、feature ID、resolved label、含 query 的 URL 或未知欄位：

1. 所有 sink projection 必須先在記憶體全部驗證；任一失敗即丟棄整個未提交 bundle，且在驗證完成前不得呼叫任何 sink。
2. 呼叫 `createTemporaryProjectionViolationResult(rawLocation)` 建立全新物件；factory 不得 spread、merge 或引用違規 payload。
3. 新物件只包含 `schemaVersion: "2.0"`、`tool: "current_weather"`、`status: "error"`、安全的原始 `requestedLocation`、`code: "weather_temporary_projection_violation"`、`retryable: false`、安全 message 與 summary。
4. Runtime 必須為 sanitized error 重建最小 State、ToolMessage、Audit 與 Log/Trace bundle，並分別通過上述 sink schema及共用 guard，才可 freeze 成 immutable validated bundle。
5. terminal state 後到達的 Provider result 必須忽略，不得覆蓋 sanitized error。

因 Temporary Mapbox 資料不離開 Backend node，BFF 與 Frontend 不需要 Mapbox-specific ephemeral contract。

驗證成功後的 commit semantics：

- State／ToolMessage／checkpoint 依既有 LangGraph node 與 checkpointer commit 邊界提交；本 Change 不宣稱跨 stream、checkpoint、audit、log、trace 的 distributed transaction。
- Audit／Log／Trace 只能從 immutable validated bundle 的對應 projection 派生，不得重新讀取 Provider response 或 node local candidate。
- Observability event 使用 `runId + toolCallId + eventType` 作為 idempotency key，暫時性失敗最多 retry 3 次。
- Audit／Log／Trace sink 失敗記錄安全 failure metric 與告警，不得回滾已提交 Graph state，也不得把未驗證 payload作為補償資料。
- 每個 sink 永遠只能接收已通過自身 Schema 與共用 guard 的 projection。

### 7.2 targeted_tools Node

新流程：

```text
plan.kind === "weather"
  ↓
weatherExecution = running
  ↓
invoke current_weather
  ↓
parse WeatherToolResultV2
  ├── success → weatherExecution.success
  ├── needs_clarification → weatherExecution.needs_clarification
  ├── not_found → optional one-time repair
  └── error → weatherExecution.failed
```

`PlanningResultV2.kind` 的 Graph edge 固定如下：

```text
direct | missing_location | clarify | extraction_error → synthesize_answer
weather | calculation                                  → targeted_tools
research                                               → generate_queries
```

`extraction_error` 的 synthesis 只能使用穩定安全文案與 error code，不得把它改寫成 `missing_location`。上述 edge 不得讀取 localized clarification 或固定 weather keyword。

### 7.3 Synthesis

`buildWeatherToolAnswer` 不再解析：

```text
Resolved location:
Temperature:
Humidity:
```

改為直接讀取 `WeatherToolResultV2`。

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

人工 E2E review 後補充：

- Planner Schema 必須以實際 Structured Output／Tool Calling 或等價 Runtime Schema 約束，不只在 Prompt 內描述 JSON。
- `PlanningResultV2.weather.rawLocation` 是唯一正式地點欄位，必須是使用者原始地點 span。
- Planner Schema 與 Weather Tool v2 input 不接受 `queryName`／`queryNameHint`；Runtime 直接以 `rawLocation` 進入 Weather Tool／Resolver。
- Retry 只修復結構化抽取，不負責決定 Provider-specific 最終名稱。
- 主 Planner 與 Retry 的 parse error、schema rejection、invoke error 必須分別記錄 machine failure code。

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
- Temporary Weather Result 已由 Backend 安全投影，不包含任何 Mapbox candidate 或座標。
- 既有 `/api/langgraph/*` Route、取消、backpressure 與 request ID 語意不變。

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
backend/src/tools/geocoding/mapbox-provider.ts
backend/src/tools/geocoding/location-normalizer.ts
backend/src/tools/geocoding/location-resolver.ts
backend/src/tools/geocoding/location-resolver.test.ts
backend/src/tools/geocoding/mapbox-provider.test.ts
backend/src/tools/weather.test.ts
frontend/src/types/weather.ts
frontend/src/components/WeatherToolResult.tsx
frontend/src/components/WeatherToolResult.test.tsx
```

建議修改：

```text
backend/src/tools/weather.ts
backend/src/agents/deep-researcher.ts
backend/src/agents/planning-result-v2.ts
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
- `PlanningResultV2`（取代 `ResearchPlan`）
- Weather Tool Result Union
- Weather Execution State
- Clarification Status

本 Change 不保留 `WEATHER_STRUCTURED_RESULT_ENABLED=false` 的舊 planning／文字結果雙軌。新 run 一律使用 `PlanningResultV2` 與 `WeatherToolResultV2`；需要 rollback 時部署前一個已驗證版本，不得在同一 runtime 依 flag 混用新舊 contract。

既有 checkpoint 不執行欄位猜測式遷移。Resume 時若 planning payload 缺少 `schemaVersion: 2` 或不符合 `PlanningResultV2`：

- Runtime 回傳 terminal error code `planner_checkpoint_incompatible_v2`。
- 發出不含 payload 的 `planning_checkpoint_rejected` audit event，只記錄 requestId、threadId、runId、checkpoint version 與 timestamp。
- 該 checkpoint 以去敏 metadata 標記 non-resumable，不複製或封存原始 planning payload。
- 不得把舊 Optional 欄位 coercion 成新 union。

Checkpoint cleanup 採明確維運閉環：

- Backend 提供 idempotent `cleanup:incompatible-checkpoints` CLI，透過 `CheckpointRetentionAdapter` 列出並刪除 non-resumable v1 checkpoint。
- Platform／Operations 以部署平台 CronJob 每小時執行一次；同一 checkpoint 重試最多 3 次並使用 exponential backoff。
- 記錄 deleted／failed count、oldest pending age 與 duration metric，不記錄 checkpoint payload。
- 任一刪除連續失敗或 oldest pending age 達 12 小時發 warning，達 24 小時發 critical alert。
- Change 完成前必須以 production-equivalent checkpoint adapter 執行整合測試，證明標記、重試、冪等刪除與告警；未部署 CronJob 或 24 小時 SLO evidence 不得完成 migration Task。

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

### C. 繼續以 Open-Meteo Geocoding 搭配 Planner 轉寫

不採用。

原因：

- Live evidence 已證明原始 CJK 查詢覆蓋不足。
- 要求 Planner 翻譯或羅馬化會把 Provider 相容性責任放錯層級。
- 正式改用 Mapbox Geocoding v6；Open-Meteo 僅保留為 Weather Provider。

### D. 固定問句詞表與 CJK phrase stripping

不採用。

原因：

- 實測已證明這類策略會把地點抽取變成 hard-coded 刪字猜測。
- `WEATHER_QUERY_WORDS`、`CJK_WEATHER_QUERY_PARTS`、`QUESTION_PUNCTUATION` 這類詞表需要持續補洞，與本 Change 的泛化目標衝突。
- CJK phrase stripping 可能刪掉行政區、城市別名或 Provider 需要的查詢線索。
- 固定 regex 難以正確處理多語言、混合語言、重音字元與自然語序。
- 該方案會繞過 Planner schema/prompt、Runtime Validation、受限制 LLM Repair 與 Provider-driven resolver。

### E. 保持文字 Tool Result

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
- 禁止固定自然語言 keyword regex、CJK phrase stripping 或固定問題標點刪除成為主要 location extraction 的規格檢查。

### Integration Test

使用 Mock Provider 驗證：

```text
Deep Research Planner
  → targeted_tools
  → current_weather
  → WeatherToolResultV2
  → weatherExecution
  → final AI message
```

### Required opt-in live acceptance

對正式目標模型、Mapbox Geocoding v6 與 Open-Meteo Weather Provider 執行明確且可重播的 live acceptance。它不列入預設離線 CI，但在本 Change 完成前必須執行。

Live 驗證必須拆成三個獨立 gate：

1. **Live model extraction**：使用正式目標模型與固定參數，驗證任意 Unicode 地點能產生非空完整原文 location；不得預先 mock Planner JSON。
2. **Live geocoding**：直接以 Resolver 契約驗證原始 Unicode、provider query transformation、capability fallback 與候選結果。
3. **Live E2E**：從 LangGraph input 到 Weather Tool Result／最終回答，確認不會在非空地點時提前 `clarify`。

每份 evidence 必須記錄 model/provider、版本或設定摘要、時間、case id、結構化 outcome、requestId/runId 與重現命令；不得記錄 API Key、Authorization Header、完整 Prompt 或未限制大小的 Provider body。

最低驗收矩陣必須涵蓋：

- 單層地點、國家＋城市、洲際＋國家＋城市及更多行政層級。
- 繁體中文、簡體中文、Latin、日文、韓文、阿拉伯文、西里爾文、重音字元與混合文字系統。
- 同名地點、缺少地點、Provider 不支援、Provider error、timeout 與 cancel。
- 等價輸入加入或移除上層地理 context 時，候選只能維持一致或縮小，不得跳到不相關地點。
- 固定種子 `20260627` 與 `mulberry32-v1` 產生州／國／城市與其他行政層級組合；展開後案例必須提交至 `backend/test-fixtures/weather-location-live-cases.v1.json`。CI 與 live evidence 以 manifest 為權威並記錄 manifest hash，不得在執行時臨時產生不可重播案例。
- `台灣高雄大寮` 必須得到 `resolved → current_weather success`；不得接受 `not_found`、`missing_location` 或提前 `clarify`。
- 無歧義的有效組合必須成功；Provider 確實回傳多個同名或近似候選時，才可回 `ambiguous` 並要求使用者選擇。
- Temporary 與 Permanent 模式各有 contract test；Temporary 另需 checkpoint、cache、log、trace persistence audit。

上述 live gate 可保持 opt-in，不作為一般 PR 的網路 CI，但在本 Change 標記完成與封存前必須執行並保存去敏證據。

### Manual Test

依 `tasks.md` 的驗收矩陣執行。
