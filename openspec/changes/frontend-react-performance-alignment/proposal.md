# Proposal：Frontend React 效能對齊

## Intent

Frontend 目前零使用 `React.memo`、`useMemo`、`useCallback`。Review 發現 7 項 Major 效能問題：

1. `groupMessages(messages)` 每次 render 重新計算（O(n) 遍歷 + 新物件參考）。
2. `displayMessages` / `messagesWithStreamError` 衍生陣列未記憶化，新參考觸發子樹完整 re-render。
3. `handleCopy` 每次 render 新參考，傳給所有 `AiMessageBubble`。
4. `useStream` 的 `onError` / `onFinish` / `onUpdateEvent` 為內联箭頭函式，每次 render 新參考。
5. 整個專案無任何 `React.memo`，父 re-render 時所有氣泡跟著 re-render。
6. `setTimeout(() => setCopiedMessageId(null), 2000)` 無清理，Strict Mode 或快速卸載時觸發 unmounted state update。
7. `drainUploadQueue` 非同步操作無卸載檢查，可能在已卸載元件上更新 state。

這些問題在訊息量少時不明顯，但隨著對話增長，每次 stream event 觸發的 re-render 成本會線性增加。

## Goals

1. 對記憶化候選點加入 `useMemo` / `useCallback`，消除可識別的冗餘 re-render。
2. 對純展示氣泡元件加入 `React.memo`，在 props 不變時跳過 re-render。
3. 修復 `setTimeout` 未清理問題，確保 Strict Mode 安全。
4. 修復 `drainUploadQueue` 卸載安全問題。
5. 不改變任何產品行為、UI 外觀、事件語意或跨層契約。

## Non-goals

- 不引入 `React.lazy` / `Suspense` / Code splitting。屬於 Bundle 優化。
- 不新增效能測試基礎設施。
- 不修改 BFF 或 Backend。純前端變更。
- 不修改任何跨層契約、事件型別或 Tool Result 格式。
- 不重組元件結構或目錄。

## Scope

變更項目：

| # | 檔案 | 變更 | 對應 Review Finding |
|---|------|------|---------------------|
| 1 | `ChatMessagesView.tsx:511` | `useMemo(() => groupMessages(messages), [messages])` | 4.1 |
| 2 | `ChatMessagesView.tsx:500-508` | `useCallback` 包裹 `handleCopy` | 4.2 |
| 3 | `App.tsx:222-235` | `useMemo` 包裹 `messagesWithStreamError` 和 `displayMessages` | 4.3 |
| 4 | `App.tsx:108-140` | `useCallback` 包裹 `onError` / `onFinish` / `onUpdateEvent`（`onUpdateEvent` 用 `useRef` 持有 `selectedAgentId` 避免 stale closure） | 5.1 |
| 5 | `ChatMessagesView.tsx` | 對 `HumanMessageBubble`、`AiMessageBubble`、`ToolMessageDisplay` 加入 `React.memo` | 4.4 |
| 6 | `ChatMessagesView.tsx:504` | `setTimeout` 改用 `useEffect` + `useRef` 清理，元件卸載時 `clearTimeout` | 2.1 / 6.1 |
| 7 | `InputForm.tsx:85-107` | `drainUploadQueue` 加入 `useRef` 卸載檢查，在 `.finally()` callback 中檢查 `unmountedRef.current` 再更新 state | 2.2 |

不受影響：

- `tailwind.config`、CSS、樣式。
- `types/` 目錄下任何型別定義。
- `lib/` 目錄下任何工具函式。
- BFF、Backend 任何檔案。
- 產品行為、事件流、Tool Result 格式。

## Affected capabilities

- `frontend-chat`（唯一受影響能力域）

---

## Baseline 測量（CCR Owner 要求補）

### 為什麼需要 baseline

`AGENTS.md` Section 5 要求「先證明問題，再修改」。效能問題與 bug 相同，需要可重現證據證明「目前有浪費」且「修改後已減少」。

`performance-optimization` skill 第一條原則：「Measure before optimizing. Performance work without measurement is guessing.」

### Baseline 錄製步驟

使用 Chrome DevTools React Profiler（不需安裝任何新依賴）：

1. 啟動 dev server：`cd frontend && npm run dev`
2. 開啟 Chrome DevTools → **Profiler** tab。
3. 按 ● Record，在 UI 中輸入 3-5 條訊息（模擬正常對話）。
4. 等待回覆完成後按 ■ Stop。
5. 截圖 flamegraph，記錄總 commit 次數與 re-render 次數。
6. 重複一次確認可重現性。

錄製結果附在 Design 文件中。

### 驗收條件（baseline 對比）

- 修改後 React DevTools Profiler 錄製顯示：同等對話下 **re-render 次數 ≤ 修改前的 70%**。
- 10 條訊息（含 Tool Call）的對話場景中，每次 stream event 觸發時 **不應看到未變更的氣泡元件 re-render**。

---

## 替代方案評估（CCR Owner 要求補）

### #3 `displayMessages` / `messagesWithStreamError`：useMemo vs useReducer

目前程式碼（`App.tsx:222-235`）：

```typescript
const messagesWithStreamError = streamErrorMessage
  ? [...thread.messages, { type: 'ai', content: streamErrorMessage, id: 'stream-error' }]
  : thread.messages;
const displayMessages = cancelledMessage
  ? [...messagesWithStreamError, cancelledMessage]
  : messagesWithStreamError;
```

兩層衍生計算依賴三個狀態片段（`thread.messages`、`streamErrorMessage`、`cancelledMessage`）。

| 方案 | 做法 | 優點 | 缺點 | 選擇 |
|------|------|------|------|------|
| **A: useMemo** | `useMemo(() => { ... }, [thread.messages, streamErrorMessage, cancelledMessage])` | 最小改動（2 行 → 1 個 useMemo）；不需重組狀態結構；與既有測試相容 | 三個依賴任一變化就重新計算；無法消除「依賴頻繁變化」的根本問題 | **本次採用** |
| **B: useReducer** | 建立 `AppState` reducer，`displayMessages` 在 dispatch 時計算 | 單一來源；可精細控制何時重新計算衍生值 | 重構量大（需改變 `useStream` 回傳值怎麼進入 state）；現有測試需大量改寫；與 `useStream` 的外部狀態模型耦合 | 不採用 |

**決策理由**：`useMemo` 方案是此 Change 的適當粒度。`displayMessages` 的依賴（`thread.messages`、`streamErrorMessage`、`cancelledMessage`）變化頻率低——`streamErrorMessage` 只在出錯時設定一次，`cancelledMessage` 只在取消時設定一次。真正的效能瓶頸是 #1（`groupMessages`）和 #5（無 `React.memo`），`useMemo` 方案已足夠。`useReducer` 重構量與風險不成比例，且應在獨立的「狀態管理重構 Change」中評估。

### #4 `useStream` callbacks：useCallback + useRef vs callback-ref pattern

經過原始碼審查，`useStream` 來自 `@langchain/langgraph-sdk`（`dist/react/stream.d.ts`），其簽名如下：

```typescript
export declare function useStream<StateType, Bag>(options: UseStreamOptions<StateType, Bag>): UseStream<StateType, Bag>;

interface UseStreamOptions<StateType, Bag> {
  // ...
  onError?: (error: unknown) => void;
  onFinish?: (state: ThreadState<StateType>) => void;
  onUpdateEvent?: (data: UpdatesStreamEvent<...>["data"]) => void;
  // ...
}
```

**關鍵發現**：`useStream` 的 `UseStreamOptions` 是一個 plain object（非 lazy 初始化函式）。callback 以 object property 傳入，LangGraph SDK 內部預期每次 render 可能傳入新的 options object。

| 方案 | 做法 | 優點 | 缺點 | 選擇 |
|------|------|------|------|------|
| **A: useCallback + useRef** | `useCallback` 包裹三個 callback，`onUpdateEvent` 用 `useRef` 持有 `selectedAgentId` 最新值避免 stale closure | callback 參考穩定；與既有 interface 完全相容；不改變 `useStream` 的行為假設 | `useRef` 模式增加一層 indirection；需確保 `useStream` 內部確實依賴 callback 參考來決定是否重新訂閱 | **本次採用** |
| **B: useMemo 包裹整個 options** | `const streamOptions = useMemo(() => ({ ... }), [...]); useStream(streamOptions)` | 整個 options object 參考穩定 | 如果 `useStream` 內部以 `useEffect` 追蹤個別 callback 而非整個 options object，則無效；依賴陣列更複雜 | 備選 |

**`useStream` 內部行為分析**（基於公開型別宣告推導）：

- `useStream` 回傳 `UseStream` 包含 `isLoading`、`stop`、`submit`、`messages` 等。
- `onError` / `onFinish` / `onUpdateEvent` 的語意是 callback——應在特定事件發生時被呼叫。
- 標準 React hook pattern：如果 callback 參考每次 render 都變，hook 內部可能以最新 callback ref 儲存（`useRef` + `useEffect` 同步），也可能在 `useEffect` 依賴陣列中包含 callback 導致重複訂閱/取消。

**結論**：選擇方案 A（`useCallback` + `useRef`），理由：

1. 不論 `useStream` 內部如何處理 callback 參考，穩定的 callback 參考一定是安全的。
2. `useRef` 持有 `selectedAgentId` 確保 `onUpdateEvent` 的閉包不會過時。
3. 不需要修改 `useStream` 的呼叫方式，改動最小。

### #5 `React.memo` 範圍：三個氣泡元件

`HumanMessageBubble`、`AiMessageBubble`、`ToolMessageDisplay` 是純展示元件（接收 props、輸出 JSX），無 side effect。

**`React.memo` 的成本**：每個 memo 元件需要 shallow compare props。`HumanMessageBubble` 接收 2 個 props（`group`、`mdComponents`），`mdComponents` 是 module-level constant（不會變），`group` 是 `MessageGroup` object。當 parental re-render 來自 stream event 但 `group` 參考不變時，`React.memo` 可跳過 re-render。`AiMessageBubble` 接收 9 個 props，其中 `handleCopy` / `mdComponents` / `selectedAgentId` / `allMessages` 在特定場景下穩定。

**是否可能 memo 比 re-render 更貴？** 對於 `HumanMessageBubble`（2 props，shallow compare 極快）和 `ToolMessageDisplay`（3-4 props），不可能。對於 `AiMessageBubble`（9 props），當大部分 props 都變更時 shallow compare 成本略高於直接 render——但這種情況（所有 props 同時變）只發生在新訊息到達時，此時本來就需要 re-render。

---

## useStream 調查（CCR Owner 要求補）

### 調查對象

`@langchain/langgraph-sdk/react` 的 `useStream` hook。

### 關鍵發現

1. **型別來源**：`frontend/node_modules/@langchain/langgraph-sdk/dist/react/stream.d.ts`
2. **簽名**：`useStream<StateType, Bag>(options: UseStreamOptions<StateType, Bag>): UseStream<StateType, Bag>`
3. **callback 傳遞方式**：`onError`、`onFinish`、`onUpdateEvent`、`onCustomEvent`、`onMetadataEvent`、`onLangChainEvent`、`onDebugEvent` 全部是 `UseStreamOptions` 的 optional property。
4. **依賴追蹤風險**：由於 SDK 原始碼不可見（僅有 `.d.ts`），無法直接確認內部是否在 `useEffect` 依賴陣列中包含 callback 或整個 options object。但 callback 以 object property 傳入（非 lazy init function），每次 render 的新 object 參考 + 新 callback 參考可能觸發內部重新訂閱。

### 建議策略

1. `useCallback` 包裹三個 callback（`onError`、`onFinish`、`onUpdateEvent`），保持 callback 參考穩定。
2. `onUpdateEvent` 中對 `selectedAgentId` 的閉包捕獲改用 `useRef`，確保始終讀取最新值而不需將 `selectedAgentId` 加入 `useCallback` 依賴。
3. 整個 `useStream` 的 options object 不需額外 `useMemo`——callback 參考已經穩定，其餘欄位（`apiUrl`、`assistantId`、`messagesKey`）來自 `useState` 或 module-level function，變化頻率極低。

---

## 既有基礎設施確認

### Strict Mode

`frontend/src/main.tsx` 已啟用 `<StrictMode>`。這意味著：

- 開發環境中 React 會 double-invoke effect、double-render 元件。
- 本 Change 的 #6（`setTimeout` 無清理）和 #7（`drainUploadQueue` 無卸載檢查）在 Strict Mode 下會暴露為「unmounted state update」warning。
- 修復後可直接在 dev 環境驗證。

### ESLint `exhaustive-deps`

`frontend/eslint.config.js` 已啟用 `react-hooks.configs.recommended.rules`（即 `exhaustive-deps: error`）。

目前既有的 `useCallback` 使用（`handleSubmit`、`handleAgentSwitch`、`handleAgentChange`、`validateAgentId`）均符合 `exhaustive-deps`。本 Change 新增的 `useMemo` / `useCallback` 必須同樣通過。

---

## Risks

### 記憶化引入 stale closure

`useCallback` / `useMemo` 的依賴陣列若不完整，會導致閉包捕獲過時值。

**緩解**：嚴格遵循 `exhaustive-deps`。`onUpdateEvent` 閉包捕獲 `selectedAgentId`，使用 `useRef` 持有最新值。

### React.memo 掩蓋 bug

若父元件依賴「子元件一定會 re-render」的行為（例如透過 side effect 同步），`React.memo` 可能打破這個假設。

**緩解**：目前三個氣泡元件都是純展示（接收 props、輸出 JSX），無 side effect。加入 `React.memo` 是安全的。`ToolMessageDisplay` 需確認內部 subscribe/unsubscribe 模式——如有的話則不適合 memo。

### 過度記憶化

對小型、快速計算的值使用 `useMemo` 可能得不償失。

**緩解**：只對 Review 已識別的 7 個 Major 項目加入記憶化。不擴大範圍。

---

## Rollback strategy

所有變更都是標準 React 模式，可逐檔案 revert：

1. 移除 `React.memo` wrapper → 回到直接 export。
2. 移除 `useMemo` / `useCallback` → 回到直接計算。
3. 還原 `setTimeout` 清理 → 回到原始寫法。

每個項目可獨立 commit、獨立 revert，不存在交叉依賴。

---

## Success criteria

1. `cd frontend && npm run lint` 通過（無新增 `exhaustive-deps` 警告）。
2. `cd frontend && npm run test` 通過（既有測試不回歸）。
3. `cd frontend && npm run build` 通過。
4. `groupMessages` 在 `messages` 參考不變時不重新計算。
5. `displayMessages` 在 `thread.messages` 和 `cancelledMessage` 不變時不產生新參考。
6. `handleCopy` 在依賴不變時保持相同參考。
7. `HumanMessageBubble`、`AiMessageBubble`、`ToolMessageDisplay` 在 props 不變時跳過 re-render。
8. `setTimeout` 在元件卸載時被清理，不觸發 unmounted state update。
9. `drainUploadQueue` 在元件卸載後不更新 state。
10. 無產品行為變更——所有 UI 外觀、事件流、Tool Result 渲染與变更前完全一致。
11. **React DevTools Profiler baseline 對比**：修改後 re-render 次數 ≤ 修改前的 70%（同等對話場景，3-5 條訊息）。

## Verification

```bash
cd frontend
npm run lint
npm run test
npm run build
```

Design 階段將包含 React Profiler baseline 錄製結果。
