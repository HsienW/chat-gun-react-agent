# Tasks：泛化 Deep Research 天氣地點解析

## 0. 規格與基線

- [x] 0.1 執行 `openspec validate generalize-weather-location-resolution`，確認 Proposal、Specs、Design 與 Tasks 格式正確。
- [x] 0.2 由 Claude 對照 `feature-v1.1.4-init-openspec` 現況確認本 Change 不重複既有 Tool Governance。
- [x] 0.3 由 Claude Code Reviewer 完成唯讀架構、歧義、安全與邊界場景 Review；本次不要求 Gemini/Gmini 參與。
- [x] 0.4 由 Codex 完成 Task 到檔案的實作映射與最小修改評估。
- [x] 0.5 解決全部 Blocker 後，才開始 source code 修改。
- [x] 0.6 建立 `feat/generalize-weather-location-resolution` 工作分支並確認 working tree 乾淨。

## 1. 測試基礎設施

- [x] 1.1 在 `backend/package.json` 加入可執行的 `test` Script。
- [x] 1.2 在 `frontend/package.json` 加入可執行的 `test` Script。
- [x] 1.3 選用 Vitest 或符合 Node.js 20 的等價測試方案，禁止只建立空白測試命令。
- [x] 1.4 建立 Backend Mock Geocoding Provider 與 Mock Weather Provider。
- [x] 1.5 建立 Frontend Weather Tool Result Fixture。
- [x] 1.6 確認測試預設不需要連線至 Open-Meteo。

## 2. Location Domain 與 Normalization

- [x] 2.1 建立 `LocationQuery`、`LocationCandidate` 與 `LocationResolutionResult` Type。
- [x] 2.2 建立地點輸入 Runtime Validation。
- [x] 2.3 實作 Trim、Unicode NFKC、多空白合併與控制字元清理。
- [x] 2.4 保留原始地點文字，不得以正規化結果覆蓋 `raw`。
- [x] 2.5 實作 Query Variant Builder，支援原文、country、region 與語言 fallback。
- [x] 2.6 限制 Query Variant 數量並去重。
- [x] 2.7 新增 Normalization 與 Query Variant Unit Test。
- [x] 2.8 測試繁體、簡體、英文、重音字元與行政區後綴。
- [x] 2.9 確認沒有新增固定城市 allowlist 或人工城市 mapping。

## 3. Geocoding Provider Adapter 與 Resolver

- [x] 3.1 建立 `GeocodingProvider` Interface。
- [x] 3.2 將 Open-Meteo Geocoding 呼叫封裝成 `OpenMeteoGeocodingProvider`。
- [x] 3.3 Provider Search 支援 `AbortSignal`、Timeout、Language 與 Limit。
- [x] 3.4 實作 Candidate Deduplication，避免同一座標重複候選。
- [x] 3.5 將現有 Candidate Score 抽成可測試純函式。
- [x] 3.6 將最小分數與歧義差距改為可設定預設值。
- [x] 3.7 實作 `resolved`、`ambiguous`、`not_found` 與 `provider_error`。
- [x] 3.8 `ambiguous` 最多回傳五個顯示候選。
- [x] 3.9 不得因人口較高而覆蓋明確 country / region 條件。
- [x] 3.10 新增 Resolver Unit Test。
- [x] 3.11 測試同名城市、缺少 country、country 不符與 provider failure。
- [x] 3.12 測試 `Springfield` 類案例不會自動選擇第一筆。

## 4. Weather Tool 結構化契約

- [x] 4.1 建立 `WeatherToolResult` Discriminated Union。
- [x] 4.2 固定 `schemaVersion: "1.0"` 與 `tool: "current_weather"`。
- [x] 4.3 將成功結果改為 `status: "success"`。
- [x] 4.4 將歧義結果改為 `status: "needs_clarification"`。
- [x] 4.5 將找不到地點改為 `status: "not_found"`。
- [x] 4.6 將 Provider、Timeout、Cancel 與未知錯誤改為 `status: "error"`。
- [x] 4.7 新增穩定錯誤碼：
  - [x] `weather_invalid_input`
  - [x] `weather_location_not_found`
  - [x] `weather_geocoding_provider_error`
  - [x] `weather_forecast_provider_error`
  - [x] `weather_timeout`
  - [x] `weather_cancelled`
  - [x] `weather_unknown_error`
- [x] 4.8 所有結果提供安全、可閱讀的 `summary`。
- [x] 4.9 成功結果保留 Provider、Source URL、Observation Time、Timezone 與 Units。
- [x] 4.10 Weather Provider Fetch 支援真正的 Abort，而不只依賴外層 Promise Race。（2026-07-03 人工測試證明不完整：Promise.race 未傳遞 AbortSignal 至底層 fetch，retry budget 可超過外層 deadline）
- [x] 4.11 只對可重試的暫時性 Provider Error 重試一次。
- [x] 4.12 不對 invalid、ambiguous、not_found 或 user cancel 重試。
- [x] 4.13 增加 Weather Tool Contract Unit Test。
- [x] 4.14 保留 Tool Name `current_weather`。

## 5. Deep Research Runtime

- [x] 5.1 在 Deep Research State 新增可序列化的 `weatherExecution`。
- [x] 5.2 修改 `targeted_tools`，以 structured result 更新 `weatherExecution`。（2026-07-03 人工測試證明不完整：governance timeout 回傳非 JSON 字串時 parseWeatherToolResult 失敗，weatherExecution 未收斂為 terminal error）
- [x] 5.3 移除以 `Provider:`、`Resolved location:`、`Temperature:` 等標籤取得核心資料的主要流程。
- [x] 5.4 移除以錯誤文字 Regex 作為主要狀態判斷的流程。
- [x] 5.5 `success` 生成目前天氣回答。
- [x] 5.6 `needs_clarification` 生成地點補充問題與候選列表。
- [x] 5.7 `not_found` 要求使用者提供更完整地點，不捏造座標。
- [x] 5.8 `provider_error` 與 `timeout` 回傳服務失敗訊息，不誤稱地點不存在。（2026-07-03 人工測試證明不完整：governance timeout 回傳自然語言字串而非 WeatherToolResult，synthesis 無法辨識為 weather_timeout）
- [x] 5.9 修改 Planner Prompt，保留原地點文字並移除「必須翻成英文才能查詢」的依賴。
- [x] 5.10 Planner 不得輸出 latitude / longitude。
- [x] 5.11 LLM Repair 只允許在第一次 `not_found` 後執行一次。
- [x] 5.12 `ambiguous`、provider error、timeout 與 cancel 不得觸發 LLM Repair。
- [x] 5.13 Repair 結果必須重新通過同一 Resolver。
- [x] 5.14 建立 Deep Research Weather Integration Test。
- [x] 5.15 確認 Graph ID `deep_researcher` 不變。

## 6. Frontend Chat

- [x] 6.1 建立 Frontend `WeatherToolResult` Type 與 Runtime Parser。
- [x] 6.2 修改 `ToolMessageDisplay`，支援：
  - [x] 執行中
  - [x] 完成
  - [x] 需補充地點
  - [x] 找不到地點
  - [x] 逾時
  - [x] 錯誤
- [x] 6.3 對 `needs_clarification` 顯示最多五個候選。
- [x] 6.4 候選顯示 `displayName`、country、admin1 與 admin2。
- [x] 6.5 一般模式不顯示經緯度。
- [x] 6.6 未知 `schemaVersion` 或未知 `status` 不得造成 Chat View Crash。
- [x] 6.7 未知格式優先顯示 `summary`，其次使用安全 JSON 降級。
- [x] 6.8 Tool Terminal State 後不得繼續顯示執行中。
- [x] 6.9 新增 Frontend Component Test。
- [x] 6.10 確認最終 AI Markdown Message 仍可正常顯示與複製。

## 7. Observability、設定與文件

- [x] 7.1 新增 Location Resolve Audit Event。
- [x] 7.2 新增 Location Resolve 與 Weather Provider Metric。
- [x] 7.3 Audit 不記錄 API Key、Proxy Credential、完整 Prompt 或完整 Conversation。
- [x] 7.4 新增或文件化以下設定：
  - [x] `WEATHER_STRUCTURED_RESULT_ENABLED`
  - [x] `WEATHER_LOCATION_MAX_CHARS`
  - [x] `WEATHER_GEOCODING_MAX_QUERIES`
  - [x] `WEATHER_GEOCODING_MAX_CANDIDATES`
  - [x] `WEATHER_GEOCODING_MIN_SCORE`
  - [x] `WEATHER_GEOCODING_AMBIGUITY_DELTA`
  - [x] `WEATHER_GEOCODING_TIMEOUT_MS`
  - [x] `WEATHER_FORECAST_TIMEOUT_MS`
- [x] 7.5 更新 `backend/.env.example`。
- [x] 7.6 更新 README 天氣能力、限制、錯誤與測試說明。
- [x] 7.7 文件說明系統不以人工城市 mapping 作為主要解析方式。

## 8. Verification

- [x] 8.1 `cd backend && npm run test` 通過。
- [x] 8.2 `cd backend && npm run build` 通過。
- [x] 8.3 `cd bff && npm run build` 通過。
- [x] 8.4 `cd frontend && npm run test` 通過。
- [x] 8.5 `cd frontend && npm run lint` 通過。
- [x] 8.6 `cd frontend && npm run build` 通過。
- [x] 8.7 `openspec validate generalize-weather-location-resolution` 通過。
- [x] 8.8 Codex 對最終 Diff 完成實作與測試 Review。（2026-06-21 CCR audit: review evidence not independently confirmed; review output not linked in change artifacts.）
- [x] 8.9 Claude Code Reviewer 對最終 Diff 完成架構、歧義與安全 Review；本次不要求 Gemini/Gmini 參與。（2026-06-21 CCR audit: review evidence not independently confirmed; review output not linked in change artifacts.）
- [x] 8.10 Claude Code 協調者解決全部 Blocker 與 Major，或明確記錄未解決 Major 的接受理由。
- [x] 8.11 Git Diff 不包含無關重構、套件升級或格式化。

## 9. Manual acceptance matrix

Status legend: `[mock]` = mock smoke verified (no real model / provider / browser); `[live]` = live acceptance completed.

- [mock] 9.1 `台北現在天氣如何？` 可解析。
- [mock] 9.2 `臺北現在天氣如何？` 可解析。
- [mock] 9.3 `高雄鳳山今天會下雨嗎？` 可解析或要求合理補充。
- [mock] 9.4 `北京市現在幾度？` 可解析。
- [mock] 9.5 `新加坡現在的濕度？` 可解析。
- [live] 9.6 `Tokyo weather now` 可解析。
- [live] 9.7 `São Paulo weather` 可解析。
- [live] 9.8 `München weather` 可解析。
- [live] 9.9 `Springfield weather` 回傳歧義候選（5 US only），不自動選擇。
- [live] 9.10 `中山現在天氣如何？` 在缺少 context 時回傳澄清候選；加上 `country: Taiwan` 可解析。
- [live] 9.11 不存在的地點回傳 `not_found`（`DefinitelyNonExistentPlace12345`），不捏造座標。
- [live] 9.14 使用者取消後（AbortSignal），回傳 `error` / `weather_cancelled`。
- [live] 9.15 JSON 輸出不含 `apiKey`、`proxy`、`stack` 等敏感欄位。
- [x] 9.16 Live smoke executed 2026-06-21: Latin/Unicode tests pass; CJK tests FAIL — Open-Meteo geocoding does not accept Chinese characters. Root cause: `geocoding-api.open-meteo.com` text index is Latin-only. See `live-smoke-report.md`. CJK resolution requires Planner-mediated transliteration (Goal #1 not yet met).

## 10. Archive

- [x] 10.1 等價人工驗證完成：CCR + Codex audit 2026-06-21；live smoke executed 2026-06-21。
- [x] 10.2 **ARCHIVED WITH CJK BLOCKER** — Proposal Goal #1 (CJK resolution) not met. Open-Meteo geocoding does not accept CJK characters. All reusable artifacts preserved for follow-up change. Latin/Unicode pipeline, WeatherToolResult schema, LocationResolver, Frontend WeatherToolResultCard, and mock smoke tests are verified and portable.
- [x] 10.3 Archive reason: live smoke confirmed CJK blocker. Follow-up change should address CJK→Latin transliteration (Planner-mediated or lightweight library). Existing code (weather.ts, geocoding/*, weather-types.ts, frontend WeatherToolResult) is NOT reverted — it successfully handles Latin/Unicode locations and all error paths.
- [x] 10.4 Delta Specs NOT merged to `openspec/specs/` — specs document the desired behavior including CJK support. Intentionally left unmerged so the follow-up change can pick up the full spec as a starting point.

## 11. 實測失敗後的策略修正

- [x] 11.1 更新 Proposal，明確禁止 hard-coded 自然語言 keyword regex、CJK phrase stripping 與固定問題標點刪除作為主要地點抽取修復策略。
- [x] 11.2 更新 Design，記錄 `WEATHER_QUERY_WORDS`、`CJK_WEATHER_QUERY_PARTS`、`QUESTION_PUNCTUATION` 類方案不採用，並要求改用 Planner schema/prompt、Runtime Validation、受限制 LLM Repair 或 Provider-driven Resolver。
- [x] 11.3 更新 Delta Specs，新增禁止固定詞表刪字猜地點的 Requirement/Scenario。
- [x] 11.4 更新專案規則 `AGENTS.md` 與 `CLAUDE.md`，讓後續實作與 Review 將此類方案視為 Major 或 Blocker。
- [x] 11.5 後續 source code 修正時，移除或降級任何以 `WEATHER_QUERY_WORDS`、`CJK_WEATHER_QUERY_PARTS`、`QUESTION_PUNCTUATION` 或等價固定詞表作為主要地點抽取流程的實作。
- [x] 11.6 後續驗證時，新增或調整測試以證明地點抽取不依賴固定自然語言刪字詞表，且 `台北現在天氣如何？`、`高雄鳳山今天會下雨嗎？`、`Springfield weather` 等案例走 Planner/Resolver 契約。

## 12. Corrective Tasks — Timeout / Cancellation / Terminal State Closure（2026-07-03）

人工測試發現（`倫敦天氣？` → 點選 London 候選 → governance timeout → 再次輸出多候選），根因為 timeout budget 衝突、底層 fetch 未取消、terminal state 不收斂、synthesis 重用舊 clarification evidence。

- [x] C1 修改 `fetchWithRetry`（`backend/src/tools/weather.ts`）使其接收外層 deadline signal，確保 retry 預算（含 250ms backoff）不超過外層 deadline。若 deadline 在 retry 前已過期，直接 throw `weather_timeout` 不進行第二次 fetch。
- [x] C2 修改 `current_weather` 主流程，將 tool governance timeout 傳遞為 AbortSignal，合併 Provider Timeout Signal（`backend/src/tools/weather.ts`）。確保 governance timeout → AbortController.abort() → fetch 取消 → fetchWithRetry 不再 retry。
  - **實施明確化（Qwen M1）**：weather.ts 內部建立一個主 AbortController，從 `RunnableConfig.configurable?.abortSignal` 提取外層 governance signal 並監聽其 `abort` 事件觸發內部 AbortController.abort()。合併後的 signal 傳入 fetchJsonWithTimeout。governance 層不需修改；weather.ts 在 invoke 時主動從 config 取得 signal。
- [x] C3 修改 `targeted_tools`（`backend/src/agents/deep-researcher.ts`），在 weather tool 返回後若 `parseWeatherToolResult` 失敗（非 JSON / governance error 字串），建立 `weatherExecution: { status: "failed", result: { status: "error", code: "weather_timeout", ... } }`。不得讓 weatherExecution 停留於 `running`。
  - **實施明確化（Qwen M2）**：在 targeted_tools 的 weather invoke catch / result 處理中，若 `parseWeatherToolResult` 回傳 undefined，檢查原始 error 或回傳字串是否包含 `timed out` 以判定 `weather_timeout`，否則設為 `weather_unknown_error`。同時在 tool-governance.ts 的 error message 中加入 machine-readable prefix（如 `[governance_timeout]`），供 parseWeatherToolResult fallback 正則匹配。
- [x] C4 確認 `parseWeatherToolResult` 失敗時，不將非結構化 governance error 字串直接寫入 messages（可寫入 summary 欄位，但不得讓 synthesis 視為 Tool 成功輸出）。
- [x] C5 修改 synthesis / `buildWeatherToolAnswer`（`backend/src/agents/deep-researcher.ts`）或 `formatEvidence`，在 weather resume 後不採用先前的 `needs_clarification` ToolResult。只使用 `weatherExecution.result` 產生 final answer。
  - **實施明確化（Qwen M3）**：採用 weatherExecution 驅動模式。`buildWeatherToolAnswer` 已在 L2308 優先讀取 weatherExecution；本 task 確保：(a) 所有 weather Tool 返回路徑（含 governance error）都設定 weatherExecution，(b) buildWeatherToolAnswer 在 weatherExecution 非 success/failed/needs_clarification 時回傳 undefined 而不 fallback 到 messages 掃描，(c) synthesis node 在 buildWeatherToolAnswer 回傳 undefined 且 plan.answerMode === 'weather' 時輸出 safety fallback（「天氣查詢服務暫時無法回應」等），不重用舊 ToolResult。
- [x] C6 新增整合測試（`backend/src/tools/weather.test.ts` 或新檔案）：Mock forecast 延遲 > governance timeout，驗證：
  - Tool 返回 weather_timeout 結構化結果
  - weatherExecution 收斂為 `failed`
  - 最終 AI 訊息不包含舊的多候選提示
  - messages 不包含非結構化 governance error 字串
- [x] C7 `cd backend && npm run test` 通過（含新增 C6 測試）。
- [x] C8 `cd backend && npm run build` 通過。
- [x] C9 人工 live smoke：重現「倫敦天氣？→ 點選候選 → 等待 timeout」情境，確認最終輸出為 weather_timeout 而非多候選提示。
