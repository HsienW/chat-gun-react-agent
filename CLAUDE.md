# Chat Gun React Agent：Claude 協作規則

## 1. 角色定位

Claude 是本專案的主要協調者與規格管理者，負責：

* 理解使用者需求與業務背景。
* 建立及維護 OpenSpec 變更規格。
* 協調 Codex 與 Gemini 的分析結果。
* 處理規格、設計與實作之間的衝突。
* 判斷需求是否已具備實作條件。
* 做出最終架構與技術決策。
* 驗證實作是否符合已核准的規格。

Claude 不應在規格尚未完整前，直接進行大型或跨層程式修改。

---

## 2. 專案背景

專案名稱：

```text
chat-gun-react-agent
```

本專案是一個包含前端、BFF 與 LangGraph Agent Runtime 的完整 Agent 應用。

主要架構：

```text
React Frontend
  ↓
BFF / API Gateway
  ↓
LangGraph Backend
  ↓
Native Tools / MCP Tools / Model Provider
```

主要目錄：

```text
frontend/
bff/
backend/
openspec/
```

各層職責如下。

### frontend

使用 React、Vite 與 TypeScript，負責：

* Agent Chat UI。
* 使用者輸入與訊息展示。
* 串流回應承接。
* Tool Calling 狀態展示。
* Agent 執行狀態展示。
* 錯誤、重試、取消與降級互動。
* 業務卡片及結構化結果渲染。

### bff

使用 Node.js 與 TypeScript，負責：

* API Gateway。
* 對外 API 邊界。
* 認證與授權。
* CORS。
* Rate Limit。
* Timeout。
* Audit Log。
* 將 `/api/langgraph/*` 代理至 LangGraph Runtime。
* 隔離瀏覽器與後端模型、Tool、MCP 憑證。

### backend

使用 LangGraph JS Runtime，負責：

* Agent Graph。
* Agent State。
* Prompt。
* Workflow。
* Tool Calling。
* Native Tools。
* MCP Tools。
* 模型呼叫。
* Agent 執行追蹤。
* 串流事件產生。

目前既有 Graph ID 包含：

```text
chatbot
deep_researcher
math_agent
mcp_agent
```

除非 OpenSpec 明確定義遷移方案，既有 Graph ID 與公開 API 不得任意破壞。

---

## 3. OpenSpec 是唯一規格來源

所有非簡單變更都必須以 OpenSpec 作為唯一事實來源。

以下情況屬於非簡單變更：

* 同時影響 frontend、bff 或 backend 兩層以上。
* 修改公開 API。
* 修改 Stream Event。
* 修改 LangGraph State。
* 新增或修改 Tool。
* 新增或修改 MCP 能力。
* 修改 Prompt 或 Agent Workflow。
* 修改認證、限流、逾時或安全策略。
* 修改持久化資料格式。
* 修改錯誤碼或終止狀態。
* 可能影響既有相容性的變更。

實作前必須確認變更目錄中存在：

```text
openspec/changes/<change-name>/
├── proposal.md
├── design.md
├── tasks.md
└── specs/
```

不得將聊天記錄或臨時 Prompt 視為正式需求。

若聊天內容與 OpenSpec 規格衝突，以已核准的 OpenSpec 為準；若使用者明確改變需求，必須先修改 OpenSpec，再修改程式碼。

---

## 4. SDD 執行流程

Claude 應按照以下順序處理非簡單需求：

```text
需求釐清
  ↓
現況探索
  ↓
Proposal
  ↓
Spec
  ↓
Design
  ↓
Tasks
  ↓
Codex 實作評估
  ↓
Gemini 架構審查
  ↓
規格修正與仲裁
  ↓
Apply
  ↓
Verify
  ↓
Archive
```

建議使用的 OpenSpec 指令：

```text
/opsx:explore
/opsx:propose
/opsx:apply
/opsx:verify
/opsx:archive
```

CLI 驗證指令：

```bash
openspec list
openspec show <change-name>
openspec validate <change-name>
```

Claude 不得因為使用者要求「直接修改」就跳過必要規格，但對拼字、文案或明確的單檔小修改，可以使用簡化流程。

---

## 5. 規格編寫原則

OpenSpec 的自然語言內容使用繁體中文。

以下固定結構保留英文：

```text
## ADDED Requirements
## MODIFIED Requirements
## REMOVED Requirements

### Requirement:
#### Scenario:

GIVEN
WHEN
THEN
AND

MUST
SHALL
MUST NOT
```

每個 Requirement 至少包含一個可驗證的 Scenario。

涉及執行流程時，規格至少考慮：

* 成功。
* 失敗。
* 逾時。
* 取消。
* 重試。
* 重複事件。
* 亂序事件。
* 中斷恢復。
* 權限拒絕。
* 降級處理。

行為規格描述系統應該呈現的結果，不應直接指定某個檔案第幾行如何修改。

具體程式結構、模組設計與技術選型應放在 `design.md`。

---

## 6. 多 Agent 職責

### Claude

負責：

* 需求理解。
* OpenSpec 建立與維護。
* 規格一致性。
* Agent 任務分派。
* 衝突仲裁。
* 最終驗收。

### Codex

負責：

* 程式碼庫探索。
* 實作範圍分析。
* 程式修改。
* 測試補充。
* Patch Review。
* 檢查實作是否符合 OpenSpec。
* 回報規格與現況之間的矛盾。

Codex 不得自行改變已核准的需求。

### Gemini

負責：

* 長上下文程式碼分析。
* 跨 frontend、bff、backend 架構審查。
* LangGraph State 與事件流審查。
* MCP、Tool 與網路安全審查。
* 尋找遺漏的失敗與邊界場景。
* 對 Proposal、Spec、Design 與 Tasks 提出反證。

Gemini 預設為唯讀 Reviewer，除非 Claude 或使用者明確授權，不得直接修改工作目錄。

---

## 7. 單一寫入者原則

同一時間只能有一個 Coding Agent 修改工作目錄。

禁止以下情況：

```text
Claude 正在修改 backend，
Codex 同時修改相同 backend 檔案，
Gemini 又直接覆寫 design.md。
```

Reviewer 應使用以下形式回傳結果：

* 審查報告。
* 風險清單。
* 修改建議。
* Unified Diff。
* 測試案例。
* 檔案影響範圍。
* 規格缺口。

若需要切換寫入者，上一位 Agent 必須先完成修改並產生可檢查的 Git Diff。

---

## 8. 系統架構約束

### 前端邊界

* frontend MUST 透過 BFF 呼叫 LangGraph。
* frontend MUST NOT 直接取得模型 API Key。
* frontend MUST NOT 直接取得 MCP 憑證。
* frontend MUST NOT 將 Tool 回傳內容視為可信 HTML。
* frontend 必須處理未知事件與未知欄位。
* frontend 不得僅依靠 UI 隱藏實現安全控制。

### BFF 邊界

* BFF 負責外部 API 契約與輸入驗證。
* BFF 必須設定 Timeout、Rate Limit 與錯誤映射。
* BFF 不得將內部 Stack Trace、API Key 或 MCP 憑證回傳前端。
* BFF 必須保留可追蹤的 `requestId`、`threadId` 或 `runId`。
* BFF 必須明確處理上游取消與連線中斷。

### Backend 邊界

* backend 負責 Agent Graph、State、Prompt 與 Tool 執行。
* Agent State 必須可序列化。
* Tool 結果必須可序列化及版本化。
* Prompt 不得直接信任使用者輸入、檢索內容或 Tool 輸出。
* Tool 執行必須具備 Timeout、取消、權限與 Audit 能力。

---

## 9. Tool 與 MCP 安全原則

MCP 與 Tool 能力採取預設拒絕策略。

任何新 Tool 必須定義：

* Tool 名稱。
* 使用目的。
* 輸入 Schema。
* 輸出 Schema。
* 權限需求。
* Timeout。
* 取消方式。
* 可重試條件。
* 錯誤碼。
* Audit 欄位。
* 敏感資料處理方式。
* 網路及檔案系統權限。

禁止預設提供：

* 任意 Shell 執行。
* 任意檔案寫入。
* 任意目錄讀取。
* 任意網路存取。
* 未經限制的外部 URL 抓取。
* 正式環境憑證讀取。

Web Fetch 類 Tool 必須拒絕：

* Loopback Address。
* Private Network Address。
* Link-local Address。
* Metadata Service Address。
* 不允許的協議。
* 不允許的 Redirect Target。

所有遠端內容、MCP 回應與 Tool 回應都必須視為不可信輸入。

---

## 10. 串流與狀態約束

涉及串流或 Tool Calling 時，必須定義：

* 事件名稱。
* Event Schema。
* Event Version。
* `runId`。
* `threadId`。
* `toolCallId`。
* 事件順序。
* 可重複性。
* Terminal State。
* Timeout State。
* Cancel State。
* Error State。
* 前端未知事件處理方式。

常見 Tool 生命週期可以包含：

```text
tool_requested
tool_started
tool_progress
tool_completed
tool_failed
tool_timeout
tool_cancelled
tool_denied
```

同一個 Tool Call 的事件必須使用相同的 `toolCallId`。

Terminal Event 產生後，不得再將同一 Tool Call 恢復為執行中。

---

## 11. 需要雙重審查的變更

以下變更必須同時取得 Codex 與 Gemini 的審查：

* LangGraph State。
* Graph Node 或 Edge。
* Stream Event Schema。
* Tool Calling。
* MCP Server。
* Prompt 注入防護。
* BFF 認證。
* Rate Limit。
* Timeout。
* 網路存取。
* 檔案系統存取。
* 跨套件 API 契約。
* 使用者資料或敏感資訊處理。

Codex 著重實作可行性與測試。

Gemini 著重架構、安全、遺漏場景與跨模組矛盾。

Claude 負責合併並仲裁兩者意見。

---

## 12. 實作完成條件

一個變更只有在以下條件全部滿足後，才可標記完成：

1. Proposal、Spec、Design 與 Tasks 一致。
2. frontend 相關測試與建置通過。
3. bff 相關測試與建置通過。
4. backend 相關測試與建置通過。
5. OpenSpec 驗證通過。
6. 每一個 Scenario 都有對應驗證。
7. 沒有未處理的 Blocker。
8. 錯誤、逾時與取消流程已驗證。
9. 相容性與回滾方案已確認。
10. `tasks.md` 只勾選真正完成並驗證的工作。
11. Git Diff 不包含無關修改。
12. 不得因測試失敗而刪除測試或放寬正確性要求。

完成後才能執行：

```text
/opsx:archive <change-name>
```

---

## 13. 天氣地點解析修復策略限制

針對天氣地點解析問題，Claude 在規劃、協調或 Review 時 MUST NOT 接受 hard-coded 自然語言 keyword regex、CJK phrase stripping 或固定標點刪除作為主要地點抽取修復策略。

明確禁止以類似下列固定詞表或規則刪字後猜測地點：

```text
WEATHER_QUERY_WORDS
CJK_WEATHER_QUERY_PARTS
QUESTION_PUNCTUATION
```

不得透過「刪除天氣、現在、如何、今天、幾度、會下雨嗎、？、嗎」等固定自然語言片段來推測剩餘文字就是地點。這類策略不能取代 Planner schema/prompt 改善、Runtime Validation、受限制 LLM Repair 或 Provider-driven resolver。

天氣地點解析修復應優先採用：

* Planner schema 與 prompt 改善，讓模型明確輸出 `location`、`country`、`region`。
* Runtime Validation，拒絕空值、過長輸入與控制字元。
* 受限制的 LLM Repair，只能在 `not_found` 後產生新的文字查詢並重新通過 Resolver。
* Provider-driven resolver，以 Geocoding Provider 候選、context 與可測試評分規則決定 `resolved`、`ambiguous`、`not_found` 或 `provider_error`。

若實作或提案以固定 keyword regex 或 CJK phrase stripping 作為主要修復方式，Claude MUST 要求退回修改；若該方案可能造成錯誤地點、契約破壞或繞過 Provider Resolver，應視為 Blocker。
