# Tasks：CJK 地名轉寫支援

## 0. Spec Gate

- [ ] 0.1 讀取 `AGENTS.md`、`backend/AGENTS.md`、`frontend/AGENTS.md`、`openspec/config.yaml`、`docs/agent-rules/weather.md`。
- [ ] 0.2 讀取已封存 `generalize-weather-location-resolution` 所有 artifacts（proposal、design、specs、tasks、mock-smoke-acceptance、live-smoke-report）。
- [ ] 0.3 執行 `openspec validate weather-cjk-geocoding-query-name --strict`，確認 Proposal、Design、Specs、Tasks 格式通過。
- [ ] 0.4 確認本 Change 不重新打開或修改已封存 `generalize-weather-location-resolution` change。
- [ ] 0.5 確認本 Change 不引入固定 CJK→Latin 城市 alias map、keyword regex、phrase stripping 或城市白名單。

## 1. Planner Schema & Prompt

- [ ] 1.1 在 Planner Prompt（`deep-researcher.ts` plan_research Node）新增 `queryName` extraction instruction：保留 `location` 原文；若為純 CJK 或含 CJK 且知道 geocoding-friendly Latin name，填入 `queryName`；不確定時不填。
- [ ] 1.2 在 Planner structured output schema instruction 中 `weather` 物件新增 optional `weather.queryName: string`。
- [ ] 1.3 在 `coerceWeatherRequest` 中新增 `queryName` 欄位萃取與 validation（trim、不為空字串、不超長）。
- [ ] 1.4 新增 Planner output test：驗證 `queryName` 欄位 optional、可萃取、不覆蓋 `location`。
- [ ] 1.5 新增 Planner output test：Planner Prompt 不含 `queryName` instruction 時（模擬 rollback），`queryName` 不影響既有行為。

## 2. Tool Schema

- [ ] 2.1 在 `weather.ts` `current_weather` Tool Zod schema 新增 optional `queryName: z.string().optional()`。
- [ ] 2.2 `queryName` 經 runtime validation：trim、長度限制（同 `location` max chars）。
- [ ] 2.3 Tool 接收 `queryName` 後傳入 `buildQueryVariants`（見 Task 3.x）。
- [ ] 2.4 保留 `raw` / `location` 不變；`queryName` 只影響 geocoding query variant 順序。
- [ ] 2.5 新增 Tool schema test：`queryName` optional；不傳時行為不變；傳入時進入 variant builder。

## 3. Query Variants

- [ ] 3.1 `buildGeocodingQueryVariants` 接受 optional `queryName` 參數。
- [ ] 3.2 當 `queryName` 存在且 `normalizeComparable(queryName) !== normalizeComparable(query.location)` 時，將 `queryName` 插入為第一 variant（`strategy: "original"`），`location` 退為第二。
- [ ] 3.3 `queryName === location` 時不產生重複 variant（現有去重邏輯已處理）。
- [ ] 3.4 `queryName` 不存在時行為完全等價既有的 variant builder。
- [ ] 3.5 新增 Query Variant test：`queryName` 優先、去重、`queryName` 缺席時不變。

## 4. Resolver (No Change, Verify)

- [ ] 4.1 確認 LocationResolver 不需要任何修改 — `queryName` variant 與其他 variant 對 Resolver 透明。
- [ ] 4.2 確認 `queryName` variant 結果仍經 Provider 候選驗證，不繞過 Resolver。
- [ ] 4.3 確認已有 Resolver tests（`location-resolver.test.ts`）全部通過。

## 5. Tests — Mock Smoke

- [ ] 5.1 新增 mock case：`台北` + `queryName: "Taipei"` → `success`。
- [ ] 5.2 新增 mock case：`臺北` + `queryName: "Taipei"` → `success`（與台北同 entity）。
- [ ] 5.3 新增 mock case：`高雄鳳山` + `queryName: "Kaohsiung Fengshan"` → `success`。
- [ ] 5.4 新增 mock case：`北京市` + `queryName: "Beijing"` → `success`。
- [ ] 5.5 新增 mock case：`新加坡` + `queryName: "Singapore"` → `success`。
- [ ] 5.6 確認既有 mock cases 全通過（Latin/Unicode 不回歸）。
- [ ] 5.7 確認 `queryName` 未提供時 CJK 案例行為與現狀一致（mock 提供 CJK 候選時可解析，真實 API 仍 `not_found`）。

## 6. Tests — Live Smoke (opt-in)

- [ ] 6.1 `OPEN_METEO_LIVE_SMOKE=true` 時，新增 `台北` + `queryName: "Taipei"` → `success`。
- [ ] 6.2 `臺北` + `queryName: "Taipei"` → 與 `台北` 同 countryCode (`TW`)。
- [ ] 6.3 `高雄鳳山` + `queryName: "Kaohsiung Fengshan"` → `success` 或 `needs_clarification`。
- [ ] 6.4 `北京市` + `queryName: "Beijing"` → `success`。
- [ ] 6.5 `新加坡` + `queryName: "Singapore"` → `success`（與英文 `Singapore` 同 entity）。
- [ ] 6.6 確認既有 live smoke Latin/Unicode cases 全通過（不回歸）。
- [ ] 6.7 Live smoke 標註 opt-in；不得要求預設 CI 執行，不得假稱未執行已通過。

## 7. Frontend & BFF Compatibility

- [ ] 7.1 確認 Frontend 無需修改：`queryName` 不在 WeatherToolResult 中，不在 UI 顯示。
- [ ] 7.2 `cd frontend && npm run test` 全部通過（42 tests）。
- [ ] 7.3 `cd frontend && npm run lint` 通過。
- [ ] 7.4 `cd frontend && npm run build` 通過。
- [ ] 7.5 `cd bff && npm run build` 通過。

## 8. Documentation

- [ ] 8.1 更新 `docs/agent-rules/weather.md`：若本 Change 引入 Planner prompt 或 Tool schema 變更涉及 weather rule 範圍，記錄 `queryName` 責任歸屬。
- [ ] 8.2 確認 `openspec validate weather-cjk-geocoding-query-name --strict` 通過。

## 9. Qwen Reviewer Gate

- [ ] 9.1 由 CCR 指派 Qwen Code Reviewer（Secondary Architecture Reviewer）進行唯讀架構審查。
- [ ] 9.2 Review target：Planner Prompt 變更、Tool Schema 變更、Query Variant 變更、Anti-hardcoding 保證。
- [ ] 9.3 解決全部 Blocker 與 Major 後才能標記 Change 完成。

## 10. Verification

- [ ] 10.1 `cd backend && npm run lint` 通過。
- [ ] 10.2 `cd backend && npm run test` 通過（含新增 mock smoke + 既有 tests）。
- [ ] 10.3 `cd backend && npm run build` 通過。
- [ ] 10.4 `cd frontend && npm run lint` 通過。
- [ ] 10.5 `cd frontend && npm run test` 通過。
- [ ] 10.6 `cd frontend && npm run build` 通過。
- [ ] 10.7 `openspec validate weather-cjk-geocoding-query-name --strict` 通過。
- [ ] 10.8 Live smoke (`OPEN_METEO_LIVE_SMOKE=true`) 執行並記錄結果。
- [ ] 10.9 Git Diff 不包含無關重構、套件升級、格式化或已封存 change 的修改。
- [ ] 10.10 Mock 通過不得宣稱 Live 驗收完成；Live 未驗證項如實列出。
