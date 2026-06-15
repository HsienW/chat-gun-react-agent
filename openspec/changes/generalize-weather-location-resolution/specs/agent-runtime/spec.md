# Delta for Agent Runtime

## ADDED Requirements

### Requirement: Planner 不得限制可查詢地區

Deep Research Planner MUST 將天氣地點視為開放文字實體，MUST NOT 透過 Prompt 中的固定城市範例形成地區 allowlist。

#### Scenario: 使用者查詢非範例城市

- GIVEN 使用者詢問一個 Planner Prompt 未列出的有效地點
- WHEN Planner 判斷天氣意圖
- THEN Planner MUST 將 `answerMode` 設為 `weather`
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

Deep Research MUST 依 `WeatherToolResult.status` 更新 State 與產生最終回答，MUST NOT 以人類可讀標籤文字作為主要資料來源。

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
