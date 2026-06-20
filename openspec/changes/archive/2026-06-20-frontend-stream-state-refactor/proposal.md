## 背景與動機

Frontend 的 stream activity 管線目前仍依賴脆弱的元件區域狀態協調：live activity events 先累積在 `processedEventsTimeline`，再透過監聽 `thread.isLoading` 的 effect 延後歸檔到 `historicalActivities`；raw stream parsing 也直接耦合在 `useStream` update callback 內。Change 1 已改善 render performance，但也暴露出 stream activity state、parser 行為與 terminal-state handling 尚未被建模成明確且可測試的 transition。

這個問題現在需要處理，因為 stream update 可能重複、晚到、透過 cancel/error 路徑終止，或在 React Strict Mode double-invocation 下執行。現有結構讓這些情境很難在不 mock 整個 LangGraph SDK hook 的情況下測試；若 backend 未來新增 event type，而 frontend type union 尚未同步，也可能靜默產生 undefined processed event。

## 變更內容

- 建立 frontend-only 的 stream activity state model，使用明確的 reducer actions 表達 stream start/update/finish/error/cancel/archive/reset。
- 以 reducer-owned activity state 取代 `processedEventsTimeline` 加 `historicalActivities` 的兩段式同步模式，同時仍向既有 render components 提供相容的 live 與 historical activity props。
- 將 raw stream event processing 拆成可測試的 pure functions：
  - raw update event extraction。
  - direct runtime event parsing。
  - nested runtime event parsing。
  - node adapter fallback parsing。
  - runtime event to processed timeline event conversion。
- 增加未知事件安全降級，讓未來的 `agent.*` events 不會讓 Chat UI 崩潰，也不會讓 processed-event conversion path 回傳 undefined。
- 定義 stream finish、error、cancel 的 terminal-state normalization，讓 live activity 透過明確 action finalize 或 discard，而不是依賴間接的 loading-state effect。
- 保留既有 `useStream` callback signatures、既有 `extractAgentRuntimeEvents` 與 `runtimeEventToProcessedEvent` exports、既有 `ProcessedEvent` 相容性，以及既有 `ChatMessagesView` / `ActivityTimeline` rendering 行為。
- 新增聚焦 frontend 測試，涵蓋 parser fallback、reducer idempotency、archive behavior、finish/error/cancel convergence、unknown events，以及既有 cancel-message behavior。
- 預期不包含 breaking changes。

## Capabilities

### New Capabilities

- 無。

### Modified Capabilities

- `frontend-chat`：在保留既有 chat rendering contracts 的前提下，細化 frontend stream activity state、runtime event parsing、unknown event fallback 與 terminal-state convergence requirements。

## 目標

- 讓 stream activity state transitions 明確、由 reducer 驅動、具備 idempotency，並能獨立測試。
- 移除依賴 `thread.isLoading` 在 live events 累積後變化才觸發 archive 的間接流程。
- 盡可能讓 raw stream parsing 與 activity state updates 脫離不透明的 React callbacks。
- 確保未知 `agent.*` event types 能安全降級為 generic processed activity，或走明確記錄的 skip path，而不是回傳 undefined。
- 讓本 Change 保持 frontend-only，並相容於目前 BFF、backend、LangGraph SDK、Tool Result rendering 與 message grouping behavior。

## 非目標

- 不引入 Redux、Zustand、Jotai 或其他外部 state management library。
- 不重構 LangGraph SDK `useStream` integration layer，除了 `App` 已擁有的 callback bodies 與 options。
- 不修改 message parsing、`groupMessages`、`ToolMessageDisplay`、`InputForm` 或 Tool Result rendering contracts。
- 不修改 BFF stream proxy behavior 或 backend runtime event generation。
- 不改變 UI 外觀、可見文案、layout 或 user interaction flow。
- 不修改 dependency manifests 或 package manager lockfiles。

## 影響範圍

- 受影響套件：`frontend`。
- 受影響能力域：`frontend-chat`，特別是 stream activity state、stream parser/normalizer、runtime event compatibility 與 activity timeline data flow。
- implementation 可能涉及的 source files：
  - `frontend/src/App.tsx`
  - `frontend/src/lib/agent-runtime-events.ts`
  - `frontend/src/lib/runtime-event-config.ts`
  - `frontend/src/types/agent-runtime-events.ts`
  - 只有在 `ProcessedEvent` type 需要相容 extension 時，才可能涉及 `frontend/src/components/ActivityTimeline.tsx`。
  - 只有在 activity props 需要相容 pass-through adjustment 時，才可能涉及 `frontend/src/components/ChatMessagesView.tsx`。
  - 聚焦的 `*.test.ts` / `*.test.tsx` coverage。
- 明確排除的 source areas：
  - `frontend/src/types/messages.ts`
  - `frontend/src/components/ToolMessageDisplay.tsx`
  - `frontend/src/components/InputForm.tsx`
  - `frontend/package.json`
  - `bff/**`
  - `backend/**`
- Public API 與 cross-layer contracts：
  - `useStream` callback signatures 維持不變。
  - 既有 exported parser/converter function names 維持可用。
  - 預期不變更 BFF route、backend event schema、Graph ID、request payload 或 Tool Result schema。

## 風險

- Reducer migration 可能意外改變 live activity 出現時機，或 historical activity 附著到 final AI message 的時機。
- Unknown-event fallback 若讓每個無法辨識的 backend payload 都 render generic timeline item，可能造成 timeline 過度雜訊。
- Deduplication 或 idempotency rules 若 identity 過粗，可能意外丟掉合法的 repeated events。
- 在拆分 parser internals 的同時保留 legacy export signatures，若沒有測試文件化，可能造成重複邏輯不易理解。
- 既有 `App.cancel.test.tsx` mocks 假設 `extractAgentRuntimeEvents` 與 `runtimeEventToProcessedEvent` imports 存在；這些 imports 必須保持穩定，或明確同步更新測試。

## 回滾策略

Implementation 應分階段落地，讓 rollback 能透過 revert reducer/parser refactor 回復目前行為，同時保留先前的 `useStream` callback wiring。因為本 Change 是 frontend-only 且避免 schema 或 dependency changes，rollback 不需要 BFF/backend migration。若 unknown-event fallback 或 reducer idempotency 造成 regression，可獨立 revert fallback 與 reducer，同時保留既有 public function exports。
