# Backend：AI 編程規則

## 1. 生效範圍

本文件適用於：

```text
backend/**
```

修改 Backend 前，必須同時遵守根目錄 `AGENTS.md`、已核准的 OpenSpec 與相關能力域規則。

目前技術棧：

```text
LangGraph JS
LangChain Core
TypeScript
Zod
Vitest
Gemini / OpenAI-compatible / CCR Provider Adapter
Native Tools / MCP Tools
```

Backend 主要責任：

- Agent Graph、Node、Edge。
- Agent State 與 Checkpoint。
- Prompt、Planner、Synthesis。
- 模型 Provider Adapter。
- Tool Calling、Native Tools、MCP Tools。
- Resolver 與外部 Provider Adapter。
- Agent Runtime Event。
- Timeout、Cancellation、Retry、Audit。

---

## 2. 修改前必查範圍

依任務讀取：

```text
langgraph.json
src/state.ts
src/prompts.ts
src/agents/
src/tools/
src/platform/
相關 *.test.ts
.env.example
相關 OpenSpec
```

涉及跨層行為時，還必須檢查：

- Frontend Tool Result 與事件承接。
- BFF Timeout、Abort 與 Error Mapping。
- Graph ID、Input、Output 與公開 API。
- 既有 Golden Case、Mock Test 與 Live Acceptance 紀錄。

---

## 3. LangGraph State 規則

State 與 Checkpoint 內容必須：

- 可 JSON 序列化。
- 有明確欄位所有者。
- 有穩定型別與預設語意。
- 不包含 API Client、AbortController、Function、Socket、Stream 等執行期物件。
- 不包含完整 Credential、敏感 Header 或不必要的完整 Prompt。

State 更新必須明確，禁止多個 Node 無規則覆寫同一欄位。

新增 State 欄位時，必須說明：

```text
owner node
write timing
readers
default value
checkpoint behavior
migration / backward compatibility
```

不得使用 `any` 或 Type Assertion 掩蓋 Checkpoint 還原後的資料不一致。

---

## 4. Node、Edge 與 Durable Execution

每個 Node 應有明確輸入、輸出與副作用邊界。

必須檢查：

- Edge 條件是否可能形成無限循環。
- Retry 是否會重複執行外部副作用。
- Checkpoint 恢復是否會重複 Tool Call 或重複事件。
- Cancel 後是否仍有背景工作。
- Error 是否收斂到明確 Terminal State。
- Interrupt Payload 是否可序列化。

外部副作用必須具備冪等策略，至少使用一種穩定識別：

```text
runId
toolCallId
idempotencyKey
checkpoint step
```

不得假設 Node 只會執行一次。

使用 Interrupt 或 Human-in-the-loop 時：

- 必須先保存足以恢復的 State。
- Interrupt 資料必須可序列化。
- Resume 後不得重複前置副作用。
- Frontend 必須能識別等待輸入狀態。

---

## 5. Prompt-as-Code

Prompt、Planner 與 Synthesis 視同正式程式碼。

修改前必須：

1. 先固定可重現失敗案例。
2. 記錄目前結構化輸出或失敗形態。
3. 判斷問題是否真的屬於 Prompt。
4. 檢查 Tool 或產品能力是否實際存在。
5. 檢查 Schema、Resolver、Provider 與 UI 是否才是真正失敗層。

修改後必須：

- 執行新增案例。
- 執行既有 Prompt / Planner 回歸。
- 驗證格式錯誤、缺欄位、無 Tool、錯誤 Tool、逾時與取消。
- 比較修改前後結構化輸出，而非只看自然語言答案。
- 記錄模型與關鍵生成參數。

禁止：

- 用更多例句無限制堆疊 Prompt。
- 用 Prompt 假裝補齊不存在的預報、搜尋、權限或 Tool 能力。
- 要求模型輸出結構化資料，卻不做 Runtime Validation。
- 解析模型自然語言文字來重建本應由 Schema 提供的欄位。
- 在 Prompt 中放入 Secret 或不必要的完整內部設定。

同類問題兩輪修改仍失敗時，必須遵守根目錄的反覆失敗停止線。

---

## 6. 結構化輸出與模型相容性

模型輸出必須先通過 Runtime Schema Validation，再進入 Domain Logic。

必須：

- 使用明確欄位、Enum、長度與可選性。
- 關閉或拒絕不必要的額外欄位。
- 區分 Parse Error、Validation Error 與 Model Refusal。
- 對缺失欄位採明確修復或失敗策略。
- 對 Tool Call Arguments 執行二次驗證。

Provider Adapter 必須隔離模型差異。

禁止在 Agent、Tool 或 Domain Logic 中直接使用：

```text
if modelName includes ...
if provider === ... then 改變 Domain Schema
```

模型能力差異應透過明確 Capability 設定處理，例如：

```text
supportsStructuredOutput
supportsToolCalling
supportsParallelToolCalls
supportsStreaming
supportsThinkingContent
```

Domain Schema 不得因模型切換而改變。

---

## 7. Context 與訊息治理

使用者輸入、歷史訊息、檢索內容、網頁內容與 Tool Output 都是不可信資料。

必須：

- 保持 System / Developer / User / Tool 的角色邊界。
- 不允許外部內容覆蓋系統規則。
- 控制 Context 長度與單筆 Tool Output 大小。
- 避免其他 Thread 或 Run 的資料混入目前執行。
- 對歷史裁剪、摘要與多輪承接建立可測試規則。
- 保留必要的原始輸入與正規化結果，兩者不得互相覆蓋。

不得將完整敏感 Context 傳給不需要它的模型或 Tool。

---

## 8. Tool 實作規則

每個 Tool 必須定義：

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
side-effect / idempotency behavior
```

Tool Schema 必須：

- 使用明確欄位與型別。
- 對 URL、Path、Identifier、長度與 Enum 執行驗證。
- 拒絕不必要的額外欄位。
- 區分使用者輸入錯誤、查無資料、歧義、Provider Error、Timeout 與 Cancelled。
- 保持穩定 Error Code。

Tool Output 必須可序列化、可版本化，並可被 Frontend 安全降級。

禁止：

- 讓模型直接決定未驗證的 URL、Path 或 Command。
- 將 Tool Output 中的文字當作新的系統指令。
- 把 Provider Error 誤轉成 Not Found。
- 在 Retry 時重複非冪等副作用。
- 讓已終止 Tool Call 回到 Running。

---

## 9. MCP 與高風險能力

MCP 與高風險 Tool 採預設拒絕與 Allowlist。

Tool 預設不得擁有：

- 任意 Shell 執行。
- 任意檔案讀寫。
- 任意目錄遍歷。
- 任意外部網路存取。
- 正式環境憑證。
- 未限制工作目錄。

檔案能力必須限制：

- 工作目錄。
- Path Traversal。
- Symbolic Link。
- 絕對路徑。
- 隱藏與敏感檔案。
- 檔案大小與類型。

網路能力必須限制：

- 協議。
- Host / Egress Allowlist。
- Loopback、Private、Link-local、Metadata Service。
- Redirect Target。
- DNS Rebinding。
- Response Size。
- Timeout。

生產環境不應讓 Agent Runtime 直接取得無限制 Tool 權限；高風險執行應隔離至受控 Tool Service 或 Sandbox。

---

## 10. Resolver 與 Provider Adapter

Resolver 應由可替換 Provider、結構化候選與可測試評分規則驅動。

必須區分：

```text
resolved
ambiguous
not_found
provider_error
timeout
cancelled
```

禁止：

- 以固定城市或自然語言關鍵字清單作為主要 Resolver。
- 以刪除問句片段後的剩餘文字直接當作實體。
- 將 Provider 無法連線視為查無資料。
- 為單一國家、語言或模型建立無限制特例。
- 以人工硬映射取代 Provider 候選與 Context。

可接受的 Normalization 僅限不改變語意的處理，例如 trim、Unicode 正規化、空白清理與控制字元移除；原始輸入必須保留。

---

## 11. Stream Event 與 Terminal State

涉及事件時，必須定義：

```text
event version
event type
runId
threadId
toolCallId
timestamp
payload schema
terminal state
```

事件產生端必須考慮：

- 重複發送。
- Retry 後重播。
- Checkpoint Resume。
- 亂序。
- Tool Timeout。
- User Cancel。
- Provider Error。
- Graph Error。

Terminal Event 產生後，不得再為同一執行發送 Running / Progress 狀態。

新增事件或欄位時，必須同步檢查 Frontend Unknown Event 降級與 BFF 透傳。

---

## 12. 禁止硬編碼與硬映射

除根目錄規則外，Backend 特別禁止：

- 以固定自然語言 Keyword Regex 作為主要 Intent 或 Entity 解析。
- 以固定城市、地區、模型名稱或 Provider 名稱決定 Domain 結果。
- 以 Prompt 字串內容判斷 Graph Edge。
- 以錯誤訊息文字代替穩定 Error Code。
- 為單一 Golden Case 增加不可泛化的分支。
- 在 Agent 程式中硬寫 API URL、Credential、Timeout 或正式環境設定。
- 讓不同 Provider 回傳不同 Domain Schema。

允許的固定映射僅限穩定 Domain Constant，且必須集中、型別化、具 Unknown Fallback 與測試。

---

## 13. Eval、測試與回歸

測試分為：

### Deterministic Unit Test

驗證：

- State Transition。
- Schema Validation。
- Resolver Scoring。
- Error Mapping。
- Tool Input / Output。
- Provider Adapter。
- Event Emission。

### Mock / Recorded Integration

驗證：

- Planner → Tool。
- Resolver → Provider。
- Tool → Structured Result。
- Timeout、Cancelled、Provider Error。
- Graph Terminal State。

### Live Smoke Test

驗證：

- 真實目標模型可產生合格結構化輸出。
- 真實 Provider 可連線。
- Tool Calling 與 Synthesis 能完成。
- 模型切換後 Domain Contract 不變。

Mock 通過不得宣稱 Live 驗收完成。

Prompt、Resolver 或 Tool 修復至少覆蓋：

```text
原始失敗案例
相同語意不同表述
不同語言或字形
缺失輸入
歧義輸入
Provider Not Found
Provider Error
Timeout
Cancelled
多輪承接
既有成功案例回歸
```

驗證命令：

```bash
cd backend
npm run lint
npm run test
npm run build
```

不得只執行單一新增測試後即宣稱修復完成。

---

## 14. 可觀測性

每次 Agent 執行應能追蹤：

```text
requestId
threadId
runId
graphId
toolCallId
provider
model
node
errorCode
duration
```

Prompt 或 Resolver 問題的 Debug Log 應優先記錄結構化摘要，例如：

- Planner Validation Result。
- Tool Name。
- Query Variant 數量。
- Candidate 數量與分數摘要。
- Resolution Strategy。
- Terminal Status。

不得在一般 Log 記錄：

- API Key。
- Token。
- 完整 System Prompt。
- 未遮罩的完整使用者敏感資料。
- 不受限的大型 Tool Output。

---

## 15. 完成條件

Backend 變更完成前，確認：

- State 與 Interrupt Payload 可序列化。
- Retry / Resume 不會重複副作用。
- Prompt 修改已有失敗案例與全量回歸。
- 模型輸出通過 Runtime Validation。
- Provider Error、Not Found、Ambiguous、Timeout、Cancelled 可區分。
- 沒有以硬編碼或硬映射取代 Resolver。
- Tool 權限、Timeout、Cancel、Audit 完整。
- Frontend 與 BFF 契約已同步檢查。
- Lint、Test、Build 已實際通過。
- Live 未驗證項已如實列出。
