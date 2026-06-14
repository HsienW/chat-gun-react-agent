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

本 Change 將天氣地點處理改造成「Provider 驅動、結構化、可版本化、可要求澄清」的解析流程，而不是持續擴充人工地名映射。

---

## Goals

1. 使用者可以使用繁體中文、簡體中文、英文及常見 Unicode 地名查詢天氣。
2. 系統不得以固定城市 allowlist 或人工城市 mapping 作為主要地點解析方式。
3. 地點解析以 Geocoding Provider 回傳資料作為最終地理事實來源。
4. Planner LLM 只負責意圖與實體抽取，不得直接決定座標或在歧義時自行選擇城市。
5. 地點解析必須區分：
   - `resolved`
   - `ambiguous`
   - `not_found`
   - `provider_error`
6. `current_weather` 必須回傳具備版本號的結構化結果，不再要求下游以標籤文字解析。
7. Deep Research 遇到歧義地點時，必須要求使用者補充國家或行政區，並提供候選。
8. 前端必須正確顯示成功、需補充地點、失敗與逾時狀態。
9. 地點解析與天氣 Provider 呼叫必須具備 timeout、受限制的 retry、audit 與 metric。
10. 保持既有 `deep_researcher` Graph ID、BFF Route 與一般聊天訊息格式相容。

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
- 增加 Audit、Metric 與測試。

### Frontend

- 顯示天氣 Tool 的執行結果狀態。
- 對 `needs_clarification` 顯示可理解的提示與候選地點。
- 對未知版本或未知狀態提供降級顯示。
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
7. Provider Adapter 先支援 Open-Meteo，但保留替換能力。
8. 優先最小修改，不擴大為所有 Tool 的平台級重構。

---

## Risks

### Provider 搜尋品質差異

Open-Meteo 對不同語言、行政區與小地名的覆蓋可能不同。

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

---

## Rollback strategy

若新契約造成問題：

1. 透過 Feature Flag 將 Deep Research 切回既有 Weather Tool Adapter。
2. 保留既有 `current_weather` Tool Name。
3. 保留既有 Open-Meteo Provider。
4. 不移除舊字串輸出程式，直到新契約通過完整驗證。
5. 可回滾 Deep Research 的 structured result parser，而不影響其他 Agent。
6. 不需要回滾 BFF Route 或 frontend API URL。

建議 Feature Flag：

```text
WEATHER_STRUCTURED_RESULT_ENABLED=true
```

穩定後再移除舊路徑。

---

## Success criteria

1. 指定測試資料中的多語言地點不依賴人工城市 mapping 即可解析。
2. 同名地點會回傳 `ambiguous`，不會自動選錯城市。
3. 不存在地點會回傳 `not_found`，不會捏造座標。
4. Provider 網路錯誤會回傳 `provider_error`，不會誤判為地點不存在。
5. Deep Research 不再以 Weather Tool 的人類可讀標籤文字作為主要資料解析方式。
6. 前端不會在 ambiguous、timeout 或 provider error 後永久顯示 Tool 執行中。
7. Backend、BFF、Frontend Build 全部通過。
8. 新增的 Backend 與 Frontend Test 全部通過。
9. `openspec validate generalize-weather-location-resolution` 通過。
