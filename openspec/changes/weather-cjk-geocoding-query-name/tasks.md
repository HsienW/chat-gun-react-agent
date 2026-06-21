# Tasks：中文地名轉寫支援

## 0. Spec Gate

- [x] 0.1 讀取 `AGENTS.md`、`backend/AGENTS.md`、`frontend/AGENTS.md`、`openspec/config.yaml`、`docs/agent-rules/weather.md`。
- [x] 0.2 讀取已封存 `generalize-weather-location-resolution` 所有 artifacts（proposal、design、specs、tasks、mock-smoke-acceptance、live-smoke-report）。
- [x] 0.3 執行 `openspec validate weather-cjk-geocoding-query-name --strict`，確認 Proposal、Design、Specs、Tasks 格式通過。
- [x] 0.4 確認本 Change 不重新打開或修改已封存 `generalize-weather-location-resolution` change。
- [x] 0.5 確認本 Change 不引入固定中文→Latin 城市 alias map、keyword regex、phrase stripping 或城市白名單。

## 1. Planner Schema & Prompt

- [x] 1.1 在 Planner Prompt（`deep-researcher.ts` plan_research Node）新增 `queryName` extraction instruction：保留 `location` 原文；若為繁體/簡體中文或含中文的混合輸入且知道 geocoding-friendly Latin name，填入 `queryName`；不確定時不填。
- [x] 1.2 在 Planner structured output schema instruction 中 `weather` 物件新增 optional `weather.queryName: string`。
- [x] 1.3 在 `coerceWeatherRequest` 中新增 `queryName` 欄位萃取與 validation（trim、不為空字串、不超長）。
- [x] 1.4 新增 Planner output test：驗證 `queryName` 欄位 optional、可萃取、不覆蓋 `location`。（deep-researcher.weather.test.ts）
- [x] 1.5 新增 Planner output test：Planner Prompt 不含 `queryName` instruction 時，`queryName` 不影響既有行為。

## 2. Tool Schema

- [x] 2.1 在 `weather.ts` `current_weather` Tool Zod schema 新增 optional `queryName: z.string().optional()`。
- [x] 2.2 `queryName` 經 runtime validation：trim、長度限制（同 `location` max chars）。
- [x] 2.3 Tool 接收 `queryName` 後傳入 `buildQueryVariants`（見 Task 3.x）。
- [x] 2.4 保留 `raw` / `location` 不變；`queryName` 只影響 geocoding query variant 順序，不進入 WeatherToolResult。
- [x] 2.5 新增 Tool schema test（weather.test.ts）：`queryName` optional；不傳時行為不變；傳入時進入 variant builder。

## 3. Query Variants

- [x] 3.1 `buildGeocodingQueryVariants` 接受 optional `queryName` 參數。
- [x] 3.2 當 `queryName` 存在且 `normalizeComparable(queryName) !== normalizeComparable(query.location)` 時，將 `queryName` 插入為第一 variant（`strategy: "original"`），`location` 退為第二。
- [x] 3.3 `queryName === location` 時不產生重複 variant（現有去重邏輯已處理）。
- [x] 3.4 `queryName` 不存在時行為完全等價既有的 variant builder。
- [x] 3.5 新增 Query Variant test（location-resolver.test.ts）：`queryName` 優先、去重、`queryName` 缺席時不變。

## 4. Resolver

- [x] 4.1 確認 LocationResolver 核心邏輯：`queryName` variant 與其他 variant 對 Resolver 透明。
- [x] 4.2 確認 `queryName` variant 結果仍經 Provider 候選驗證，不繞過 Resolver。
- [x] 4.3 修正 `mergeLocationCandidate`：language=zh variant 回傳的 localized name（如 `台北市`）不再覆蓋 Latin queryName 取得的原始名稱（`Taipei`），確保 scoring 正確。
- [x] 4.4 修正 `scoreAndResolve`：`isShortCjkQuery` early ambiguous return 在 candidates 來自 queryName variant 時跳過，不阻擋 Latin query 的成功解析。
- [x] 4.5 確認已有 Resolver tests 全部通過（150 tests）。

## 5. Tests — Mock Smoke

- [x] 5.1 新增 mock case：`台北` + `queryName: "Taipei"` → `success`。
- [x] 5.2 新增 mock case：`臺北` + `queryName: "Taipei"` → `success`（與台北同 entity）。
- [x] 5.3 新增 mock case：`高雄鳳山` + `queryName: "Kaohsiung Fengshan"` → `success`。
- [x] 5.4 新增 mock case：`北京市` + `queryName: "Beijing"` → `success`。
- [x] 5.5 新增 mock case：`新加坡` + `queryName: "Singapore"` → `success`。
- [x] 5.6 確認既有 mock cases 全通過（Latin/Unicode 不回歸）。
- [x] 5.7 確認 `queryName` 未提供時 CJK 案例行為與現狀一致。

## 6. Tests — Live Smoke (opt-in)

- [x] 6.1 `OPEN_METEO_LIVE_SMOKE=true`：`台北` + `queryName: "Taipei"` → `success`。
- [x] 6.2 `臺北` + `queryName: "Taipei"` → 與 `台北` 同 countryCode (`TW`)，座標相容。
- [ ] 6.3 `高雄鳳山` + `queryName: "Kaohsiung Fengshan"` → `not_found`。Open-Meteo 索引無此地名；需 Planner 嘗試不同 queryName（如 `Fengshan` 或 `Fengshan District`）或由 LLM Repair 補救。
- [ ] 6.4 `北京市` + `queryName: "Beijing"` → `needs_clarification`。Open-Meteo 回傳 10 個 Beijing candidates 跨 CN 多省；加上 `country: "China"` → `success`。`queryName` 有效但需 country context 消除歧義。
- [ ] 6.5 `新加坡` + `queryName: "Singapore"` → `needs_clarification`。Open-Meteo 回傳多個 Singapore entries；加上 `country: "Singapore"` 可 resolve。
- [x] 6.6 確認既有 live smoke Latin/Unicode cases 全通過（9.6–9.11, 9.14–9.15, REL:中山+country）。
- [x] 6.7 Live smoke 標註 opt-in；不要求預設 CI 執行，未執行項如實記錄。

## 7. Frontend & BFF Compatibility

- [x] 7.1 確認 Frontend 無需修改：`queryName` 不在 WeatherToolResult 中，不在 UI 顯示。
- [x] 7.2 `cd frontend && npm run test` 全部通過（42 tests）。
- [x] 7.3 `cd frontend && npm run lint` 通過。
- [x] 7.4 `cd frontend && npm run build` 通過。
- [x] 7.5 `cd bff && npm run build` 通過。

## 8. Documentation

- [x] 8.1 更新 `docs/agent-rules/weather.md`：記錄 `queryName` 責任歸屬（Planner 語意轉寫 → Resolver Provider 驗證）。
- [x] 8.2 `openspec validate weather-cjk-geocoding-query-name --strict` 通過。

## 9. Qwen Reviewer Gate

- [ ] 9.1 由 CCR 指派 Qwen Code Reviewer（Secondary Architecture Reviewer）進行唯讀架構審查。
- [ ] 9.2 Review target：Planner Prompt 變更、Tool Schema 變更、Query Variant 變更、Resolver merge/scoring 修正、Anti-hardcoding 保證。
- [ ] 9.3 解決全部 Blocker 與 Major 後才能標記 Change 完成。

## 10. Verification

- [x] 10.1 `cd backend && npm run lint` 通過。
- [x] 10.2 `cd backend && npm run test` 通過（150 tests, 23 skipped）。
- [x] 10.3 `cd backend && npm run build` 通過。
- [x] 10.4 `cd frontend && npm run lint` 通過。
- [x] 10.5 `cd frontend && npm run test` 通過（42 tests）。
- [x] 10.6 `cd frontend && npm run build` 通過。
- [x] 10.7 `openspec validate weather-cjk-geocoding-query-name --strict` 通過。
- [x] 10.8 Live smoke (`OPEN_METEO_LIVE_SMOKE=true`) 執行：11/17 pass。核心 CJK 案例（台北/臺北）成功；殘留 6 fail 為 Provider 能力上限（高雄鳳山 not_found、北京市/新加坡 needs_clarification），如實記錄於 tasks 6.3–6.5。
- [x] 10.9 Git Diff 不包含無關重構、套件升級、格式化或已封存 change 的修改。
- [x] 10.10 Mock 通過不宣稱 Live 驗收完成；Live 未驗證項已如實列出。
