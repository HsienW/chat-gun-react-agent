# Design：天氣多輪澄清工作流程

## 1. 責任邊界

```text
Browser（Frontend）
  → 顯示可互動候選列表
  → 收集使用者編輯後回覆
  → 手動送出 resume 請求（同 threadId）
  → 識別 interrupt event，區分 terminal event

BFF
  → 透傳 interrupt event 與 resume 請求
  → 不重新解析澄清語意
  → 無新 route

Backend（LangGraph）
  → targetedTools node 在 needs_clarification 時呼叫 interrupt()
  → 儲存完整 weatherExecution checkpoint
  → 恢復後 Planner 結合 pending candidates 解析回覆
  → 繼續或重新執行天氣查詢
```

## 2. LangGraph State 變更

### 新增 State 欄位

```typescript
// DeepResearchState 新增
clarification: Annotation<WeatherClarificationState | undefined>({
  default: () => undefined,
})
```

```typescript
type WeatherClarificationState = {
  status: "awaiting_user_input";
  candidates: LocationCandidate[];      // 候選列表（最多 5 個）
  originalQuery: LocationQuery;         // 原始地點查詢
  weatherCapability: WeatherCapability; // "current" | "hourly" | "daily"
  timeRange?: TimeRange;                // 原始時間範圍
  summary: string;                      // 澄清提示文字
  interruptCheckpointStep: number;      // checkpoint step（防重複 resume）
};
```

### WeatherExecutionState 擴展

```typescript
// 原有
export type WeatherExecutionState =
  | { status: "idle" }
  | { status: "running"; requestedLocation: LocationQuery }
  | { status: "success"; result: WeatherToolResult }
  | { status: "needs_clarification"; result: WeatherToolResult }  // 改為 interrupt 起點
  | { status: "failed"; result: WeatherToolResult };
```

`needs_clarification` 狀態保持不變，但行為從 terminal 改為 interrupt trigger。

## 3. Graph Node 與 Edge 變更

### 現有流程

```text
plan → targetedTools → (weatherExecution 寫入 State) → synthesize → END
```

當 weather tool 回傳 `needs_clarification` 時，`weatherExecution.status = "needs_clarification"`，但 graph 繼續進入 synthesize → END。

### 新流程

```text
plan → targetedTools → [needs_clarification?]
                         ├── YES → clarifyInterrupt → interrupt()
                         │                        ↓
                         │              (等待使用者輸入)
                         │                        ↓
                         │              resumeClarify → targetedTools（重新解析）
                         │                        ↓
                         │              [resolved?] → weather tool → synthesize → END
                         │              [changed?]  → 新 geocoding → weather tool → synthesize → END
                         │              [cancelled?] → synthesize(cancelled) → END
                         │
                         └── NO  → weather tool → synthesize → END（現有行為）
```

### 新增 Node

- `clarifyInterrupt`：建構 interrupt payload，呼叫 `interrupt()`，儲存 `clarification` state。
- `resumeClarify`：讀取 `clarification` state 與使用者回覆，呼叫 Planner 解析，更新 `weatherExecution`。

### Edge Condition

- `routeAfterTargetedTools`：若 `weatherExecution.status === "needs_clarification"` 且有 candidates，route 到 `clarifyInterrupt`；否則 route 到 `synthesize`。
- `routeAfterClarifyInterrupt`：graph 在此被 interrupt，無 edge transition（LangGraph 內部處理）。
- `routeAfterResumeClarify`：根據 resolution 結果 route 到 `targetedTools`（重新執行）或 `synthesize`（取消／失敗）。

## 4. Interrupt Payload 設計

```typescript
type WeatherClarificationInterrupt = {
  type: "weather_clarification";
  threadId: string;
  runId: string;
  candidates: Array<{
    index: number;           // 1-based display index
    name: string;
    displayName: string;
    country: string;
    countryCode: string;
    admin1?: string;
    latitude: number;
    longitude: number;
    providerId: string;
  }>;
  originalQuery: {
    raw: string;            // 使用者原始輸入
    location: string;       // 正規化後的地點文字
    country?: string;
    region?: string;
  };
  weatherCapability: "current" | "hourly" | "daily";
  timeRange?: TimeRange;
  summary: string;          // "Location 'Springfield' matches multiple candidates. Please specify."
};
```

Interrupt payload 透過 LangGraph `interrupt()` 的標準機制傳遞。Frontend 透過 stream event 或 `thread.state` 取得。

## 5. Planner Resume Prompt 設計

Resume 時 Planner 接收擴充 context：

```text
[Clarification Context]
The previous weather query returned multiple location candidates.
The user has replied. Determine the user's intent:

Pending candidates:
1. Springfield, Illinois, United States (providerId: geo-123)
2. Springfield, Missouri, United States (providerId: geo-456)
3. Springfield, Massachusetts, United States (providerId: geo-789)

Original query: { location: "Springfield", weatherCapability: "current" }
User reply: "第二個"

Classify the user reply as ONE of:
- "select_candidate": user selected a specific candidate (output candidateIndex 1-based)
- "filter_candidates": user provided country/region to narrow down (output filter)
- "new_location": user wants a different location (output newLocationText)
- "cancel": user wants to cancel
- "unrecognized": cannot determine user intent

Output JSON:
{ "resolutionType": "...", "candidateIndex": N, "filter": {...}, "newLocationText": "...", "cancel": false }
```

Planner 輸出的結構化 resolution 由 Resolver 消費：
- `select_candidate`：直接用 candidate 的座標呼叫 weather tool。
- `filter_candidates`：用 filter 條件篩選 pending candidates，若只剩一個則用其座標，若仍多個則再次 interrupt。
- `new_location`：執行完整新 geocoding（不重複使用 pending candidates）。
- `cancel`：terminal cancelled。
- `unrecognized`：再次 interrupt 或 fallback error。

## 6. Frontend 資料流

### Interrupt Event 處理

```text
Stream Event → App.tsx useStream → parse event type
  ├── "interrupt" → set thread.isLoading = false
  │               → 設定 clarificationState（來自 event payload）
  │               → WeatherToolResult 進入可互動模式
  ├── "on_chat_model_stream" → 正常 streaming
  ├── ...其他 event type...
  └── unknown → safe degradation
```

### Resume 流程

```text
使用者在 WeatherToolResult 編輯回覆
  → 點選候選：candidate.displayName 填入輸入欄位
  → 編輯文字
  → 點選送出（Enter 或 button）
  → thread.submit({ messages: [{ type: "human", content: editedText }] })
  → 使用相同 threadId（resume，非新 thread）
  → LangGraph 從 interrupt point 恢復
  → stream 繼續
```

### WeatherToolResult 變更

`WeatherToolResult.tsx` 的 `needs_clarification` 分支從靜態 `WeatherClarificationDisplay` 改為可互動元件：

```typescript
// 現有：靜態列表 + 固定提示文字
<WeatherClarificationDisplay result={result} />

// 新：可互動元件
<WeatherClarificationInteractive
  candidates={result.candidates}
  summary={result.summary}
  isResuming={isResuming}               // resume 進行中
  onReply={(replyText) => handleResume(replyText)}
  onCancel={() => handleCancelClarification()}
/>
```

新元件 `WeatherClarificationInteractive`：
- 渲染候選列表（可點選）。
- 提供文字輸入欄位（預填候選 displayName，可編輯）。
- 送出按鈕（空值 disabled）。
- 取消按鈕。
- Loading 狀態時禁用所有互動。

## 7. BFF 考量

BFF 的 stream proxy 目前透傳 LangGraph event。Interrupt event 是 LangGraph 的標準 event type，若 BFF 使用 langgraph SDK 的 stream proxy，應可自然透傳。

需要驗證的事項：
- BFF stream proxy 是否對未知 event type 做過濾或改寫？
- Resume 請求的 HTTP method 與 path 是否與初始 submit 相同？（預期相同 threadId，由 LangGraph SDK 處理）
- Interrupt event 在 BFF 的 timeout 計算中是否正確（interrupt 期間不應觸發 proxy timeout）

## 8. 錯誤處理矩陣

| 情境 | 行為 | 狀態 |
|------|------|------|
| interrupt() 呼叫失敗 | terminal error | `weather_clarification_error` |
| 使用者在 interrupt 期間關閉瀏覽器 | checkpoint 保留，reconnect 時可恢復 | interrupt 等待中 |
| Resume 時 Planner 輸出 invalid JSON | fallback: 再次 interrupt 或 unrecognized | 等待新回覆 |
| Resume 後 geocoding 失敗 | terminal provider error | `weather_geocoding_provider_error` |
| Resume 後 weather tool 失敗 | terminal provider error | `weather_provider_error` |
| 使用者在 resume 後再次 ambiguous | 再次 interrupt（最多 2 輪） | 等待新回覆 |
| 連續 2 輪仍 unresolvable | terminal error | `weather_clarification_exhausted` |
| Interrupt timeout（可設定，預設 5 分鐘） | terminal timeout | `weather_clarification_timeout` |

## 9. 替代方案與決策

### 替代方案 A：Stateless（不使用 interrupt）

每次使用者回覆都當作全新查詢，由 Planner 從 conversation history 推斷 context。

- **拒絕理由**：Planner 不可靠地從自然語言 history 推斷候選編號對應；容易出錯且無法保證 checkpoint 一致性。違反 `AGENTS.md` 禁止以自然語言推測取代結構化 state。

### 替代方案 B：只在 Frontend 做互動（不改 LangGraph）

Frontend 記住 candidates，使用者選擇後 Frontend 重新發送完整地點文字。

- **拒絕理由**：Frontend 不應持有 geocoding state（違反 Frontend 責任邊界）；且無法保證 resume 後的 idempotency（可能重複 geocoding）。

### 替代方案 C：interrupt 但不存完整 checkpoint

只存 candidates 陣列，不存 `weatherExecution`。

- **拒絕理由**：恢復時缺少 `weatherCapability`、`timeRange` 等 context，Planner 無法正確判斷是 current 還是 forecast。

### 決策

採用 **LangGraph interrupt + 完整 checkpoint + Frontend 手動送出**。

## 10. 安全與相容性

- Interrupt payload 不得包含 credential、API key、內部 provider ID（僅保留必要的 `providerId` 供 resume 使用）。
- `providerId` 不得在前端 UI 中直接暴露給使用者（僅用於內部 resolve）。
- 現有 `current_weather` 與 `weather_forecast` tool schema 保持不變。
- Graph ID、threadId、runId 格式向後相容。
- `needs_clarification` 的現有 `WeatherToolResult` 靜態渲染路徑保留為 fallback（當 clarification 元件不在 interrupt context 中時使用）。
