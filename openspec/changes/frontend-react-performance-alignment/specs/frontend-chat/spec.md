# Delta for Frontend Chat

## ADDED Requirements

### Requirement: Chat message rendering MUST avoid unnecessary recomputation

Frontend MUST avoid recomputing grouped chat messages when the `messages` reference has not changed.

#### Scenario: Messages reference is unchanged

- GIVEN `ChatMessagesView` receives the same `messages` array reference across renders
- WHEN the parent component re-renders because unrelated state changed
- THEN `groupMessages(messages)` MUST NOT be recomputed for that render
- AND existing message order and grouping semantics MUST remain unchanged

#### Scenario: Messages reference changes

- GIVEN `ChatMessagesView` receives a new `messages` array reference
- WHEN the component renders
- THEN grouped messages MUST be recomputed from the new messages
- AND tool call grouping MUST remain compatible with the existing behavior

---

### Requirement: Derived display message arrays MUST preserve stable references

Frontend MUST memoize display-only derived message arrays so unrelated renders do not create new references.

#### Scenario: No stream error or cancellation state changes

- GIVEN `thread.messages`, `streamErrorMessage`, and `cancelledMessage` are unchanged
- WHEN `App` re-renders for unrelated state
- THEN `messagesWithStreamError` and `displayMessages` SHOULD keep stable references
- AND `ChatMessagesView` MUST receive the same display messages reference

#### Scenario: Stream error changes

- GIVEN `streamErrorMessage` changes
- WHEN `App` re-renders
- THEN `messagesWithStreamError` MUST be recomputed
- AND the stream error message MUST still be appended with the existing message shape and order

#### Scenario: Cancellation message changes

- GIVEN `cancelledMessage` changes
- WHEN `App` re-renders
- THEN `displayMessages` MUST be recomputed
- AND the cancelled assistant message MUST remain appended after stream error handling

---

### Requirement: Chat callbacks MUST be stable without stale state

Frontend MUST stabilize callbacks passed to memoized children or runtime hooks while preserving current state semantics.

#### Scenario: Copy callback is passed to AI bubbles

- GIVEN `ChatMessagesView` re-renders without changing copy-related dependencies
- WHEN `AiMessageBubble` receives `handleCopy`
- THEN `handleCopy` SHOULD keep a stable function reference
- AND copy-to-clipboard behavior MUST remain unchanged

#### Scenario: Runtime update callback reads selected agent

- GIVEN `selectedAgentId` changes
- WHEN a later stream update event is handled
- THEN `onUpdateEvent` MUST read the latest selected agent value
- AND the callback MUST NOT rely on a stale closure

#### Scenario: Hook dependency validation

- WHEN frontend lint runs
- THEN the new `useMemo` and `useCallback` usages MUST satisfy `react-hooks/exhaustive-deps`

---

### Requirement: Pure chat display components MUST define safe memo boundaries

Frontend MUST define safe memo boundaries around pure chat display components so unchanged historical bubbles can skip renders during unrelated parent renders.

#### Scenario: Human message bubble props are unchanged

- GIVEN a human message bubble receives unchanged props
- WHEN the parent chat view re-renders
- THEN the human bubble SHOULD skip rendering
- AND its Markdown and image attachment display MUST remain unchanged

#### Scenario: AI message bubble props are unchanged

- GIVEN an AI message bubble receives unchanged props
- WHEN the parent chat view re-renders
- THEN the AI bubble SHOULD skip rendering
- AND Activity Timeline, Tool Call display, Markdown, and Copy Button behavior MUST remain unchanged

#### Scenario: Tool display memo is applied from the consumer

- GIVEN `ChatMessagesView` renders `ToolMessageDisplay`
- WHEN memoization is added
- THEN the memo wrapper SHOULD be applied from `ChatMessagesView`
- AND `ToolMessageDisplay.tsx` MUST NOT be modified by this Change

---

### Requirement: Timer and upload queue async work MUST be unmount safe

Frontend MUST prevent known timer and upload queue async callbacks from updating state after component unmount.

#### Scenario: Copy reset timer is pending during unmount

- GIVEN a copy success reset timer is pending
- WHEN `ChatMessagesView` unmounts
- THEN the timer MUST be cleared
- AND React MUST NOT receive a state update from that timer after unmount

#### Scenario: A new copy action occurs before the previous timer fires

- GIVEN a copy reset timer is pending
- WHEN the user copies another message
- THEN the previous timer MUST be cleared before creating the new timer
- AND the visible copied state MUST still reset after the configured delay

#### Scenario: Upload queue resolves after unmount

- GIVEN `InputForm` has an upload queue async operation in flight
- WHEN `InputForm` unmounts before the operation settles
- THEN upload queue callbacks MUST NOT call state setters after unmount
- AND upload preflight, queue order, and error semantics MUST remain unchanged while mounted

---

### Requirement: Frontend performance alignment MUST preserve product contracts

This Change MUST NOT alter product behavior, UI appearance, public contracts, or cross-layer data shapes.

#### Scenario: Source execute is applied

- WHEN the implementation is complete
- THEN only `frontend/src/App.tsx`, `frontend/src/components/ChatMessagesView.tsx`, and `frontend/src/components/InputForm.tsx` SHOULD need source changes
- AND BFF and backend files MUST remain unchanged
- AND dependency manifests MUST remain unchanged

#### Scenario: Tool and stream behavior is exercised

- GIVEN a conversation includes stream updates and Tool Calls
- WHEN the frontend renders the conversation
- THEN Tool Result rendering MUST remain compatible with the previous behavior
- AND stream terminal state handling MUST remain unchanged
- AND no public event, schema, route, Graph ID, or request payload shape MUST change

#### Scenario: Performance verification is available

- GIVEN React DevTools Profiler can be used in the local environment
- WHEN the same 3-5 message scenario is recorded before and after implementation
- THEN unchanged historical bubbles SHOULD no longer re-render on every stream update
- AND total re-render count SHOULD be less than or equal to 70% of the baseline
