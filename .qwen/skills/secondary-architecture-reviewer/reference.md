# Secondary Architecture Reviewer：審查參考

只選擇與本次變更相關的維度，不機械式輸出完整清單。

## OpenSpec 與可追溯性

- Proposal 是否描述問題、目標、非目標、影響與回滾。
- Requirement 是否使用可驗證的 `MUST`、`MUST NOT` 或 `SHALL`。
- 每個 Requirement 是否至少包含一個 Scenario。
- Scenario 是否有明確 GIVEN、WHEN、THEN 與可觀察結果。
- Design 是否覆蓋所有 Requirement。
- Task 是否可獨立施工、驗證並追溯。
- 是否用實作偷偷擴大或改變需求。

## 正確性與狀態

- Null、Empty、Unknown、Unicode、極端大小及邊界值。
- Race、Retry、重複執行、亂序、中斷與恢復。
- Terminal State 是否能反向回到 Running。
- Error 是否被吞掉、誤映射或錯誤標記為成功。
- Type Assertion、Optional 或 `any` 是否掩蓋契約缺陷。

## 跨層契約

- Request、Response、Event、Graph、Tool Input／Output Schema 是否一致。
- Required、Optional、Enum、Version、Error Code 是否一致。
- `requestId`、`threadId`、`runId`、`toolCallId` 是否完整傳遞。
- Timeout、Cancel、Retry、Unknown、Terminal State 是否跨層同義。
- Backend 新狀態是否能被 BFF 與 Frontend 安全承接。

## Frontend

- 是否依結構化狀態渲染，而非解析顯示文案。
- Effect、Subscription、Timer、Request 是否清理。
- 重複、亂序事件與 Strict Mode 是否造成重複提交。
- Markdown、HTML、URL 與 Tool Output 是否視為不可信輸入。
- Loading、Success、Error、Timeout、Cancel 是否互斥且終態明確。

## BFF

- Input Validation、Auth、CORS、Rate Limit、Body Limit 是否完整。
- Streaming、Backpressure、Disconnect、Abort、Timeout 是否正確傳遞。
- Error Mapping 是否保留語意並隱藏內部資訊。
- 是否洩露 Stack、Token、Cookie、Credential 或 Provider 原始錯誤。

## Backend、LangGraph 與模型

- State、Checkpoint、Interrupt Payload 是否可序列化。
- Node、Edge、Retry、Resume 是否重複副作用。
- Prompt、Planner、Resolver、Provider、Tool、Synthesis 責任是否清楚。
- 模型輸出與 Tool Argument 是否經 Runtime Schema Validation。
- Provider 差異是否由 Adapter 隔離。
- 是否以模型名稱硬分支 Domain Schema 或事件語意。
- Parse Error、Validation Error、Refusal、Timeout、Provider Error 是否區分。
- Repair 是否有限次數並保留 Audit。

## Tool、MCP 與安全

- 是否預設拒絕並使用 Allowlist。
- 權限、工作目錄、網路目的地、Timeout、Cancel、Audit 是否明確。
- SSRF、Path Traversal、Command Injection、XSS、Prompt Injection。
- Retry 是否重複非冪等副作用。
- Tool Result 是否可序列化、版本化並安全降級。
- 外部內容、檢索結果與 Tool Output 是否被當成不可信資料。

## 硬編碼與硬映射

特別檢查：

- 固定自然語言 Keyword、Regex、刪字或詞表承擔主要意圖解析。
- 固定城市、國家、模型、Provider 或輸入案例白名單。
- 依錯誤文字 `includes()` 決定 Error Code。
- Frontend 依顯示文案推測 Tool 狀態。
- 寫死正式 URL、Port、Secret、Token 或權限。
- 為單一失敗測試新增一次性分支。

穩定 Domain Constant、Protocol Enum、Error Code、MIME Allowlist、Feature Flag 或顯示映射，在具有單一來源、型別、Fallback 與測試時可以接受。

## 驗證證據

Reviewer 不執行 Shell。Coordinator 應提供：

- Base／Merge Base／Commit。
- 完整 Patch 或 Diff。
- `git status --short`。
- `git diff --stat`。
- `git diff --check`。
- 受影響套件的 lint、test、build 真實輸出。
- 未執行命令與原因。

缺少會影響結論的證據時，標記 `Unverified`；無法可靠審查時輸出 `INCOMPLETE`。
