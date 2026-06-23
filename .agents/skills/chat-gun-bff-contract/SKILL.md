---
name: chat-gun-bff-contract
description: >
  Apply when creating, modifying, refactoring, debugging, testing, or
  reviewing TypeScript and Node.js code under bff/** in
  chat-gun-react-agent. Enforces transport boundaries, naming, imports,
  validation, streaming, timeout, cancellation, security, observability,
  internationalization, and legacy-code compatibility.
---

# ChatGun BFF Engineering Contract

## Instruction precedence

Apply instructions in this order:

1. Approved OpenSpec proposal, specs, design, and tasks
2. Root AGENTS.md
3. bff/AGENTS.md
4. Existing public contracts, tests, and accepted runtime behavior
5. This skill
6. External general-purpose skills

External skills must not override approved API behavior, stream-event
semantics, timeout behavior, security boundaries, package ownership, or
existing transport contracts.

## Existing stack must be preserved

This is an existing TypeScript Node.js BFF.

Preserve unless an approved OpenSpec change explicitly requires otherwise:

- the existing TypeScript and tsc build pipeline;
- existing ESM and module-resolution behavior;
- current Node.js version requirements;
- package scripts;
- HTTP and stream contracts;
- route paths;
- error codes;
- timeout and cancellation semantics.

Do not:

- enable Node.js native TypeScript type stripping;
- execute production TypeScript directly with Node;
- change import-extension conventions;
- introduce Express, Fastify, NestJS, Hono, or another framework;
- add dependencies;
- replace existing HTTP transport;
- change CI, package scripts, or runtime tooling;
- migrate error or response formats;

unless explicitly approved through OpenSpec.

## BFF ownership

The BFF owns:

- transport-level request parsing;
- authentication and authorization boundaries;
- header allowlisting;
- CORS;
- request-size limits;
- rate limiting;
- timeout and cancellation propagation;
- upstream request orchestration;
- stream forwarding and backpressure;
- transport error mapping;
- request tracing and audit metadata.

The BFF does not own:

- prompt construction;
- model reasoning;
- Agent planning;
- LangGraph routing;
- natural-language intent classification;
- business-domain decisions;
- localized product copy;
- tool implementation details.

Do not move Backend Agent responsibilities into the BFF.

## Skill routing

Use `coding-standards` for:

- naming;
- readability;
- TypeScript clarity;
- magic-value prevention;
- avoiding generated-looking or unnecessarily clever code.

Use `node` for:

- HTTP lifecycle;
- streams and backpressure;
- AbortSignal propagation;
- timeout handling;
- client disconnect handling;
- resource cleanup;
- graceful shutdown;
- event-loop diagnosis.

Use `security-and-hardening` for:

- request boundaries;
- authentication;
- CORS;
- headers;
- URLs;
- rate limiting;
- body and upload validation;
- secrets and credentials.

Use `observability-and-instrumentation` for:

- request and trace identifiers;
- structured logs;
- latency;
- stream completion reasons;
- upstream error visibility.

Use `debugging-and-error-recovery` when:

- a stream remains running;
- a request never terminates;
- timeout or cancellation fails;
- the client disconnects but upstream work continues;
- headers were already sent before an error;
- open handles prevent process exit;
- behavior is flaky or difficult to reproduce.

Use `test-driven-development` before changing timeout, cancellation, stream,
error-mapping, or rate-limit behavior.

## Naming rules

Use names that describe transport role and lifecycle.

Required conventions:

- Booleans start with `is`, `has`, `can`, `should`, or `supports`.
- Request handlers use `handleXxxRequest`.
- Middleware-style functions describe responsibility.
- Parsers use `parseXxx`.
- Validators use `validateXxx` or `safeParseXxx`.
- Type guards use `isXxx`.
- Mappers describe both sides, such as `toUpstreamRequest`.
- Error conversion uses `mapXxxError`.
- Abort helpers identify ownership, such as `createUpstreamAbortSignal`.
- Timeout constants identify the operation they protect.
- Header collections identify whether they are inbound or outbound.

Avoid ambiguous names outside very small scopes:

- data
- result
- info
- value
- item
- temp
- flag
- config
- handler
- process
- responseData

Prefer names such as:

- inboundRequestHeaders
- allowedForwardHeaders
- upstreamResponse
- requestAbortSignal
- clientDisconnectReason
- streamTerminalReason
- upstreamTimeoutMs
- normalizedLocale
- transportErrorCode

## Import rules

- Use `import type` for type-only imports.
- Group imports into third-party, repository absolute, relative, and
  side-effect imports.
- Avoid barrel imports unless they define a stable package surface.
- BFF transport modules must not import LangGraph nodes, prompts, model
  providers, or concrete Agent implementations.
- Do not create circular imports.
- Do not bypass directory ownership.

## Hardcoding policy

Do not scatter hardcoded:

- upstream URLs;
- route paths;
- timeout durations;
- retry counts;
- body-size limits;
- rate-limit thresholds;
- header names;
- MIME types;
- locale lists;
- environment-variable names;
- error codes;
- user-visible error messages;
- CORS origins;
- terminal reasons.

Allowed constants must be:

- owned by the correct module;
- named by semantic role;
- typed;
- validated when loaded from configuration;
- testable;
- documented when externally visible.

Do not place unrelated values into a generic global constants file.

## Request validation

Everything received from a client is untrusted:

- headers;
- cookies;
- query parameters;
- route parameters;
- JSON bodies;
- multipart metadata;
- filenames;
- MIME types;
- locale headers;
- forwarded-address headers.

Validate at the transport boundary.

A TypeScript type assertion is not runtime validation.

Do not forward arbitrary inbound headers upstream.

Use an explicit allowlist for forwarded headers.

Do not allow clients to control:

- upstream hosts;
- arbitrary URLs;
- authorization targets;
- internal service headers;
- trace ownership;
- filesystem paths.

## Streaming and backpressure

Do not buffer an unbounded upstream stream in memory.

Respect backpressure when forwarding streams.

Every stream must define terminal paths for:

- success;
- client cancellation;
- client disconnect;
- BFF timeout;
- upstream timeout;
- upstream error;
- malformed upstream event;
- process shutdown.

Do not treat all terminal reasons as a generic error.

Do not write to a response after it is closed or destroyed.

When the downstream client disconnects:

1. abort upstream work;
2. stop forwarding events;
3. release listeners and timers;
4. record a structured terminal reason.

## Timeout and cancellation

Timeout ownership must be explicit.

Differentiate:

- client cancellation;
- client disconnect;
- BFF request timeout;
- upstream timeout;
- process shutdown;
- internal execution error.

Propagate AbortSignal where supported.

Every timer and listener must have a cleanup path.

Do not implement timeout handling only by hiding loading UI or returning a
response while upstream work continues.

## Error contract

Transport errors must use stable machine-readable identifiers.

Separate:

- HTTP status;
- errorCode;
- developerMessage;
- userMessageKey;
- retryability;
- terminalReason.

Do not expose:

- stack traces;
- internal URLs;
- provider responses;
- secrets;
- raw authorization errors;
- internal exception names.

Do not localize behavior by matching complete error-message strings.

## Security

CORS must use explicit configuration.

Do not combine wildcard origins with credentials.

Rate-limit identity must not blindly trust arbitrary forwarded headers.

Do not log:

- Authorization;
- Cookie;
- provider API keys;
- complete request bodies by default;
- complete prompts;
- uploaded private content.

Ensure security headers and response behavior remain consistent across
success and error paths.

## Internationalization

Accept-Language is transport metadata, not Agent intent.

The BFF may:

- parse and normalize locale metadata;
- validate supported locales;
- apply a configured fallback;
- forward normalized locale metadata.

The BFF must not:

- infer user intent from locale;
- translate prompts;
- route LangGraph by language;
- guess locale from IP;
- scatter Chinese or English user-facing strings in route handlers;
- depend on the operating-system locale.

Use stable locale identifiers and centralized configuration.

Separate:

- errorCode;
- userMessageKey;
- localized presentation text.

Tests should cover, when relevant:

- Traditional Chinese;
- Simplified Chinese;
- English;
- mixed-language headers;
- malformed Accept-Language;
- unsupported locale;
- explicit fallback behavior.

## Observability

Prefer structured events over free-form console logs.

When relevant, include:

- requestId;
- traceId;
- runId;
- threadId;
- route;
- HTTP method;
- statusCode;
- upstream service;
- durationMs;
- bytesIn;
- bytesOut;
- terminalReason;
- errorCode.

Use distinct terminal reasons such as:

- completed;
- client_cancelled;
- client_disconnected;
- bff_timeout;
- upstream_timeout;
- upstream_error;
- malformed_upstream_event;
- process_shutdown.

Do not include secrets or unnecessary sensitive payloads.

## Legacy-code workflow

Before modifying BFF code:

1. Read the approved OpenSpec artifacts.
2. Read root AGENTS.md and bff/AGENTS.md.
3. Inspect existing route and stream behavior.
4. Add characterization tests when behavior lacks coverage.
5. Make the smallest complete change.
6. Preserve unrelated behavior.
7. Verify success and every relevant terminal path.

Do not perform repository-wide cleanup while implementing a scoped change.

## Completion checklist

Before completion:

1. Confirm the implementation matches approved OpenSpec artifacts.
2. Confirm BFF responsibility did not expand into Agent logic.
3. Confirm no unrelated refactor was introduced.
4. Confirm naming and imports follow this contract.
5. Confirm no new magic values were introduced.
6. Confirm all external inputs are validated.
7. Confirm timeout and cancellation reach upstream work.
8. Confirm stream listeners, timers, and resources are cleaned up.
9. Confirm internationalization metadata has explicit fallback behavior.
10. Run BFF build, lint, and targeted tests.
11. Report commands and evidence.
