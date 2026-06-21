# Backend Query Workflow Contract

This document records the backend contracts covered by the
`backend-langgraph-tool-structure-refactor` change. It is intentionally limited
to the generic query workflow and model runtime boundary.

## Query Workflow Invariant

The deep research graph keeps a one-way workflow:

```text
request accepted
  -> context / upload preflight
  -> planning
  -> targeted tool execution | search / rank / fetch / extract / verify
  -> synthesis
  -> terminal response
```

Terminal error, cancellation, timeout, or completed responses must not be
converted back into running or progress states by backend runtime events. Graph
routes remain stable string constants owned by the backend graph.

## State Field Ownership

| Field | Owner | Readers | Checkpoint requirement |
| --- | --- | --- | --- |
| `messages` | graph reducers | all nodes | LangGraph message serializable |
| `contextPack` | context pack node | planning / synthesis | JSON serializable |
| `initial_search_query_count` | graph input/config | planner | finite integer |
| `max_research_loops` | graph input/config | search / fetch | finite integer |
| `reasoning_model` | graph input/config | model nodes | string only |
| `plan` | planner | routers / tools / synthesis | JSON serializable object |
| `searchResults` | search node | rank / fallback evidence | JSON serializable array |
| `rankedSources` | rank node | fetch / verify | JSON serializable array |
| `fetchedSources` | fetch node | extract / synthesis | JSON serializable array |
| `extractedSources` | extract node | verify / synthesis | JSON serializable array |
| `verification` | verify node | synthesis | JSON serializable object |
| `uploadError` | upload preflight | synthesis | safe error envelope string |
| `imageObservations` | image analysis | synthesis | string array |
| `weatherExecution` | targeted weather execution | synthesis | domain result union |

No field may store live handles, provider clients, streams, callbacks, timers,
AbortControllers, or non-serializable response objects.

## Provider Capability Enforcement

Provider adapters expose typed capabilities. Unsupported combinations fail
before a provider request is sent:

- `supportsStructuredOutput` gates `responseFormat`.
- `supportsToolCalling` gates `bindTools`.
- `supportsVision` gates vision requests.

The CCR Anthropic-compatible adapter does not expose `bindTools`; it rejects
structured output requests through capability enforcement.

## Structured Output Validation

Planner structured output follows a three-level path:

1. Parse a JSON object and record `parse_failed` diagnostics on failure.
2. Coerce known fields into a typed `ResearchPlan`.
3. Fall back to a safe clarification or research plan when required fields are
   missing.

Failures are represented as safe diagnostics or fallback plans. Raw parser
exceptions, stack traces, secrets, and provider response bodies are not exposed
as public contract fields.

## Stable Error Codes

Public error codes come from structured sources in priority order:

1. Domain-specific error classes such as provider response parse errors.
2. Structured error names such as `AbortError`.
3. Structured HTTP status fields.
4. Structured nested cause codes.
5. `unknown_error`.

Message regex matching is telemetry only and must not produce public codes such
as `network_error`.

## Runtime Events

Backend `AgentRuntimeEvent` is the source of truth for runtime event variants.
The union includes `agent.unknown` so newer events can be carried without
breaking older consumers. Event timestamps are assigned by `createRuntimeEvent`
with `Date.now()` and are deterministic under test when the clock is mocked.
