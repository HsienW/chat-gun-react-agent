# Delta for Agent Runtime

## ADDED Requirements

### Requirement: Bounded LLM Repair Candidate Retry

Runtime MUST limit LLM Repair to one bounded invocation after the first `not_found`; that invocation MAY return up to three textual LocationQuery candidates.

#### Scenario: Multi-candidate repair retries through Resolver

- GIVEN Deterministic Resolver returns `not_found`
- AND the Weather Request has not yet been repaired
- WHEN Runtime starts LLM Repair
- THEN LLM Repair output MUST contain only textual candidates with `location`, optional `country`, optional `region`, and optional `reason`
- AND Runtime MUST reject coordinates, provider IDs, provider candidates, URLs, tool calls, and other direct resolution data
- AND Runtime MUST validate each candidate and re-run the same Provider Resolver with `resolutionStrategy = "llm_repair"`
- AND Runtime MAY use the first candidate that resolves successfully through the provider-backed weather tool
- AND Runtime MUST NOT run a second LLM Repair invocation for the same Weather Request
- AND Runtime MUST NOT ask the LLM to choose among provider candidates when a repair candidate returns `ambiguous`

### Requirement: Planner 不得限制可查詢地區

Deep Research Planner MUST 將天氣地點視為開放文字實體，MUST NOT 透過 Prompt 中的固定城市範例形成地區 allowlist。

#### Scenario: 使用者查詢非範例城市

- GIVEN 使用者詢問一個 Planner Prompt 未列出的有效地點
- WHEN Planner 判斷天氣意圖
- THEN Planner MUST 將 `PlanningResultV2.kind` 設為 `weather`
- AND MUST 將使用者地點放入 Weather Request
- AND MUST NOT 因地點未出現在 Prompt 範例而改成 `clarify`

#### Scenario: 使用者提供 country 或 region

- GIVEN 使用者問題中明確包含國家或行政區
- WHEN Planner 抽取 Weather Request
- THEN Planner SHOULD 將資訊分別放入 `country` 或 `region`
- AND Planner MUST NOT 捏造未出現在問題中的國家

---

### Requirement: Planner 必須保留地點原文且不得產生座標

Planner MUST 保留使用者可辨識的地點文字，並 MUST NOT 輸出 latitude 或 longitude。

#### Scenario: 地點為非英文名稱

- GIVEN 使用者以繁體中文、簡體中文或其他語言提供地點
- WHEN Planner 建立 Weather Request
- THEN Planner MUST 保留可追溯至使用者輸入的地點文字
- AND Tool Resolver MUST 負責多語言查詢
- AND Planner MUST NOT 將翻譯結果視為座標事實

#### Scenario: 複合中文行政區地名

- GIVEN 使用者以多層中文行政區串聯提供地點，例如「台灣高雄大寮天氣如何？」、「北京市朝陽區現在幾度？」
- WHEN Planner 建立 Weather Request
- THEN Planner MUST 將完整行政區文字保留為 `weather.rawLocation`，不得拆解或省略層級
- AND `weather.rawLocation` MUST 包含使用者提供的所有行政區層級原文
- AND Planner MUST NOT 因行政區層級過多而將 `kind` 設為 `clarify` 或產出空 `rawLocation`
- AND Planner MUST 只輸出 `weather.rawLocation` 作為正式地點欄位
- AND Planner Schema MUST 拒絕 legacy `weather.location`、`weather.queryName` 與 `weather.queryNameHint`，並回 `planner_schema_rejected`

#### Scenario: 任意 Unicode 文字系統與行政層級

- GIVEN 使用者以任意 Unicode 語言或文字系統提供單層或多層地點
- AND 地點可能包含洲際、國家、城市、行政區、鄰里或 Provider 可辨識的其他層級
- WHEN Planner 建立 Weather Request
- THEN Planner MUST 將可追溯至目前使用者輸入的完整地點 span 保留為 `weather.rawLocation`
- AND Planner MUST NOT 依語言、文字系統、國家或行政區層級排除該地點
- AND Planner MUST NOT 要求地點先被翻譯、羅馬化或轉寫才能將 `kind` 設為 `weather`
- AND Planner MUST NOT 將整句天氣問句當作 `weather.rawLocation`

#### Scenario: 模型嘗試回傳座標

- GIVEN Planner Response 包含未定義的 latitude 或 longitude
- WHEN Runtime 驗證 Planner Result
- THEN Runtime MUST 忽略或拒絕未定義欄位
- AND MUST NOT 將模型座標傳給 Weather Provider

#### Scenario: Runtime 嘗試以固定問句詞表補救 Planner 失敗

- GIVEN Planner 未能穩定抽取 location
- WHEN Runtime 嘗試修復 Weather Request
- THEN Runtime MUST NOT 以 `WEATHER_QUERY_WORDS`、`CJK_WEATHER_QUERY_PARTS`、`QUESTION_PUNCTUATION` 或等價固定 keyword regex 刪除自然語言片段後猜測地點
- AND MUST 優先修正 Planner schema/prompt、執行 Runtime Validation、使用受限制 LLM Repair 或交由 Provider-driven Resolver 處理
- AND MUST NOT 讓刪字結果覆蓋使用者原始地點文字

---

### Requirement: Agent Runtime 必須以結構化 Weather Result 分流

Deep Research MUST 依 `WeatherToolResultV2.status` 更新 State 與產生最終回答，MUST NOT 以人類可讀標籤文字作為主要資料來源。

#### Scenario: Weather Tool 成功

- GIVEN Weather Tool Result 為 `status: "success"`
- WHEN `targeted_tools` 完成
- THEN Runtime MUST 將 `weatherExecution` 更新為成功 Terminal State
- AND最終回答 MUST 使用 Structured Current Data
- AND MUST NOT 透過搜尋 `Temperature:` 標籤取得溫度

#### Scenario: Weather Tool 需要補充地點

- GIVEN Weather Tool Result 為 `status: "needs_clarification"`
- WHEN Runtime 進入 Synthesis
- THEN `weatherExecution` MUST 為 `needs_clarification`
- AND Assistant MUST 要求使用者補充國家或行政區
- AND Assistant MUST 列出有限候選
- AND Runtime MUST NOT 自動再次呼叫 Weather Tool 選擇第一個候選

#### Scenario: Weather Tool 找不到地點

- GIVEN Weather Tool Result 為 `status: "not_found"`
- WHEN Runtime 產生回答
- THEN Assistant MUST 說明無法解析該地點
- AND SHOULD 要求更完整地點
- AND MUST NOT 宣稱 Weather Provider 網路故障

#### Scenario: Weather Provider 失敗

- GIVEN Weather Tool Result 為 `status: "error"`
- WHEN Runtime 產生回答
- THEN Assistant MUST 顯示簡潔且可行動的失敗訊息
- AND MUST NOT 暴露 Stack Trace、API Key、Proxy Credential 或完整內部 Error Envelope

---

### Requirement: LLM Repair 只能作為受限制的次要策略

Runtime MAY 在第一次 `not_found` 後執行一次 LLM Repair，但 MUST NOT 將 Repair 當成主要地點解析方式。

#### Scenario: 第一次解析找不到地點

- GIVEN Deterministic Resolver 回傳 `not_found`
- AND本次 Weather Request 尚未 Repair
- AND Planner LLM 可用
- WHEN Runtime 啟動 Repair
- THEN LLM MUST 只回傳 location、country 與 region
- AND MUST NOT 回傳座標
- AND Repair Result MUST 重新通過相同 Resolver
- AND Audit MUST 將 Strategy 記錄為 `llm_repair`

#### Scenario: Repair 後仍找不到地點

- GIVEN本次 Weather Request 已執行過一次 Repair
- AND第二次 Resolver 仍回傳 `not_found`
- WHEN Runtime 分流
- THEN Runtime MUST 停止 Repair
- AND Assistant MUST 要求使用者提供更完整地點

#### Scenario: 地點有歧義

- GIVEN Resolver 回傳 `ambiguous`
- WHEN Runtime 分流
- THEN Runtime MUST NOT 啟動 LLM Repair
- AND MUST 將候選交由使用者澄清

#### Scenario: Provider 發生錯誤

- GIVEN Resolver 回傳 `provider_error`
- WHEN Runtime 分流
- THEN Runtime MUST NOT 啟動 LLM Repair
- AND MUST 保留 Provider Error 語意

#### Scenario: Repair 不得降級為 hard-coded phrase stripping

- GIVEN Runtime 需要改善 `not_found` 後的查詢文字
- WHEN Planner LLM 不可用或 Repair 驗證失敗
- THEN Runtime MUST NOT fallback 到 hard-coded weather keyword stripping 或 CJK phrase stripping
- AND MUST 直接保留 `not_found` 或要求使用者提供更完整地點

---

### Requirement: Weather Execution State 必須可序列化且終態不可逆

Deep Research State MUST 使用可 JSON Serialize 的 Weather Execution State，且 Terminal State MUST NOT 回到 Running。

#### Scenario: Tool 執行中

- GIVEN Runtime 已開始呼叫 Weather Tool
- WHEN Tool 尚未完成
- THEN `weatherExecution.status` MUST 為 `running`
- AND State MUST 包含 Requested Location

#### Scenario: Tool 已成功

- GIVEN `weatherExecution.status` 已為 `success`
- WHEN後續 Stream Event 到達
- THEN Runtime MUST NOT 將同一次 Weather Execution 改回 `running`

#### Scenario: Tool 已取消

- GIVEN `weatherExecution.status` 已為 `failed`
- AND Error Code 為 `weather_cancelled`
- WHEN延遲的 Provider Response 到達
- THEN Runtime MUST 忽略該成功結果
- AND Terminal State MUST 保持取消

---

### Requirement: Deep Research 必須保持既有公開識別字相容

本 Change MUST 保持 `deep_researcher` Graph ID、`current_weather` Tool Name 與 `messages` State Key 不變。

#### Scenario: Frontend 使用既有 Graph ID

- GIVEN Frontend 以 `deep_researcher` 建立 LangGraph Stream
- WHEN新版 Backend 啟動
- THEN Graph MUST 可被相同 ID 載入
- AND Frontend MUST NOT 因本 Change 修改 Assistant ID

#### Scenario: Tool Registry 載入 Weather Tool

- GIVEN Tool Registry 載入 Base Tools
- WHEN Tool Governance 套用後
- THEN Weather Tool Name MUST 仍為 `current_weather`
- AND現有 Allowlist 設定 MUST 繼續有效

---

### Requirement: Weather Planning 必須以穩定結構狀態分流

Deep Research MUST 以 Runtime Validation 後的 machine status 與結構化欄位決定 Weather Retry、Tool Routing 與 Clarification，MUST NOT 以固定自然語言 keyword 或 localized clarification 文案作為權威分流條件。

#### Scenario: 非空原始地點但缺少 Provider-friendly hint

- GIVEN Planner 已判斷目前請求為天氣意圖
- AND Planner 提供非空且可追溯的 `weather.rawLocation`
- AND Planner 只提供非空 `weather.rawLocation`
- WHEN Runtime 驗證 Weather Request
- THEN Runtime MUST 將 Request 路由至 Weather Tool／Location Resolver
- AND MUST NOT 將缺少 Provider-friendly hint 解讀為 `missing_location`
- AND MUST NOT 直接產生地點補充文案

#### Scenario: Planner 確實未抽取到地點

- GIVEN Runtime Validation 確認目前請求為天氣意圖
- AND沒有非空且可追溯至目前使用者輸入的地點 span
- WHEN Runtime 建立 Planning Outcome
- THEN machine status MUST 明確表示 `missing_location`
- AND Runtime MAY 要求使用者提供地點
- AND顯示文案 MUST NOT 成為後續 Routing 的狀態來源

#### Scenario: Planner Parse 或 Schema Validation 失敗

- GIVEN主 Planner 或 bounded extraction retry 發生 parse error、schema rejection、invoke error 或 model refusal
- WHEN Runtime 建立 Planning Outcome
- THEN machine status MUST 表示對應的 extraction failure
- AND MUST NOT 將該失敗偽裝成使用者缺少地點
- AND Audit MUST 記錄去敏的 phase、provider、model、failure code 與 result status
- AND Routing MUST NOT 以固定 weather keyword 或特定語言文案重建地點

#### Scenario: Localized clarification 文案改變

- GIVEN產品變更 locale、翻譯或 clarification 顯示文案
- WHEN Runtime 對相同結構化 Planning Outcome 分流
- THEN Weather Retry 與下一個 Graph Node MUST 保持不變
- AND Runtime MUST NOT 比對顯示文字決定是否執行 Weather Tool

### Requirement: Planner Schema 約束不得只依賴 Prompt 文字

Weather Intent／Location Extraction MUST 使用模型能力支援的 Structured Output、Tool Calling 或等價的 Runtime Schema Validation 契約，並 MUST 保持 Provider Adapter 邊界。

#### Scenario: 模型產生 Weather Extraction Result

- GIVEN目標模型支援結構化 JSON 或 Tool Calling
- WHEN Runtime 要求模型抽取 Weather Intent 與 Location
- THEN模型輸出 MUST 通過同一份 Runtime Schema
- AND Schema MUST 區分 weather、missing location、not weather 與 extraction error
- AND非空 `weather.rawLocation` MUST 保留原始 Unicode 地點 span
- AND `weather.rawLocation` MUST 為唯一正式地點欄位
- AND legacy `weather.location`、`weather.queryName` 與 `weather.queryNameHint` MUST 被拒絕並回 `planner_schema_rejected`
- AND未知欄位、座標、Provider candidate、URL 或 Tool command MUST 被拒絕或忽略

#### Scenario: 模型不支援相同結構化模式

- GIVEN目前 Provider／Model 不支援指定 Structured Output 或 Tool Calling 能力
- WHEN Runtime 建立模型呼叫
- THEN Provider Adapter MUST 選擇已宣告且相容的結構化模式或回傳明確 capability error
- AND Domain Schema MUST NOT 因模型名稱或語言而改變
- AND Runtime MUST NOT fallback 到自然語言文案解析

---

### Requirement: PlanningResultV2 必須取代 ResearchPlan

Weather extraction MUST 作為完整 `PlanningResultV2` union 的正式分支，且 `PlanningResultV2` MUST 取代既有 `ResearchPlan`；MUST NOT 在新 run 中先產生 `ResearchPlan` 再轉換成新 union。

#### Scenario: 新 run 建立 planning outcome

- GIVEN 使用者開始新的 `deep_researcher` run
- WHEN Planner 完成 Runtime-validated structured extraction
- THEN State MUST 寫入 `schemaVersion: 2` 的 `PlanningResultV2`
- AND Routing MUST 只依 `PlanningResultV2` discriminant 與已驗證欄位
- AND union MUST 完整區分 `direct`、`weather`、`calculation`、`research`、`missing_location`、`clarify` 與 `extraction_error`
- AND `direct` MUST NOT 攜帶 Tool request、queries 或 urls
- AND `weather` MUST 包含非空 `rawLocation`、weatherCapability 與 units，且不得包含座標或 Provider candidate
- AND `calculation` MUST 包含非空 expression
- AND `research` MUST 包含至少一筆 query、urls 陣列與大於等於 1 的 requiredSourceCount，freshness MAY 為 `pd | pw | pm | py`
- AND `missing_location` MUST 只表示 Weather intent 沒有地點；一般資訊不足 MUST 使用具有穩定 reason 的 `clarify`
- AND `extraction_error` MUST 使用穩定 parse、schema、invoke、refusal 或 capability error code
- AND Graph ID、BFF Route 與 Messages Key MUST 保持相容
- AND `plan_research` MUST 是唯一 writer，State 預設 MUST 為 `undefined` 且 reducer MUST 採 overwrite
- AND新 run MUST NOT 透過 Feature Flag 回到 `ResearchPlan` 或舊文字 Tool Result

#### Scenario: PlanningResultV2 Graph routing

- GIVEN State 包含通過 Runtime Validation 的 `PlanningResultV2`
- WHEN Graph 選擇下一個 Node
- THEN `direct | missing_location | clarify | extraction_error` MUST 前往 `synthesize_answer`
- AND `weather | calculation` MUST 前往 `targeted_tools`
- AND `research` MUST 前往 `generate_queries`
- AND Routing MUST NOT 讀取 localized clarification、固定 weather keyword 或 legacy `answerMode`

#### Scenario: 舊 checkpoint 嘗試 resume

- GIVEN checkpoint 缺少 `schemaVersion: 2` 或 planning payload 不符合 `PlanningResultV2`
- WHEN Runtime 嘗試 resume
- THEN Runtime MUST 回傳 terminal error code `planner_checkpoint_incompatible_v2`
- AND MUST 發出不含原始 payload 的 `planning_checkpoint_rejected` audit event
- AND MUST NOT 以 Optional 欄位、顯示文案或 heuristic coercion 猜測新狀態
- AND checkpoint MUST 標記 non-resumable
- AND MUST NOT 複製或封存原始 planning payload
- AND Platform／Operations CronJob MUST 每小時執行 idempotent cleanup CLI
- AND cleanup MUST 透過 `CheckpointRetentionAdapter` 刪除 incompatible checkpoint，單筆最多重試 3 次
- AND oldest pending age 達 12 小時 MUST warning，達 24 小時 MUST critical alert
- AND Change 完成前 MUST 以 production-equivalent adapter 證明標記、重試、冪等刪除與告警
- AND Audit MUST 只保留去敏 metadata，不得保存完整 Prompt 或 Mapbox 衍生資料

#### Scenario: Temporary Mapbox 結果遇到 checkpoint

- GIVEN `MAPBOX_GEOCODING_STORAGE_MODE=temporary`
- WHEN Graph 準備提交 checkpoint、ToolMessage、stream trace 或 chat history
- THEN payload MUST NOT 包含 Mapbox response、candidate、座標、feature ID 或衍生 resolved label
- AND只能保存使用者原始地點與非 Mapbox 衍生的 Weather Provider 資料
- AND Runtime MUST 在提交前以 sink-specific Weather Result、WeatherExecution State、Audit、Log/Trace Schema及共用 forbidden-field guard 驗證 bundle
- AND所有 projection MUST 在記憶體全部通過前保持零 sink side effect
- AND違規 bundle MUST 被丟棄，且不得呼叫 State、ToolMessage、checkpoint、Audit、Log、Trace 或下游 event
- AND Runtime MUST 新建最小 sanitized `weather_temporary_projection_violation` bundle並逐 sink 驗證
- AND sanitized bundle MUST freeze 後依既有 LangGraph commit 邊界更新 `weatherExecution.failed`、建立安全 ToolMessage並使 Graph terminal
- AND Observability MUST 只從 validated bundle 派生，採冪等 best-effort／最多 3 次 retry；失敗不得回滾 Graph state
- AND晚到 Provider result MUST NOT 讓 terminal state 回到 running 或 success
