# frontend-clarification-ui

## ADDED Requirements

### Requirement: Interactive candidate display

當收到 `needs_clarification` 狀態時，Frontend MUST 顯示可互動的候選列表，而非靜態提示文字。

#### Scenario: Candidates rendered as selectable items

- **GIVEN** Weather tool result 的 status 為 `needs_clarification`
- **AND** result 包含 `candidates` 陣列（至少 2 個）
- **WHEN** `WeatherToolResult` 元件渲染
- **THEN** 每個 candidate MUST 顯示為可選取的項目
- **AND** 每個項目 MUST 顯示 `displayName` 與行政區資訊（`country`、`admin1`）
- **AND** 項目 MUST 有明確的選取視覺提示（hover、focus、selected state）
- **AND** MUST NOT 以一般錯誤樣式渲染

#### Scenario: Empty candidates fallback

- **GIVEN** result status 為 `needs_clarification`
- **AND** `candidates` 為空陣列或不存在
- **WHEN** `WeatherToolResult` 元件渲染
- **THEN** MUST 顯示 summary 文字
- **AND** MUST 顯示通用輸入提示（「請輸入更詳細的地點資訊」）

### Requirement: Reply MUST be editable before manual resubmission

使用者 MUST 能夠編輯回覆文字後手動送出，而非自動重送。

#### Scenario: Candidate selection populates input

- **GIVEN** 候選列表已顯示
- **WHEN** 使用者點選某個候選
- **THEN** 該候選的 `displayName` MUST 填入可編輯的輸入欄位
- **AND** 使用者 MUST 可以修改輸入欄位中的文字
- **AND** MUST NOT 自動送出

#### Scenario: Manual resubmission

- **GIVEN** 輸入欄位中有文字
- **WHEN** 使用者點選送出按鈕或按下 Enter
- **THEN** MUST 以該文字作為新的使用者訊息送出
- **AND** MUST 使用相同的 `threadId`（resume 而非新對話）
- **AND** 送出後 MUST 顯示 loading 狀態

#### Scenario: Empty submission prevented

- **GIVEN** 輸入欄位為空或僅含空白
- **WHEN** 使用者嘗試送出
- **THEN** 送出 MUST be prevented
- **AND** MUST 顯示提示（例如 disable button）

### Requirement: Clarification state isolation

Clarification UI MUST 與其他 weather tool 狀態（success、error、not_found）有明確視覺區隔，且不影響其他訊息。

#### Scenario: Clarification does not affect other messages

- **GIVEN** 聊天中有多個訊息
- **AND** 某個 weather tool result 為 `needs_clarification`
- **WHEN** 使用者在該 clarification 互動
- **THEN** 其他訊息的顯示 MUST NOT 改變
- **AND** MUST NOT 觸發全域 loading 狀態（僅該 clarification 卡片顯示互動中）

#### Scenario: Clarification card transitions to loading on resubmit

- **GIVEN** 使用者已編輯回覆並送出
- **WHEN** resume 請求已發出
- **THEN** clarification 卡片 MUST 顯示 loading 或等待狀態
- **AND** MUST 禁用重複送出

### Requirement: Cancel clarification

使用者 MUST 能夠取消澄清流程。

#### Scenario: Cancel button visible

- **GIVEN** clarification UI 已顯示
- **WHEN** `WeatherToolResult` 元件渲染 `needs_clarification` 狀態
- **THEN** MUST 顯示取消按鈕或等價操作
- **AND** 取消 MUST 發送取消訊號（而非 resume）

#### Scenario: Cancel transitions to terminal state

- **GIVEN** 使用者點選取消
- **WHEN** 取消請求完成
- **THEN** clarification 卡片 MUST 顯示 cancelled 狀態
- **AND** MUST NOT 保留可互動的候選列表
- **AND** cancelled state MUST 不可復原（不可再次 resume）

### Requirement: Interrupt event recognition

Frontend MUST 能識別 LangGraph interrupt event，區分於一般 streaming event 與 terminal event。

#### Scenario: Interrupt event does not close stream

- **GIVEN** BFF 透傳 LangGraph interrupt event
- **WHEN** Frontend stream parser 收到 interrupt event
- **THEN** stream MUST NOT 被標記為 terminal
- **AND** `thread.isLoading` MUST 轉為 false（等待使用者輸入）
- **AND** 聊天 UI MUST 顯示等待使用者輸入的狀態

#### Scenario: Unknown event type safe degradation

- **GIVEN** BFF 透傳未知的 event type
- **WHEN** Frontend stream parser 收到該 event
- **THEN** MUST NOT crash
- **AND** MUST 安全降級（記錄並忽略，或顯示通用狀態）
