# Tasks：修復 Weather Planner 提前產出 Clarification

## Phase 0：失敗基線測試

### Task 0.1：建立「大寮天氣」失敗基線測試
- [ ] 新增 deterministic test case：input「大寮天氣」→ 預期 `targetedTools` 被呼叫 → `weatherTool` 執行 → 斷言 `weatherExecution` 非 idle
- [ ] 在基線測試中記錄「未修復前」的失敗行為（`plan.answerMode === "clarify"` → 直接 synthesis → 無 ToolMessage）
- [ ] 確保測試可在 CI 中執行（不依賴真實 LLM 或 Provider）
- **驗證**：`cd backend && npx vitest run src/agents/deep-researcher.weather.test.ts` — 基線 test case 目前 FAIL（預期）

### Task 0.2：建立「無地點」不變量測試
- [ ] 新增 test case：input「明天會下雨嗎」→ 預期 `plan.answerMode === "clarify"` → 不進 targeted_tools
- [ ] 新增 test case：input「介紹一下大寮的歷史」→ 預期不觸發 weather recovery
- **驗證**：`cd backend && npx vitest run src/agents/deep-researcher.weather.test.ts` — 基線測試 PASS

### Task 0.3：建立 Tool Invocation Count 斷言工具
- [ ] 在測試中新增 helper：`assertWeatherToolInvocationCount(messages, expectedCount)` 
- **驗證**：Tool call count 測試 PASS

---

## Phase 1：Planner Gate／Bounded Extraction

### Task 1.1：擴充 `shouldRetryWeatherPlannerExtraction` 觸發條件
- [ ] 新增條件：`plan.answerMode === "clarify"` 且 `createPlannerFailureRoutingDecision(question).answerMode !== "clarify"`
- [ ] 保留既有條件（`missingWeatherLocationPlan`、`plannerReturnedWeatherWithoutLocation` 等）
- [ ] 新增 Run-level guard：檢查 `config.configurable._weatherExtractionAttempted`
- **驗證**：`cd backend && npx vitest run src/agents/deep-researcher.weather.test.ts` — Phase 0 FAIL 案例變 PASS

### Task 1.2：確保 Bounded Extraction 不修改 Prompt 邏輯
- [ ] 確認 `retryWeatherPlannerExtraction()` prompt 仍符合 bounded extraction 要求
- [ ] 確認 prompt 不要求 LLM 判斷地理歧義或產生座標
- **驗證**：Prompt review（不新增 code change）

### Task 1.3：新增 Run-level Guard（`_weatherExtractionAttempted` flag）
- [ ] 在 `applyWeatherPlannerExtractionRetry` 中設定 flag
- [ ] 在 `shouldRetryWeatherPlannerExtraction` 中檢查 flag
- **驗證**：測試確認連續兩次 clarify plan 只觸發一次 extraction

### Task 1.4：MainPlanner Prompt `queryName` 語意調整
- [ ] 將 MainPlanner prompt 中 `queryName` 的描述從「when you know a geocoding-friendly Latin name」調整為「when you know a geocoding-friendly Latin name that may help if the original location is not found by the geocoding provider」
- **驗證**：Prompt diff review

---

## Phase 2：queryName Fallback

### Task 2.1：確認 Resolver 查詢順序
- [ ] 檢查 `resolveLocation` 中的 query variant 順序：`original` → `queryName` fallback
- [ ] 確認 `requestedLocation.raw` 未被 `queryName` 覆蓋
- **驗證**：`cd backend && npx vitest run src/tools/geocoding/location-resolver.test.ts` — 既有測試 PASS

### Task 2.2：更新 `docs/agent-rules/weather.md` 中 `queryName` 定義
- [ ] 更新 `queryName` 語意：從「geocoding-friendly Latin place name」改為「optional fallback query variant」
- [ ] 明確說明 `queryName` 不得覆蓋 `requestedLocation.raw`
- **驗證**：文件 review

---

## Phase 3：Graph／Tool Integration

### Task 3.1：確認 `routeAfterPlan` 無需變更
- [ ] 確認 `routeAfterPlan` 根據 `state.plan.answerMode` 路由至 `targetedTools` 或 `synthesizeAnswer`
- [ ] 確認 Planner Gate 在 `routeAfterPlan` 之前已修正 `plan.answerMode`
- **驗證**：`cd backend && npx vitest run src/agents/deep-researcher.weather.test.ts` — routing 測試 PASS

### Task 3.2：確認 `coercePlan` 防禦檢查不變
- [ ] 確認 `answerMode === "weather" && !weather?.location.trim()` 仍觸發 `missingWeatherLocationPlan`
- **驗證**：既有 unit test PASS

### Task 3.3：確認 `applyWeatherPlannerExtractionRetry` 正常路徑無 LLM Call
- [ ] 加入 assertion：Planner 回傳 `answerMode: "weather"` 時 `retryWeatherPlannerExtraction` 不被呼叫
- **驗證**：測試中 mock `retryWeatherPlannerExtraction` 並斷言未被呼叫

---

## Phase 4：Golden Eval／Live Smoke／Docs

### Task 4.1：執行完整 Weather Golden Eval 回歸
- [ ] `cd backend && npx vitest run src/tools/weather-golden-eval.test.ts`
- [ ] 確認所有既有 `pass` 案例維持 `pass`
- [ ] 記錄任何 `known_gap` 的變更
- **驗證**：Golden eval report

### Task 4.2：執行 Backend 全量測試
- [ ] `cd backend && npm run lint`
- [ ] `cd backend && npm run test`
- [ ] `cd backend && npm run build`
- **驗證**：All pass（含新增 Phase 0–3 測試）

### Task 4.3：Live Smoke（opt-in）
- [ ] 使用真實 LLM 測試「大寮天氣」→ 確認進入 targeted_tools → Weather Tool 回傳結果
- [ ] 使用真實 LLM 測試「高雄大寮今天會下雨嗎」→ 確認不增加 LLM Call
- [ ] 記錄 Live Smoke 結果（pass / fail / skipped）
- **驗證**：Live smoke report（若無法執行則標記 skipped，不得假裝通過）

### Task 4.4：更新 `docs/agent-rules/weather.md`
- [ ] 加入 Planner Gate 說明（Section 3 Backend Planner）
- [ ] 更新 `queryName` 語意（Section 3 Backend Planner）
- [ ] 確保禁止策略清單仍包含 keyword stripping、city allowlist 等
- **驗證**：文件 diff review

---

## 未決事項

- 若 Open-Meteo Geocoding 對「大寮」無結果，LLM Repair 流程 (`repairWeatherRequest`) 會嘗試修復。此為現有能力，非本 Change 範圍。若 LLM Repair 也失敗，結果為 `not_found`。
- Bounded extraction prompt 不改寫，因其已符合需求。未來若 extraction 失敗率過高，可獨立建立 prompt 改進 Change。
