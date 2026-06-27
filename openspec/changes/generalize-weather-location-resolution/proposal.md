# Proposal：泛化 Deep Research 天氣地點解析

## Intent

目前 `deep_researcher` 的天氣查詢流程已具備 `current_weather` Tool、Open-Meteo Geocoding、候選評分，以及地點解析失敗後的一次 LLM 修復流程。

但目前使用者仍可能感受到「只能查部分地區」或「換一種地名寫法就失敗」，核心原因不是單純缺少更多城市 mapping，而是地點解析責任尚未形成穩定契約：

- Planner LLM 需要先把自然語言地點轉成 geocoding-friendly 名稱。
- 不同語言、繁簡體、行政區後綴、別名與重音字元的解析結果不一致。
- 同名城市缺乏結構化的歧義狀態，容易被當成一般錯誤或被模型自行猜測。
- Tool 主要回傳標籤文字，Deep Research 再透過字串查找解析欄位。
- `not_found`、`ambiguous`、`provider_error` 與 `timeout` 的語意尚未形成一致的跨層契約。
- 如果以人工城市表或固定地區 mapping 補洞，會持續增加維護成本，且無法覆蓋全球地點。
- 目前實測已證明，以固定自然語言 keyword regex、CJK phrase stripping 或固定標點刪除來「刪掉問題詞後猜剩餘文字是地點」會破壞多語言、行政區與自然語序，不能作為主要修復策略。

本 Change 將天氣地點處理改造成「Provider 驅動、結構化、可版本化、可要求澄清」的解析流程，而不是持續擴充人工地名映射。

---

## Goals

1. 使用者可以使用繁體中文、簡體中文、英文及常見 Unicode 地名查詢天氣。
2. 系統不得以固定城市 allowlist 或人工城市 mapping 作為主要地點解析方式。
3. 地點解析以 Geocoding Provider 回傳資料作為最終地理事實來源。
4. Planner LLM 只負責意圖與實體抽取，不得直接決定座標或在歧義時自行選擇城市。
5. 系統不得以 hard-coded 自然語言 keyword regex、CJK phrase stripping 或固定標點刪除作為主要地點抽取修復策略。
6. 地點解析必須區分：
   - `resolved`
   - `ambiguous`
   - `not_found`
   - `provider_error`
7. `current_weather` 必須回傳具備版本號的結構化結果，不再要求下游以標籤文字解析。
8. Deep Research 遇到歧義地點時，必須要求使用者補充國家或行政區，並提供候選。
9. 前端必須正確顯示成功、需補充地點、失敗與逾時狀態。
10. 地點解析與天氣 Provider 呼叫必須具備 timeout、受限制的 retry、audit 與 metric。
11. 保持既有 `deep_researcher` Graph ID、BFF Route 與一般聊天訊息格式相容。
12. Planner 必須保留任意 Unicode 語言與文字系統的原始地點實體，不得排除特定語言、文字系統或行政區層級。
13. Planner 不得因缺少 geocoding-friendly、Latin 或翻譯後名稱而把已存在的原始地點判定為缺失。
14. Provider-facing query transformation 與多 Provider fallback 必須由 Location Resolver／Provider Adapter 邊界負責，不得要求 Planner 承擔特定文字系統轉寫。
15. Planner、Retry 與 Graph Routing 必須依 Runtime Validation 後的結構化狀態分流，不得依固定自然語言 keyword 或 localized clarification 文案判斷。
16. 真實模型抽取、真實 Geocoding 與完整 E2E 驗收必須有獨立證據；Mock 通過不得作為 Change 完成依據。
17. Mapbox Geocoding API v6 是本 Change 正式啟用的 Geocoding Provider；Open-Meteo 僅保留為 Weather Provider。
18. Mapbox 預設採 Temporary Geocoding，並保留透過部署設定切換 Permanent Geocoding 的能力；兩種模式必須遵守不同的資料保存政策。
19. `台灣高雄大寮` 必須在 live E2E 成功解析並取得天氣，不得以 `not_found` 作為通過結果；真正歧義的地點必須回傳候選請使用者確認。

---

## Non-goals

本次不處理：

- 七日或十五日完整天氣預報。
- 雷達圖、衛星圖或地圖 UI。
- 使用者裝置 GPS 定位。
- 建立完整全球地名資料庫。
- 在第一階段接入第二個 Weather Provider。
- 將 MCP Execution 拆成獨立 Tool Service 或 Container。
- 全面重構所有 Tool 的輸出格式。
- 全面重構 BFF Stream Protocol。
- 以人工維護所有城市別名、行政區別名或國家名稱。
- 以 `WEATHER_QUERY_WORDS`、`CJK_WEATHER_QUERY_PARTS`、`QUESTION_PUNCTUATION` 這類固定詞表或 regex 刪除自然語言片段後猜測地點。
- 以 CJK phrase stripping 作為 Planner 或 Provider Resolver 的替代品。
- 針對特定語言、文字系統、國家、洲際或行政區層級建立固定解析分支。
- 將整句自然語言問句不經實體抽取直接當作 Geocoding location。
- 要求 Planner 必須翻譯、羅馬化或轉寫地名才能呼叫 Weather Tool。
- 修改既有 Graph ID。
- 修改公開 `/api/langgraph/*` Route。

---

## Scope

### Backend

- 建立 Location Resolution Domain Type。
- 建立 Geocoding Provider Adapter。
- 對輸入地點做可預測的正規化與查詢變體。
- 以 Provider 候選資料與可設定評分規則完成解析。
- 對歧義、找不到與 Provider 失敗產生不同結果。
- 將 Weather Tool Result 改為結構化、可版本化的 Discriminated Union。
- 讓 Deep Research 直接依結構化結果分流。
- 限制 LLM Repair 的使用範圍。
- 將 Planner 的 Weather Intent／Location Extraction 改為 Runtime Schema 驗證的穩定結果；`weather.rawLocation` 保存完整原始地點 span。
- 從 `PlanningResultV2` 與新 Weather Tool input 移除 legacy `queryName`；Planner 只輸出 `rawLocation`，Provider-facing transformation 完全由 Resolver／Adapter 負責。
- 由 Resolver 建立 Provider-facing 查詢、套用 Provider capability fallback，並保留原始地點與每次嘗試。
- 實作 Mapbox Geocoding v6 Adapter，對 Provider response 執行 Runtime Validation，再轉換為 provider-neutral `LocationCandidate`。
- 新增 Mapbox access token、storage mode、worldview、timeout、rate-limit、retry、circuit-breaker 與全域解析預算設定。
- Temporary 模式只允許在單次執行期間使用 Mapbox 結果；Mapbox response、候選、座標及其衍生 resolved label 不得寫入 checkpoint、cache、長期 log／trace 或其他持久化儲存。
- 移除以固定 keyword 或 localized clarification 文案驅動 Weather Retry／Routing 的依賴。
- 增加 Audit、Metric 與測試。

### Frontend

- 顯示天氣 Tool 的執行結果狀態。
- 對 `needs_clarification` 顯示可理解的提示與候選地點。
- 對未知版本或未知狀態提供降級顯示。
- 在 Temporary 模式，Mapbox 候選不得離開 Backend node；歧義時只顯示以使用者原始地點產生的通用補充提示，不列出 Provider 候選。Permanent 模式才可持久化並顯示候選。
- 不直接顯示原始 Provider Error、Stack Trace 或敏感內容。

### BFF

- 不新增公開 Route。
- 不改變 `/api/langgraph/*` Proxy 行為。
- 驗證 Stream 與取消行為沒有被本 Change 破壞。

---

## Affected capabilities

- `tool-execution`
- `agent-runtime`
- `frontend-chat`

---

## Current behavior summary

目前已有：

- `current_weather` 使用 Open-Meteo。
- Geocoding Query 支援 `location`、`country`、`region`。
- 候選地點會經過評分。
- Deep Research Planner 會抽取天氣地點。
- Geocoding 失敗後可由 LLM 嘗試修復一次。
- Tool Governance 已提供通用 allowlist、timeout、輸入輸出大小限制、audit 與 metric。
- 前端可顯示 Tool 執行中、完成與錯誤。

目前主要缺口：

- 地點解析與 Weather Result 尚未形成明確的版本化 Domain Contract。
- Deep Research 仍依賴字串內容與錯誤文字判斷流程。
- 歧義不是第一級業務狀態。
- LLM Repair 的邊界不夠明確。
- 缺少自動化測試基線。

---

## Approach

採用四層設計：

```text
Natural Language Location
  ↓
Location Input Normalization
  ↓
Geocoding Provider Adapter
  ↓
Deterministic Candidate Resolution
  ↓
Weather Provider
  ↓
Versioned Weather Tool Result
  ↓
Deep Research State Transition
  ↓
Frontend Presentation
```

核心原則：

1. 不新增人工城市 allowlist。
2. 原始輸入必須保留，正規化只產生查詢變體，不覆蓋使用者原文。
3. 座標與行政區資料只能來自 Geocoding Provider。
4. 歧義時不由 LLM 猜測。
5. LLM Repair 只能在 `not_found` 後產生一個新的文字查詢，且必須重新通過 Provider 解析。
6. 所有結果使用結構化狀態，不使用錯誤字串 Regex 作為主要分流依據。
7. Geocoding Provider Adapter 正式使用 Mapbox Geocoding v6；Open-Meteo 僅作為 Weather Provider，Adapter 契約仍保持 provider-neutral。
8. 優先最小修改，不擴大為所有 Tool 的平台級重構。
9. 不以 hard-coded weather keyword、CJK query phrase 或 question punctuation 的固定刪除規則作為主要地點抽取策略；地點抽取應由 Planner schema/prompt、Runtime Validation、受限制 LLM Repair 或 Provider-driven Resolver 承擔。
10. Planner 只抽取可追溯至使用者輸入的完整地點 span，不負責產生 Provider 必須接受的語言、文字系統或別名。
11. `rawLocation` 是唯一正式地點欄位；新 Schema 不接受 legacy `queryName`／`queryNameHint`，Resolver 必須直接以原始地點進入 Provider transformation。
12. Resolver 不以固定語言偵測或行政區層級拆解選擇業務分支；Provider 選擇與 query transformation 必須由設定化 capability、Adapter 結果與結構化候選驅動。
13. Planner 失敗、地點缺失、地點歧義、Provider 不支援及 Provider 失敗必須使用不同 machine status，不得由顯示文案反推。

---

## Risks

### Provider 搜尋品質差異

Mapbox 對不同語言、行政區、小地名與 worldview 的覆蓋仍可能不同；採用 Mapbox 不代表可以跳過歧義判斷或 live acceptance。

緩解方式：

- 查詢原文與標準化變體。
- 使用多語言查詢策略。
- 使用 country / region context。
- 無法可靠決定時回傳 `ambiguous` 或 `not_found`，不猜測。

### 結構化輸出造成相容性問題

現有 Deep Research 會解析文字標籤，前端 Tool Panel 也可能直接顯示字串。

緩解方式：

- Tool Result 使用 `schemaVersion`。
- Deep Research 優先解析新格式。
- 在遷移期間保留可閱讀的 `summary`。
- 未知格式以安全文字降級。
- 不修改公開 Graph ID 與 BFF Route。

### LLM Repair 產生錯誤地名

模型可能將地名翻譯成另一個城市。

緩解方式：

- Repair 不得輸出座標。
- Repair 結果仍須進入 Provider Resolver。
- `ambiguous` 不允許觸發自動選擇。
- Audit 記錄 original query 與 repair strategy，但不得記錄敏感憑證。

### 測試依賴外部網路

直接測試 Open-Meteo 可能造成不穩定。

緩解方式：

- Unit Test 使用 Mock Geocoding Provider 與 Mock Weather Provider。
- Live Provider Test 標記為 optional，不作為預設 CI Gate。
- 核心候選評分、歧義與狀態機均由純函式測試。

### 任意語言與 Provider 覆蓋率

單一 Geocoding Provider 無法保證涵蓋所有語言、文字系統、洲際層級與行政區深度。

緩解方式：

- Location Resolver 使用可設定的 Provider capability fallback，而不是語言或地區硬編碼。
- Provider-facing query transformation 可使用通用 transliteration／translation adapter，但結果只作查詢候選，不能取代 Provider 地理事實。
- 原始 Unicode 地點必須跨所有 fallback 保留。
- 無法可靠解析時回傳 `ambiguous`、`not_found` 或 `provider_error`，不得猜測座標。
- 以多語言、多文字系統與不同行政層級的 live matrix 驗證實際 Provider 覆蓋率。

### Temporary Geocoding 與持久化衝突

Temporary 模式不得讓 Mapbox response 或其衍生地理資料離開 Backend node，亦不得進入 LangGraph State、ToolMessage、checkpoint、BFF、Frontend、cache、log／trace 或測試 evidence。Weather Result、State、Audit 與 Log/Trace 使用各自 closed Schema並共用 forbidden-field guard；所有 projection 在記憶體全數驗證前不得呼叫任何 sink。驗證失敗時丟棄未提交 bundle，另建不含 Provider 資料的最小 sanitized terminal bundle，避免 Tool 永久 Loading。

### 憑證、費用與供應商依賴

- `MAPBOX_ACCESS_TOKEN` 只存在 Backend secret store，不得傳至 Browser、BFF response、checkpoint、log 或 trace。
- Platform／Operations owner 負責 token 建立、最小權限、輪替、撤銷與 `api.mapbox.com` egress allowlist。
- Product／FinOps owner 負責 Temporary／Permanent 用量預算、告警與模式切換核准。
- Adapter 與 Domain Model 保持 provider-neutral，以降低未來加入自架 Nominatim fallback 的替換成本；本 Change 不使用公共 Nominatim 作為自動 fallback。

---

## Rollback strategy

若新契約造成問題：

1. 回滾至前一個已驗證部署版本；不得在同一 runtime 以 Feature Flag 混用 `ResearchPlan`／`PlanningResultV2` 或 Weather Tool v1／v2。
2. 保留既有 `current_weather` Tool Name。
3. 保留既有 Open-Meteo Weather Provider；Geocoding 可透過設定切回核准且符合契約的 Provider Adapter，但不得回到 Planner 翻譯地名。
4. 舊字串輸出程式不得成為新 run 的 fallback。
5. 回滾部署必須同步使用該版本相容的 checkpoint；v2 runtime 不得 heuristic 讀取舊 checkpoint。
6. 不需要回滾 BFF Route 或 frontend API URL。

---

## Success criteria

1. 指定測試資料中的多語言地點不依賴人工城市 mapping 即可解析。
2. 同名地點會回傳 `ambiguous`，不會自動選錯城市。
3. 不存在地點會回傳 `not_found`，不會捏造座標。
4. Provider 網路錯誤會回傳 `provider_error`，不會誤判為地點不存在。
5. Deep Research 不再以 Weather Tool 的人類可讀標籤文字作為主要資料解析方式。
6. 前端不會在 ambiguous、timeout 或 provider error 後永久顯示 Tool 執行中。
7. Codebase 不包含以 `WEATHER_QUERY_WORDS`、`CJK_WEATHER_QUERY_PARTS`、`QUESTION_PUNCTUATION` 或等價固定自然語言詞表作為主要地點抽取修復策略的新增實作。
8. Backend、BFF、Frontend Build 全部通過。
9. 新增的 Backend 與 Frontend Test 全部通過。
10. `openspec validate generalize-weather-location-resolution` 通過。
11. 任意 Unicode 地點不得因語言、文字系統或行政區層級被 Planner 排除；單層與多層地點皆必須保留完整原文。
12. 具有非空 `rawLocation` 的 Weather Request 必須進入 Weather Tool／Resolver；Planner Schema 不包含 Provider-specific hint。
13. Weather Retry／Routing 不依賴固定自然語言 keyword 或 localized clarification 文案。
14. Resolver capability fallback 不包含城市、國家、語言或行政區硬映射，且所有最終座標皆來自 Geocoding Provider。
15. 指定的 live model extraction、live geocoding 與完整 E2E matrix 有可重現、去敏且零失敗的驗收證據。
16. `台灣高雄大寮` 的 live E2E 結果為 `resolved → current_weather success`，不得接受 `not_found` 或提前 `clarify`。
17. 固定種子產生的州／國／城市及其他行政層級組合可重播；無歧義案例必須成功，有歧義案例必須回傳結構化候選。
18. Temporary 模式的持久化稽核證明 Mapbox 衍生資料未進入 checkpoint、cache、長期 log／trace；Permanent 模式可只靠設定切換且會送出對應 Provider 參數。
