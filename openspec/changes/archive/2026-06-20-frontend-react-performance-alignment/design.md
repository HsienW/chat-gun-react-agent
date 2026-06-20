# Design：Frontend React 效能對齊

## 1. 現況分析

目前前端聊天主流程集中在：

```text
App
  -> useStream
  -> displayMessages
  -> ChatMessagesView
  -> groupMessages
  -> HumanMessageBubble / AiMessageBubble
  -> ToolMessageDisplay
  -> InputForm
```

已核准 Proposal 與 `frontend-change1-detailed-plan-and-diff.txt` 指出 7 個實作前必須收斂的問題：

1. `groupMessages(messages)` 在每次 render 都重新計算並產生新物件參考。
2. `messagesWithStreamError` 與 `displayMessages` 每次 render 都可能產生新的衍生陣列。
3. `handleCopy` 每次 render 都產生新函式參考，傳入所有 AI 氣泡。
4. `useStream` 的 `onError`、`onFinish`、`onUpdateEvent` 使用 inline callback，參考不穩定。
5. 訊息氣泡與 Tool 顯示缺少 memo 邊界，父層 render 會帶動未變更的子樹 render。
6. 複製成功提示的 `setTimeout` 沒有卸載清理。
7. `InputForm` 上傳佇列的非同步 callback 沒有卸載後 state update 防護。

本 Change 的設計目標是加入精準、局部的 React 效能與安全模式，不改變任何產品行為、UI 外觀、事件語意、Tool Result 格式或跨層契約。

---

## 2. 設計原則

### 2.1 最小且可回滾

每個 task 必須可以獨立 review 與 revert：

- `useMemo` 只包裹已識別的衍生計算。
- `useCallback` 只包裹會傳入子元件或 hook options 的 callback。
- `React.memo` 只套用在純展示元件或消費端 memo wrapper。
- 卸載防護只處理已識別的 timer 與 upload queue async state update。

### 2.2 不改變資料與事件契約

本 Change 不得修改：

- LangGraph / BFF route。
- Stream event type。
- Tool Result schema。
- Message shape。
- Agent ID、Graph ID、request payload。
- 使用者可見 UI layout、文字、互動流程。

### 2.3 避免 stale closure

新增 `useMemo` / `useCallback` 時必須通過 `react-hooks/exhaustive-deps`。若 callback 需要讀取最新值但不應因該值改變而重建，使用 `useRef` 保存最新值，且必須用 `useEffect` 同步。

本 Change 只允許此模式用於 `App.tsx` 的 `selectedAgentId` 與 `onUpdateEvent`。

### 2.4 memo 邊界不得隱藏行為

`React.memo` 僅能用於沒有副作用的展示元件。若下一輪 execute 發現目標元件內存在 subscription、imperative effect 或依賴父層 render 的副作用，必須停止該 memo 子項並回報，不得硬套。

---

## 3. 實作範圍

本 Change 的 source code execute 範圍限於：

```text
frontend/src/App.tsx
frontend/src/components/ChatMessagesView.tsx
frontend/src/components/InputForm.tsx
```

不得修改：

```text
frontend/src/types/**
frontend/src/lib/**
frontend/src/components/ToolMessageDisplay.tsx
frontend/package.json
bff/**
backend/**
```

若下一輪 execute 發現必須修改上述禁止範圍才可完成，必須停止並回到 OpenSpec 修訂，不得直接擴大 scope。

---

## 4. Component Design

### 4.1 `ChatMessagesView.tsx`

#### `groupMessages`

將：

```ts
const messageGroups = groupMessages(messages);
```

改為：

```ts
const messageGroups = useMemo(() => groupMessages(messages), [messages]);
```

此 memo 僅依賴 `messages` 參考。不得改寫 `groupMessages` 的分組語意、ID fallback 或 tool message 合併邏輯。

#### `handleCopy`

將 `handleCopy` 包入 `useCallback`，並保留原有 clipboard 寫入、`copiedMessageId` 設定與錯誤記錄行為。

`handleCopy` 需搭配 `copyTimerRef`：

```ts
const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

每次設定新 timer 前先清除舊 timer，元件卸載時清除尚未觸發的 timer。

#### `HumanMessageBubble`

以 `React.memo` 包裹，不改 JSX、props、Markdown render 或圖片附件 render。

#### `AiMessageBubble`

以 `React.memo` 包裹，不改 Activity Timeline、Tool Call、Copy Button 或 Markdown render 語意。

`toggleTool` 可改為 `useCallback`，但不得改變展開/收合狀態的 Set 更新語意。

#### `ToolMessageDisplay`

Proposal scope 包含 `ToolMessageDisplay` memo。下一輪 execute 應優先以 `ChatMessagesView.tsx` 內的消費端 wrapper 完成：

```ts
const MemoizedToolMessageDisplay = React.memo(ToolMessageDisplay);
```

不得修改 `ToolMessageDisplay.tsx` 本體。若 props 參考不穩導致 wrapper 效益有限，不得為追求 memo 命中率而擴大重構 `extractToolCallsFromMessage` 或 Tool Result parsing。

### 4.2 `App.tsx`

#### 衍生訊息陣列

將 `messagesWithStreamError` 與 `displayMessages` 包入 `useMemo`：

- `messagesWithStreamError` depends on `[thread.messages, streamErrorMessage]`
- `displayMessages` depends on `[messagesWithStreamError, cancelledMessage]`

不得改變 stream error message 或 cancelled message 的新增順序。

#### `useStream` callbacks

將 `onError`、`onFinish`、`onUpdateEvent` 抽成穩定 callback。

`onUpdateEvent` 不直接捕獲 `selectedAgentId`，改由：

```ts
const selectedAgentIdRef = useRef(selectedAgentId);

useEffect(() => {
  selectedAgentIdRef.current = selectedAgentId;
}, [selectedAgentId]);
```

讀取最新 agent 設定。不得改變 `extractAgentRuntimeEvents` 與 `runtimeEventToProcessedEvent` 的使用方式。

### 4.3 `InputForm.tsx`

新增：

```ts
const unmountedRef = useRef(false);

useEffect(() => {
  return () => {
    unmountedRef.current = true;
  };
}, []);
```

`patchImageItem` 與 upload queue 的 `.then` / `.catch` / `.finally` 中，任何 state update 前都必須確認元件尚未卸載。

不得改變 upload preflight、錯誤訊息、queue 順序、附件提交或取消行為。

---

## 5. Baseline 與驗收

執行 source code 前需先建立 React Profiler baseline：

1. `cd frontend && npm run dev`
2. 使用 Chrome DevTools Profiler 錄製 3-5 條正常對話。
3. 記錄總 commit 次數與未變更訊息氣泡 re-render 情況。
4. 修改後以同等操作重錄。

驗收目標：

- 同等場景下 re-render 次數需小於或等於 baseline 的 70%。
- stream event 期間，未變更的歷史氣泡不應持續 re-render。
- 不得新增 `exhaustive-deps` lint error。
- 不得出現 unmounted state update warning。

若本地環境無法使用瀏覽器 Profiler，下一輪 execute 必須在完成回報中明確標記 Profiler baseline 未驗證，不得宣稱效能驗收完成。

---

## 6. 相容性

保持：

- UI 外觀與互動流程。
- Chat message order。
- Tool Call / Tool Result 顯示語意。
- Activity Timeline 顯示條件。
- Copy button 行為。
- Upload queue 行為。
- BFF 與 backend contract。

新增的 hook 與 memo 僅改善 render 與卸載安全，不得成為產品狀態來源。

---

## 7. 風險與緩解

### stale closure

風險：callback 依賴陣列不完整導致讀取舊狀態。

緩解：`exhaustive-deps` 必須通過；`selectedAgentId` 只透過 ref 模式處理。

### memo 未生效或掩蓋更新

風險：props 參考仍不穩，或 memo 用在非純元件。

緩解：只 memo 已識別展示元件；不為提高命中率擴大重構；發現副作用即停止該子項。

### async cleanup 遺漏

風險：只保護 `.catch` 而漏掉 `.then` / `.finally` 中的 state update。

緩解：下一輪 execute 必須檢查 `drainUploadQueue` 所有非同步分支。

---

## 8. Verification strategy

本輪 OpenSpec 驗證：

```bash
openspec validate frontend-react-performance-alignment
```

下一輪 source execute 驗證：

```bash
cd frontend
npm run lint
npm run test
npm run build
```

可選但建議的人工驗證：

- React Profiler baseline 對比。
- dev server Strict Mode 下快速切換頁面或卸載聊天 view，確認沒有 timer / async state update warning。
