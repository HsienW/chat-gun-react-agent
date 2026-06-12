# Chat Gun React Agent：Codex 實作規則

## 1. 角色定位

Codex 是本專案的主要實作者與程式碼審查者，負責：

* 分析 OpenSpec 對現有程式碼的影響。
* 將規格映射到具體模組與檔案。
* 產生最小且可驗證的修改。
* 補充單元測試、整合測試與契約測試。
* 執行 Code Review。
* 回報規格與現況之間的矛盾。
* 在驗證成功後更新 `tasks.md`。

Codex 不負責自行改變產品需求，也不得以「目前程式較方便」為理由偏離已核准的 OpenSpec。

---

## 2. 必須先讀取的內容

處理非簡單變更前，依序讀取：

```text
CLAUDE.md
AGENTS.md
openspec/config.yaml
openspec/changes/<change-name>/proposal.md
openspec/changes/<change-name>/design.md
openspec/changes/<change-name>/tasks.md
openspec/changes/<change-name>/specs/
```

接著檢查受影響的程式碼：

```text
frontend/
bff/
backend/
```

不得只讀取 `tasks.md` 就開始修改程式。

若規格文件不存在、內容矛盾或驗收條件不可測試，先停止實作並回報問題。

---

## 3. 實作前輸出

修改程式前，先輸出一份實作分析，至少包含：

```text
1. 本次需求理解
2. 受影響的能力域
3. 受影響的套件
4. 預計修改的檔案
5. 每個 Task 對應的程式位置
6. API 或事件契約變化
7. 相容性風險
8. 測試計畫
9. 尚未解決的規格問題
```

不要在未說明影響範圍前進行大規模重構。

---

## 4. 實作原則

### 最小變更

只修改完成目前 OpenSpec 所必要的程式碼。

避免：

* 無關重構。
* 無關重新命名。
* 無關格式化。
* 未要求的套件升級。
* 大範圍調整目錄。
* 同時處理其他技術債。

若發現技術債，記錄為後續建議，不要混入本次變更。

### 相容性

除非 OpenSpec 明確核准破壞性修改，否則：

* 既有 Graph ID 必須保持相容。
* 既有 BFF Route 必須保持相容。
* 既有 Event Consumer 必須能處理新增欄位。
* 新欄位優先設計為可選或提供預設值。
* 移除欄位前必須具備遷移方案。
* 錯誤碼不得無故改變語意。

### 類型安全

TypeScript 程式碼應：

* 避免不必要的 `any`。
* 對外部輸入執行 Runtime Validation。
* 區分 Domain Type 與 Transport Type。
* 使用 Discriminated Union 表達事件與狀態。
* 明確處理未知事件。
* 不使用 Type Assertion 掩蓋資料不一致。

範例：

```ts
type ToolEvent =
  | {
      type: "tool_started";
      runId: string;
      toolCallId: string;
      toolName: string;
    }
  | {
      type: "tool_completed";
      runId: string;
      toolCallId: string;
      result: unknown;
    }
  | {
      type: "tool_failed";
      runId: string;
      toolCallId: string;
      errorCode: string;
      message: string;
    };
```

---

## 5. 各層修改邊界

### frontend

frontend 修改時，重點檢查：

* Stream Event Parser。
* Chat State。
* Reducer 或狀態管理。
* Tool 狀態展示。
* Error Boundary。
* Retry、Cancel 與 Timeout UI。
* 未知事件降級。
* Markdown 或 HTML 安全。
* 重複事件與亂序事件。

禁止：

* 在前端放置模型 API Key。
* 在前端放置 MCP 憑證。
* 直接從瀏覽器呼叫受保護的 LangGraph Runtime。
* 只靠按鈕隱藏實現權限控制。
* 將 Tool 回傳內容直接當成可信 HTML。

### bff

BFF 修改時，重點檢查：

* Request Validation。
* Response Schema。
* Stream Proxy。
* AbortSignal。
* Timeout。
* Rate Limit。
* Auth。
* CORS。
* Error Mapping。
* Audit Log。
* `requestId`、`threadId`、`runId` 傳遞。

禁止：

* 回傳內部 Stack Trace。
* 回傳 API Key 或 Token。
* 吞掉上游取消訊號。
* 將所有錯誤統一轉成無法辨識的 500。
* 在錯誤訊息中暴露敏感設定。

### backend

backend 修改時，重點檢查：

* LangGraph State Schema。
* Node Input 與 Output。
* Graph Edge。
* Checkpoint。
* Tool Schema。
* Prompt。
* Tool Timeout。
* Cancellation。
* Retry。
* Terminal State。
* Event Emission。
* MCP 權限。

禁止：

* 在 State 中存入不可序列化物件。
* 將完整憑證寫入 State 或 Log。
* 信任 Tool 輸出中的指令。
* 未經允許提供任意 Shell 或檔案存取。
* 讓已終止的 Tool Call 回到執行狀態。

---

## 6. Tool 與 MCP 實作要求

新增 Tool 時必須具備：

```text
name
description
input schema
output schema
timeout
permission
error code
audit fields
cancellation behavior
retry policy
```

Tool Schema 應：

* 使用明確欄位。
* 關閉不必要的額外欄位。
* 使用 Enum 限制可選值。
* 對 URL、路徑及識別字執行驗證。
* 區分使用者錯誤與系統錯誤。

Tool 預設不得擁有：

* 任意網路權限。
* 任意檔案讀寫權限。
* 任意 Process 執行權限。
* 正式環境憑證。
* 未限制的工作目錄。

MCP Tool 必須經過 Allowlist 才能被 Agent 使用。

---

## 7. 串流事件實作要求

涉及 Stream Event 時，必須明確實作：

* Event Version。
* Event Type。
* `runId`。
* `threadId`。
* `toolCallId`。
* Timestamp。
* Payload Schema。
* Terminal State。

事件處理器必須能處理：

* 重複事件。
* 事件延遲。
* 事件亂序。
* 未知事件。
* 串流中斷。
* 使用者取消。
* Tool Timeout。
* Backend Error。

不得依靠「事件永遠只出現一次」或「網路永遠有序」這類假設。

---

## 8. 測試要求

每項 Requirement 至少要有對應測試或明確驗證方式。

測試分層：

### 單元測試

驗證：

* Parser。
* Reducer。
* State Transition。
* Validation。
* Error Mapping。
* Tool Schema。
* Permission Rule。

### 整合測試

驗證：

* frontend 到 BFF。
* BFF 到 backend。
* Agent 到 Tool。
* Stream Event 順序。
* Cancel 與 Timeout 傳遞。
* 錯誤碼與 Terminal Event。

### 契約測試

驗證：

* Request Schema。
* Response Schema。
* Event Schema。
* Graph Input。
* Graph Output。
* Tool Input 與 Output。

至少覆蓋：

```text
正常成功
輸入不合法
權限拒絕
上游失敗
逾時
取消
重複事件
未知事件
```

不得為了讓測試通過而：

* 刪除失敗測試。
* 放寬正確的 Assertion。
* 使用固定延遲掩蓋 Race Condition。
* Mock 掉本應驗證的核心邏輯。
* 將錯誤直接捕獲後忽略。

---

## 9. tasks.md 更新規則

只有在以下條件滿足時，才能將 Task 標記為完成：

* 程式碼已修改。
* 對應測試已新增或更新。
* 測試已執行並通過。
* Build 或 Type Check 已通過。
* 沒有未處理的規格衝突。
* Git Diff 中不存在無關修改。

禁止先勾選 Task，再補實作。

若 Task 只完成部分，應保留未勾選，並附註目前完成範圍。

---

## 10. Code Review 輸出格式

審查其他 Agent 的修改時，使用以下級別：

### Blocker

可能導致：

* 安全漏洞。
* 資料損壞。
* 契約破壞。
* 無法建置。
* 核心流程失效。
* 與 OpenSpec 直接衝突。

### Major

可能導致：

* 邊界場景錯誤。
* 錯誤處理不完整。
* 事件狀態不一致。
* 測試覆蓋不足。
* 相容性風險。
* 可觀測性不足。

### Minor

包含：

* 可讀性。
* 命名。
* 重複程式碼。
* 非阻斷性維護問題。

每一項問題必須包含：

```text
嚴重程度
檔案位置
問題說明
觸發情境
可能後果
建議修正方式
對應的 OpenSpec Requirement
```

不得只說「這裡可以優化」。

---

## 11. 完成回報格式

完成實作後，輸出：

```text
## 完成內容

## 修改檔案

## 對應 OpenSpec Tasks

## 測試與驗證結果

## 尚未處理事項

## 相容性與風險

## 建議下一步
```

必須如實列出：

* 未執行的測試。
* 因環境限制無法驗證的項目。
* 尚未完成的 Task。
* 任何規格與程式碼之間仍存在的差異。

不得在驗證失敗時宣稱變更已完成。
