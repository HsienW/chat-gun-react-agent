## 背景

Change 1（`frontend-react-performance-alignment`）已在 chat UI 周圍加入 memo/callback/cleanup boundaries。後續問題不只是 render cost；stream activity state 本身仍是隱性的，而且分散在多處：

- Live activity 累積在一個 array，historical activity 儲存在另一個 map。
- Archiving 依賴觀察 `thread.isLoading` 的 effect，而不是明確的 stream lifecycle transition。
- Raw stream updates 在 `useStream` update callback 內被 parse、adapt、convert 並 append。
- `onFinish` 目前除了 logging 以外沒有執行 state convergence。
- `runtimeEventToProcessedEvent` 依賴 frontend discriminated union 與 backend events 同步；未來 `agent.*` event types 可能無法良好降級。

受影響的問題層級是 `Frontend State / Stream Parser`。BFF 與 backend contracts 只作為參考脈絡：本 Change 不得修改 BFF proxy behavior、backend runtime event generation、Tool Result schemas 或 message grouping。

## 目標 / 非目標

**目標：**

- 讓 activity state transitions 明確、由 reducer 驅動，且能在不 mock 整個 LangGraph SDK hook 的情況下測試。
- 將 stream event parsing 拆成 pure functions，並具備獨立 unit coverage。
- 除非需要相容 extension，否則保留既有 public function exports 與既有 component prop compatibility。
- 對未來 `agent.*` event types 增加 unknown-event fallback。
- 將 stream finish、error、cancel 正規化為 terminal activity state transitions。
- 保持 implementation frontend-only。

**非目標：**

- 不引入外部 state management library。
- 不改變 `useStream` SDK semantics 或 callback signatures。
- 不改變 message parsing、message grouping、Tool Result rendering、BFF stream proxy、backend runtime event production、UI layout、visible text 或 interaction flow。
- 不修改 dependency 或 package manifest。

## 設計決策

### 決策 1：stream activity state 採用 local `useReducer`

使用專用 reducer 管理 activity state，而不是保留五個獨立 `useState`，也不是只把多個 setter 包到 helper functions 後面。

Reducer 將負責 stream activity concerns：

- 目前 live activity events。
- 依 message id 儲存的 historical activity。
- 目前 stream lifecycle state：`idle`、`running`、`finished`、`error`、`cancelled`。
- terminal transition 發生但 final AI message id 尚不可用時的 pending archive metadata。

不屬於 activity state 的 App-level state 若 lifecycle 不同，可以保留獨立管理：

- selected agent id。
- stream error message。
- local cancelled assistant message。

替代方案評估：

| 方案 | 結論 | 理由 |
| --- | --- | --- |
| 保留多個 `useState`，但集中 setter | 不採用 | 可降低 call-site 雜訊，但無法提供 transition model、idempotency 或 reducer-level tests。 |
| 只用 `useReducer` 管 live events，historical map 保持分離 | 不採用 | 仍讓 fragile live-to-history boundary 分散在 reducer 與 effect 之間。 |
| 使用外部 state library | 不採用 | 明確非目標；scope 只在 `App` 區域內，不值得新增 dependency。 |

### 決策 2：archive 由明確 stream lifecycle actions 觸發，不依賴 `thread.isLoading`

Terminal transitions 由 reducer actions 啟動：

- `streamStarted`
- `streamEventsReceived`
- `streamFinished`
- `streamFailed`
- `streamCancelled`
- `archiveLiveActivity`
- `resetForAgentOrSubmit`

`onFinish` dispatch `streamFinished`。`onError` 對 non-abort errors dispatch `streamFailed`。`handleCancel` dispatch `streamCancelled`。

由於 final AI message id 由 LangGraph SDK message array 擁有，implementation 仍可使用一個窄範圍 effect，觀察 `thread.messages` 與 reducer `pendingArchive`，用來解析 message id 並 dispatch `archiveLiveActivity`。這個 effect 不得使用 `thread.isLoading` 作為 archive trigger；它唯一目的，是在 terminal state 已記錄後，把外部 message id source 接回 reducer。

`pendingArchive` 必須保存足以判斷後續 message arrival 的 reference point，至少包含：

- terminal transition 發生時的 `thread.messages.length`，命名可為 `messagesLengthAtTerminal` 或等價欄位。
- 若 terminal transition 已知應排除的 local placeholder message id，保存 `excludeMessageId` 或等價欄位。
- terminal run 的 archive intent 與 lifecycle kind，避免下一次 submit 或 agent switch 後的舊 effect 誤歸檔。

Bridge effect 的觸發條件必須以 `pendingArchive !== null` 作為前提，並只在 `thread.messages` 中出現 terminal reference point 之後的新 assistant message 時 dispatch `archiveLiveActivity`。建議判斷順序是：先取得 `thread.messages.slice(messagesLengthAtTerminal)`，再尋找第一個可穩定識別的 assistant/AI message id，且不得等於 `excludeMessageId`。若沒有新 message id，effect 不得猜測、不得使用 timer、不得改用 `thread.isLoading`；它應保持 `pendingArchive` 等待下一次 `thread.messages` 變化。

Cancel 與 error paths 若由 frontend 建立 local assistant message id，可使用該 id 歸檔。若沒有有效 message id，reducer 保留 terminal live activity 給目前 bubble 使用，並記錄 archive pending，而不是猜測。

替代方案評估：

| 方案 | 結論 | 理由 |
| --- | --- | --- |
| 保留目前以 `thread.isLoading` 作為 key 的 effect | 不採用 | Loading state 是間接訊號，在快速提交、errors、cancellation 或 Strict Mode 下可能漏歸檔或重複歸檔。 |
| 只在 `onFinish` 內 archive | 不作為唯一機制 | `onFinish` 可能早於 SDK 在 `thread.messages` 暴露 final AI message；message id resolution 需要小型 bridge。 |
| 每次 update 都 archive | 不採用 | 會增加寫入，且保留同樣的 live/history synchronization risk。 |

### 決策 3：stream parser 拆成 pure pipeline functions

Parser layer 將與 React callbacks 分離。既有 exports 保持可用，作為 compatibility wrappers：

- `extractAgentRuntimeEvents(event)` 持續回傳 `AgentRuntimeEvent[]`。
- `runtimeEventToProcessedEvent(event)` 持續回傳 processed timeline event。

內部 implementation 應拆分為 pure helpers：

- 從 raw update payload 取出 direct runtime events。
- 從 node values 取出 nested runtime events。
- 使用 `NODE_EVENT_RULES` 執行 node adapter conversion。
- normalized raw update parsing：合併上述來源，並在 node 已有 direct runtime events 時避免 duplicate adapter output。
- processed-event conversion。

Tests 應直接覆蓋這些 helpers 與 public wrappers。React component tests 只覆蓋無法用 pure functions 證明的 integration behavior。

替代方案評估：

| 方案 | 結論 | 理由 |
| --- | --- | --- |
| 保留 parsing 在 `handleStreamUpdate` 內 | 不採用 | 會迫使測試 mock `useStream`，且把 parser regression 隱藏在 React behavior 後面。 |
| 移到 class-like `StreamEventParser` | 不採用 | Parser 不需要 mutable state；pure functions 更簡單，也更容易測試。 |
| 完整重寫 node adapter rules | 不採用 | 本 Change 應拆分職責，不改變 adapter semantics。 |

### 決策 4：未知 `agent.*` events render 成 generic activity item

Unknown event handling 必須 forward-compatible，且具備足夠除錯可見性，同時不能讓 UI 崩潰。

Frontend 應接受 `type` 為 string 且以 `agent.` 開頭的物件，即使 exact type 未知。型別策略採用 closed union extension：在 `AgentRuntimeEvent` union 中加入明確 unknown variant，而不是把所有 known event `type` 放寬成任意 `string`。

Unknown variant 的 shape 應等價於：

```ts
{
  type: 'agent.unknown';
  originalType: string;
  rawPayload?: Record<string, unknown>;
  ts: number;
}
```

此策略保留 `runtimeEventToProcessedEvent` 對 known events 的 exhaustiveness，同時讓 unknown path 有明確 `case 'agent.unknown'`。`ProcessedRuntimeEvent.eventType` 可以持續使用 `AgentRuntimeEvent['type']`，因此 unknown processed item 的 `eventType` 為 `agent.unknown`，而 original backend event type 必須保留在 processed data 中。`RUNTIME_EVENT_ICON_BY_TYPE` 可維持 `Partial<Record<AgentRuntimeEvent['type'], ...>>`，並視需要替 `agent.unknown` 提供 generic icon fallback。

Unknown events 應被 normalize 為明確的 unknown runtime event variant，例如包含：

- original event type。
- event payload 有 timestamp 時使用原 timestamp，否則產生 timestamp。
- sanitized payload data。

Processed activity 應透過既有 Activity Timeline rendering 顯示 generic title 與 data payload。不得從自然語言內容推斷 backend semantics。

`isAgentRuntimeEvent` type guard 可繼續以 `type` 是否為 `agent.` prefix 作為 agent-event eligibility，但 parser 必須區分 known 與 unknown：known events 依既有 variant 驗證最低必要欄位；unknown events 只接受 object 且 `type` 為非空 `agent.` string。缺少 `ts` 的 unknown event 不視為 malformed；normalizer 必須補上 deterministic test 可控制的 timestamp source 或等價注入點。不是 object、缺少有效 `type`、或 `type` 不是 `agent.` prefix 的 malformed values 會被 skip。

替代方案評估：

| 方案 | 結論 | 理由 |
| --- | --- | --- |
| 靜默 skip unknown events | 不採用 | 會隱藏 backend/frontend contract drift，降低 audit/debug 能力。 |
| unknown events 直接 throw | 不採用 | 未來 backend event additions 不得讓 Chat UI 崩潰。 |
| 只記錄 console warning | 不作為唯一行為 | Console logs 不足以呈現 user-visible activity state，測試也應能 assert deterministic fallback output。 |

### 決策 5：Terminal state convergence 由 reducer 擁有

Reducer 必須強制單向 lifecycle convergence：

```text
idle -> running -> finished | error | cancelled
```

Terminal state 後晚到的 update events 不得讓 stream 回到 running。重複 finish、error、cancel 或 archive actions 必須 idempotent。新的 submit 或 agent switch 必須明確 reset activity state，才能開始 new run。

`onFinish` 不再是 no-op；它 dispatch terminal convergence。`onError` 對 non-cancel failures dispatch error convergence。由 deliberate cancel 造成的 client abort 屬於 cancel path，不是 generic stream error。

Error terminal state 必須保留錯誤分類，至少支援：

```ts
type StreamErrorKind = 'generic' | 'timeout' | 'abort';
```

Reducer 的 `streamFailed` action payload 必須攜帶 error classification，例如：

```ts
{
  kind: 'streamFailed';
  errorKind: StreamErrorKind;
  message: string;
  archiveMessageId?: string;
}
```

`timeout` 不新增獨立 lifecycle terminal state；它是 `error` terminal state 的子分類。這可滿足「timeout failure preserves timeout meaning」且避免把 timeout 當成 successful completion。Timeout classification 必須從結構化錯誤來源取得：優先使用現有 error envelope / parsed error code / SDK 提供的 structured error field；只有在沒有結構化欄位時，才可使用既有 formatted message 作為顯示文字，不得以顯示文案反推 timeout 語意。

Abort routing 由 reducer terminal idempotency 承擔，而不是只在 callback 層做 broad abort ignore：

- `handleCancel` 必須先 dispatch `streamCancelled`，並記錄本次 cancel intent。
- 後續 `onError` 收到由該 cancel intent 對應的 `AbortError` 時，應被 terminal-state idempotency 吸收，不得覆蓋 `cancelled`。
- 若沒有 cancel intent，`AbortError` 不得被靜默視為成功；implementation 必須依可取得的結構化原因分類為 `streamFailed` 的 `abort` 或 `generic` error。
- Terminal state 已存在後的 late error events 一律不得把 `finished`、`error` 或 `cancelled` 改寫成其他 terminal kind。

替代方案評估：

| 方案 | 結論 | 理由 |
| --- | --- | --- |
| 繼續依賴 SDK loading state | 不採用 | UI 需要 frontend-owned terminal model 來處理 archive 與 late-event behavior。 |
| 讓各 callback 各自 mutate independent state | 不採用 | 會讓 transition rules 分散在多個 closures 與 effects。 |
| 加入 timers 來 settle stream state | 不採用 | 固定延遲被禁止，且會掩蓋 race conditions。 |

## 分層變更

### Frontend

- 新增 reducer-owned stream activity state 與 action types。
- Refactor `handleStreamUpdate`、`handleStreamFinish`、`handleStreamError`、`handleCancel`、submit reset 與 agent switch reset，改為 dispatch reducer actions。
- 拆分 parser internals，同時保留 existing public exports compatibility。
- 只在 unknown-event fallback 與 generic labels/icons 需要時，擴充 runtime event typing/config。
- 除非 `ProcessedEvent` type 需要 backward-compatible event type extension，否則保持 `ChatMessagesView` 與 `ActivityTimeline` render behavior 不變。
- 新增 parser 與 reducer behavior unit tests，並保持 existing cancel tests passing。

### BFF

- 不修改 source。
- 既有 BFF stream proxy behavior 仍是 browser-to-LangGraph communication 的邊界。
- 不修改 route、auth、CORS、timeout、error envelope 或 proxy behavior。

### Backend

- 不修改 source。
- 既有 backend `AgentRuntimeEvent` contract 仍是 known events 的 authoritative producer shape。
- Frontend fallback 只保護未來 `agent.*` additions 或 frontend 同步落後情境；不改變 backend event semantics。

## 風險 / 取捨

- Reducer migration 改變 activity timing → 緩解：新增 start/update/finish/error/cancel/archive/reset reducer tests，並透過 integration tests 保持目前 visible behavior。
- Pending archive bridge 仍需要 effect → 緩解：effect 依賴 reducer `pendingArchive` 與 `thread.messages`，不依賴 `thread.isLoading`；archive intent 仍是 event-driven。
- Unknown-event fallback 可能增加 generic timeline items 雜訊 → 緩解：只對 minimal `agent.*` event objects fallback，malformed non-agent values 直接 skip。
- Event deduplication 可能丟掉合法 repeated events → 緩解：除非有 stable event identity，否則不引入 aggressive deduplication；idempotency 聚焦 terminal/archive actions 與 duplicated lifecycle transitions。
- Compatibility wrappers 可能模糊新 parser layers → 緩解：測試同時覆蓋 pure helpers 與 legacy public exports。

## Migration Plan

1. 在修改 parser internals 前，先新增目前 parser behavior 與 desired unknown-event fallback 的測試。
2. 新增 lifecycle transitions 與 archive behavior 的 reducer tests。
3. 在 existing exports 後方引入 reducer 與 parser helpers。
4. 將 `App` callbacks 接到 reducer actions，同時保留既有 `ChatMessagesView` props。
5. 執行 frontend lint、tests、build。

Rollback 是 frontend-only revert reducer/parser refactor。由於沒有 BFF/backend schemas 或 dependencies changes，rollback 不需要 data migration。

## 開放問題

- Unknown `agent.*` events 顯示的 exact processed payload 需在 implementation 時定案，但必須 generic、sanitized，且有測試覆蓋。
- 若 LangGraph SDK 在 `onFinish` 執行時尚未 expose final AI message id，implementation 應使用上方 pending-archive bridge，不得加入 timers 或 loading-state triggers。
