# Proposal：修正天氣澄清的 Frontend Resume Contract

## Intent

目前天氣澄清（weather clarification）流程中，Backend 已正確產生 LangGraph interrupt 並具備 `resumeClarify` 節點以處理 `Command(resume=...)`。但 Frontend 在收到 interrupt 後，將使用者選擇以一般 `HumanMessage` 形式透過 `thread.submit({messages})` 發送，導致 Graph 重新進入 `plan_research` 而非 `resume_clarify`，中斷了正確的 Human-in-the-loop resume contract。

本 Change 修正 Frontend transport 層，讓天氣澄清互動透過同一 thread_id 的 `Command(resume=...)` 恢復 Graph 執行，並傳遞結構化 resume payload（`userReply`、`candidateIndex`、`cancel`）。

## Why

已歸檔的 `weather-clarification-workflow`（`openspec/changes/archive/2026-06-26-weather-clarification-workflow/`）的 Task 4.3 明確要求「同一 threadId 呼叫 resume」。但目前實作使用一般 `thread.submit({messages})`，造成以下人工測試失敗：

```text
用戶「大寮天氣」→ Backend interrupt (weather_clarification，5 candidates)
→ UI 顯示候選清單
→ 用戶點選「Daliao, Kaohsiung, Kaohsiung, Taiwan」
→ UI 將 candidate.displayName 當作純文字 submit
→ App.tsx 包成 HumanMessage → thread.submit({messages})
→ Graph 重新進入 plan_research（非 resume_clarify）
→ Planner 收到純地名非天氣問題 → 要求補充地點
```

正確流程應為：

```text
用戶「大寮天氣」→ Backend interrupt
→ 用戶點選候選或輸入文字
→ Frontend 呼叫 thread.submit(null, {command: {resume: {userReply, candidateIndex}}})
→ Graph 從 interrupt 恢復，進入 resume_clarify
→ Planner 結合候選與回覆進行地點解析 → 天氣成功
```

`@langchain/langgraph-sdk` 的 `useStream.submit()` 已支援 `command?: Command` 選項（含 `resume` 欄位），Backend 的 `clarifyInterrupt` 已正確實作 `interrupt(payload)` 並透過 `parseClarificationResumeInput` 處理 resume value。缺失的環節僅在 Frontend 未使用此 API。

## Goals

1. Weather clarification 使用者點選候選時，透過 `thread.submit(null, {command: {resume: {userReply, candidateIndex}}})` 恢復執行
2. 使用者手動輸入文字後提交時，透過 `thread.submit(null, {command: {resume: {userReply}}})` 恢復執行
3. 使用者取消時，透過 `thread.submit(null, {command: {resume: {cancel: true}}})` 恢復執行
4. `WeatherClarificationInteractive` 的 `onReply` callback 改為接受結構化 payload（`ClarificationReplyPayload`）
5. 現有一般 text submit 流程（非 clarification）不受影響
6. 現有 Frontend 測試更新為驗證結構化 resume payload 而非純文字

## Non-Goals

- 不修改 Backend `clarifyInterrupt` 或 `resumeClarify` 實作（已正確實作）
- 不修改 BFF（LangGraph SDK 直接處理 Command，無需 BFF 中介）
- 不修改 `@langchain/langgraph-sdk`
- 不修改已歸檔的 `weather-clarification-workflow` change
- 不新增天氣能力或 Tool
- 不修改 Planner prompt 或 resolution 邏輯
- 不改變 interrupt payload schema

## Capabilities

### Modified Capabilities

- `frontend-clarification-ui`：修正 `WeatherClarificationInteractive` 的 submit/resume contract，從純文字 callback 改為結構化 `ClarificationReplyPayload`；新增 `ClarificationResumeValue` 型別；`App.tsx` 新增 `handleClarificationResume` callback

### New Capabilities

無。本 Change 僅修正既有能力的實作缺陷。

## Impact

受影響套件與能力域：

- **frontend**：`src/App.tsx`（新增 `handleClarificationResume` callback）、`src/components/ChatMessagesView.tsx`（`handleClarificationReply` 改用 resume callback，新增 props）、`src/components/WeatherToolResult.tsx`（`onReply` callback 型別變更、新增 `selectedIndex` state）、相關 `*.test.tsx`（更新斷言為結構化 payload）
- **backend**：無 production code 變更。需確認 `parseClarificationResumeInput` 已處理所有 resume value 形狀（已確認：string、`{userReply}`、`{cancel: true}` 均已涵蓋）
- **bff**：無變更。LangGraph SDK 的 `command` 選項透過 HTTP request body 直接傳遞，BFF proxy 無需修改

## Risks

1. **SDK Command API 相容性**：`useStream.submit()` 的 `command` 選項已在目前 SDK 型別定義中確認存在（`SubmitOptions.command?: Command`）。Risk: Low。
2. **Resume value 形狀不相容**：Backend `parseClarificationResumeInput` 目前只處理 string 和 `{userReply}`, `{cancel}`。若前端傳遞 `{candidateIndex: 5, userReply: "..."}` 物件，`userReply` 會被提取，`candidateIndex` 被忽略（Planner 將從文字推斷）。Risk: Low — candidateIndex 是輔助資訊，userReply 仍是主要輸入。
3. **現有測試依賴舊 contract**：`WeatherToolResult.test.tsx` 的 interactive clarification 測試目前驗證 `onReply` 接收字串。需更新為結構化 payload。Risk: Medium — 需仔細更新測試。

## Rollback Strategy

1. 恢復 `WeatherToolResult.tsx` 中 `onReply` 的型別為 `(replyText: string) => void`
2. 恢復 `ChatMessagesView.tsx` 中 `handleClarificationReply` 為呼叫 `onSubmit(replyText, ...)`
3. 移除 `App.tsx` 中的 `handleClarificationResume` callback
4. 恢復測試為驗證字串 payload
5. Git revert（無資料遷移、無 Schema 變更）

## Relationship To Prior Changes

- `weather-clarification-workflow`（`archive/2026-06-26-weather-clarification-workflow/`）：本 Change 修正該已歸檔 change 中 Task 4.3 的實作缺陷。該 change 的 Backend interrupt/resume 邏輯正確，本 Change 補齊 Frontend transport contract。
- `weather-forecast-capability`（`archive/2026-06-25-weather-forecast-capability/`）：本 Change 不影響預報能力；多輪澄清同時適用 current weather 與 forecast。
- 本 Change 是 regression fix，不是新功能。

## Acceptance Criteria

- `openspec validate fix-weather-clarification-resume-contract --strict` passes
- 人工測試「大寮天氣」→ 選候選 → 直接顯示天氣結果（不是再次要求補充地點）
- 點選候選後 `thread.submit` 以 `{command: {resume: {userReply, candidateIndex}}}` 呼叫
- 手動輸入文字後 `thread.submit` 以 `{command: {resume: {userReply}}}` 呼叫
- 取消後 `thread.submit` 以 `{command: {resume: {cancel: true}}}` 呼叫
- 一般對話 submit（非 clarification）仍走 `thread.submit({messages})` 不受影響
- Frontend lint、test、build 全部通過
- Backend lint、test、build 全部通過（確認無 regression）
