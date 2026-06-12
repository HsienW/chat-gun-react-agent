# Delta for Frontend Chat

## ADDED Requirements

### Requirement: 前端必須顯示天氣 Tool 的明確狀態

Frontend MUST 將 Weather Tool 的 Structured Result 轉換為可理解且具終態的顯示狀態。

#### Scenario: Weather Tool 尚未回傳

- GIVEN AI Message 已包含 `current_weather` Tool Call
- AND尚未收到對應 Tool Result
- WHEN Frontend Render Tool Panel
- THEN狀態 MUST 顯示「執行中」

#### Scenario: Weather Tool 成功

- GIVEN收到 `status: "success"` 的 Weather Tool Result
- WHEN Frontend Render Tool Panel
- THEN狀態 MUST 顯示「完成」
- AND MUST NOT 繼續顯示「執行中」

#### Scenario: Weather Tool 需要補充地點

- GIVEN收到 `status: "needs_clarification"` 的 Weather Tool Result
- WHEN Frontend Render Tool Panel
- THEN狀態 MUST 顯示「需補充地點」
- AND MUST NOT 將該狀態顯示為一般系統錯誤

#### Scenario: Weather Tool 找不到地點

- GIVEN收到 `status: "not_found"` 的 Weather Tool Result
- WHEN Frontend Render Tool Panel
- THEN狀態 MUST 顯示「找不到地點」
- AND MUST NOT 永久停留在執行中

#### Scenario: Weather Tool 逾時

- GIVEN收到 Error Code `weather_timeout`
- WHEN Frontend Render Tool Panel
- THEN狀態 MUST 顯示「逾時」
- AND該 Tool Call MUST 被視為 Terminal State

---

### Requirement: 前端必須以安全方式顯示歧義候選

Frontend MUST 對 `needs_clarification` 顯示有限、可讀且不自動執行的地點候選。

#### Scenario: 顯示候選地點

- GIVEN Weather Tool Result 包含多個 Candidates
- WHEN Frontend 展開 Tool Panel
- THEN Frontend MUST 顯示最多五個候選
- AND每個候選 SHOULD 顯示 displayName、country、admin1 與 admin2
- AND一般模式 MUST NOT 顯示 latitude 或 longitude

#### Scenario: 使用者尚未選擇或補充地點

- GIVEN Frontend 已顯示歧義候選
- WHEN使用者沒有送出新訊息
- THEN Frontend MUST NOT 自動選擇候選
- AND MUST NOT 自動重新呼叫 Weather Tool

---

### Requirement: 前端必須支援 Weather Result 契約版本降級

Frontend MUST 驗證 `schemaVersion` 與 `status`，並對未知格式安全降級。

#### Scenario: 收到已知版本

- GIVEN Weather Tool Result 的 `schemaVersion` 為 `1.0`
- WHEN Frontend Parse Result
- THEN Frontend MUST 依 Discriminated Union Render
- AND MUST NOT 依人類可讀文字標籤判斷狀態

#### Scenario: 收到未知版本

- GIVEN Weather Tool Result 包含未知 `schemaVersion`
- WHEN Frontend Parse Result
- THEN Chat View MUST NOT Crash
- AND Frontend SHOULD 顯示 `summary`
- AND若沒有 `summary`，Frontend MAY 顯示安全 JSON
- AND Frontend MUST 記錄 Warning

#### Scenario: 收到未知狀態

- GIVEN Weather Tool Result 包含未知 `status`
- WHEN Frontend Render Tool Panel
- THEN Frontend MUST 將該 Result 視為已收到回應
- AND MUST NOT 永久顯示「執行中」
- AND MUST 使用安全降級顯示

---

### Requirement: 前端不得暴露內部敏感錯誤

Frontend MUST 顯示經過整理的 Weather Error，MUST NOT 顯示 API Key、Proxy Credential 或 Stack Trace。

#### Scenario: Backend 回傳 Provider Error

- GIVEN Weather Tool Result 為 `status: "error"`
- WHEN Frontend Render Error
- THEN Frontend MUST 顯示 Code 與安全 Message
- AND MUST NOT 顯示 API Key
- AND MUST NOT 顯示 Proxy Credential
- AND MUST NOT 顯示完整 Stack Trace

---

### Requirement: 最終聊天訊息必須在 Tool Panel 解析失敗時仍可閱讀

Frontend MUST 保持既有 Assistant Markdown Message 顯示能力，Tool Panel 的版本解析失敗 MUST NOT 阻擋最終回答。

#### Scenario: Tool Panel 無法解析 Weather Result

- GIVEN Frontend 無法完整解析 Weather Tool Result
- AND Backend 已產生最終 Assistant Message
- WHEN Chat View Render
- THEN Assistant Message MUST 仍可顯示
- AND使用者 MUST 能複製該訊息
- AND Tool Panel Error MUST NOT 造成整個 Message Group Render 失敗
