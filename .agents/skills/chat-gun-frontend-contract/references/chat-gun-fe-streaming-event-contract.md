---
name: chat-gun-fe-streaming-event-contract
description: 定義 LangGraph → BFF → Frontend 的流式事件契約，包含 AgentRuntimeEvent discriminated union、NODE_EVENT_RULES adapter、Terminal State 單向收斂與冪等 Reducer 規範。
---

# Streaming Event Contract

## 使用時機

當需要新增、修改或除錯下列任一環節時使用本 Skill：

- LangGraph Node 產出的 Stream Event。
- BFF 串流代理行為（backpressure、disconnect、abort）。
- Frontend `useStream` hook 承接與事件轉換。
- `AgentRuntimeEvent` 型別擴充或 adapter 規則。
- ActivityTimeline 或 Tool 狀態渲染。

## 強制前置條件

依序讀取：

1. `frontend/src/types/agent-runtime-events.ts` - 事件型別定義。
2. `frontend/src/lib/agent-runtime-events.ts` - 事件擷取與轉換。
3. `frontend/src/lib/runtime-event-config.ts` - Node Key 映射與標籤。
4. `backend/src/platform/agent-runtime-events.ts` - Backend 事件型別。
5. `bff/src/server.ts` - 串流代理實作。
6. `frontend/AGENTS.md` §5 - 串流事件與狀態機規則。

## 全鏈路事件流

```text
Backend (LangGraph Node)
  → runtimeEvents / node-based adapter
  → SSE Stream (text/event-stream)
  → BFF pipeWebResponseBody (ReadableStream, backpressure)
  → Frontend useStream (onUpdateEvent)
  → extractAgentRuntimeEvents()
  → runtimeEventToProcessedEvent()
  → ActivityTimeline / ToolMessageDisplay 渲染
```

## AgentRuntimeEvent 型別定義

目前支援 7 種事件類型（discriminated union）：

```ts
export type AgentRuntimeEvent =
  | { type: 'agent.plan.start'; title: string; ts: number }
  | { type: 'agent.tool.start'; toolName: string; input?: unknown; ts: number }
  | {
      type: 'agent.tool.success';
      toolName: string;
      output?: unknown;
      costMs: number;
      ts: number;
    }
  | { type: 'agent.tool.error'; toolName: string; error: string; ts: number }
  | {
      type: 'agent.context.build';
      sources: ContextSource[];
      tokenEstimate: number;
      ts: number;
    }
  | { type: 'agent.answer.stream'; delta: string; ts: number }
  | { type: 'agent.card.emit'; cardType: string; payload: unknown; ts: number };
```

## 擴充事件類型規則

1. 新增事件類型必須在 discriminated union 中加入。
2. `type` 欄位必須以 `agent.` 開頭。
3. 必須同時更新 `runtimeEventToProcessedEvent()` 的 switch。
4. 必須在 `RUNTIME_EVENT_LABELS` 中加入對應標籤。
5. 必須提供 fallback 處理（未知事件不得崩潰 UI）。

## NODE_EVENT_RULES Adapter

用於將 LangGraph Node 輸出轉換為 `AgentRuntimeEvent[]`：

```ts
type RuntimeEventRule = {
  nodeKey: string;
  toEvents: (nodeValue: unknown) => AgentRuntimeEvent[];
};
```

目前映射：

| Node Key | 產生事件 |
| --- | --- |
| `build_context_pack` | `agent.context.build` |
| `plan_research` | `agent.plan.start` |
| `targeted_tools` | `agent.tool.success` / `agent.tool.error` |
| `search_web` | `agent.tool.success` / `agent.tool.error` |
| `fetch_sources` | `agent.tool.success` / `agent.tool.error` |
| `rank_sources` | `agent.context.build` |
| `extract_evidence` | `agent.context.build` |
| `verify_citations` | `agent.context.build` |
| `synthesize_answer` | `agent.answer.stream` |

### 新增 Node 映射規則

1. 在 `RUNTIME_EVENT_NODE_KEYS` 加入 key。
2. 在 `NODE_EVENT_RULES` 加入轉換規則。
3. 若 Node 已有 `runtimeEvents` 直接事件，adapter 不會重複觸發。

## Terminal State 單向收斂

狀態轉換必須遵守：

```text
idle → running → success | error | cancelled | timeout
```

禁止反向轉換：

```text
completed → running  ❌
failed → completed   ❌
cancelled → running  ❌
timeout → progress   ❌
```

## 冪等 Reducer 規範

事件 Reducer 必須具備冪等性：

- 重複事件不得產生副作用。
- 亂序事件不得破壞狀態。
- 晚到的 progress event 不得覆蓋 terminal state。
- `toolCallId` 為主要識別，`runId` / `threadId` 為關聯識別。

```ts
// 範例：冪等 tool state 更新
function reduceToolEvent(state: ToolState, event: AgentRuntimeEvent): ToolState {
  if (state.status === 'success' || state.status === 'error') {
    // Terminal state - 忽略後續事件
    return state;
  }

  // ...正常轉換
}
```

## BFF 串流代理規範

- 使用 `ReadableStream` reader 逐 chunk 寫入。
- `res.write()` 回傳 `false` 時等待 `drain` event（backpressure）。
- 客戶端斷線時必須中止上游請求。
- 不得緩衝整個 response 再發送。
- 錯誤不得暴露內部 Stack Trace。

## 禁止事項

- 不得假設事件只會到達一次。
- 不得在 UI 層解析自然語言判斷事件狀態。
- 不得以延遲或 timer 模擬串流完成。
- 不得讓未知事件類型導致整個 Chat UI 崩潰。
- 不得在 Frontend 持有或推測 Backend 的語意。

## 驗證命令

```bash
cd frontend && npm run lint && npm run test && npm run build
cd backend && npm run test
```

測試必須覆蓋：重複事件、亂序事件、未知事件、terminal state 後的晚到事件、缺少可選欄位。

## 參考檔案

- `frontend/src/types/agent-runtime-events.ts`
- `frontend/src/lib/agent-runtime-events.ts`
- `frontend/src/lib/runtime-event-config.ts`
- `frontend/src/components/ActivityTimeline.tsx`
- `backend/src/platform/agent-runtime-events.ts`
- `bff/src/server.ts`
