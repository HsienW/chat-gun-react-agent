# frontend-clarification-ui

## Purpose

本規格修正 `frontend-clarification-ui` 中關於天氣澄清回覆的 transport contract：從一般 `HumanMessage` submit 改為 LangGraph `Command(resume=...)` 呼叫，以正確銜接 Backend 的 `resumeClarify` interrupt resume 流程。

## MODIFIED Requirements

### Requirement: Reply MUST use Command(resume) on the same threadId

使用者送出澄清回覆時，Frontend MUST 透過 `thread.submit(null, {command: {resume: ...}})` 發送，而非包裝成新的 `HumanMessage`。

#### Scenario: Candidate selection resumes with structured payload

- **GIVEN** 候選列表已顯示
- **AND** 使用者點選某個候選（例如 index 3）
- **WHEN** 使用者點選送出按鈕或按下 Enter
- **THEN** Frontend MUST 呼叫 `thread.submit(null, {command: {resume: {userReply: <displayName>, candidateIndex: <1-based index>}}})`
- **AND** MUST NOT 呼叫 `thread.submit({messages: [...]})`
- **AND** MUST 使用與原始對話相同的 thread_id（LangGraph SDK 自動處理）
- **AND** resume 後 Graph MUST 進入 `resume_clarify` 節點而非 `plan_research`

#### Scenario: Manual text input resumes with userReply only

- **GIVEN** clarification UI 顯示中
- **AND** 使用者手動在輸入欄位中輸入自訂文字（未點選候選，或已修改所選候選的文字）
- **WHEN** 使用者點選送出
- **THEN** Frontend MUST 呼叫 `thread.submit(null, {command: {resume: {userReply: <text>}}})`
- **AND** resume value 中 MUST NOT 包含 `candidateIndex`

#### Scenario: Cancel sends cancel signal via resume

- **GIVEN** clarification UI 顯示中
- **WHEN** 使用者點選取消
- **THEN** Frontend MUST 呼叫 `thread.submit(null, {command: {resume: {cancel: true}}})`
- **AND** MUST NOT 發送新 HumanMessage
- **AND** Backend `parseClarificationResumeInput` MUST 將 `{cancel: true}` 解析為 `userReply: "cancel"`

#### Scenario: Regular chat submit unchanged

- **GIVEN** 沒有 active clarification（`weatherClarificationMessages` 為 null）
- **WHEN** 使用者一般提交文字
- **THEN** Frontend MUST 仍使用 `thread.submit({messages: [...]})` 發送
- **AND** MUST NOT 使用 `command: {resume: ...}` 選項

### Requirement: Reply MUST be editable before manual resubmission

使用者 MUST 能夠編輯回覆文字後手動送出，而非自動重送。

#### Scenario: Candidate selection populates input

- **GIVEN** 候選列表已顯示
- **WHEN** 使用者點選某個候選
- **THEN** 該候選的 `displayName` MUST 填入可編輯的輸入欄位
- **AND** 該候選的 1-based index MUST 被記錄（用於 `candidateIndex` resume payload）
- **AND** 使用者 MUST 可以修改輸入欄位中的文字
- **AND** MUST NOT 自動送出

#### Scenario: Editing selected candidate clears candidateIndex

- **GIVEN** 使用者已點選候選且輸入欄位等於該候選的 `displayName`
- **WHEN** 使用者編輯文字，使輸入值不再等於該候選的 `displayName`
- **THEN** Frontend MUST 清除已記錄的 `candidateIndex`
- **AND** 即使使用者手動將文字改回相同 `displayName`，MUST NOT 自動恢復 `candidateIndex`
- **AND** 使用者 MUST 重新點選候選才能再次建立 candidate selection

#### Scenario: Manual resubmission

- **GIVEN** 輸入欄位中有文字
- **WHEN** 使用者點選送出按鈕或按下 Enter
- **THEN** MUST 以結構化 `ClarificationReplyPayload` 呼叫 `onReply` callback
- **AND** payload MUST 包含 `userReply`（字串）
- **AND** 僅當輸入值仍等於使用者最後點選候選的 `displayName` 時，payload MUST 包含 `candidateIndex`（正整數，1-based）
- **AND** 使用者手動修改文字後，payload MUST NOT 包含 `candidateIndex`
- **AND** 送出後 MUST 顯示 loading 狀態

#### Scenario: Empty submission prevented

- **GIVEN** 輸入欄位為空或僅含空白
- **WHEN** 使用者嘗試送出
- **THEN** 送出 MUST be prevented
- **AND** MUST 顯示提示（例如 disable button）

### Requirement: Cancel clarification

使用者 MUST 能夠取消澄清流程。

#### Scenario: Cancel button visible

- **GIVEN** clarification UI 已顯示
- **WHEN** `WeatherToolResultCard` 元件渲染 `needs_clarification` 狀態
- **AND** `onClarificationCancel` prop 已提供
- **THEN** MUST 顯示取消按鈕或等價操作

#### Scenario: Cancel transitions to cancelled state

- **GIVEN** 使用者點選取消
- **WHEN** 取消請求完成
- **THEN** clarification 卡片 MUST 顯示 cancelled 狀態
- **AND** MUST NOT 保留可互動的候選列表

## ADDED Requirements

### Requirement: ClarificationResumeValue type contract

Frontend MUST 使用明確的 TypeScript 型別定義 clarification resume payload。

#### Scenario: ClarificationReplyPayload has required fields

- **GIVEN** `WeatherToolResult.tsx` 匯出 `ClarificationReplyPayload` 型別
- **WHEN** 該型別被使用
- **THEN** MUST 包含 `userReply: string`（必填）
- **AND** MAY 包含 `candidateIndex?: number`（選填，僅在使用者點選候選時出現）

#### Scenario: ClarificationResumeValue is a discriminated union

- **GIVEN** `WeatherToolResult.tsx` 匯出 `ClarificationResumeValue` 型別
- **WHEN** 該型別被使用
- **THEN** MUST 為 `ClarificationReplyPayload | { cancel: true }`
- **AND** 呼叫端可透過 `"cancel" in value` 判別 cancel vs reply

### Requirement: Clarification state MUST clear once per resume stream

Frontend MUST 在 clarification resume 後，以明確且冪等的條件清除舊 clarification UI。

#### Scenario: First non-interrupt event clears stale clarification

- **GIVEN** clarification resume 已送出
- **AND** 舊 clarification UI 仍以 loading 狀態顯示
- **WHEN** resume stream 收到第一個非 interrupt event
- **THEN** Frontend MUST 清除舊 clarification messages
- **AND** 後續重複或非 interrupt events MUST NOT 重複觸發清除

#### Scenario: Re-interrupt preserves new clarification

- **GIVEN** clarification resume 已送出
- **WHEN** resume stream 回傳新的 interrupt event
- **THEN** Frontend MUST 顯示新的 clarification messages
- **AND** MUST NOT 由舊 resume 的 pending cleanup 清除新 clarification

#### Scenario: Terminal event clears pending clarification fallback

- **GIVEN** clarification resume 已送出
- **AND** 尚未收到非 interrupt update event
- **WHEN** stream 直接 finish、error 或被使用者取消
- **THEN** Frontend MUST 清除舊 clarification messages
- **AND** MUST 重設 pending cleanup 狀態，避免影響下一次 submit
