# Design：修正天氣澄清的 Frontend Resume Contract

## 1. 責任邊界

```text
Frontend (修改)
  └─ WeatherToolResult.tsx：onReply callback 型別變更，新增 selectedIndex state
  └─ ChatMessagesView.tsx：handleClarificationReply 改用 resume callback
  └─ App.tsx：新增 handleClarificationResume，調用 thread.submit(null, {command: {resume: ...}})
  └─ 相關 *.test.tsx：更新斷言

Backend (不修改)
  └─ clarifyInterrupt：已正確實作 interrupt(payload) → resumeValue → parseClarificationResumeInput
  └─ resumeClarify：已正確讀取 userReply → resolveClarificationWithPlanner

BFF (不修改)
  └─ LangGraph SDK HTTP client 直接傳遞 command 選項
```

## 2. 資料流

### 2.1 修正前（錯誤流程）

```text
Backend interrupt
  → Frontend detect isLangGraphInterruptEvent
  → extractWeatherClarificationInterruptToolResult
  → createWeatherClarificationDisplayMessages
  → WeatherClarificationInteractive 渲染候選
  → 使用者點選「Springfield, Illinois」
  → setReplyText(candidate.displayName)
  → 使用者按 Submit
  → onReply("Springfield, Illinois")                     // 純字串
  → ChatMessagesView.handleClarificationReply
  → onSubmit("Springfield, Illinois", ...)                // 一般 submit
  → App.handleSubmit
  → thread.submit({messages: [new HumanMessage(...)]})    // 新 HumanMessage！
  → Graph 從頭開始 → plan_research
  → ❌ 失敗
```

### 2.2 修正後（正確流程）

```text
Backend interrupt
  → Frontend detect isLangGraphInterruptEvent
  → extractWeatherClarificationInterruptToolResult
  → createWeatherClarificationDisplayMessages
  → WeatherClarificationInteractive 渲染候選
  → 使用者點選「Springfield, Illinois」
  → setReplyText(candidate.displayName), setSelectedIndex(1)
  → 使用者按 Submit
  → onReply({userReply: "Springfield, Illinois", candidateIndex: 1})  // 結構化
  → ChatMessagesView.handleClarificationReply
  → onClarificationResume({userReply: "Springfield, Illinois", candidateIndex: 1})
  → App.handleClarificationResume
  → thread.submit(null, {command: {resume: {userReply: "Springfield, Illinois", candidateIndex: 1}}})
  → Graph interrupt resume → resume_clarify
  → ✅ 成功
```

## 3. 元件變更設計

### 3.1 WeatherToolResult.tsx

新增匯出型別：

```typescript
export type ClarificationReplyPayload = {
  userReply: string;
  candidateIndex?: number;  // 1-based，僅在使用者點選候選時出現
};

export type ClarificationResumeValue =
  | ClarificationReplyPayload
  | { cancel: true };
```

`WeatherClarificationInteractive` 內部變更：

- 新增 `selectedIndex` state（`useState<number | undefined>(undefined)`）
- 候選點擊 handler 同時設定 `setReplyText(candidate.displayName)` 和 `setSelectedIndex(index + 1)`
- 使用者編輯輸入文字時，若新值不再等於已選候選的 `displayName`，立即清除 `selectedIndex`；再次改回相同文字不自動恢復 index，必須重新點選候選
- `submitReply` 建構 `ClarificationReplyPayload` 物件而非傳遞純字串
- `onReply` callback 型別改為 `(payload: ClarificationReplyPayload) => void`

### 3.2 ChatMessagesView.tsx

Props 擴充：

```typescript
interface ChatMessagesViewProps {
  // ... 既有 props ...
  onClarificationResume?: (resumeValue: ClarificationResumeValue) => void;
}
```

`handleClarificationReply` 改為：

```typescript
const handleClarificationReply = useCallback(
  (payload: ClarificationReplyPayload) => {
    onClarificationResume?.(payload);
  },
  [onClarificationResume]
);
```

`handleClarificationCancel` 改為：

```typescript
const handleClarificationCancel = useCallback(() => {
  onClarificationResume?.({ cancel: true });
}, [onClarificationResume]);
```

`ToolMessageDisplay.tsx` 的 `onClarificationReply` prop 必須同步改為
`(payload: ClarificationReplyPayload) => void`，確保型別由
`WeatherToolResult` 經 `ToolMessageDisplay`、`AiMessageBubble`、
`ChatMessagesView` 一致傳播，不得在中間層退回純字串。

### 3.3 App.tsx

新增 `handleClarificationResume` callback：

```typescript
const handleClarificationResume = useCallback(
  (resumeValue: ClarificationResumeValue) => {
    dispatchStreamActivity({ type: 'resetForAgentOrSubmit' });
    dispatchStreamActivity({ type: 'streamStarted' });
    setStreamErrorMessage(null);
    setCancelledMessage(null);
    clarificationResumePendingRef.current = true;
    // 注意：不清除 weatherClarificationMessages，保留以便 UI 顯示 loading

    thread.submit(null, {
      command: { resume: resumeValue },
    });
  },
  [thread]
);
```

傳遞給 ChatMessagesView：

```tsx
<ChatMessagesView
  // ... 既有 props ...
  onClarificationResume={handleClarificationResume}
/>
```

`handleSubmit` 加入 guard：

```typescript
// 若有 active clarification，阻斷一般 submit
if (weatherClarificationMessages) {
  // 此路徑不應到達（ChatMessagesView 在 clarification 期間會改用 onClarificationResume）
  // 但保留防禦性 guard
  return;
}
```

當 `handleClarificationResume` 執行後，需要在新 stream 開始時清除
`weatherClarificationMessages`。使用 `clarificationResumePendingRef` 作為
once-only guard：

- resume 送出前設為 `true`
- `handleStreamUpdate` 收到第一個非 interrupt event 時，若 ref 為 `true`，
  清除 clarification messages 並立即將 ref 設為 `false`
- 重複或後續非 interrupt event 不得再次觸發清除
- 若收到新的 interrupt event，保留新的 clarification messages，並將 ref 設為
  `false`
- 若 resume 尚 pending 就直接 stream error、cancel 或 finish，清除舊
  clarification messages 並將 ref 重設為 `false`；若 ref 已是 `false`，
  不得清除後續新建立的 clarification

## 4. Resume Value 與 Backend 的對應

| Frontend 發送 | Backend `parseClarificationResumeInput` 處理 |
|--------------|---------------------------------------------|
| `{userReply: "第一個", candidateIndex: 1}` | 提取 `userReply = "第一個"`，`candidateIndex` 被忽略（Planner 從文字推斷） |
| `{userReply: "Illinois"}` | 提取 `userReply = "Illinois"` |
| `{userReply: "換高雄"}` | 提取 `userReply = "換高雄"` |
| `{cancel: true}` | 偵測 `cancel === true`，回傳 `userReply = "cancel"` |

Backend Planner 收到 `userReply: "cancel"` 後，輸出 `resolutionType: "cancel"`，resumeClarify 進入 cancelled 分支。

`candidateIndex` 目前僅作為 Frontend 追蹤輔助欄位。Backend Planner 透過自然語言理解從 `userReply` 和 clarification context 推斷 `select_candidate`。若要讓 Backend 直接使用 `candidateIndex` 跳過 Planner，需要修改 `parseClarificationResumeInput` 和 `resumeClarify` 的解析邏輯 — 這屬於未來強化，不在本 Change 範圍。

## 5. 替代方案

### 方案 A（採用）：修改 Frontend resume contract

- 優點：最小變更，Backend 零修改，直接修正實作缺陷
- 缺點：`candidateIndex` 目前僅為輔助資訊，Planner 仍需解析自然語言
- 風險：低

### 方案 B：Backend 直接處理 candidateIndex

- 優點：跳過 Planner，減少 LLM 呼叫，更可靠
- 缺點：需要修改 Backend `parseClarificationResumeInput` 和 `resumeClarify`，scope 擴大
- 風險：中（需要額外 testing 和 regression 驗證）

### 方案 C：BFF 中介轉換

- 優點：Frontend 和 Backend 都不改
- 缺點：增加不必要的代理層，違反 BFF 職責邊界
- 風險：高（BFF 不應承擔 resume contract 翻譯）

**選擇方案 A**。方案 B 的 candidateIndex 直接處理可列為後續強化（另開 change）。

## 6. 風險與緩解

1. **`thread.submit(null, ...)` first argument null**：SDK 型別 `submit(values: GetUpdateType | null | undefined, options?: SubmitOptions)` 允許 null。LangGraph SDK 在收到 `null` values 且 command 存在時不會更新 state。Risk: Low。
2. **現有測試覆蓋**：`WeatherToolResult.test.tsx` 中 `onReply` 的測試需要更新為驗證結構化 payload。需同時確保不破壞任何現有測試。Risk: Medium。
3. **BFF 透傳**：LangGraph SDK 的 `command` 是 HTTP request body 的一部份。確認 BFF 的 proxy 不會過濾或改寫。Risk: Low（BFF 僅做 rate-limit，不解析 request body）。
