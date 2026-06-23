# Frontend：AI 編程規則

## 1. 生效範圍

本文件適用於：

```text
frontend/**
```

修改 Frontend 前，必須同時遵守根目錄 `AGENTS.md` 與已核准的 OpenSpec。

目前技術棧：

```text
Vite
React 19
TypeScript
LangGraph SDK
Vitest
Testing Library
ESLint
```

主要責任：

- Agent Chat UI。
- 使用者輸入與訊息展示。
- 串流事件承接。
- Tool Calling 狀態展示。
- 錯誤、逾時、取消、重試與降級互動。
- 結構化 Tool Result 與業務卡片渲染。

---

## 2. 修改前必查範圍

依任務讀取相關檔案，不得只修改畫面表層：

```text
src/App.tsx
src/components/
src/lib/agent-runtime-events.ts
src/lib/runtime-event-config.ts
src/lib/agent-run-config.ts
src/types/
vite.config.ts
相關 *.test.tsx
```

涉及 Tool Result 時，還必須檢查：

- Backend Tool Output Schema。
- BFF 是否改寫或透傳欄位。
- Event Type、Event Version 與 Terminal State。
- `runId`、`threadId`、`toolCallId` 是否一致。

---

## 3. Frontend 責任邊界

Frontend 只負責呈現與互動，不得承擔 Backend 的語意推理。

不得：

- 直接呼叫受保護的模型、LangGraph Runtime、Native Tool 或 MCP Tool。
- 持有模型 API Key、MCP 憑證、正式環境 Token。
- 在 UI 層重新解析地點、意圖或 Tool 參數。
- 根據自然語言回覆文字猜測 Tool 是否成功。
- 以按鈕隱藏取代 Backend 權限檢查。
- 將 Tool Output 當作可信 HTML。
- 為特定模型或特定句型建立 UI 特殊分支。

Frontend 必須以結構化契約作為唯一渲染依據。

---

## 4. Vite 與環境變數安全

所有 `VITE_*` 變數都視為可能暴露在瀏覽器 Bundle 中。

禁止將以下內容放入 `VITE_*`：

- API Key。
- Access Token。
- MCP Credential。
- 私有網路憑證。
- 任何只應由 BFF 或 Backend 持有的秘密。

不得將 `envPrefix` 設為空字串，也不得藉由 `define` 將 Server Secret 注入 Client Bundle。

環境差異必須透過已定義設定注入，不得在元件內硬編碼 Host、Port 或正式環境 URL。

---

## 5. 串流事件與狀態機

事件處理必須能承受：

- 重複事件。
- 亂序事件。
- 延遲事件。
- 未知事件。
- 斷線。
- 取消。
- Backend Error。
- Tool Timeout。
- Terminal Event 重播。

每個 Tool Call 應以 `toolCallId` 作為主要識別，並保留 `runId` 與 `threadId` 關聯。

Terminal State 必須單向收斂。禁止出現：

```text
completed → running
failed → completed
cancelled → running
timeout → progress
```

事件 Reducer 或 State Transition 必須具備冪等性；不得假設事件只會到達一次。

未知 Event Type 或未來新增欄位必須安全降級，不得讓整個 Chat UI 崩潰。

---

## 6. Tool Result 渲染規則

Tool UI 必須依結構化狀態渲染，至少能區分：

```text
running
success
needs_clarification
not_found
error
timeout
cancelled
denied
unknown
```

若 Backend Contract 使用不同 Enum，以正式 Schema 為準，不得在 Frontend 自行創造同義狀態。

必須遵守：

- `needs_clarification` 不得渲染成一般系統錯誤。
- Provider Error 不得渲染成查無資料。
- Timeout 與 Cancelled 不得混為一談。
- 未知 Error Code 顯示安全的通用降級訊息，同時保留可追蹤識別字。
- Tool 已完成後，UI 不得因晚到的 Progress Event 回到執行中。
- 顯示文案不得成為程式狀態來源。

涉及 `WeatherToolResult.tsx` 或其他專項卡片時，必須讀取相應能力域規則與 Backend Schema。

---

## 7. React 實作規則

### State

- 優先保存最小必要 State。
- 可由 Props 或既有 State 推導的值，不重複保存。
- 非同步請求不得依賴過期閉包更新狀態。
- 陣列與物件更新必須保持不可變語意。
- 列表 Key 必須穩定，不得使用會隨排序改變的 Index 作為具狀態項目 Key。

### Effect

- Effect 必須有明確依賴。
- 訂閱、Timer、Event Listener 與 Request 必須清理。
- 請求取消應使用 `AbortSignal` 或既有取消契約。
- 不得以忽略 ESLint 規則掩蓋依賴問題。
- React Strict Mode 下重複執行不得造成重複 Tool Call 或重複提交。

### 元件邊界

- 展示元件不得直接包含 Provider 或模型判斷。
- Parser、Normalizer、State Transition 優先放入可測試的純函式。
- 不因單一畫面需求將跨層 Transport Type 散落到多個元件。
- 大型 Tool Result 應拆分狀態邏輯與展示邏輯，但不得為拆分而過度抽象。

---

## 8. 安全與內容渲染

所有下列內容都視為不可信輸入：

- 使用者訊息。
- 模型輸出。
- Markdown。
- Tool Result。
- Web Search / Web Fetch 內容。
- MCP 回傳。

禁止：

- 直接使用未淨化的 `dangerouslySetInnerHTML`。
- 將 Tool 回傳的 URL、HTML、Script 或事件處理器直接注入 DOM。
- 在錯誤畫面顯示完整 Stack Trace、Token 或敏感設定。
- 讓外部內容覆蓋系統級 UI 指令或安全提示。

外部連結必須使用安全屬性與允許的協議；未知協議應拒絕或降級為純文字。

---

## 9. 禁止硬編碼與硬映射

除根目錄規則外，Frontend 特別禁止：

- 以回覆中是否包含「成功」「失敗」「天氣」等文字決定元件狀態。
- 以固定 Tool Name 陣列散落在多個元件中。
- 以固定城市、語言、模型名稱決定卡片樣式或邏輯。
- 以固定延遲模擬真實串流完成。
- 以特定測試輸入建立一次性 UI 分支。
- 在元件內硬寫 BFF URL、Agent ID 或 Graph ID。

允許的 UI Mapping 必須以穩定 Enum 為 Key，具有 Unknown Fallback，並集中管理。

---

## 10. 錯誤、取消與重試

- Retry 必須建立新的明確執行或遵守既有 Retry Contract，不得偷偷重用已終止狀態。
- Cancel 必須立即反映 UI 狀態，並將取消訊號傳給 BFF。
- 同一操作不得因雙擊或重渲染重複送出。
- 錯誤訊息面向使用者；追蹤資訊面向 Log，兩者不得混用。
- 可重試與不可重試錯誤必須由結構化契約判斷，不得解析文案。

---

## 11. 測試要求

修改 Parser、Reducer、事件或 Tool UI 時，至少覆蓋：

```text
正常成功
needs_clarification
not_found
provider error
timeout
cancelled
unknown status
重複事件
亂序事件
晚到的 progress
未知欄位
缺少可選欄位
```

React 測試應以使用者可見行為與可存取語意為主，避免只測實作細節。

不得只更新 Snapshot 而不檢查行為差異。

驗證命令：

```bash
cd frontend
npm run lint
npm run test
npm run build
```

Vite Chunk Size Warning 在 Exit Code 為 0 時不等於 Build 失敗，但若本次修改造成明顯 Bundle 增長，必須回報原因與影響。

---

## 12. 完成條件

Frontend 變更完成前，確認：

- 沒有 Client Secret 洩露。
- Stream 與 Tool State 可單向收斂。
- Unknown Event / Status 可降級。
- Error、Timeout、Cancelled 語意未混淆。
- 沒有以自然語言文案反推狀態。
- 測試、Lint、Build 已實際通過。
- 跨層 Schema 變更已同步 Backend 與 BFF。
