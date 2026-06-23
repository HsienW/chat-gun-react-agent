---
name: chat-gun-backend-contract
description: >
  Apply when creating, modifying, refactoring, debugging, testing, or
  reviewing TypeScript, LangGraph JS, LangChain, provider adapter, tool,
  MCP, prompt, state, checkpoint, runtime event, or backend code under
  backend/** in chat-gun-react-agent.
---

# ChatGun Backend Engineering Contract

## Instruction precedence

Apply instructions in this order:

1. Approved OpenSpec proposal, specs, design, and tasks
2. Root AGENTS.md
3. backend/AGENTS.md
4. Existing public contracts, tests, and accepted runtime behavior
5. This skill
6. External general-purpose skills

External skills must not override approved product behavior, graph contracts,
tool schemas, event semantics, security boundaries, or package ownership.

## Existing stack must be preserved

This is an existing TypeScript and LangGraph JS codebase.

Preserve unless an approved OpenSpec change explicitly requires otherwise:

- TypeScript compilation through the existing tsc configuration
- ESM module configuration
- Vitest
- LangGraph JS and LangChain package versions
- Existing package scripts
- Existing module resolution and import-extension conventions
- Existing Graph IDs, state contracts, event contracts, and tool contracts

Do not:

- enable Node.js native TypeScript type stripping;
- replace Vitest with node:test;
- rewrite imports to use a different extension convention;
- upgrade LangGraph, LangChain, Node.js, TypeScript, Zod, MCP SDK, or Undici;
- migrate build, lint, test, or runtime tooling;
- introduce dependencies without an approved change.

## Legacy-code policy

Before changing backend code:

1. Read the approved OpenSpec artifacts.
2. Read root AGENTS.md and backend/AGENTS.md.
3. Inspect existing tests and public behavior.
4. Identify the owning layer.
5. Make the smallest complete vertical change.
6. Preserve unrelated behavior.
7. Add or update tests for the changed contract.

Do not copy an existing legacy pattern merely because it already exists.

Do not perform repository-wide cleanup while implementing a scoped change.

## Skill routing

Use `coding-standards` for:

- naming;
- readability;
- TypeScript clarity;
- avoiding magic values;
- avoiding generated-looking or unnecessarily clever code.

Use `node` for:

- async lifecycle;
- streams and backpressure;
- AbortSignal propagation;
- timeout handling;
- resource cleanup;
- process shutdown;
- event-loop and runtime diagnosis.

Use `langgraph-fundamentals` for:

- StateGraph;
- nodes and edges;
- reducers;
- Command and Send;
- graph routing;
- terminal-state behavior.

Use `langgraph-persistence` for:

- checkpointers;
- thread IDs;
- resume behavior;
- durable state;
- persistence compatibility.

Use `langgraph-human-in-the-loop` for:

- interrupts;
- approval;
- reviewer decisions;
- resume commands;
- serialized HITL state.

Use `security-and-hardening` for:

- external input;
- tool and MCP permissions;
- prompt injection boundaries;
- secrets;
- URL, path, command, header, and credential handling.

Use `observability-and-instrumentation` for:

- structured runtime events;
- correlation identifiers;
- latency and terminal status;
- safe logs, metrics, and traces.

## Naming rules

Use names that describe role, ownership, and lifecycle.

Required conventions:

- Booleans start with `is`, `has`, `can`, `should`, or `supports`.
- Parsers use `parseXxx`.
- Runtime validators use `validateXxx` or `safeParseXxx`.
- Type guards use `isXxx`.
- Factories use `createXxx`.
- Adapters use `XxxProviderAdapter` or `XxxToolAdapter`.
- Resolvers use `resolveXxx`.
- Event constructors use `createXxxEvent`.
- Normalizers use `normalizeXxx`.
- Mappers describe both sides, such as `toDomainToolResult`.
- Retry and timeout functions identify the owned operation.

Avoid ambiguous names outside small local scopes:

- data
- result
- value
- item
- info
- config
- temp
- flag
- handler
- process
- doIt

Use specific names such as:

- graphExecutionState
- providerCapabilities
- normalizedToolArguments
- toolExecutionResult
- reviewerDecision
- checkpointMetadata
- terminalEvent
- abortReason

## Import rules

- Use `import type` for type-only imports.
- Group imports into third-party, repository absolute, relative, and side-effect imports.
- Do not import concrete provider logic into domain or graph contracts.
- Do not import a concrete tool into generic runtime infrastructure.
- Avoid barrel files unless they define an intentional stable public surface.
- Do not introduce circular imports.
- Do not bypass package or directory ownership.

## Hardcoding policy

Do not scatter hardcoded:

- model IDs;
- provider IDs;
- tool names;
- graph IDs;
- event names;
- terminal statuses;
- timeout durations;
- retry counts;
- locale codes;
- user-visible messages;
- error codes;
- environment-variable names;
- provider capability checks;
- prompt fragments;
- MIME types;
- external URLs.

Allowed constants must be:

- owned by the correct module;
- named by semantic role;
- typed;
- testable;
- documented when externally visible.

Do not solve hardcoding by creating an unrelated global constants file.

## LangGraph constraints

State and checkpoint fields must be JSON serializable.

Do not store:

- clients;
- streams;
- sockets;
- AbortController instances;
- functions;
- credentials;
- raw response objects.

A new state field must define:

- owner;
- write timing;
- readers;
- default value;
- reducer behavior;
- checkpoint behavior;
- migration and backward compatibility.

Do not branch on natural-language model output when a structured schema or
stable machine identifier should be used.

Do not assume a node executes only once.

External side effects must define idempotency and resume behavior.

## Security boundaries

User input, model output, retrieved content, tool output, MCP content, HTTP
responses, persisted state, and checkpoint data are untrusted.

Validate at the boundary.

A type assertion is not runtime validation.

Models must not decide unchecked:

- paths;
- URLs;
- hosts;
- commands;
- permissions;
- provider credentials;
- file-system scope.

Tool and MCP capabilities are deny-by-default.

## Internationalization

Use stable machine identifiers independent of language.

Separate:

- errorCode;
- messageKey;
- developerMessage;
- localized user message.

Do not:

- route graph edges by matching Chinese or English sentences;
- infer locale from model prose;
- scatter user-visible strings through nodes or tools;
- use server operating-system locale implicitly;
- overwrite the original user input with a normalized translation.

Locale must be explicit metadata or configuration.

Tests should cover Traditional Chinese, Simplified Chinese, English, mixed
language, emoji, full-width characters, and unknown locale fallback when
relevant.

## Observability

Prefer structured events over free-form console output.

When relevant, include:

- runId;
- threadId;
- graphId;
- nodeName;
- toolCallId;
- toolName;
- provider;
- model;
- durationMs;
- retryCount;
- terminalStatus;
- errorCode.

Do not log secrets, authorization headers, full credentials, or unnecessary
complete prompts and tool payloads.

## Completion checklist

Before completion:

1. Confirm the implementation matches approved OpenSpec artifacts.
2. Confirm external skills did not override repository rules.
3. Confirm no unrelated refactor was introduced.
4. Confirm naming and imports follow this contract.
5. Confirm no new magic values or language-dependent routing was introduced.
6. Confirm runtime boundaries validate untrusted data.
7. Confirm timeout, cancellation, retry, and terminal-state paths are tested.
8. Run backend build, lint, and targeted tests.
9. Report commands and evidence.

## Node skill compatibility override

When applying the `node` skill in this repository:

- Preserve the existing TypeScript compilation through `tsc`.
- Preserve Vitest and existing test scripts.
- Do not enable Node.js native TypeScript type stripping.
- Do not run production TypeScript files directly with Node.
- Do not change import file extensions or module resolution.
- Do not replace Vitest with `node:test`.
- Do not change the Node.js version or package scripts.
- Apply only compatible guidance for:
    - async lifecycle;
    - error handling;
    - streams and backpressure;
    - AbortSignal propagation;
    - resource cleanup;
    - graceful shutdown;
    - logging;
    - profiling;
    - environment validation.
