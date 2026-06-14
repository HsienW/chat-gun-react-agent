# Delta for Tool Execution

## ADDED Requirements

### Requirement: 天氣地點解析不得依賴固定地區清單

`current_weather` Tool MUST 接受通用自然語言地點輸入，且 MUST NOT 以固定城市 allowlist 或人工城市 mapping 作為主要解析方式。

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

---

### Requirement: Geocoding 必須透過 Provider Adapter

地點解析 MUST 經由 `GeocodingProvider` 契約執行，Weather Tool MUST NOT 將 Provider URL、Response Shape 與候選選擇邏輯耦合成不可替換的單一流程。

#### Scenario: 使用 Open-Meteo Geocoding

- GIVEN 目前設定的 Geocoding Provider 為 Open-Meteo
- WHEN系統搜尋地點
- THEN Provider Adapter MUST 將 Open-Meteo Response 轉換成標準 `LocationCandidate`
- AND下游 Resolver MUST 只依賴標準 Candidate 契約

#### Scenario: Provider 回傳額外欄位

- GIVEN Geocoding Provider 回傳目前 Domain Model 未使用的欄位
- WHEN Adapter 轉換 Provider Response
- THEN系統 MUST 忽略未知欄位
- AND MUST NOT 因未知欄位造成解析失敗

---

### Requirement: 地點解析必須明確區分四種結果

Location Resolver MUST 回傳 `resolved`、`ambiguous`、`not_found` 或 `provider_error` 之一。

#### Scenario: 唯一高可信候選

- GIVEN Provider 回傳一個明確符合 location、country 與 region 的候選
- WHEN Resolver 完成評分
- THEN結果 MUST 為 `resolved`
- AND結果 MUST 包含 Candidate、Confidence、Strategy 與 Attempted Queries

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

- GIVEN Geocoding Provider 發生 Network Error 或 Timeout
- WHEN Resolver 無法取得候選
- THEN結果 MUST 為 `provider_error`
- AND結果 MUST 標示是否可重試
- AND系統 MUST NOT 將該結果誤判為 `not_found`

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
- THEN結果 MUST 包含 `schemaVersion: "1.0"`
- AND MUST 包含 `tool: "current_weather"`
- AND MUST 包含 `status: "success"`
- AND MUST 包含 Requested Location、Resolved Location、Observation Time、Timezone、Current Data、Units、Provider、Source URL 與 Summary

#### Scenario: 地點有歧義

- GIVEN地點解析結果為 `ambiguous`
- WHEN Tool 完成
- THEN結果 MUST 包含 `status: "needs_clarification"`
- AND MUST 包含可安全顯示的候選
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
