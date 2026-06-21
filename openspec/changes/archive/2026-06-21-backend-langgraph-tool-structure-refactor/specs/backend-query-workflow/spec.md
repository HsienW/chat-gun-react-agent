## ADDED Requirements

### Requirement: LangGraph State 必須保持 serializable 與 checkpoint-safe

Backend 查詢 Agent 的 LangGraph State 所有欄位 MUST be JSON-serializable，且 checkpoint 恢復後 SHALL NOT 產生資料不一致。

#### Scenario: State 欄位使用 JSON-safe types

- **WHEN** 定義或修改 DeepResearchState 的 Annotation 欄位
- **THEN** 每個欄位的型別必須可 JSON 序列化（不含 Function、Socket、AbortController、Stream 等執行期物件）
- **AND** 不得使用 `any` 掩蓋序列化問題

#### Scenario: 新增 optional 欄位時向前相容舊 checkpoint

- **GIVEN** 舊 checkpoint 中不存在新增的 optional 欄位
- **WHEN** checkpoint 恢復後 Node 讀取該欄位
- **THEN** 必須使用 Annotation 定義中的 default value
- **AND** Node 行為不得因欄位缺失而拋出錯誤

#### Scenario: Checkpoint 恢復後 Node 行為一致

- **GIVEN** 一份已儲存的 checkpoint
- **WHEN** Graph 從該 checkpoint resume
- **THEN** 每個 Node 的輸入 State 必須與原始執行相同
- **AND** resume 不得重複已完成的前置副作用

---

### Requirement: 查詢工作流必須定義 explicit invariants 再修改查詢邏輯

Backend 查詢工作流 MUST define explicit invariants for lifecycle、terminal state rules 與 error convergence。未來修改查詢功能前 SHALL update these invariants first。

#### Scenario: Query workflow lifecycle 定義明確

- **WHEN** 文件化 query workflow
- **THEN** lifecycle states 至少包含：idle、running（plan 建立後）、executing（tool 或研究執行中）、synthesizing（最終答案生成中）、done（terminal）
- **AND** 每種 state transition 有明確的觸發條件

#### Scenario: Terminal state 後不得回到 running

- **GIVEN** query workflow 已進入 done 狀態
- **WHEN** 接收到 late progress event、重複 finish 或額外 tool result
- **THEN** workflow 不得回到 running 或 executing 狀態
- **AND** late events 被 idempotently ignore

#### Scenario: Error path 收斂到 terminal

- **GIVEN** query workflow 在任何非 terminal 階段
- **WHEN** tool execution 失敗、LLM 呼叫失敗或 structured output parse 失敗
- **THEN** workflow 必須收斂到 done terminal state
- **AND** error 資訊必須保留在 terminal state 中（error code + safe message）

#### Scenario: Cancel path 收斂到 terminal

- **GIVEN** query workflow 在 running 或 executing 階段
- **WHEN** 使用者取消
- **THEN** workflow 必須收斂到 done terminal state
- **AND** cancelled message 必須保留在 messages 中

#### Scenario: 修改查詢 workflow 前先更新 invariant

- **WHEN** 任何 Change 修改查詢 graph routing、answer mode、tool execution 流程或 synthesis 邏輯
- **THEN** 該 Change 必須先更新 query workflow invariant spec
- **AND** CCR Owner 必須在 Design 核准階段確認 invariant 未被破壞

---

### Requirement: Tool 輸入與輸出必須經過 runtime schema validation

所有 Tool 的輸入 MUST pass Runtime Validation（Zod schema），輸出 MUST use structured discriminated union。

#### Scenario: Tool input 不合法

- **GIVEN** Planner 產生的 tool input 缺少必填欄位或型別錯誤
- **WHEN** Tool 被 invoke
- **THEN** Tool 必須回傳 validation error（不回傳 raw provider error）
- **AND** validation error 必須包含欄位名稱與預期型別

#### Scenario: Tool output 不符合 discriminated union

- **GIVEN** Tool 回傳的內容不是有效的 structured result
- **WHEN** Agent 嘗試解析 tool output
- **THEN** 必須使用 fallback（generic error 或 raw content display）
- **AND** 不得因 parse 失敗而 crash

#### Scenario: Tool output 包含不安全內容

- **GIVEN** Tool output 包含 HTML、script 或惡意 payload
- **WHEN** Tool output 被傳遞到 synthesis node
- **THEN** output 必須被 sanitize 或標記為不可信
- **AND** 不得直接注入到 LLM prompt 或 frontend render

---

### Requirement: Structured output validation 必須定義分級處理流程

LLM structured output 的 validation MUST have three-level processing：parse retry、schema coercion/repair、deterministic fallback。

#### Scenario: JSON parse 失敗時重試一次

- **GIVEN** LLM 回傳的內容無法被 JSON.parse 解析
- **WHEN** 這是第一次 parse failure
- **THEN** Agent 必須重試一次（重新呼叫 LLM）
- **AND** 重試前記錄 `parse_failed` diagnostic

#### Scenario: Schema 不符時嘗試 coercion

- **GIVEN** JSON parse 成功但欄位不符合預期 schema
- **WHEN** coercion 規則存在（如既有 `coercePlan`）
- **THEN** Agent 必須嘗試 coercion
- **AND** 拒絕 forbidden 欄位（如 latitude/longitude）
- **AND** 記錄 `schema_rejected` diagnostic

#### Scenario: 兩次都失敗時使用 deterministic fallback

- **GIVEN** parse 重試與 schema coercion 都失敗
- **WHEN** 沒有更多 retry 次數
- **THEN** Agent 必須使用 deterministic fallback（如 `fallbackPlan`）
- **AND** 記錄 `llm_unavailable` diagnostic
- **AND** terminal state 不得回到 running

---

### Requirement: Runtime events 必須通過 schema validation

所有 runtime event MUST pass `AgentRuntimeEvent` type check，且 timestamp SHALL use deterministic source。

#### Scenario: Runtime event 通過 type check

- **GIVEN** Backend node 產生 runtime event
- **WHEN** event 被 emit
- **THEN** event 必須是 `AgentRuntimeEvent` union 的合法 variant
- **AND** 每個 variant 的必填欄位必須存在

#### Scenario: 未知 event type 使用 unknown variant

- **GIVEN** 未來 Backend 需要發送目前 union 中未定義的 event type
- **WHEN** 該 event 被產生
- **THEN** 必須新增對應的 union variant（不鬆綁成任意 string）
- **AND** 必須同步更新 frontend 的 `AgentRuntimeEvent` type

#### Scenario: Event timestamp 使用 deterministic source

- **WHEN** runtime event 被建立
- **THEN** `ts` 欄位必須使用 deterministic timestamp source（如 `Date.now()` 或可控制的注入點）
- **AND** 不得使用非確定性來源（如 Math.random）

---

### Requirement: Tool result status 與 error codes 必須保持穩定

Tool output 的 `status` 與 `errorCode` MUST be stable enums，SHALL NOT change due to provider 或模型切換。

#### Scenario: Tool result 使用 discriminated union

- **GIVEN** Tool 回傳結構化結果
- **WHEN** Agent 或 frontend 讀取結果
- **THEN** `status` 欄位必須區分：`success`、`needs_clarification`、`not_found`、`error`
- **AND** 不得只用自然語言字串表達狀態

#### Scenario: Error code 來自結構化來源

- **WHEN** Tool 回傳 error 狀態
- **THEN** error code 必須來自結構化來源（status code、error name、cause code）
- **AND** 不得從 error message 文字中推斷 error code
- **AND** regex pattern matching（如 `/timeout|network|fetch failed/i`）不得作為公開 error code 的決定因素

#### Scenario: 新增 error code 不破壞既有相容性

- **GIVEN** 需要新增 error code
- **WHEN** error code 被加入 enum
- **THEN** frontend 的 error classification 必須能處理新 code（或安全降級為 generic）
- **AND** BFF 的 error mapping 不受影響（BFF 透傳 backend error envelope）

---

### Requirement: Query workflow MUST have regression test matrix

Backend 的查詢能力 MUST have reproducible test matrix 覆蓋正常與異常路徑。

#### Scenario: 正常成功路徑有測試

- **WHEN** 執行 backend test suite
- **THEN** 至少有一個測試驗證完整 query workflow 的成功路徑
- **AND** 測試不依賴真實外部 Provider（使用 mock）

#### Scenario: Error path 有測試

- **WHEN** 執行 backend test suite
- **THEN** 至少有一個測試驗證 tool execution 失敗時的 error convergence
- **AND** 至少有一個測試驗證 structured output parse 失敗時的 fallback behavior
- **AND** 至少有一個測試驗證 provider error 時的 terminal state

#### Scenario: Timeout / cancel path 有測試

- **WHEN** 執行 backend test suite
- **THEN** 測試必須覆蓋：tool timeout 後 terminal state 不回退
- **AND** cancel 後 workflow 正確收斂到 cancelled terminal state

#### Scenario: Unknown event / unknown status 有測試

- **WHEN** 執行 backend test suite
- **THEN** 測試必須覆蓋：AgentRuntimeEvent unknown variant 正確 emit
- **AND** Tool output unknown status 正確 fallback
