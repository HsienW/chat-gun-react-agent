# BFF：AI 編程規則

## 1. 生效範圍

本文件適用於：

```text
bff/**
```

修改 BFF 前，必須同時遵守根目錄 `AGENTS.md` 與已核准的 OpenSpec。

目前技術棧：

```text
Node.js
TypeScript
原生或既有 HTTP 能力
```

主要責任：

- 對外 API Gateway。
- 瀏覽器與 LangGraph Runtime 之間的代理。
- Request Validation。
- Auth、CORS、Rate Limit、Body Limit。
- Timeout 與 Abort 傳遞。
- Stream Proxy。
- Error Mapping。
- Audit Log 與追蹤識別字傳遞。
- 隔離模型、Tool 與 MCP 憑證。

---

## 2. 修改前必查範圍

依任務檢查：

```text
src/config.ts
src/server.ts
src/errors.ts
src/error-messages.ts
src/rate-limit.ts
src/upload-security.ts
.env.example
docs/bff.md
相關 OpenSpec
```

涉及代理契約時，還必須檢查：

- Frontend Request 與取消方式。
- LangGraph Upstream Route 與串流格式。
- Error Code 與 HTTP Status Mapping。
- `requestId`、`threadId`、`runId` 傳遞。

---

## 3. BFF 責任邊界

BFF 是安全與傳輸邊界，不是第二個 Agent Runtime。

不得：

- 實作 Prompt、Planner、Synthesis 或模型特定邏輯。
- 重新解析使用者自然語言意圖。
- 以固定城市、關鍵字或模型名稱改寫 Tool 參數。
- 將 Backend Domain State 複製成另一套不相容狀態機。
- 直接執行 MCP Tool 或持有不必要的 Tool 權限。
- 將瀏覽器可控 Header 不經驗證地轉成內部授權資訊。

可以進行的資料轉換必須是明確、可測試、與契約一致的 Transport Mapping。

---

## 4. 設定管理

所有環境差異必須集中由設定層讀取與驗證。

禁止：

- 在 Route Handler 中硬編碼 Upstream URL、Port 或 Allowed Origin。
- 將缺少設定默默替換成正式環境危險預設值。
- 在 Log 中輸出 API Key、Token、Cookie 或 Authorization Header。
- 讓測試專用 Fault Switch 在 Production 生效。

設定必須：

- 有明確型別。
- 在啟動時驗證。
- 對缺失或非法值快速失敗。
- 將數值字串轉成 Number 後檢查範圍。
- 對逗號分隔清單執行 trim、去空值與去重。

---

## 5. Request 與 Response 契約

所有外部輸入都視為不可信資料，包括：

- URL。
- Path。
- Query。
- Header。
- Body。
- Upload Metadata。
- Client 提供的追蹤識別字。

必須驗證：

- Method。
- Content-Type。
- Body Size。
- 必填欄位。
- 字串長度。
- Enum。
- ID 格式。
- Upload 類型與大小。

不得使用 Type Assertion 取代 Runtime Validation。

Response 不得暴露：

- Stack Trace。
- 內部檔案路徑。
- Upstream Credential。
- 完整 Provider Error Body。
- 伺服器環境變數。

---

## 6. Proxy、串流與背壓

代理串流時必須維持：

- 狀態碼與必要 Header 語意。
- Chunk 順序。
- Client Disconnect 傳遞。
- Upstream Abort。
- Backpressure。
- Terminal 結束。

禁止：

- 將完整串流先 Buffer 後一次回傳，除非 OpenSpec 明確要求。
- 無限制累積 Chunk、Request Body 或 Error Body。
- Client 已斷線後仍讓 Upstream 長時間執行。
- 吞掉 Upstream Stream Error。
- 在未定義轉碼規則下修改 Event Payload。

如果需要檢查串流內容，必須使用增量、有限大小且可回復的方式，不得破壞原始串流契約。

---

## 7. Timeout 與 Cancellation

BFF 必須明確區分：

```text
client_cancelled
client_disconnected
bff_timeout
upstream_timeout
upstream_error
```

不得將它們全部映射為一般 500。

必須：

- 使用 `AbortSignal` 或既有等價機制連接 Client 與 Upstream。
- 在 Timeout、Disconnect 或 Cancel 後釋放資源。
- 避免同一請求重複呼叫終止流程。
- 確保 Timer 在成功、失敗與取消後清理。
- 為 Upstream 設置有限 Timeout，不依賴 Node 預設無限等待。

---

## 8. Auth、CORS、Rate Limit

### Auth

- 認證預設拒絕時，不得因 Header 格式錯誤而繞過。
- API Key 比對與錯誤訊息不得洩露有效 Key 特徵。
- 認證結果不得只由 Frontend UI 控制。

### CORS

- 必須使用明確 Allowlist。
- 不得把任意 Origin 直接反射回 `Access-Control-Allow-Origin`。
- Credential 模式不得搭配萬用 `*`。
- 預檢與實際請求必須使用一致規則。

### Rate Limit

- Key 的來源與信任邊界必須明確。
- 不得無限制信任可偽造的轉發 Header。
- Rate Limit Error 必須有穩定狀態與可觀測資訊。
- 計數器必須有清理機制，避免無限制成長。

---

## 9. Error Mapping

錯誤映射必須保持資訊足以區分失敗階段，同時避免暴露內部細節。

每個公開錯誤至少應有：

```text
stable code
safe message
HTTP status
retryable 或等價語意
requestId
```

禁止：

- 以錯誤字串 `includes()` 作為主要分類方式。
- 將 Provider Error、Not Found、Validation Error 與 Timeout 全部轉成同一錯誤。
- 將 Backend 的 `needs_clarification` 轉成一般失敗。
- 依模型名稱建立錯誤映射分支。
- 將未知錯誤直接回傳原始內容。

未知錯誤必須安全降級，同時在 Server Log 保留可追蹤原因。

---

## 10. Upload 與內容安全

涉及上傳時，必須檢查：

- 宣告 MIME 與實際內容是否一致。
- 檔案大小與總請求大小。
- 檔名與路徑字元。
- Path Traversal。
- 空檔案。
- 重複欄位。
- 過多檔案。
- 不支援類型。

不得只依副檔名判斷安全性，也不得將使用者檔名直接當作 Server 路徑。

---

## 11. Audit 與可觀測性

每個跨層請求應能關聯：

```text
requestId
threadId
runId
graphId
toolCallId
```

Audit Log 應使用結構化欄位，至少包含：

- Route。
- Method。
- Status。
- Duration。
- Upstream Status。
- Error Code。
- 是否 Timeout 或 Cancelled。

不得記錄：

- API Key。
- Authorization Header。
- Cookie。
- 完整 Prompt。
- 完整敏感 Tool Output。
- 未遮罩的個人資料。

---

## 12. 禁止硬編碼與硬映射

除根目錄規則外，BFF 特別禁止：

- 硬編碼 Upstream Host、Allowed Origin、Auth Key 或環境 Port。
- 以固定自然語言關鍵字修改 Request。
- 以模型名稱決定 Transport Schema。
- 以顯示文案判斷 Error Code。
- 以單一特殊 Route 分支繞過共用 Validation、Auth 或 Rate Limit。
- 為單一測試案例加入固定 Response。

允許的 Route、Error Code 與 Header 清單必須集中定義並有測試，不得散落在多個 Handler。

---

## 13. 測試要求

新增或修改可觀察行為時，至少驗證：

```text
正常 Proxy
非法 Method / Content-Type / Body
Auth 成功與拒絕
CORS 允許與拒絕
Rate Limit
Body Too Large
Upstream 4xx / 5xx
Upstream Timeout
Client Cancel / Disconnect
串流成功與中途失敗
未知錯誤降級
敏感資訊不外洩
```

目前 `bff/package.json` 尚未提供既有 `test` script。

因此：

- 任何新增的非簡單 BFF 行為，MUST 同時新增可自動執行測試。
- 若本次變更未核准新增第三方測試框架，優先使用 Node 內建 `node:test` 與 `assert`。
- 新增測試後，必須在 `package.json` 提供穩定的 `test` script。
- 無法完成自動測試時，必須明確回報缺口，不得以手動測試假裝完整回歸。

現有最低驗證命令：

```bash
cd bff
npm run build
```

涉及 Runtime Proxy 的變更，還應在可用環境執行 `/api/health`、`/api/ready` 與代表性代理請求 Smoke Test。

---

## 14. 完成條件

BFF 變更完成前，確認：

- 設定在啟動時驗證。
- Client Abort 能傳遞至 Upstream。
- Stream 未被無限制 Buffer。
- Timeout、Cancel、Disconnect、Provider Error 語意可區分。
- CORS、Auth、Rate Limit 未被特殊分支繞過。
- Response 不暴露敏感內容。
- Build 已通過。
- 新增行為已有自動測試入口，或已誠實記錄缺口。
