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
- [x] 4.10 Weather Provider Fetch 支援真正的 Abort，而不只依賴外層 Promise Race。
- [x] 4.11 只對可重試的暫時性 Provider Error 重試一次。
- [x] 4.12 不對 invalid、ambiguous、not_found 或 user cancel 重試。
- [x] 4.13 增加 Weather Tool Contract Unit Test。
- [x] 4.14 保留 Tool Name `current_weather`。

## 5. Deep Research Runtime

- [x] 5.1 在 Deep Research State 新增可序列化的 `weatherExecution`。
- [x] 5.2 修改 `targeted_tools`，以 structured result 更新 `weatherExecution`。
- [x] 5.3 移除以 `Provider:`、`Resolved location:`、`Temperature:` 等標籤取得核心資料的主要流程。
- [x] 5.4 移除以錯誤文字 Regex 作為主要狀態判斷的流程。
- [x] 5.5 `success` 生成目前天氣回答。
- [x] 5.6 `needs_clarification` 生成地點補充問題與候選列表。
- [x] 5.7 `not_found` 要求使用者提供更完整地點，不捏造座標。
- [x] 5.8 `provider_error` 與 `timeout` 回傳服務失敗訊息，不誤稱地點不存在。
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

## 12. Planner Extraction 複合中文行政區覆蓋修復（2026-06-26）

- [x] 12.1 主 Planner Prompt（`planResearch` L1178）加入「保留完整行政區串聯」引導與範例，確保三層以上中文行政區（如「台灣高雄大寮」）不被拆解或省略。
- [x] 12.2 Retry Extraction Prompt（`retryWeatherPlannerExtraction` L1069-1074）加入「不拆解複合地名」負面約束，確保 LLM 不會將多層行政區分解為多個欄位或直接走 `clarify`。
- [x] 12.3 新增 regression test case：「台灣高雄大寮天氣如何？」在主 Planner 或 retry extraction 後，`weather.location` 非空且為完整原文。
- [x] 12.4 對 `installRepairWeatherFetchMock` 補入 `Daliao` geocoding mock response，使 regression test 可通過完整 pipeline。
- [x] 12.5 `cd backend && npm run lint` 通過。
- [x] 12.6 `cd backend && npm run test` 通過（含既有回歸）。
- [x] 12.7 `cd backend && npm run build` 通過。
- [x] 12.8 `openspec validate generalize-weather-location-resolution` 通過。

## 13. 人工 E2E Review 失敗後的跨語言架構修正（2026-06-26）

> Section 12 僅證明 prompt 文字與 mock pipeline 已完成。人工以正式 `qwen-plus` 執行「台灣高雄大寮天氣如何？」仍得到 `clarify`，且 checkpoint 證明 Weather Tool 未被呼叫，因此本 Change 尚未完成，不得封存。

- [ ] 13.1 將人工失敗 run 的去敏 checkpoint、runId、Planner outcome 與重現步驟固化為 regression evidence，並確認主 Planner 與 bounded retry 的 failure code 可區分 parse error、schema rejection、invoke error、model refusal 與 missing location。
- [ ] 13.2 定義並實作 `schemaVersion: 2` 的完整 `PlanningResultV2`，明確區分 `direct`、`weather`、`calculation`、`research`、`missing_location`、`clarify` 與 `extraction_error`，包含各分支必要欄位與禁止欄位；直接取代 `ResearchPlan`，不得成為其前置結果，也不得以 Optional 欄位或顯示文案代替狀態。
- [ ] 13.3 將 Weather Planner extraction 接到 Provider Adapter 支援的 Structured Output、Tool Calling 或等價 schema-bound mode；不支援時回傳明確 capability error，不得依模型名稱改變 Domain Schema。
- [ ] 13.4 保留任意 Unicode 與任意行政層級的完整 `rawLocation` span；移除日文、韓文或其他文字系統的排除條件，從 `PlanningResultV2`、Weather Tool v2 input、Prompt 與 Retry 移除 legacy `location`／`queryName`／`queryNameHint`，並同步更新 `docs/agent-rules/weather.md` 與相關文件中的舊限制。
- [ ] 13.5 將 Weather Retry 與 Graph Routing 改為只依 machine status 與 Runtime-validated fields；移除固定 weather keyword 與 localized clarification equality 對 Weather Tool routing 的決定權。
- [ ] 13.6 Planner parse/schema/invoke failure 不得偽裝成 `missing_location`；新增去敏 audit，至少包含 phase、provider、model、failureCode、resultStatus、requestId 與 runId。
- [ ] 13.7 將 Provider-facing query transformation 所有權完整移至 Location Resolver／Provider Adapter，保留 original query、contextual query、transformed query 與 resolution strategy；Planner 只輸出 `rawLocation`，transformation 不得直接產生座標或最終地理事實。
- [ ] 13.8 實作 `MapboxGeocodingProvider` 對接 Geocoding API v6，先 Runtime Validation Provider response，再轉換為 provider-neutral `LocationCandidate`；Open-Meteo 僅保留 Weather Provider。保留 `GeocodingProvider` capability 與設定化 fallback 邊界供未來自架 Nominatim 使用，但本 Change 不得使用公共 Nominatim 自動 fallback。
- [ ] 13.9 將 `LocationResolutionResult` 統一為 `resolved | ambiguous | not_found | provider_error | timeout | cancelled` 六態，實作跨 attempt 聚合優先序 `cancelled → resolved → ambiguous → timeout → provider_error → not_found`；驗證語意不被合併，且最終座標只來自通過 Runtime Validation 的 Geocoding Provider Candidate。
- [ ] 13.10 新增 deterministic／mock integration matrix，涵蓋單層地點、國家＋城市、洲際＋國家＋城市與更多行政層級，以及繁體中文、簡體中文、Latin、日文、韓文、阿拉伯文、西里爾文、重音字元與混合文字系統。
- [ ] 13.11 新增關係型測試：增加上層地理 context 只能維持或縮小候選；非空 `rawLocation` 不得改成 missing_location；legacy `queryName` 不得進入 Provider query；localized 文案改變不得改變 routing；Provider error 不得變成 not_found。
- [ ] 13.12 新增明確 opt-in 且可自動執行的 live scripts：`npm run test:weather-live-model`、`npm run test:weather-live-geocoding` 與 `npm run test:weather-live-e2e`；預設 `npm run test` 不得連線外部模型或 Provider。使用 `mulberry32-v1` 與固定 seed `20260627` 產生州／國／城市及其他行政層級組合，將展開案例提交至 `backend/test-fixtures/weather-location-live-cases.v1.json`；執行時以 manifest 與 hash 為權威，不得臨時隨機生成。
- [ ] 13.13 執行 `cd backend && npm run test:weather-live-model`，以正式目標模型與固定參數驗證 live extraction matrix；所有非空地點必須輸出完整 `rawLocation` 且不得回 `missing_location`，輸出不得包含任何 Provider-specific hint。
- [ ] 13.14 執行 `cd backend && npm run test:weather-live-geocoding`，以 Mapbox Geocoding v6 驗證原始 Unicode、query transformation、歧義、錯誤語意及固定 seed 行政層級矩陣；保存不含 token、完整 response、座標與 Temporary 衍生資料的去敏 evidence。
- [ ] 13.15 執行 `cd backend && npm run test:weather-live-e2e`，至少驗證「宜蘭天氣如何？」、「台灣宜蘭天氣如何？」、「亞洲台灣宜蘭天氣如何？」與原始失敗案例「台灣高雄大寮天氣如何？」會進入 Weather Tool／Resolver。前三者及固定 seed 無歧義案例必須成功或在 Provider 確實歧義時回候選；「台灣高雄大寮」必須 `resolved → current_weather success`，不得接受 `not_found`、`missing_location` 或提前 `clarify`。
- [ ] 13.16 執行 Backend `npm run lint && npm run test && npm run build`、Frontend `npm run lint && npm run test && npm run build`、BFF `npm run build`；全部零錯誤且不得跳過既有回歸。
- [ ] 13.17 執行 `openspec validate generalize-weather-location-resolution` 並確認 Git Diff 不包含固定城市／國家／語言 mapping、自然語言刪字策略、無關重構或未核准套件升級。
- [ ] 13.18 由獨立人工 Reviewer 依正式 runtime checkpoint 複驗 Section 13 live matrix；只有零 Blocker、零 Major 且 evidence 已記錄時，才可將 Section 13 標記完成並進入 archive readiness check。
- [ ] 13.19 新增並驗證 `MAPBOX_ACCESS_TOKEN`、`MAPBOX_GEOCODING_STORAGE_MODE=temporary|permanent`、`MAPBOX_WORLDVIEW` 與 Mapbox endpoint 設定；token 只能由 Backend secret store 注入，Platform／Operations owner 負責輪替、撤銷與 `api.mapbox.com` egress，Product／FinOps owner 負責用量預算與告警。
- [ ] 13.20 實作 Temporary／Permanent 模式：Temporary 不送 `permanent=true`，Permanent 必須送出；模式只靠受驗證設定切換。部署 owner 必須先確認 Permanent entitlement；被拒絕時回 configuration error，不得自動降級 Temporary。
- [ ] 13.21 實作 `prepareTemporaryDurableBundle`：分別建立並驗證 closed Weather Result／ToolMessage、WeatherExecution State、Audit、Log/Trace projection，再套用共用 forbidden-field guard；記憶體全數通過前零 sink side effect，通過後 freeze immutable bundle。State／ToolMessage／checkpoint 依既有 LangGraph commit；Observability 只從 validated bundle 派生，以 `runId + toolCallId + eventType` 冪等 best-effort送出並最多 retry 3 次，失敗不回滾 Graph state。違規時丟棄未提交 bundle並建立逐 sink驗證的 sanitized terminal bundle。
- [ ] 13.22 定義並實作 `MAPBOX_WORLDVIEW`：空值不傳參數並沿用 Provider 預設；非空值先 Runtime Validation；不得依語言、locale、國家名稱或文字系統推斷。
- [ ] 13.23 實作受驗證的全域解析時間／嘗試預算與 process-local traffic governor：單次 timeout 5000ms、總預算 8000ms、最多 3 個 query variants、1 個 Provider、4 次總網路嘗試；per-instance token bucket 預設 100/min、concurrency 10、FIFO queue 100，queue wait 計入總預算。文件不得宣稱跨 replica 全域限流；Platform／Operations 依最大 replica 數配置額度並監控 token 級 Provider 用量。
- [ ] 13.24 實作 retry：只對 Network Error、429、502、503、504 等暫時性錯誤最多重試一次，優先遵守 `Retry-After`，否則 exponential backoff + bounded jitter；invalid、ambiguous、not_found、401、403 與 cancel 不重試。
- [ ] 13.25 實作 process-local per-provider circuit breaker：連續 5 次可重試失敗開啟 60000ms，half-open 每 process 僅放行 1 次探測，restart 歸零；成功後關閉歸零；不得把門檻誤作單一請求重試 5 次。
- [ ] 13.26 為 Mapbox request／response、feature properties、座標範圍、未知欄位與錯誤 envelope 新增 Runtime Schema Validation 及 deterministic contract tests；`q` 最多 256 字元／20 個 words or numbers 且不得含 `;`，worldview 僅接受正式 Enum，不得以 Type Assertion 信任外部資料或刪字補救。
- [ ] 13.27 定義 `PlanningResultV2` checkpoint migration：新 run 只寫 v2 且無 legacy feature-flag 雙軌；舊 checkpoint 不做 heuristic coercion，resume 時回 `planner_checkpoint_incompatible_v2`、發出 `planning_checkpoint_rejected` 去敏 audit並標記 non-resumable，不複製或封存原始 payload。實作 idempotent `cleanup:incompatible-checkpoints` CLI 與 `CheckpointRetentionAdapter`，支援每筆最多 3 次重試、deleted/failed/oldest-age metric、12h warning 與 24h critical alert。
- [ ] 13.28 為每個 sink 新增合法 payload 通過與惡意欄位拒絕測試，涵蓋 Temporary／Permanent、Weather Result、State/checkpoint weather slice、Audit、Log/Trace、candidate／座標／feature ID／resolved label／unknown field／query URL／Provider body、驗證前零 side effect、LangGraph commit、observability idempotency/retry/failure不回滾、sanitized factory、Graph terminal、晚到結果忽略、Frontend 不停留 Loading，以及 token/worldview、Mapbox constraints、429、queue、timeout、retry、circuit、cancel。
- [ ] 13.29 更新 `backend/.env.example`、部署文件與 weather 專項規則，文件化 secret owner、rotation、egress、storage mode、worldview、費用 owner、資料保存限制與未來自架 Nominatim fallback 邊界。
- [x] 13.30 在 apply-change 前重新執行獨立 plan review；只有 Proposal、Design、Specs 與 Tasks 為零 Blocker、零 Major，才可開始 source code 修改。（2026-06-27 Codex independent review：PASS，零 Blocker／Major／Minor。）
- [ ] 13.31 驗證 Temporary safe projection 通過 BFF 與 Frontend 時不含任何 Mapbox candidate、座標、feature ID、resolved label 或含 query URL；保持既有 `/api/langgraph/*` Route、取消、backpressure 與 request ID 語意。
- [ ] 13.32 建立 Temporary persistence evidence：以合法與惡意 fixture 對 Weather Result、State/checkpoint weather slice、ToolMessage、Audit、Log/Trace 與 BFF response 執行 contract suite，證明 sink-specific schema 保留合法 observability 欄位、共用 guard 拒絕 Mapbox 衍生資料、驗證失敗前零 sink side effect、每個 sink 只接收 validated projection，且沒有 Mapbox candidate event。
- [ ] 13.33 由 Platform／Operations 部署每小時執行的 checkpoint cleanup CronJob，使用 production-equivalent adapter 完成標記、重試、冪等刪除與告警整合測試；保存不含 payload 的部署與 24 小時 SLO evidence，否則 13.27 不得完成。
