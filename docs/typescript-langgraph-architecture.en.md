# TypeScript + LangGraph Code Structure

<p>
  <a href="./typescript-langgraph-architecture.en.md">English</a> |
  <a href="./typescript-langgraph-architecture.md">繁體中文</a>
</p>

Chat Gun React Agent is a TypeScript monorepo. The frontend, BFF, and LangGraph backend have explicit responsibility boundaries and can be developed and deployed independently.

## Package Responsibilities

```text
frontend/                 React UI and LangGraph streaming client
bff/                      External API Gateway and static site entry point
backend/                  Runtime for LangGraph graphs, models, and tools
docs/                     Public usage and architecture documentation
```

| Package | Primary responsibilities | Responsibilities it must not own |
| --- | --- | --- |
| `frontend` | Conversation UI, attachments, streaming event parsing, state, and structured result rendering | Model or tool credentials and backend semantic decisions |
| `bff` | Authentication, CORS, rate limiting, size limits, timeouts, cancellation, error mapping, and auditing | Prompts, planners, or agent workflows |
| `backend` | LangGraph state, nodes, edges, LLMs, tools, MCP, and runtime events | Browser authentication or UI rendering logic |

## Backend Directory

```text
backend/
├─ langgraph.json                 Graph and HTTP app registration
└─ src/
   ├─ agents/                     Graphs executable by LangGraph Server
   ├─ tools/                      Native tools, MCP loader, and registry
   ├─ platform/                   LLM Gateway, configuration, events, metrics, and tracing
   ├─ context/                    Context assembly, budgeting, and compression strategies
   ├─ runtime/                    Reusable runtime primitives
   ├─ evaluation/                 Opik datasets, experiments, and scoring
   ├─ prompts.ts                  Agent prompts
   └─ state.ts                    Shared message and context helpers
```

### `agents/`

Each graph exports a compiled LangGraph instance. `langgraph.json` assigns its public Graph ID. The currently registered graphs are:

```json
{
  "deep_researcher": "./src/agents/deep-researcher.ts:deepResearcherGraph",
  "chatbot": "./src/agents/chatbot.ts:chatbotGraph",
  "math_agent": "./src/agents/math-agent.ts:mathAgentGraph",
  "mcp_agent": "./src/agents/mcp-agent.ts:mcpAgentGraph"
}
```

A graph node receives state and `RunnableConfig`, then returns a state update. Routing decisions are centralized in conditional edge functions so nodes do not combine business operations with flow control. Graphs that require persistent conversations or human-in-the-loop workflows must configure a checkpointer, while callers must retain a stable `thread_id`.

### `platform/`

`platform` defines external capability boundaries shared by graphs:

- `llm-gateway.ts`: Provider creation, capability checks, model calls, and optional fallback.
- `runtime-config.ts`: Locale, time zone, context budget, metrics, and tracing configuration.
- `agent-runtime-events.ts`: The event union sent from the backend to the frontend.
- `tool-governance.ts`: Tool permissions, input and output limits, timeouts, and audit events.
- `metrics/`: Task, step, tool, token, cost, and latency statistics, plus the JSON metrics endpoint.
- `tracing/`: OpenTelemetry spans and Opik integration.

Graphs do not depend directly on a specific Provider SDK. Add a Provider by implementing the shared LLM Gateway interface and declaring its capabilities; do not branch on model names inside a graph.

### `tools/`

Deep Researcher and MCP Agent load native and MCP tools through the registry. The registry:

1. Provides the shared native tool set.
2. Applies tool governance policies.
3. Loads MCP Servers according to call options and environment settings.
4. Returns LangChain-compatible tools to a graph or `ToolNode`.

Math Agent currently imports the calculator directly and does not use the registry. Tool inputs and outputs require explicit schemas. Callers of directly imported tools must also enforce permissions and resource limits. Tools that access networks, files, or third-party services must additionally restrict destinations, paths, timeouts, and data sizes.

### `context/`

The context assembler organizes messages and candidate data before allocating space according to the token budget. When content exceeds the budget, the compression strategy produces a shorter version. Graphs receive the assembled context and do not need to reimplement truncation rules.

### `runtime/`

`runtime` provides primitives that workflows can adopt explicitly, including:

- Task and step state machines with domain events
- PostgreSQL repositories and migrations
- Retry policies, backoff, and retry budgets
- Idempotency guards
- Redis step locks and transition guards
- Audit logging and sensitive-data redaction
- Compensation registry and saga orchestrator

These modules are libraries. Their presence in the directory does not apply them automatically to every graph. Agents and services opt into the required capabilities through imports and configuration.

## Frontend Streaming Boundary

The frontend uses `@langchain/langgraph-sdk` to create threads, start runs, and receive streams. Its primary boundaries are:

```text
App.tsx
  ├─ lib/agent-run-config.ts       Assembles graph execution configuration
  ├─ lib/agent-runtime-events.ts   Validates and normalizes runtime events
  ├─ lib/task-event-reducer.ts     Merges task state
  └─ components/                   Renders messages, activity, and tool results
```

Backend event types are defined in `backend/src/platform/agent-runtime-events.ts`, with corresponding frontend types in `frontend/src/types/agent-runtime-events.ts`. Adding or changing an event requires synchronized updates to types, the normalizer, the reducer, and tests on both sides. The frontend must not infer event state from display text.

`VITE_LANGGRAPH_API_URL` controls only the browser connection target. Production environments should use same-origin `/api/langgraph`, allowing the BFF to hide the backend address and apply external API policies.

## BFF Boundary

`bff/src/server.ts` is the external entry point and is responsible for:

- Request and stream proxying for `/api/langgraph/*`
- The protected metrics proxy at `/api/metrics`
- `/api/health` and `/api/ready`
- Frontend static files under `/app/*`
- Request IDs, trace context, authentication, CORS, rate limiting, body and image validation, timeouts, and cancellation

The BFF does not parse LangGraph state or change model, tool, or planner semantics. See [BFF API Gateway](./bff.en.md) for routing and configuration details.

## Deployment Topology

Local development can run the three packages separately. Docker Compose provides the following services:

```text
Browser
  │
  ▼
BFF :8123
  ├─ /app/*            frontend static files
  ├─ /api/langgraph/*  → langgraph-api :8000
  └─ /api/metrics      → backend metrics app

langgraph-api
  ├─ Redis
  ├─ PostgreSQL
  ├─ LLM providers
  └─ Native / MCP tools
```

Credentials exist only in the server process that uses them. Provider and tool keys belong to the backend, BFF API keys belong to the BFF, and the frontend uses only public `VITE_*` settings.

## Extension Points

### Add an Agent

1. Create the graph under `backend/src/agents/` and export the compiled result.
2. Register a stable Graph ID in `backend/langgraph.json`.
3. Update the frontend agent type and list if the agent should be selectable in the UI.
4. Add tests for state reducers, conditional routes, errors, and cancellation paths.

### Add a Tool

1. Define an input schema with runtime validation.
2. Implement a LangChain-compatible tool.
3. Register it in the Tool Registry. If only selected agents may use it, define explicit visibility rules in the registry.
4. Configure governance policies, timeouts, data size limits, and audit behavior.
5. Test success, invalid input, denial, timeout, and upstream failure paths.

### Add a Provider

1. Implement the LLM Gateway interface.
2. Declare structured output, tool calling, and vision capabilities.
3. Normalize external errors into safe, stable error categories.
4. Test regular input, multimodal input, tool calling, timeouts, cancellation, and optional fallback.

## Validation

When modifying a single package, run at least its complete set of checks:

```bash
cd frontend
npm run lint
npm run test
npm run build
```

```bash
cd backend
npm run lint
npm run test
npm run build
```

```bash
cd bff
npm run build
```

Cross-layer contract changes require validation of every affected package, especially Graph IDs, request schemas, runtime events, terminal states, and error codes.
