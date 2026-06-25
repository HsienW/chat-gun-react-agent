# Weather 能力專項規則

## 1. 適用範圍

涉及下列任一內容時，必須讀取本文件：

- 天氣意圖判斷。
- Planner 的 Weather 結構化輸出。
- 地點正規化與解析。
- Geocoding Provider。
- Current Weather / Forecast Tool。
- Weather Tool Result Schema。
- Weather Stream Event。
- Frontend Weather Card。
- 天氣多輪追問、錯誤、逾時、取消與澄清。

本文件承接跨 `frontend`、`bff`、`backend` 的天氣能力不變量，不重複定義各套件一般工程規則。

---

## 2. 先確認能力邊界

修改前，先將問題分類：

```text
current observation
hourly forecast
daily forecast
historical weather
climate knowledge
weather advice
missing location
ambiguous location
multi-turn follow-up
```

不得用 Prompt 或 UI 文案假裝補齊尚不存在的 Tool 能力。

若目前只有 `current_weather`，則「明天」「週末」「下週」「今日降雨機率」等需求必須：

- 由正式 Forecast Tool 支援；或
- 明確回覆能力不支援；
- 不得拿即時觀測冒充預報。

Phase 2 起，`weather_forecast` 是正式 Forecast Tool，負責 `hourly forecast` 與
`daily forecast`。`current_weather` 仍只負責 `current observation`，不得宣稱或代答預報。
歷史天氣、氣候知識、獨立旅遊/穿搭/活動建議與多輪候選選擇仍不屬於 Phase 2 forecast tool 能力。

---

## 3. 跨層責任

### Backend Planner

負責從使用者語意產生結構化天氣意圖，例如：

```text
intent
location
country
region
timeRange
weatherCapability
```

不得直接宣稱地理實體解析成功。

`queryName` is an optional planner hint for Chinese or mixed-Chinese weather locations.
It may contain a geocoding-friendly Latin place name, but it must not replace the
user's original `location`/raw location text. The resolver may try `queryName`
before the original location as a provider query variant, but provider-backed
candidates remain the only geographic authority.

`queryName` must not be implemented with Chinese/CJK city alias maps, fixed
natural-language keyword stripping, phrase stripping, punctuation-stripping
heuristics, or hardcoded place allowlists. Japanese and Korean inputs are outside
this `queryName` scope and must not be guessed through this path.

### Resolver / Geocoding Provider

負責根據 Planner 輸出、對話 Context 與 Provider 候選，產生：

```text
resolved
ambiguous
not_found
provider_error
timeout
cancelled
```

### Weather Tool

負責使用已解析地點與明確時間能力呼叫天氣 Provider，並回傳結構化結果。

### BFF

只負責安全代理、取消、逾時與錯誤透傳，不重新解析天氣語意。

### Frontend

只依結構化狀態渲染，不重新猜測地點、時間或天氣意圖。

---

## 4. 禁止的解析策略

禁止將以下方式作為主要地點抽取或修復策略：

- 固定城市 Allowlist。
- 人工城市中英文 Mapping。
- 固定自然語言 Keyword Regex。
- CJK Phrase Stripping。
- 刪除「天氣、現在、今天、明天、幾度、下雨嗎」後把剩餘文字當地點。
- 固定標點移除後猜測實體。
- 依模型名稱套用不同城市規則。
- 為單一失敗問句建立特殊分支。

允許的輸入清理僅限不改變語意的 Normalization：

- trim。
- Unicode NFKC。
- 合併多餘空白。
- 移除控制字元。
- 長度限制。

`rawLocation` 必須保留，不得被正規化結果覆蓋。

---

## 5. Resolver 不變量

Resolver 必須：

- 由 Provider Candidate 驅動。
- 保留候選的名稱、國家、行政區、座標與 Provider ID。
- 使用可測試、可解釋的評分或排序規則。
- 在候選接近時回傳 `ambiguous` / `needs_clarification`。
- 在 Provider 無候選時回傳 `not_found`。
- 在 Provider 失敗時回傳 `provider_error`，不得回傳 `not_found`。
- 在逾時時回傳 `timeout`。
- 在取消時回傳 `cancelled`。

受限制的 LLM Repair 只能：

1. 在第一次 Provider-driven Resolution 失敗後啟動。
2. 產生新的文字查詢候選。
3. 再次通過相同 Runtime Validation。
4. 再次交給 Provider Resolver。
5. 有最大重試次數與 Audit。

LLM Repair 不得直接產生最終座標或繞過 Provider。

---

## 6. 結構化結果

Weather Tool Result 應使用穩定 Discriminated Union，至少表達：

```text
success
needs_clarification
not_found
error
```

Error 必須使用穩定 Code 區分：

```text
geocoding_provider_error
weather_provider_error
timeout
cancelled
invalid_input
```

實際 Enum 以專案正式 Schema 為準。

必須保留：

- 使用者原始地點。
- 正規化查詢。
- 已解析地點。
- Provider Metadata。
- Observation / Forecast 時間。
- Timezone。
- 單位。

不得只回傳一段自然語言，讓 Frontend 再次解析。

---

## 7. 多輪上下文

至少驗證：

```text
使用者：台北現在幾度？
使用者：那明天呢？
使用者：換成高雄。
```

多輪承接必須明確決定：

- 哪些欄位沿用上一輪。
- 哪些欄位被新輸入覆蓋。
- 缺少哪個欄位需要澄清。
- Current Weather 與 Forecast 能力如何切換。

不得以「那」「這裡」「換成」等固定詞表單獨完成 Context Resolution；必須結合對話 State 與結構化 Planner Output。

---

### Phase 3 clarification support

Multi-turn weather clarification is supported for provider-backed ambiguous location candidates.

- Backend owns the LangGraph `interrupt()` and resume workflow.
- Clarification state must remain serializable and checkpoint-safe.
- Candidate selection by index must use provider-backed candidate coordinates directly and must not repeat geocoding.
- Region supplement may filter existing provider candidates; if multiple candidates remain, the workflow may ask one more clarification round.
- Location change must be treated as a fresh provider-backed weather request.
- Cancel must terminate with `weather_cancelled`, not `not_found`.
- Unrecognized clarification replies may ask again once and must terminate after the maximum clarification rounds.
- Frontend may render candidate choices and editable reply controls, but must not infer geography or bypass backend resolution.
- BFF must pass LangGraph interrupt and unknown stream events through without filtering or rewriting.

## 8. Golden Regression Matrix

天氣能力變更必須維護可重現的 Golden Regression Matrix。矩陣至少分成三層：

- deterministic：不呼叫真實模型、不呼叫真實 Provider、不依賴網路，適合預設 CI。
- mock integration：使用受控模型／Provider fixture 驗證 Planner、Resolver、Tool 與 terminal outcome 邊界。
- live smoke：明確 opt-in 才能呼叫真實模型或真實天氣 Provider，不得作為預設 CI gate。

Baseline report 必須誠實區分：

- `pass`：目前能力符合結構化期望。
- `fail`：目前能力違反 Phase 內應通過的結構化期望。
- `known_gap`：已知能力缺口，例如 forecast 或 multi-turn clarification，必須標明後續 Phase owner。
- `skipped`：未啟用 live smoke 或環境不可用，不得假裝通過。

矩陣至少建立以下案例：

### 地點形式

```text
台北天氣
臺北天氣
台北市現在幾度
高雄鳳山天氣
北京市朝陽區天氣
Singapore weather
新加坡天氣
São Paulo weather
東京 weather
```

### 輸入變體

- 全形／半形。
- 多餘空白。
- 標點。
- 口語長句。
- 錯字。
- 中英混輸。
- 同名城市。
- 缺少國家或行政區。
- 完全未提供地點。

### 時間與能力

- 現在幾度。
- 現在是否下雨。
- 今天會不會下雨。
- 明天天氣（若尚無 Forecast Tool，標為 Phase 2 known gap）。
- 今晚天氣（若尚無 Forecast Tool，標為 Phase 2 known gap）。
- 週末天氣（若尚無 Forecast Tool，標為 Phase 2 known gap）。
- 下週是否適合出遊（若尚無 Forecast Tool 或 advice 能力，標為 Phase 2 known gap）。
- 歷史天氣（若尚無 Historical Tool，標為 known gap，不得用 current observation 代答）。
- 一般氣候問題（若尚無 climate capability，標為 known gap，不得用 current observation 代答）。

### 失敗

- Planner 回傳非 JSON。
- Planner 缺少 `location`。
- Provider 無候選。
- Provider Timeout。
- Provider Error。
- 多候選接近。
- Weather Provider Error。
- 使用者取消。
- Tool 成功但 Synthesis 失敗。
- Live smoke 未啟用時必須記錄為 `skipped`，不得記錄為 pass。

### Baseline Report

Baseline report 必須包含：

- case id。
- mode：`deterministic`、`mock_integration` 或 `live_smoke`。
- capability category。
- expected outcome summary。
- observed outcome summary。
- result classification：`pass`、`fail`、`known_gap` 或 `skipped`。
- known gap owner（例如 Phase 2 forecast、Phase 3 clarification）。
- reproduction commands。

Baseline report 不得包含：

- API Key、Authorization Header、Credential、Token。
- 完整 Prompt。
- Raw Provider Body。
- 未限制大小的 Tool Output。
- Live smoke 大型原始輸出。

`weather-golden-eval` Phase 1 的 baseline report 固定提交於：

```text
openspec/changes/weather-golden-eval/baseline-report.md
```

---

## 9. 關係型測試

除了固定案例，必須驗證不變關係：

- `台北`、`臺北`、`台北市` 應解析至相容地理實體。
- 加入不影響語意的標點不得改變解析結果。
- 加入國家或行政區只能縮小候選，不得跳到不相關地點。
- `Singapore` 與 `新加坡` 應落到相同或等價實體。
- Provider Error 不得變成 `not_found`。
- `needs_clarification` 不得被 UI 當作一般錯誤。
- 晚到事件不得讓已完成卡片回到 Loading。

---

## 10. 修復流程與停止線

每次修復必須：

1. 先新增失敗案例。
2. 記錄 Planner 結構化輸出。
3. 記錄 Resolver Query Variant 與 Candidate 摘要。
4. 判斷失敗層級。
5. 只修改真正負責的層。
6. 執行完整 Golden Regression。
7. 執行受影響的 Frontend 與 Backend 測試。
8. 有條件時執行真實模型與 Provider Smoke Test。

同類問題兩輪仍失敗，或修復 A 導致 B 回歸時，禁止繼續疊加 Prompt 範例、Regex 或特殊 Mapping；必須回到能力邊界、Schema 與跨層不變量重新分析。

---

## 11. 驗證命令

```bash
cd backend
npm run lint
npm run test
npm run build

cd ../frontend
npm run lint
npm run test
npm run build
```

若 BFF 契約或 Proxy 行為有改動：

```bash
cd ../bff
npm run build
```

Mock 通過只代表 deterministic / integration 行為通過，不代表真實模型與真實天氣 Provider 已完成驗收。
