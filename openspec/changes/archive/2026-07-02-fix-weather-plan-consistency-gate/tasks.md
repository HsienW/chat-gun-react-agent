# Tasks：修復 Weather Plan Consistency Gate

## Phase 0：Current Master Baseline

### Task 0.1：建立 Case A 失敗測試（矛盾 Plan Fast Path）
- [x] 0.1 建立 Case A 失敗測試（矛盾 Plan Fast Path）
- **描述**：在 `deep-researcher.weather.test.ts` 新增 deterministic test，模擬 Main Planner 回傳 `{"answerMode":"clarify","weather":{"location":"高雄大寮"},"clarification":"請提供更具體的位置"}`，驗證當前 master 行為（Weather Tool invocation count = 0）
- **驗證**：`cd backend && npm run test -- deep-researcher.weather.test.ts`
- **產出**：一個 `fail` 的測試案例，證明 Case A 缺口存在

### Task 0.2：建立 Case B 失敗測試（Planner 提前 Clarify Recovery）
- [x] 0.2 建立 Case B 失敗測試（Planner 提前 Clarify Recovery）
- **描述**：新增 test，模擬 Main Planner 回傳 `{"answerMode":"clarify","clarification":"請問您指的是哪個地區？"}`（無 weather.location），驗證 bounded extraction 是否已觸發
- **驗證**：`cd backend && npm run test -- deep-researcher.weather.test.ts`
- **產出**：確認 Case B 當前行為（pass 或 fail）

### Task 0.3：建立 Case C 測試（真正缺少地點）
- [x] 0.3 建立 Case C 測試（真正缺少地點）
- **描述**：新增 test，模擬「明天會下雨嗎」（無地點），驗證 bounded extraction 最多一次且最終為 clarification
- **驗證**：`cd backend && npm run test -- deep-researcher.weather.test.ts`
- **產出**：base regression test for Case C

### Task 0.4：建立 Contract 測試（routing contract）
- [x] 0.4 建立 Contract 測試（routing contract）
- **描述**：在 `deep-researcher.query-workflow.test.ts` 新增 route contract test，驗證 `routeAfterPlan` 對 `answerMode=weather` + 合法 location → `targeted_tools`
- **驗證**：`cd backend && npm run test -- deep-researcher.query-workflow.test.ts`
- **產出**：routing contract baseline

## Phase 1：Weather Plan Consistency Gate

### Task 1.1：實作 `normalizeWeatherPlanConsistency` 純函式
- [x] 1.1 實作 `normalizeWeatherPlanConsistency` 純函式
- **描述**：在 `deep-researcher.ts` 新增純函式，當 `answerMode=clarify` + 合法 `weather.location` 時正規化為 `answerMode=weather`。函式需回傳 `gateActivated: boolean` 旗標供 `coercePlan` 清除 `clarification`。
- **檔案**：`backend/src/agents/deep-researcher.ts`
- **驗證**：unit test（Task 1.2）
- **約束**：不增加 LLM call、不新增 import、不修改型別
- **注意**：必須將此函式加入 `deepResearcherWeatherTestInternals` 或 `deepResearcherQueryContractTestInternals` export object，使 Task 1.2 可直接測試

### Task 1.2：撰寫 Consistency Gate 單元測試
- [x] 1.2 撰寫 Consistency Gate 單元測試
- **描述**：新增 unit test，直接測試 `normalizeWeatherPlanConsistency` 的各種組合（透過 Task 1.1 匯出的 test internals）
- **驗證**：`cd backend && npm run test -- deep-researcher.weather.test.ts`
- **案例**：
  - `clarify` + valid location → `weather`，`gateActivated = true`
  - `clarify` + undefined weather → `clarify`（不變），`gateActivated = false`
  - `clarify` + empty location → `clarify`（不變），`gateActivated = false`
  - `weather` + valid location → `weather`（不變），`gateActivated = false`
  - `direct` + valid weather → `direct`（不變），`gateActivated = false`

### Task 1.3：整合 Consistency Gate 至 `coercePlan`
- [x] 1.3 整合 Consistency Gate 至 `coercePlan`
- **描述**：在 `coercePlan` 中，`coerceWeatherRequest` 之後、`missingWeatherLocationPlan` 守衛之前，呼叫 `normalizeWeatherPlanConsistency`
- **檔案**：`backend/src/agents/deep-researcher.ts`
- **驗證**：Task 0.1 的失敗測試轉為 pass

### Task 1.4：驗證 Case A 通過
- [x] 1.4 驗證 Case A 通過
- **描述**：確認 Task 0.1 的測試從 fail 轉為 pass
- **驗證**：
  - `answerMode` 最終為 `weather`
  - `routeAfterPlan` 回傳 `targeted_tools`
  - Weather Tool invocation count = 1
  - 不增加 LLM call count

## Phase 2：Graph Integration Regression

### Task 2.1：Case B Integration Test（Bounded Extraction 驗證）
- [x] 2.1 Case B Integration Test（Bounded Extraction 驗證）
- **描述**：驗證 `answerMode=clarify` + 無 weather.location + deterministic WeatherIntent → bounded extraction 觸發一次 → targeted_tools
- **驗證**：`cd backend && npm run test -- deep-researcher.weather.test.ts`
- **約束**：不依賴固定 clarification 文案字串

### Task 2.2：Case C Integration Test（真正無地點）
- [x] 2.2 Case C Integration Test（真正無地點）
- **描述**：驗證「明天會下雨嗎」→ bounded extraction 最多一次 → 最終 clarification，Weather Tool invocation count = 0
- **驗證**：`cd backend && npm run test -- deep-researcher.weather.test.ts`

### Task 2.3：Case D Integration Test（非天氣問題不誤觸發）
- [x] 2.3 Case D Integration Test（非天氣問題不誤觸發）
- **描述**：驗證「介紹一下大寮的歷史」→ 不執行 Weather recovery → Weather Tool invocation count = 0
- **驗證**：`cd backend && npm run test -- deep-researcher.weather.test.ts`

### Task 2.4：Case E Integration Test（Provider Ambiguity 保持）
- [x] 2.4 Case E Integration Test（Provider Ambiguity 保持）
- **描述**：驗證有地點但 Mock Provider 回傳多候選 → Weather Tool invocation count = 1 → Resolver `needs_clarification` → clarification interrupt
- **驗證**：`cd backend && npm run test -- deep-researcher.weather.test.ts`

### Task 2.5：既有 Weather Test Regression
- [x] 2.5 既有 Weather Test Regression
- **描述**：執行全部既有 weather tests，確保無 regression
- **驗證**：`cd backend && npm run test -- deep-researcher.weather.test.ts`
- **門檻**：全部既有 test 通過

### Task 2.6：既有 Query Workflow Test Regression
- [x] 2.6 既有 Query Workflow Test Regression
- **描述**：執行全部既有 query workflow tests，確保 routing contract 無 regression
- **驗證**：`cd backend && npm run test -- deep-researcher.query-workflow.test.ts`
- **門檻**：全部既有 test 通過

## Phase 3：Live Smoke 與證據判斷

### Task 3.1：Backend Full Test Suite
- [x] 3.1 Backend Full Test Suite
- **描述**：執行 backend 完整 test suite
- **驗證**：`cd backend && npm run test`

### Task 3.2：Backend Lint
- [x] 3.2 Backend Lint
- **描述**：執行 backend lint
- **驗證**：`cd backend && npm run lint`

### Task 3.3：Backend Build
- [x] 3.3 Backend Build
- **描述**：執行 backend build
- **驗證**：`cd backend && npm run build`

### Task 3.4：Open-Meteo Live Smoke（選擇性，需人工執行）
- [x] 3.4 Open-Meteo Live Smoke（選擇性，需人工執行）
- **描述**：使用真實 Open-Meteo 驗證「大寮天氣」、「高雄大寮今天會下雨嗎」、「明天會下雨嗎」
- **驗證**：人工執行，記錄結果
- **輸出**：決定是否追加 `queryName` fallback task
- **注意**：Live smoke 需要真實網路，不適合 CI
- **結果**：
  - configured CCR/Anthropic Planner 與真實 Open-Meteo integrated live smoke：3/3 通過
  - 「大寮天氣」：provider-backed `needs_clarification`，不再錯誤自動選擇 New Taipei
  - 「高雄大寮今天會下雨嗎」：首次 not_found 後由既有 bounded repair 解析為 `Daliao + Kaohsiung`，forecast `success`
  - 「明天會下雨嗎」：直接 clarify或 provider not_found安全收斂，不回傳虛構地點天氣
  - Live evidence證明需要 queryName同國行政區歧義 guard，已由 Task 3.7 完成

### Task 3.5：更新 Weather 規則文件
- [x] 3.5 更新 Weather 規則文件
- **描述**：在 `docs/agent-rules/weather.md` 補充 Plan Consistency Gate 說明
- **驗證**：文件審查

### Task 3.6：修正 Configured Provider Structured Output Capability 相容性
- [x] 3.6 修正 Configured Provider Structured Output Capability 相容性
- **描述**：讓 Deep Researcher JSON 型 LLM 路徑依 `supportsStructuredOutput` capability 決定是否傳入 native `responseFormat`，同時保留 Prompt JSON 約束與 Runtime Validation。
- **檔案**：`backend/src/platform/llm-gateway.ts`、`backend/src/agents/deep-researcher.ts`
- **驗證**：
  - CCR 直接要求 unsupported native structured output 仍 fail fast
  - CCR Planner 不再因 `responseFormat` 在 request 前失敗
  - Qwen/OpenAI-compatible 仍使用 native JSON mode
  - deterministic provider 與 weather regression tests 通過

### Task 3.7：防止 queryName 自動選錯同國行政區
- [x] 3.7 防止 queryName 自動選錯同國行政區
- **描述**：當 country相同、region缺失、top candidates分數接近且行政區不同時，Resolver回傳 `ambiguous`，不得因 queryName存在而自動選第一候選。
- **檔案**：`backend/src/tools/geocoding/location-resolver.ts`
- **驗證**：
  - deterministic Daliao same-country multi-region fixture回傳 `ambiguous`
  - `location-resolver.test.ts` 全部通過
  - Open-Meteo live「大寮天氣」回傳 provider-backed `needs_clarification`

## Task 依賴關係

```text
Phase 0（Baseline）
  Task 0.1, 0.2, 0.3, 0.4（可平行）
    → Phase 1（Gate Implementation）
      Task 1.1 → Task 1.2 → Task 1.3 → Task 1.4
        → Phase 2（Integration）
          Task 2.1, 2.2, 2.3, 2.4, 2.5, 2.6（可平行，依賴 Phase 1 完成）
            → Phase 3（Live Smoke & Final）
              Task 3.1, 3.2, 3.3（可平行）
                Task 3.4（選擇性，需人工）
                Task 3.5
```

## 驗證命令摘要

```bash
# Phase 0 & 1: Unit + Integration tests
cd backend
npm run test -- deep-researcher.weather.test.ts
npm run test -- deep-researcher.query-workflow.test.ts

# Phase 3: Full suite
cd backend
npm run lint
npm run test
npm run build
```
