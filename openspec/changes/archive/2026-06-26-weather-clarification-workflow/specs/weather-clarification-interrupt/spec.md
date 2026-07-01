# weather-clarification-interrupt

## ADDED Requirements

### Requirement: LangGraph interrupt on ambiguous location

當天氣 Tool 回傳 `needs_clarification` 且包含候選列表時，LangGraph workflow MUST 進入 interrupt 狀態，而非 terminal state。

#### Scenario: Ambiguous location triggers interrupt

- **GIVEN** 使用者查詢「Springfield 天氣」
- **AND** Geocoding Provider 回傳多個接近候選
- **WHEN** `targetedTools` node 收到 `needs_clarification` 結果
- **THEN** LangGraph MUST 呼叫 `interrupt()` 並附帶完整 clarification payload
- **AND** interrupt payload MUST 包含 `candidates`（至少 2 個）、`originalQuery`、`weatherCapability` 與 `weatherExecution` 快照
- **AND** workflow MUST NOT 進入 synthesis 或 terminal state

#### Scenario: Interrupt state survives checkpoint

- **GIVEN** workflow 已進入 interrupt 狀態
- **WHEN** checkpoint 被儲存並在稍後恢復
- **THEN** 恢復的 state MUST 包含完整 `weatherExecution` 與 interrupt payload
- **AND** resume 後 MUST NOT 重複執行已完成的 geocoding 呼叫

#### Scenario: Single candidate does not trigger interrupt

- **GIVEN** Geocoding Provider 回傳唯一候選
- **WHEN** `targetedTools` node 收到 `resolved` 結果
- **THEN** workflow MUST 直接執行 weather tool 並進入 synthesis
- **AND** MUST NOT 觸發 interrupt

#### Scenario: Not found does not trigger interrupt

- **GIVEN** Geocoding Provider 回傳 `not_found`
- **WHEN** `targetedTools` node 收到結果
- **THEN** workflow MUST 直接進入 synthesis 並回傳 error result
- **AND** MUST NOT 觸發 interrupt

### Requirement: Resume after clarification

使用者送出澄清回覆後，workflow MUST 從 interrupt point 恢復，並使用 pending candidates 與使用者回覆重新解析地點。

#### Scenario: User selects candidate by index

- **GIVEN** interrupt payload 包含候選 [Springfield-IL, Springfield-MO, Springfield-MA]
- **AND** 使用者回覆「第二個」
- **WHEN** resume 後 Planner 處理使用者回覆
- **THEN** Planner MUST 從 pending candidates 中選出 index 1（Springfield-MO）
- **AND** Resolver MUST 使用選定候選的 provider ID 取得天氣

#### Scenario: User supplements country or region

- **GIVEN** interrupt payload 包含候選 [Springfield-IL, Springfield-MO]
- **AND** 使用者回覆「Illinois」
- **WHEN** resume 後 Planner 處理使用者回覆
- **THEN** Planner MUST 將候選過濾為 country/region 匹配 Illinois 的項目
- **AND** Resolver MUST 使用過濾後候選繼續

#### Scenario: User changes location

- **GIVEN** interrupt payload 包含 Springfield 候選
- **AND** 使用者回覆「換高雄」
- **WHEN** resume 後 Planner 處理使用者回覆
- **THEN** Planner MUST 識別這是新的地點查詢（覆蓋原始 `originalQuery`）
- **AND** Resolver MUST 對新地點執行完整 geocoding
- **AND** MUST NOT 受限於 pending candidates

#### Scenario: User cancels clarification

- **GIVEN** workflow 在 interrupt 狀態
- **WHEN** 使用者觸發取消
- **THEN** workflow MUST 進入 terminal cancelled state
- **AND** Frontend MUST 顯示取消狀態

#### Scenario: Clarification timeout

- **GIVEN** workflow 在 interrupt 狀態超過可設定的 timeout
- **WHEN** timeout 觸發
- **THEN** workflow MUST 進入 terminal timeout state
- **AND** MUST 釋放 checkpoint 資源

### Requirement: Clarification state schema MUST be structured and resume-ready

Interrupt payload 與 resume state MUST 使用明確的結構化 schema，包含所有恢復所需資訊。

#### Scenario: Interrupt payload has required fields

- **GIVEN** workflow 準備進入 interrupt
- **WHEN** interrupt payload 被建構
- **THEN** payload MUST 包含以下欄位：
  - `type: "weather_clarification"`
  - `candidates`: 候選列表（每項含 `name`、`displayName`、`country`、`admin1`、`providerId`）
  - `originalQuery`: 使用者原始地點輸入（`rawLocation` 與 `location`）
  - `weatherCapability`: 原始查詢的 weather capability（`current`、`hourly`、`daily`）
  - `timeRange`: 原始查詢的時間範圍（若有）
  - `summary`: 面向使用者的澄清提示文字
- **AND** all fields MUST be JSON-serializable

#### Scenario: Resume input validation

- **GIVEN** 使用者送出 resume 請求
- **WHEN** resume input 被處理
- **THEN** resume input MUST 包含 `userReply`（字串）
- **AND** empty `userReply` MUST be rejected with validation error
- **AND** `userReply` over 500 characters MUST be rejected

### Requirement: Tool execution on resume MUST be idempotent

Resume 後 MUST NOT 重複執行已完成的 side effect。

#### Scenario: Geocoding not repeated on resume

- **GIVEN** interrupt 前的 geocoding 已完成（candidates 已取得）
- **WHEN** resume 後使用 pending candidates 選出地點
- **THEN** MUST NOT 再次呼叫 Geocoding Provider
- **AND** 直接使用選定候選的座標進入 weather tool

#### Scenario: Weather tool executed only after resolution

- **GIVEN** resume 後地點已從 pending candidates 解析
- **WHEN** Resolver 確認 resolved
- **THEN** weather tool MUST 被呼叫一次
- **AND** MUST NOT 在 resume 時重複 weather tool 呼叫

### Requirement: Planner clarification prompt MUST receive pending candidates context

Planner 在 resume 時 MUST 接收 pending candidates context，並區分候選選擇、補充資訊、更換地點與取消。

#### Scenario: Planner receives clarification context

- **GIVEN** workflow 從 interrupt resume
- **WHEN** Planner 被呼叫以解析使用者回覆
- **THEN** Planner prompt MUST 包含：
  - pending candidates 列表（含 index、displayName、country、admin1）
  - 原始 weather capability 與 timeRange
  - 使用者回覆文字
- **AND** Planner MUST 輸出一致的結構化 resolution（選定候選 index、補充過濾條件、新地點文字、或取消）

#### Scenario: Planner handles unrecognizable reply

- **GIVEN** 使用者回覆無法與候選關聯（例如「今天運氣如何」）
- **WHEN** Planner 處理回覆
- **THEN** Planner MUST 回傳 `unrecognized` status
- **AND** workflow MAY 再次進入 interrupt 或 fallback 到 terminal error
