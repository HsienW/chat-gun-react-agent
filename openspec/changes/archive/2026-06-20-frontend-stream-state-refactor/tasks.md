## 0. Execute Gate 與 Scope Check

- [x] 0.1 確認 CCR Owner 已核准 Design，再開始任何 frontend source changes。
- [x] 0.2 編輯前讀取 `proposal.md`、`design.md`、`specs/frontend-chat/spec.md`、根目錄 `AGENTS.md`、`frontend/AGENTS.md`，以及受影響 source/tests。
- [x] 0.3 確認 source edits 保持 frontend-only，且不觸碰 `bff/**`、`backend/**`、dependency manifests、message parsing、Tool Result rendering 或 `InputForm`。
- [x] 0.4 在 refactor 前固定目前 activity archive、cancel placeholder、stream error display 與 known runtime event conversion 的行為證據。
- [x] 0.5 檢查 working tree 中受影響 frontend files 是否存在 unrelated changes，並保留使用者既有變更。

## 1. Parser Tests First

- [x] 1.1 新增 direct runtime event extraction from raw stream update 的 unit tests。
- [x] 1.2 新增 nested runtime event extraction from node values 的 unit tests。
- [x] 1.3 新增 known node 沒有 direct runtime events 時 node adapter fallback 的 unit tests。
- [x] 1.4 新增測試，證明 known node 已包含 runtime events 時會 skip node adapter fallback。
- [x] 1.5 新增測試，證明 malformed values 會被 skip，而同一 update 中 valid events 仍會繼續 processing。
- [x] 1.6 新增測試，證明 unknown `agent.*` event fallback 會產生 generic processed activity item，而不是 undefined。

## 2. Reducer Tests First

- [x] 2.1 新增 new stream starts 且 update events arrive 時 `idle -> running` 的 reducer tests。
- [x] 2.2 新增 successful finish terminal convergence 與 duplicate finish idempotency 的 reducer tests。
- [x] 2.3 新增 non-cancel error terminal convergence 與 late progress event handling 的 reducer tests。
- [x] 2.4 新增 timeout failure preserves timeout meaning 且不會變成 success 的 reducer tests。
- [x] 2.5 新增 user cancellation terminal convergence 與 late progress event handling 的 reducer tests。
- [x] 2.6 新增依 assistant message id archive idempotency 的 reducer tests。
- [x] 2.7 新增 new submit 或 agent switch reset 的 reducer tests，並確認必要時 archived historical activity 仍保留。

## 3. Parser Implementation

- [x] 3.1 將 runtime event parsing 拆成 pure helpers，涵蓋 direct extraction、nested extraction、node adapter conversion 與 normalized update extraction。
- [x] 3.2 保留 `extractAgentRuntimeEvents` export，並維持目前 call shape。
- [x] 3.3 保持 known event conversion behavior 與 existing visible activity title/data semantics 相容。
- [x] 3.4 新增明確 unknown `agent.*` runtime event fallback type，或等價的 compatible representation。
- [x] 3.5 只在 generic unknown activity fallback 需要時更新 runtime event labels/icon mapping。
- [x] 3.6 確保 malformed non-agent values 會被 skip 且不 throw。

## 4. Activity State Reducer Implementation

- [x] 4.1 新增 local frontend activity state model，包含 idle、running、finished、error、cancelled lifecycle states。
- [x] 4.2 新增 stream start、events received、finish、failure、cancellation、archive 與 reset reducer actions。
- [x] 4.3 確保 terminal actions 具備 idempotency，且 late progress events 不能讓 terminal state 回到 running。
- [x] 4.4 確保依 assistant message id archive 時保留第一次 archived activity，且不 duplicate entries。
- [x] 4.5 確保 terminal state 發生但 stable assistant message id 尚不可用時，pending archive metadata 會被明確表示。

## 5. App Integration

- [x] 5.1 以 reducer-owned activity state 取代 live activity array 與 historical activity map coordination。
- [x] 5.2 更新 stream update handling，使其透過 pure parser pipeline parse events 並 dispatch reducer update actions。
- [x] 5.3 更新 stream finish handling，使其 dispatch terminal convergence，而不是只 logging。
- [x] 5.4 更新 stream error handling，使 non-abort errors dispatch error convergence，同時保留既有 formatted stream error display。
- [x] 5.5 更新 cancel handling，使 user cancellation dispatch cancelled convergence，同時保留 local cancelled assistant bubble。
- [x] 5.6 以 event-driven pending archive bridge 取代 `thread.isLoading` archive triggering，且 bridge 只依賴 terminal archive intent 與 available assistant message id。
- [x] 5.7 保留傳給 chat message rendering 的 current props，或只做 backward-compatible activity prop extensions。
- [x] 5.8 保留 selected agent switch 與 new submit reset behavior。

## 6. Compatibility And Regression Coverage

- [x] 6.1 保持 `App.cancel.test.tsx` passing，包含 terminal cancel bubble 與 next submit clearing placeholder。
- [x] 6.2 新增或更新 integration coverage，證明 stable message id 存在時 finished activity 會 archive 到 final assistant message。
- [x] 6.3 新增或更新 integration coverage，證明 message id 在 finish 後才出現時 pending archive 會 resolve。
- [x] 6.4 新增或更新 coverage，證明 error 與 cancellation 不會 duplicate archive activity，也不會在 late events 後 re-enter running。
- [x] 6.5 確認 `useStream` update、finish 與 error callback signatures 維持相容。
- [x] 6.6 確認 Tool Result rendering 與 message grouping behavior 未被改變。

## 7. Validation

- [x] 7.1 執行 `cd frontend; npm run lint`，確認沒有新增 lint 或 hooks dependency errors。
- [x] 7.2 執行 `cd frontend; npm run test`，確認 parser、reducer 與既有 regression tests 通過。
- [x] 7.3 執行 `cd frontend; npm run build`，確認 frontend build 通過。
- [x] 7.4 執行 `openspec validate frontend-stream-state-refactor`，確認 OpenSpec validation 通過。
- [x] 7.5 檢查 git diff，確認不包含 BFF、backend、dependency、package lock、unrelated formatting、UI appearance、message parsing、Tool Result rendering 或 package manifest changes。
