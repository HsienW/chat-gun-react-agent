# Tasks：修正天氣澄清的 Frontend Resume Contract

## 0. Spec Gate

- [x] 0.1 讀取 `AGENTS.md`、`frontend/AGENTS.md`、`backend/AGENTS.md`、`docs/agent-rules/weather.md`、`openspec/config.yaml`
- [x] 0.2 確認 `weather-clarification-workflow` 已歸檔於 `openspec/changes/archive/2026-06-26-weather-clarification-workflow/`，並閱讀其 `tasks.md` 的 Task 4.3
- [x] 0.3 確認 Backend `clarifyInterrupt` 與 `parseClarificationResumeInput` 已正確處理 resume value（string、`{userReply}`、`{cancel: true}`）
- [x] 0.4 確認 `@langchain/langgraph-sdk` 的 `useStream.submit()` 支援 `command?: Command` 選項
- [x] 0.5 執行 `cd frontend && npm run test` 記錄既有測試 baseline
- [x] 0.6 執行 `cd backend && npm run test` 記錄既有測試 baseline

## 1. WeatherToolResult：結構化 onReply Contract

- [x] 1.1 在 `WeatherToolResult.tsx` 中匯出 `ClarificationReplyPayload` type（`{userReply: string; candidateIndex?: number}`）
- [x] 1.2 在 `WeatherToolResult.tsx` 中匯出 `ClarificationResumeValue` type（`ClarificationReplyPayload | {cancel: true}`）
- [x] 1.3 `WeatherClarificationInteractive` 新增 `selectedIndex` state（`useState<number | undefined>`）
- [x] 1.4 候選點擊 `onClick` 同時設定 `setReplyText` 和 `setSelectedIndex(index + 1)`
- [x] 1.5 `submitReply` 建構並傳遞 `ClarificationReplyPayload` 物件（含 `userReply` 和選填 `candidateIndex`）
- [x] 1.6 `onReply` callback 型別改為 `(payload: ClarificationReplyPayload) => void`
- [x] 1.7 使用者編輯文字且不再匹配已選候選 `displayName` 時清除 `selectedIndex`；手動改回文字不得自動恢復

## 2. ChatMessagesView：Resume Callback

- [x] 2.1 `ChatMessagesViewProps` 新增 `onClarificationResume?: (resumeValue: ClarificationResumeValue) => void`
- [x] 2.2 匯入 `ClarificationReplyPayload` 和 `ClarificationResumeValue` 型別
- [x] 2.3 `handleClarificationReply` 改為接收 `ClarificationReplyPayload` 並呼叫 `onClarificationResume`
- [x] 2.4 `handleClarificationCancel` 改為呼叫 `onClarificationResume?.({cancel: true})`
- [x] 2.5 同步更新 `ToolMessageDisplay.tsx` 的 `onClarificationReply` prop 型別，確認型別經 `AiMessageBubble` 到 `ChatMessagesView` 全鏈一致

## 3. App.tsx：Command(resume) Transport

- [x] 3.1 新增 `handleClarificationResume` callback，調用 `thread.submit(null, {command: {resume: resumeValue}})`
- [x] 3.2 `handleClarificationResume` 中 reset stream activity state（`resetForAgentOrSubmit`、`streamStarted`）
- [x] 3.3 `handleSubmit` 中新增 guard：若 `weatherClarificationMessages` 存在則阻斷一般 submit
- [x] 3.4 新增 `clarificationResumePendingRef`：resume 時設為 true；`handleStreamUpdate` 收到第一個非 interrupt event 時清除 `weatherClarificationMessages` 並立即設回 false；新 interrupt 重設 ref；pending resume 直接 error、cancel、finish 時清除舊 messages 並重設 ref
- [x] 3.5 傳遞 `onClarificationResume={handleClarificationResume}` 給 `ChatMessagesView`

## 4. Frontend Tests

- [x] 4.1 更新 `WeatherToolResult.test.tsx`：點選候選 → 驗證 `onReply` 收到 `{userReply, candidateIndex}`
- [x] 4.2 更新 `WeatherToolResult.test.tsx`：手動輸入文字 → 驗證 `onReply` 收到 `{userReply}`（無 `candidateIndex`）
- [x] 4.3 更新 `WeatherToolResult.test.tsx`：取消 → 驗證 `onCancel` callback 仍正常運作
- [x] 4.4 新增測試：`handleClarificationResume` 調用 `thread.submit(null, {command: {resume: ...}})`
- [x] 4.5 新增測試：點選候選後修改文字會清除 `candidateIndex`，手動改回文字亦不自動恢復
- [x] 4.6 新增測試：resume stream 第一個非 interrupt event 只清除 clarification state 一次；新的 interrupt 不會被清除；無 update 直接 finish 時清除舊 clarification
- [x] 4.7 確認所有既有測試通過（無 regression）

## 5. Backend Verification（確認無 Regression）

- [x] 5.1 `cd backend && npm run lint`
- [x] 5.2 `cd backend && npm run test`
- [x] 5.3 `cd backend && npm run build`

## 6. Integration Verification

- [x] 6.1 `cd frontend && npm run lint`
- [x] 6.2 `cd frontend && npm run test`
- [x] 6.3 `cd frontend && npm run build`
- [x] 6.4 人工 live smoke：「大寮天氣」→ 點選候選 → 確認直接顯示天氣結果（非再次要求補充地點）
- [x] 6.5 人工 live smoke：一般對話 submit（非 clarification）→ 確認仍正常運作
- [x] 6.6 人工 live smoke：「大寮天氣」→ 手動輸入文字 → 確認 resume 正常
- [x] 6.7 人工 live smoke：「大寮天氣」→ 按取消 → 確認 cancelled 狀態
