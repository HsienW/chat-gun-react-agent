# Proposal：天氣多輪澄清工作流程

## Intent

目前當天氣查詢遇到 ambiguous location 時，系統會回傳候選列表並顯示 `needs_clarification`，但這是一個 terminal state — 使用者無法回覆「第三個」「高雄」「Taipei not Taiwan」來繼續互動。系統會把使用者的回覆當作全新查詢，丟失上一輪的候選上下文。

本 Change 將 `needs_clarification` 從 terminal state 轉換為 LangGraph interrupt，允許使用者在看到候選列表後編輯回覆並繼續查詢，直到地點解析成功、使用者取消或逾時。

## Why

Phase 1 baseline (`weather-golden-eval`) 記錄了 `WGE-MULTITURN-CANDIDATE-KNOWN-GAP` 為 Phase 3 owned 的已知缺口。Phase 2 (`weather-forecast-capability`) 已交付預報能力，但多輪澄清仍然是系統的已知缺口：

```text
使用者：Springfield 天氣
系統：  候選 [Springfield-IL, Springfield-MO, ...] + "請指定國家或區域"
使用者：第一個   → ❌ 無法理解
使用者：Illinois → ❌ 無法關聯候選
使用者：換高雄   → ❌ 當作新查詢
```

本 Change 為天氣能力增加正式的 Human-in-the-loop 中斷／恢復機制，填補 Phase 1 baseline 中最後一個 known gap。

## Goals

1. 當天氣查詢回傳 `needs_clarification` 時，LangGraph 進入 interrupt 狀態而非 terminal state。
2. Interrupt payload 包含完整候選列表、原始查詢與 weather capability context，足以讓後續 resume 正確繼續。
3. 使用者在 Frontend 可以從候選列表中選擇、編輯文字後手動重新送出。
4. Resume 後，Planner 結合使用者回覆與 pending candidates 進行地點解析，不再從頭開始。
5. 支援多種使用者回覆模式：候選編號、候選名稱、補充國家／區域、更換地點、取消。
6. Phase 1 baseline 中的 `WGE-MULTITURN-CANDIDATE-KNOWN-GAP` 轉為 passing。
7. 現有 current weather 與 forecast 行為不受影響。
8. BFF 正確透傳 interrupt 訊號與 resume 請求；不新增 route。

## Non-Goals

- 不新增 Weather Provider 或 Geocoding Provider。
- 不改變 Planner 的 weather capability 分類邏輯（current/hourly/daily 分類維持不變）。
- 不實作多輪對話中的非天氣 domain 切換（那是 Planner 的既有責任）。
- 不實作歷史天氣、氣候知識或旅遊建議。
- 不實作「智慧推薦」或自動選擇候選。
- 不改變 BFF 的 auth、CORS、rate limit 策略。
- 不改變 `current_weather` 或 `weather_forecast` 的 tool schema。

## Capabilities

### New Capabilities

- `weather-clarification-interrupt`：定義 LangGraph interrupt/resume 的 state、payload、Planner resume prompt 與 resolution 行為。
- `frontend-clarification-ui`：定義 Frontend 的候選互動 UI、編輯送出、interrupt 狀態識別與取消行為。

### Modified Capabilities

- `weather-golden-eval`：將 Phase 3 known gap 轉為 passing，新增多輪 clarification 的 deterministic 與 mock integration 案例。

## Impact

受影響套件與能力域：

- **backend**：`DeepResearchState` 新增 clarification 相關欄位；`targetedTools` node 在 `needs_clarification` 時改為 interrupt 而非 terminal；新增 `resumeAfterClarification` 或等價 resume node；Planner prompt 擴充 clarification context；新增 deterministic 與 mock integration 測試。
- **frontend**：`WeatherToolResult` 元件新增可互動候選 UI；`ToolMessageDisplay` 識別 interrupt 狀態；`App.tsx` 處理 resume 流程；新增 component 測試。
- **bff**：確認 interrupt signal 與 resume 請求正確透傳；若 LangGraph SDK 需要額外 header 或 event type mapping，在此處理。無新 route。
- **docs/agent-rules/weather.md**：更新 multi-turn 能力邊界（從 known gap 移入正式能力）。
- **openspec**：Phase 3 規劃產物。

## Risks

1. **LangGraph interrupt API 複雜度**：`interrupt()` 的 checkpoint、resume 與錯誤處理可能與現有 LangGraph 版本有相容性問題。Mitigation：先用 deterministic test 驗證 interrupt/abort/resume/timeout 的行為，再進行 mock integration。
2. **Resume 重複副作用**：resume 後可能重複執行 geocoding 或 weather tool call。Mitigation：使用 checkpoint step 或 idempotencyKey 防止重複。
3. **Frontend interrupt 狀態識別**：現有 `useStream` hook 可能不完全支援 LangGraph interrupt event。Mitigation：若需要，在 Frontend 的 stream parser 中新增 interrupt event type 處理。
4. **Resume 後 Planner 無法正確結合候選**：Planner 可能忽略 pending candidates 只使用使用者原始輸入。Mitigation：Planner prompt 明確傳入 pending candidates context。
5. **BFF 透傳中斷**：BFF 可能不認識 interrupt event 而誤轉成 terminal error。Mitigation：先確認 BFF stream proxy 對未知 event 的處理方式，必要時新增 event type mapping。

## Rollback Strategy

1. 移除 `DeepResearchState` 中的 clarification 欄位。
2. 恢復 `targetedTools` node 中 `needs_clarification` 的 terminal 行為。
3. 移除 Frontend 的候選互動 UI 與 resume 邏輯。
4. 恢復 Planner prompt（移除 clarification context 段落）。
5. 保留 `weather-golden-eval` 中的 Phase 3 案例（可標回 known gap）。
6. BFF 不需 rollback（無新 route）。

## Relationship To Prior Phases

- Phase 1 (`weather-golden-eval`)：baseline 中有 `WGE-MULTITURN-CANDIDATE-KNOWN-GAP`（Phase 3 owned）。
- Phase 2 (`weather-forecast-capability`)：已交付 forecast；本 Change 的多輪澄清同時適用 current weather 與 forecast。
- 本 Change 是 Phase 3，是 weather-golden-eval 所規劃的最後一個 known gap。

## Acceptance Criteria

- `openspec validate weather-clarification-workflow --strict` passes。
- LangGraph 在 `needs_clarification` 時正確進入 interrupt 狀態，而非 terminal。
- Frontend 顯示可互動候選列表，使用者可編輯後手動送出。
- Resume 後，Planner 能從候選中選出正確地點並完成天氣查詢。
- 「第一個」「Illinois」「換高雄」等回覆模式均有 test coverage。
- Phase 1/Phase 2 weather baseline regression 全部維持 passing。
- Live smoke 是 opt-in 且誠實報告。
