# Agent Execution Architecture

<p>
  <a href="./architecture.en.md">English</a> |
  <a href="./architecture.md">繁體中文</a>
</p>

This document explains how Chat Gun React Agent receives requests, selects execution paths, calls models and tools, and streams results back to the browser. For package boundaries and extension points, see the [TypeScript + LangGraph Code Structure](./typescript-langgraph-architecture.en.md).

## Request Flow

```text
Browser
  │
  │ LangGraph SDK streaming
  ▼
Frontend (React)
  │
  │ /api/langgraph/*
  ▼
BFF (authentication, CORS, rate limiting, request validation, timeouts, and cancellation)
  │
  ▼
LangGraph Agent Server
  │
  ├─ TypeScript graphs
  ├─ LLM Gateway ── Qwen / OpenAI-compatible / CCR
  └─ Tool Registry ── Native tools / MCP servers
```

By default, the frontend connects to the BFF through same-origin `/api/langgraph`. After validating external requests, the BFF forwards LangGraph API paths and streaming content to the backend. It also propagates `x-request-id`, W3C Trace Context, cancellation signals, and allowed identity fields. See [BFF API Gateway](./bff.en.md) for the complete external API behavior.

## Available Agents

The Agent Server registers four graphs through `backend/langgraph.json`:

| Graph ID | Execution | Use cases |
| --- | --- | --- |
| `deep_researcher` | Plans and selects a direct answer, a targeted tool, or multi-step web research | Research, weather, calculations, source organization, and image understanding |
| `chatbot` | Single model node | General conversations |
| `math_agent` | Prefers the calculator and falls back to the model when no expression can be extracted | Math questions and numerical calculations |
| `mcp_agent` | Loops between the model and ToolNode until no more tool calls are produced | Enabled native or MCP tools |

## Deep Researcher Flow

`deep_researcher` validates uploaded content, builds the conversation context, and then lets the planner select the most appropriate path.

```text
START
  │
  ▼
validate_uploads
  │
  ├─ upload error ───────────────────────────┐
  ▼                                          │
build_context_pack                           │
  │                                          │
  ▼                                          │
analyze_images                               │
  │                                          │
  ▼                                          │
plan_research                                │
  │                                          │
  ├─ direct ─────────────────────────────────┤
  ├─ weather / calculation                   │
  │      ▼                                   │
  │   targeted_tools                         │
  │      ├─ location confirmation required   │
  │      │      ▼                            │
  │      │   clarify_interrupt               │
  │      │      │ resume                     │
  │      │      ▼                            │
  │      │   resume_clarify ─────────────────┤
  │      └────────────────────────────────────┤
  │                                          │
  └─ research                                │
         ▼                                   │
      search_web                             │
         ▼                                   │
      rank_sources                           │
         ▼                                   │
      fetch_sources                          │
         ▼                                   │
      extract_evidence                       │
         ▼                                   │
      verify_citations                       │
         │                                   │
         └───────────────────────────────────┤
                                             ▼
                                      synthesize_answer
                                             │
                                            END
```

When search returns no results or too few sources, the router can skip unnecessary nodes and proceed directly to verification or answer synthesis. Only `synthesize_answer` produces the final response, so successful execution, tool errors, upload errors, and cancellation all converge at the same endpoint.

## State and Checkpoints

Deep Researcher state is defined with LangGraph `Annotation.Root`. Its primary fields are:

| Field | Purpose |
| --- | --- |
| `messages` | Conversation messages and tool results |
| `contextPack` | Organized, budget-controlled conversation context |
| `plan` | Answer mode, queries, and tool parameters produced by the planner |
| `searchResults` | Search results |
| `rankedSources` | Ranked candidate sources |
| `fetchedSources` | Retrieved web content |
| `extractedSources` | Evidence available for citation |
| `verification` | Citation and source verification results |
| `imageObservations` | Image analysis results |
| `weatherExecution` | Weather tool execution state and results |
| `clarification` | State while waiting for the user to confirm a location |

State must remain serializable. It must not contain runtime objects such as provider clients, streams, callbacks, timers, or `AbortController` instances.

Deep Researcher uses LangGraph `MemorySaver` to preserve conversation execution state within the process. When a weather location has multiple candidates, the graph pauses with `interrupt()`. It resumes the same thread after the user selects a candidate, supplies a different location, or cancels. Resume operations must return to the backend process that owns the checkpoint. Deployments that require recovery across restarts or multiple instances should use a compatible durable checkpointer.

## Model and Tool Boundaries

All model calls pass through `backend/src/platform/llm-gateway.ts`. The gateway supports `qwen`, `openai-compatible`, and `ccr`, and checks model capabilities before sending a request:

- Structured output requires `supportsStructuredOutput`.
- Tool calling requires `supportsToolCalling` and `bindTools`.
- Image input requires `supportsVision`.

Provider fallback is selected explicitly by the caller; declaring multiple providers does not enable automatic switching. Structured output is parsed and normalized first. When data is incomplete, the runtime uses a safe fallback plan without exposing raw provider responses or stack traces to users.

Deep Researcher and MCP Agent load native and MCP tools through the Tool Registry. This path applies enable and disable settings, allowlists and denylists, input size limits, timeouts, and output size limits. Math Agent calls the calculator directly and does not use the registry. See [Tool and MCP Security Configuration](./tool-security-isolation.en.md) for network and path restrictions applied to web fetching and Filesystem MCP.

## Streaming Events

The backend and frontend share the same Agent runtime event types:

- `agent.plan.start`
- `agent.tool.start`
- `agent.tool.success`
- `agent.tool.error`
- `agent.context.build`
- `agent.answer.stream`
- `agent.card.emit`
- `agent.unknown`

The frontend converts events into the activity timeline and answer stream. Unrecognized new events are retained as `agent.unknown`, preventing older clients from breaking when an event type is introduced. The reusable task state machine defines `completed`, `failed`, and `cancelled` as terminal states, with no valid transition back to `running`.

## Observability

- The BFF preserves and forwards W3C `traceparent` and `tracestate`, allowing the backend to continue the upstream trace context.
- `/api/metrics` exposes the backend's JSON metrics snapshot through the BFF.
- OpenTelemetry can export spans for graph nodes, LLM calls, and repair flows.
- Opik can record graph, LLM, and tool traces in development and supports evaluation workflows under `backend/src/evaluation/`.
- Tool audit events retain only diagnostic metadata; sensitive inputs and outputs must be redacted.

OpenTelemetry and Opik are enabled through environment variables. When not configured, they do not affect the primary request flow.
