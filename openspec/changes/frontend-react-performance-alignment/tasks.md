# Tasks：Frontend React 效能對齊

## 0. 規格與 Execute 前準備

- [x] 0.1 讀取已核准 `proposal.md`。
- [x] 0.2 讀取 `frontend-change1-detailed-plan-and-diff.txt`，抽出 7 個 source execute task。
- [x] 0.3 建立 `design.md`，明確限定 source execute 只能修改三個前端檔案。
- [x] 0.4 建立 `specs/frontend-chat/spec.md`，固化效能、相容性與卸載安全需求。
- [ ] 0.5 執行 source code 前取得 React DevTools Profiler baseline，或明確記錄無法取得的原因。
- [ ] 0.6 執行 source code 前確認 working tree 不含會干擾三個目標檔案的未關聯修改。

## 1. `ChatMessagesView.tsx`：`groupMessages` memo

- [ ] 1.1 在 `frontend/src/components/ChatMessagesView.tsx` 補入 `useMemo` import。
- [ ] 1.2 將 `groupMessages(messages)` 改為 `useMemo(() => groupMessages(messages), [messages])`。
- [ ] 1.3 不修改 `groupMessages` 分組語意、fallback ID、tool result 合併邏輯或 message order。

## 2. `ChatMessagesView.tsx`：`handleCopy` callback 與 timer cleanup

- [ ] 2.1 補入 `useCallback`、`useEffect`、`useRef` import。
- [ ] 2.2 新增 `copyTimerRef` 保存 `setTimeout` 回傳值。
- [ ] 2.3 新增 unmount cleanup，卸載時清除尚未觸發的 copy timer。
- [ ] 2.4 將 `handleCopy` 包入 `useCallback`。
- [ ] 2.5 `handleCopy` 設定新 timer 前先清除舊 timer。
- [ ] 2.6 保持 clipboard 寫入、`copiedMessageId`、錯誤記錄與按鈕顯示行為不變。

## 3. `ChatMessagesView.tsx`：訊息氣泡 memo 邊界

- [ ] 3.1 以 `React.memo` 包裹 `HumanMessageBubble`。
- [ ] 3.2 以 `React.memo` 包裹 `AiMessageBubble`。
- [ ] 3.3 在 `ChatMessagesView.tsx` 內以消費端 wrapper memo `ToolMessageDisplay`，不得修改 `ToolMessageDisplay.tsx` 本體。
- [ ] 3.4 將 `AiMessageBubble` 內的 `toggleTool` 改為 `useCallback`，但保持 Set 更新語意不變。
- [ ] 3.5 若發現任一 memo 目標不是純展示元件，停止該子項並回報，不得硬套。

## 4. `App.tsx`：衍生訊息陣列 memo

- [ ] 4.1 在 `frontend/src/App.tsx` 補入 `useMemo` import。
- [ ] 4.2 將 `messagesWithStreamError` 包入 `useMemo`，依賴為 `[thread.messages, streamErrorMessage]`。
- [ ] 4.3 將 `displayMessages` 包入 `useMemo`，依賴為 `[messagesWithStreamError, cancelledMessage]`。
- [ ] 4.4 保持 stream error message 與 cancelled message 的新增順序與內容不變。

## 5. `App.tsx`：`useStream` callback 穩定化

- [ ] 5.1 新增 `selectedAgentIdRef`。
- [ ] 5.2 新增 `useEffect` 同步 `selectedAgentIdRef.current = selectedAgentId`。
- [ ] 5.3 將 `onError` 抽為 `useCallback`，保持 abort 判斷、stream error formatting 與 console error 行為不變。
- [ ] 5.4 將 `onFinish` 抽為 `useCallback`，保持既有行為不變。
- [ ] 5.5 將 `onUpdateEvent` 抽為 `useCallback`，從 `selectedAgentIdRef.current` 讀取最新 agent。
- [ ] 5.6 不修改 `useStream` 的 route、assistant id、messages key、submit 或 stop 行為。

## 6. `InputForm.tsx`：upload queue 卸載安全

- [ ] 6.1 在 `frontend/src/components/InputForm.tsx` 新增 `unmountedRef`。
- [ ] 6.2 新增 unmount cleanup，卸載時設定 `unmountedRef.current = true`。
- [ ] 6.3 `patchImageItem` 在 state update 前檢查 `unmountedRef.current`。
- [ ] 6.4 `drainUploadQueue` 的 `.then`、`.catch`、`.finally` 分支中，任何 state update 前都必須檢查尚未卸載。
- [ ] 6.5 保持 upload preflight、queue 順序、錯誤訊息與附件提交行為不變。

## 7. Source execute 驗證

- [ ] 7.1 `cd frontend && npm run lint` 通過，且無新增 `exhaustive-deps` error。
- [ ] 7.2 `cd frontend && npm run test` 通過。
- [ ] 7.3 `cd frontend && npm run build` 通過。
- [ ] 7.4 React DevTools Profiler 對比完成，修改後同等場景 re-render 次數小於或等於 baseline 的 70%；若環境無法執行，需如實記錄。
- [ ] 7.5 Dev Strict Mode 下未觀察到 copy timer 或 upload queue 的 unmounted state update warning；若環境無法執行，需如實記錄。

## 8. OpenSpec 驗證

- [x] 8.1 `openspec validate frontend-react-performance-alignment` 通過。

## 9. 禁止事項檢查

- [ ] 9.1 Git diff 不包含 BFF、backend、dependency、package lock 或 unrelated formatting。
- [ ] 9.2 Git diff 不包含 UI layout、文字、顏色、事件契約或 Tool Result schema 變更。
- [ ] 9.3 未 archive change。
