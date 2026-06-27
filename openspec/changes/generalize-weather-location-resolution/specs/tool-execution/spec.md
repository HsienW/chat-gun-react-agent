# Delta for Tool Execution

## ADDED Requirements

### Requirement: 天氣地點解析不得依賴固定地區清單

`current_weather` Tool MUST 接受通用自然語言地點輸入，且 MUST NOT 以固定城市 allowlist、人工城市 mapping、hard-coded 自然語言 keyword regex、CJK phrase stripping 或固定問題標點刪除作為主要解析方式。

#### Scenario: 查詢未預先配置的城市

- GIVEN 使用者查詢一個未出現在任何人工城市表中的有效城市
- WHEN `current_weather` 解析該地點
- THEN 系統 MUST 將地點交由 Geocoding Provider 解析
- AND 系統 MUST NOT 因城市未預先配置而拒絕查詢

#### Scenario: 地點使用繁體中文

- GIVEN 使用者以繁體中文提供有效地點
- WHEN `current_weather` 執行地點解析
- THEN 系統 MUST 保留原始地點文字
- AND 系統 MUST 透過正規化與 Provider 查詢變體嘗試解析
- AND 系統 MUST NOT 要求該地點必須先存在於人工繁中對照表

#### Scenario: 查詢包含自然語言問句詞

- GIVEN 使用者輸入包含天氣、現在、今天、幾度、會下雨嗎、嗎、？或其他自然語言問句片段
- WHEN `current_weather` 或其上游 Runtime 需要取得地點
- THEN 系統 MUST 使用 Planner schema/prompt、Runtime Validation、受限制 LLM Repair 或 Provider-driven Resolver
- AND 系統 MUST NOT 以 `WEATHER_QUERY_WORDS`、`CJK_WEATHER_QUERY_PARTS`、`QUESTION_PUNCTUATION` 或等價固定詞表刪字後將剩餘文字視為地點
- AND 系統 MUST NOT 讓該刪字結果覆蓋 `raw`

#### Scenario: CJK 片段可能是地點上下文

- GIVEN 使用者輸入包含市、區、縣、州、省、台、臺、中山、新城或其他可能同時是地名與自然語言片段的 CJK 文字
- WHEN 系統執行正規化或查詢變體建立
- THEN 系統 MUST 保留可能影響 Geocoding 的地點上下文
- AND MUST NOT 以 CJK phrase stripping 作為主要 location extraction
- AND 若地點不明確，系統 MUST 回傳 `ambiguous` 或要求補充，而不是刪字猜測

#### Scenario: 地點使用重音字元

- GIVEN 使用者提供如 `São Paulo` 或 `München` 的地點
- WHEN 系統執行正規化
- THEN 系統 MUST 保留具有語意的 Unicode 字元
- AND 系統 MUST NOT 因非 ASCII 字元直接判定地點無效

---

### Requirement: 地點正規化必須保留原始輸入

系統 MUST 將原始地點與正規化查詢分離儲存。

#### Scenario: 正規化地點文字

- GIVEN 使用者地點包含前後空白、全形字元或重複空白
- WHEN 系統建立 Location Query
- THEN 系統 MUST 保留未改寫的 `raw`
- AND 系統 MUST 產生經過 Trim、Unicode NFKC 與空白合併的 `location`
- AND 系統 MUST NOT 將正規化視為地點翻譯

#### Scenario: 行政區後綴具有辨識價值

- GIVEN 使用者輸入包含市、區、縣、州或省等行政區資訊
- WHEN 系統正規化地點
- THEN 系統 MUST 保留可能影響 Geocoding 的行政區資訊
- AND 系統 MUST NOT 無條件移除行政區後綴

#### Scenario: 固定問句詞表清理會改變語意

- GIVEN 一個候選實作使用固定 regex 或固定詞表刪除自然語言片段來產生 location
- WHEN 該清理可能移除行政區、地名別名、語言上下文或產生空字串
- THEN 該實作 MUST NOT 被視為合格的主要地點解析策略
- AND 必須改用 Planner schema/prompt、Runtime Validation、受限制 LLM Repair 或 Provider-driven Resolver

---

### Requirement: Geocoding 必須透過 Provider Adapter

地點解析 MUST 經由 `GeocodingProvider` 契約執行，Weather Tool MUST NOT 將 Provider URL、Response Shape 與候選選擇邏輯耦合成不可替換的單一流程。

#### Scenario: 使用 Mapbox Geocoding v6

- GIVEN 目前正式設定的 Geocoding Provider 為 Mapbox Geocoding v6
- WHEN系統搜尋地點
- THEN Provider Adapter MUST 先對 Mapbox Response 執行 Runtime Schema Validation
- AND MUST 將已驗證 Response 轉換成標準 `LocationCandidate`
- AND下游 Resolver MUST 只依賴標準 Candidate 契約
- AND Open-Meteo MUST 僅作為 Weather Provider，不得要求 Planner 產生英文或其他 Provider-specific hint

#### Scenario: Provider 回傳額外欄位

- GIVEN Geocoding Provider 回傳目前 Domain Model 未使用的欄位
- WHEN Adapter 轉換 Provider Response
- THEN系統 MUST 忽略未知欄位
- AND MUST NOT 因未知欄位造成解析失敗

---

### Requirement: 地點解析必須明確區分六種結果

Location Resolver MUST 回傳 `resolved`、`ambiguous`、`not_found`、`provider_error`、`timeout` 或 `cancelled` 之一。

#### Scenario: 唯一高可信候選

- GIVEN Provider 回傳一個明確符合 location、country 與 region 的候選
- WHEN Resolver 完成評分
- THEN結果 MUST 為 `resolved`
- AND結果 MUST 包含 Candidate、Confidence、Strategy 與 provider-neutral Attempts

#### Scenario: 多個候選分數接近

- GIVEN Provider 回傳多個合理候選
- AND前兩名候選差距低於設定的歧義閾值
- AND使用者沒有提供足夠的 country 或 region
- WHEN Resolver 完成評分
- THEN結果 MUST 為 `ambiguous`
- AND結果 MUST 提供最多五個去重候選
- AND系統 MUST NOT 自動選擇第一個候選

#### Scenario: 沒有可接受候選

- GIVEN Provider 正常回應
- AND所有候選均低於最低可信分數
- WHEN Resolver 完成評分
- THEN結果 MUST 為 `not_found`
- AND系統 MUST NOT 捏造座標

#### Scenario: Provider 無法連線

- GIVEN Geocoding Provider 發生 Network Error、rate limit、circuit open 或 configuration error
- WHEN Resolver 無法取得候選
- THEN結果 MUST 為 `provider_error`
- AND結果 MUST 包含 `network | rate_limited | circuit_open | configuration` reason
- AND結果 MUST 標示是否可重試
- AND系統 MUST NOT 將該結果誤判為 `not_found`

#### Scenario: Provider 逾時

- GIVEN單次 timeout 或整體 Geocoding budget 到期
- AND尚未取得 resolved 或 ambiguous 語意結果
- WHEN Resolver 結束
- THEN結果 MUST 為 `timeout`
- AND MUST NOT 合併為 `provider_error` 或 `not_found`

#### Scenario: 使用者取消

- GIVEN上游 AbortSignal 已取消
- WHEN Resolver 尚在執行
- THEN結果 MUST 立即為 `cancelled`
- AND MUST 停止 retry、fallback 與 queued request

#### Scenario: 多次 attempt 聚合

- GIVEN Resolver 執行多個 query 或未來多個 Provider attempt
- WHEN結果包含不同 outcome
- THEN聚合優先序 MUST 為 `cancelled` → `resolved` → `ambiguous` → `timeout` → `provider_error` → `not_found`
- AND `not_found` MUST 只在所有允許 attempt 都正常完成且無候選時產生

---

### Requirement: 候選選擇必須是可測試的決定性流程

Candidate Scoring MUST 使用可測試的規則，且 MUST 優先採用使用者提供的 country 與 region context。

#### Scenario: 國家提示與人口排序衝突

- GIVEN一個人口較高的候選不符合使用者 country
- AND另一個人口較低的候選符合使用者 country
- WHEN系統評分候選
- THEN符合 country 的候選 MUST 優先
- AND人口 MUST 僅作為次要 Tie-breaker

#### Scenario: 相同輸入與相同候選

- GIVEN相同的 Location Query
- AND相同的 Provider Candidate 集合
- WHEN Resolver 重複執行
- THEN Resolver MUST 產生相同結果
- AND不得依賴 LLM 隨機輸出決定 Candidate

---

### Requirement: Weather Tool 必須回傳版本化結構結果

`current_weather` MUST 回傳包含 `schemaVersion`、`tool` 與 `status` 的結構化結果。

#### Scenario: 成功取得天氣

- GIVEN地點解析結果為 `resolved`
- AND Weather Provider 回傳目前天氣
- WHEN Tool 完成
- THEN結果 MUST 包含 `schemaVersion: "2.0"` 與受驗證的 `geocodingStorageMode`
- AND MUST 包含 `tool: "current_weather"`
- AND MUST 包含 `status: "success"`
- AND MUST 包含 Requested Location、Observation Time、Timezone、Current Data、Units、Weather Provider、Provider Attribution 與 Summary
- AND只有 Permanent 模式 MUST 包含 Mapbox 衍生 Resolved Location
- AND Temporary 模式 MUST 改用等於使用者原始地點的 Display Location
- AND Temporary 模式的 Provider Attribution MUST 為固定無 query string URL，不得保存含 latitude、longitude、query 或 feature ID 的 request URL

#### Scenario: 地點有歧義

- GIVEN地點解析結果為 `ambiguous`
- WHEN Tool 完成
- THEN結果 MUST 包含 `status: "needs_clarification"`
- AND Permanent 模式的 durable result MUST 包含可安全顯示的候選
- AND Temporary 模式的 durable result MUST 不含候選，且 MUST NOT 發出任何 Mapbox candidate event
- AND MUST NOT 將歧義包裝成未知系統錯誤

#### Scenario: 找不到地點

- GIVEN地點解析結果為 `not_found`
- WHEN Tool 完成
- THEN結果 MUST 包含 `status: "not_found"`
- AND Error Code MUST 為 `weather_location_not_found`
- AND Summary MUST 指示需要更完整地點

#### Scenario: Tool 發生錯誤

- GIVEN Geocoding 或 Forecast Provider 發生錯誤
- WHEN Tool 完成
- THEN結果 MUST 包含 `status: "error"`
- AND MUST 包含穩定 Error Code
- AND MUST 包含 Retryable
- AND MUST NOT 包含 API Key、Proxy Credential 或 Stack Trace

---

### Requirement: Weather Provider 呼叫必須支援 Timeout、Cancel 與受限制 Retry

Geocoding 與 Forecast Provider Request MUST 支援 Abort，且 Retry MUST 只用於暫時性錯誤。

#### Scenario: Geocoding 超過 Timeout

- GIVEN Geocoding Request 超過設定 Timeout
- WHEN Timeout 觸發
- THEN系統 MUST 中止底層 Fetch
- AND Tool Result MUST 為 `status: "error"`
- AND Error Code MUST 為 `weather_timeout`

#### Scenario: 使用者取消 Agent Run

- GIVEN上游 Agent Run 已取消
- WHEN Weather Provider Request 尚未完成
- THEN系統 MUST 中止 Request
- AND結果 MUST NOT 被標示為成功
- AND Tool MUST 進入 Terminal State

#### Scenario: Provider 回傳暫時性錯誤

- GIVEN Provider 回傳可重試的 429、502、503 或 504
- WHEN Retry Policy 允許重試
- THEN系統 MUST 最多重試一次
- AND MUST 使用有界退避
- AND Audit MUST 記錄 Retry 次數

#### Scenario: 地點有歧義

- GIVEN Resolver 回傳 `ambiguous`
- WHEN Tool 建立結果
- THEN系統 MUST NOT 重試 Provider
- AND MUST NOT 將歧義送給 LLM 自動選擇

#### Scenario: 有界重試與全域解析預算

- GIVEN Mapbox Geocoding 發生暫時性 Network Error、429、502、503 或 504
- WHEN Resolver 執行 retry
- THEN 每次暫時性失敗 MUST 最多重試一次
- AND MUST 優先遵守 `Retry-After`，否則使用 exponential backoff 與 bounded jitter
- AND 單次 Provider timeout MUST 預設為 5000ms
- AND 整體 Geocoding budget MUST 預設為 8000ms
- AND query variants MUST 最多為 3，所有網路嘗試合計 MUST 最多為 4
- AND 所有上限 MUST 可透過受驗證設定調整

#### Scenario: Circuit breaker 開啟與 half-open

- GIVEN 同一 Geocoding Provider 跨請求連續發生 5 次可重試失敗
- WHEN 下一個 Geocoding Request 到達
- THEN circuit breaker MUST 開啟並預設拒絕請求 60000ms
- AND cooldown 後 MUST 只允許 1 次 half-open 探測
- AND成功探測 MUST 關閉 breaker 並歸零
- AND `invalid_input`、`ambiguous`、`not_found` 與 user cancel MUST NOT 計入門檻
- AND 5 次門檻 MUST NOT 被實作為單一請求重試 5 次

#### Scenario: Rate limiter admission

- GIVEN Mapbox request 準備送出
- WHEN per-provider token bucket、concurrency semaphore 或 bounded queue 評估 admission
- THEN每個 process MUST 使用獨立且受驗證的 per-instance token bucket，預設 100 requests/minute
- AND queue 等待 MUST 計入 8000ms 總解析預算
- AND queue 超過預設 100 或剩餘 budget 不足 MUST 回 `provider_error.reason = "rate_limited"`
- AND 429 MUST 依 `Retry-After` 暫停該 process 的 bucket
- AND per-instance 額度、最大 concurrency 與 queue size 預設 MUST 分別為 100/min、10、100，且都 MUST 通過 Runtime Validation

#### Scenario: 多 Backend instance

- GIVEN Backend 以多個 replica 部署
- WHEN Platform／Operations 設定 Geocoding traffic governance
- THEN文件 MUST 明確指出 process-local limiter 不保證跨 replica 全域上限
- AND Platform／Operations MUST 依核准的最大 replica 數設定 per-instance 額度並監控 token 級 Provider 用量
- AND circuit breaker MUST 明定為 process-local、restart 歸零、每個 process 最多 1 個 half-open probe
- AND本 Change MUST NOT 宣稱或測試不存在的共享 Redis／global governor

---

### Requirement: Mapbox Geocoding 儲存模式、憑證與 worldview 必須由設定治理

Mapbox Adapter MUST 支援 `temporary | permanent` 儲存模式，且 MUST 將 token、worldview、egress 與資料保存政策留在 Backend／部署邊界。

#### Scenario: Temporary 模式

- GIVEN `MAPBOX_GEOCODING_STORAGE_MODE=temporary`
- WHEN Runtime 準備呼叫 Mapbox
- THEN Request MUST NOT 設定 `permanent=true`
- AND durable Weather Tool Result MUST 使用 `schemaVersion: "2.0"` 與 `geocodingStorageMode: "temporary"`
- AND success 結果 MUST 只以使用者原始地點作為 `displayLocation`，不得包含 Mapbox 衍生 `resolvedLocation`
- AND success 結果 MUST 只保存固定 `https://open-meteo.com/` attribution，不得保存含 query string 的 Forecast request URL
- AND ambiguous 結果 MUST 只包含以使用者原始地點產生的通用補充提示，不得包含或發送 candidates
- AND Mapbox response、candidate、座標、feature ID 與衍生 resolved label MUST NOT 離開 Backend node或寫入 State、checkpoint、ToolMessage、cache、log／trace、chat history或其他持久化儲存

#### Scenario: Temporary durable projection validation

- GIVEN Temporary result 準備寫入 State、ToolMessage、checkpoint、audit、log 或 trace
- WHEN `prepareTemporaryDurableBundle` 建立 sink projections
- THEN Weather Result／ToolMessage、WeatherExecution State、Audit、Log/Trace MUST 分別使用 closed Runtime Schema
- AND每個 Schema MUST 組合共用 forbidden-field guard，拒絕 candidates、latitude、longitude、feature ID、resolved label、Provider body、含 query URL 與 Mapbox 衍生地理值
- AND Audit Schema MUST 允許 provider identifier、strategy、candidateCount、attemptCount、durationMs、resultStatus、errorCode、requestId 與 runId
- AND所有 projection MUST 在記憶體全部驗證完成前保持零 sink side effect
- AND任一驗證失敗 MUST 丟棄整個未提交 bundle，且 MUST NOT 呼叫 State、ToolMessage、Audit、Log或Trace sink
- AND Runtime MUST 以不 spread／merge 原 payload 的 factory 新建 sanitized `weather_temporary_projection_violation` error
- AND sanitized error MUST 只含版本、tool、error status、安全原始地點、`retryable: false` 與安全文案
- AND sanitized error 的 State、ToolMessage、Audit、Log/Trace projections MUST 分別通過對應 Schema 與共用 guard
- AND通過後 MUST freeze immutable validated bundle
- AND State／ToolMessage／checkpoint MUST 依既有 LangGraph commit 邊界提交
- AND Audit／Log／Trace MUST 只從 validated bundle 派生，以 `runId + toolCallId + eventType` 冪等送出並對暫時性失敗最多 retry 3 次
- AND Observability sink 失敗 MUST 記安全 metric／告警，不得回滾已提交 Graph state
- AND terminal 後晚到的 Provider result MUST 被忽略

#### Scenario: Permanent 模式

- GIVEN `MAPBOX_GEOCODING_STORAGE_MODE=permanent`
- WHEN Runtime 呼叫 Mapbox
- THEN Request MUST 設定 `permanent=true`
- AND durable Weather Tool Result MUST 使用 `schemaVersion: "2.0"` 與 `geocodingStorageMode: "permanent"`
- AND success MAY 包含已驗證的 `resolvedLocation`
- AND ambiguous MAY 在版本化 durable result 中包含顯示候選
- AND若 token／帳戶沒有 Permanent entitlement，MUST 回 `provider_error.reason = "configuration"`，不得自動降級 Temporary

#### Scenario: Worldview 設定

- GIVEN `MAPBOX_WORLDVIEW` 為空
- WHEN Adapter 建立 Request
- THEN Adapter MUST 不傳 worldview 並沿用 Provider 預設
- AND若 `MAPBOX_WORLDVIEW` 有設定，MUST 只接受 `ar | cn | in | jp | ma | rs | ru | tr | us`
- AND worldview MUST NOT 從語言、locale、國家名稱或文字系統推斷

#### Scenario: Mapbox forward request constraints

- GIVEN Adapter 準備建立 Mapbox v6 forward request
- WHEN Runtime Validation 驗證 `q`
- THEN `q` MUST 最多 256 字元與 20 個 words／numbers
- AND `q` MUST NOT 包含 `;`
- AND不符合時 MUST 回穩定 invalid input，不得刪除字元後重試
- AND endpoint MUST 固定為核准的 Mapbox v6 forward endpoint，不得由使用者輸入控制 host、path 或 protocol

#### Scenario: Token 與 egress

- GIVEN Backend 啟用 Mapbox Geocoding
- WHEN Adapter 建立 Request
- THEN `MAPBOX_ACCESS_TOKEN` MUST 從 Backend secret store 注入
- AND Token MUST NOT 出現在 Browser、BFF response、checkpoint、audit、log 或 trace
- AND egress MUST 僅允許核准的 Mapbox endpoint

---

### Requirement: 天氣地點解析必須可觀測

系統 MUST 為 Location Resolution 與 Weather Provider 呼叫記錄結構化 Audit 與 Metric。

#### Scenario: 地點解析成功

- GIVEN Resolver 成功選出 Candidate
- WHEN解析完成
- THEN Audit MUST 記錄 Provider、Strategy、Candidate Count、Attempt Count、Duration 與 Result Status
- AND Metric MUST 記錄 Resolve Duration 與 Success Count

#### Scenario: 地點解析失敗

- GIVEN結果為 `ambiguous`、`not_found` 或 `provider_error`
- WHEN解析完成
- THEN Audit MUST 記錄明確 Result Status 與 Error Code
- AND Audit MUST NOT 記錄 API Key、完整 Prompt 或 Proxy Credential

---

### Requirement: Location Resolver 必須擁有 Provider-facing Query Transformation

Location Resolver MUST 接受已驗證的 `rawLocation` Unicode 地點 span，並 MUST 完整負責 Provider-facing query transformation；新 Schema MUST NOT 接受 Planner 產生的 `queryName`／`queryNameHint`。

#### Scenario: 原始地點直接進入 Resolver

- GIVEN Weather Request 包含非空原始 Unicode `rawLocation`
- WHEN Weather Tool 呼叫 Location Resolver
- THEN Resolver MUST 以原始地點與使用者明確提供的 context 開始解析
- AND MUST NOT 要求 Planner 提供 Latin、翻譯、羅馬化名稱或其他 Provider-specific hint
- AND原始地點 MUST 在所有 transformation 與 fallback 中保持不變

#### Scenario: Legacy queryName 出現在輸入

- GIVEN Weather Tool v2 input 包含 `queryName` 或 `queryNameHint`
- WHEN Runtime Schema 驗證輸入
- THEN該 legacy 欄位 MUST 被拒絕並回穩定 schema error
- AND MUST NOT 進入 Provider query variants
- AND `rawLocation` MUST 保持唯一正式地點欄位

#### Scenario: 地點包含可變行政層級

- GIVEN原始地點可能只有城市名稱，或包含洲際、國家、城市、行政區、鄰里及其他可變層級
- WHEN Resolver 建立 Provider-facing queries
- THEN Resolver MUST 保留完整地理 context
- AND MUST NOT 假設固定層級數量或以固定語言字尾拆解地點
- AND新增上層地理 context 只能維持或縮小合理候選，不得導向不相關地點

### Requirement: Geocoding 必須支援設定化 Provider Capability Fallback

Location Resolver MUST 能在有界且可觀測的策略內使用設定化 Geocoding Provider capability fallback，MUST NOT 以語言、國家、城市或行政區硬映射選擇 Provider。

#### Scenario: 第一個 Provider 無法解析原始文字系統

- GIVEN第一個設定的 Geocoding Provider 對已驗證地點回傳不支援或沒有可接受候選
- AND另一個具相容 capability 的 Geocoding Provider 已設定
- WHEN Resolver 執行 bounded fallback
- THEN Resolver MUST 將同一原始地點與明確 context 交給下一個 Provider Adapter
- AND MUST 記錄 Provider、attempt order、query strategy 與 result status
- AND MUST NOT 要求 Planner 猜測特定語言的 Provider 名稱
- AND第一個通過決定性評分的 Candidate MAY 成為 resolved 結果

#### Scenario: 通用 query transformation 產生候選文字

- GIVEN設定的 transliteration／translation adapter 可為 Provider 建立查詢候選
- WHEN Resolver 使用該候選搜尋
- THEN transformation output MUST 通過 Runtime Validation
- AND MUST 只作為 bounded Provider query
- AND MUST NOT 直接產生座標、Provider ID 或最終 resolved location
- AND Audit MUST 保留 original strategy 與 transformed strategy 的區分

#### Scenario: 所有 Provider 均無候選

- GIVEN所有設定的 Geocoding Provider 都正常回應但沒有可接受候選
- WHEN bounded fallback 結束
- THEN Resolver MUST 回傳 `not_found`
- AND MUST 包含去敏的 attempted provider/query strategy 摘要
- AND MUST NOT 捏造座標或回到 Planner 增加語言特例

#### Scenario: Provider 發生錯誤後 fallback

- GIVEN某個 Provider 回傳 provider error、timeout 或 cancel
- WHEN Resolver 評估 fallback policy
- THEN cancel MUST 立即終止
- AND timeout／provider error MUST 保留穩定錯誤語意
- AND只有明確允許的 retryable／fallback 情況 MAY 嘗試下一個 Provider
- AND最終結果 MUST NOT 將全部 Provider error 誤報為 `not_found`

---

### Requirement: Live Geocoding 驗收必須可重播且證明指定地點成功

Live acceptance MUST 使用正式 Mapbox Geocoding v6 與 Open-Meteo Weather Provider，並 MUST 保存不含 Temporary Provider 衍生資料的可重播結果摘要。

#### Scenario: 台灣高雄大寮

- GIVEN原始地點為 `台灣高雄大寮`
- WHEN live E2E 執行
- THEN結果 MUST 為 `resolved → current_weather success`
- AND MUST NOT 以 `not_found`、`missing_location`、提前 `clarify` 或 mock candidate 作為通過

#### Scenario: 固定種子行政層級矩陣

- GIVEN `mulberry32-v1`、seed `20260627` 產生的州／國／城市與其他行政層級案例
- AND展開案例已提交於 `backend/test-fixtures/weather-location-live-cases.v1.json`
- WHEN live matrix 執行
- THEN執行器 MUST 使用已提交 manifest 並記錄其 hash
- AND無歧義有效案例 MUST 成功取得天氣
- AND只有 Provider 確實回傳多個同名或近似合理候選時 MAY 回 `ambiguous`
- AND執行器 MUST NOT 在 runtime 臨時產生未記錄的隨機案例
