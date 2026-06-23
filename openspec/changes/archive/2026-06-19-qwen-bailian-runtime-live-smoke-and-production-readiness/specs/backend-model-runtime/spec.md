## ADDED Requirements

### Requirement: Qwen Live Smoke Gate
Backend Runtime MUST provide a Qwen/Bailian live smoke gate that is disabled by default and safe to run only when explicitly enabled.

#### Scenario: Live smoke is skipped by default
- **WHEN** the backend test suite runs without `RUN_QWEN_LIVE_SMOKE=true`
- **THEN** Qwen/Bailian live smoke cases MUST be skipped
- **AND** the test suite MUST NOT require `QWEN_API_KEY`

#### Scenario: Live smoke is enabled without credential
- **GIVEN** `RUN_QWEN_LIVE_SMOKE=true`
- **AND** `QWEN_API_KEY` is missing or blank
- **WHEN** the live smoke suite starts
- **THEN** it MUST fail with a safe missing-credential message
- **AND** it MUST NOT print any credential value

### Requirement: Live Text and Structured JSON Smoke
Live smoke MUST verify Qwen/Bailian text invocation and JSON mode through the same Backend gateway contract used by Runtime agents.

#### Scenario: Text chat live smoke succeeds
- **GIVEN** live smoke is enabled with a valid Qwen/Bailian credential
- **WHEN** Backend sends a short Traditional Chinese chat prompt through the Qwen provider
- **THEN** the response MUST contain non-empty text
- **AND** diagnostics MUST identify provider `qwen` and OpenAI-compatible Chat Completions
- **AND** output MUST NOT expose system prompts, request headers, or credentials

#### Scenario: JSON mode live smoke succeeds
- **GIVEN** live smoke is enabled with a valid Qwen/Bailian credential
- **WHEN** Backend sends a planner-like request using `response_format: { "type": "json_object" }`
- **THEN** the model response MUST parse as JSON
- **AND** the parsed object MUST pass Runtime Validation for the live smoke schema
- **AND** location must come from structured model output rather than keyword stripping

### Requirement: Live Vision Smoke
Live smoke MUST verify Qwen/Bailian vision routing with a small validated image data URL when a vision model is configured.

#### Scenario: Vision live smoke succeeds
- **GIVEN** live smoke is enabled with a valid Qwen/Bailian credential
- **AND** a Qwen vision model is configured or defaulted
- **WHEN** Backend validates a small image data URL and sends it through vision purpose
- **THEN** the model MUST return a non-empty observation
- **AND** diagnostics MUST identify provider `qwen`
- **AND** unsupported vision MUST be reported explicitly rather than silently succeeding

### Requirement: Live Tool Calling Smoke
Live smoke MUST verify Qwen/Bailian tool calling and ToolMessage round trip through Backend tool execution.

#### Scenario: Calculator tool round trip succeeds
- **GIVEN** live smoke is enabled with a valid Qwen/Bailian credential
- **WHEN** the model is asked to use a tool to calculate `123*456`
- **THEN** Qwen MUST emit a tool call or the smoke MUST fail with evidence
- **AND** Backend MUST execute the calculator tool
- **AND** the ToolMessage MUST be sent back with the same tool call id
- **AND** the final answer MUST include `56088`

#### Scenario: Tool choice can select a tool
- **WHEN** Backend binds tools with a specific compatible `tool_choice`
- **THEN** the request MUST preserve that tool choice
- **AND** existing default `auto` behavior MUST remain available

### Requirement: MCP Agent Architecture Smoke
Backend MUST verify MCP Agent remains Backend-executed and is not replaced by provider-hosted MCP.

#### Scenario: MCP Agent remains backend governed
- **WHEN** Qwen provider is selected
- **THEN** MCP Agent MUST still bind tools through Backend ToolRegistry and ToolNode
- **AND** existing governance, allowlist, timeout, cancellation, and audit boundaries MUST remain in effect
- **AND** Backend MUST NOT delegate MCP execution to Bailian Responses API

### Requirement: Production Error Mapping
Backend Runtime MUST expose production-oriented provider error codes and preserve credential safety.

#### Scenario: Provider HTTP and transport errors are mapped
- **WHEN** provider failures are simulated for 401, 403, 429, 400, 5xx, network failure, timeout, abort, or invalid JSON
- **THEN** Backend MUST produce distinct error codes for auth/permission, quota/rate limit, request validation, provider unavailable, network, timeout, and JSON parse failures
- **AND** error envelopes MUST identify provider `qwen`
- **AND** error envelopes MUST NOT leak API keys or authorization headers

### Requirement: Usage and Metadata Live Evidence
Live smoke MUST report available provider metadata without fabricating missing fields.

#### Scenario: Metadata is reported safely
- **GIVEN** live smoke receives a provider response
- **WHEN** response metadata or usage metadata is available
- **THEN** Backend MUST report provider, model, endpoint kind, finish reason, response id presence, and usage metadata presence
- **AND** Backend MUST NOT invent missing usage fields
- **AND** Backend MUST NOT log full prompts, credentials, or sensitive headers

### Requirement: Production Readiness Matrix
Second phase completion MUST include a production readiness matrix.

#### Scenario: Matrix distinguishes evidence levels
- **WHEN** the second phase is reported
- **THEN** the report MUST include capability, current status, evidence, remaining risk before production, and required action
- **AND** every capability MUST be marked as LiveVerified, MockVerified, NotVerified, Blocked, or NeedsWork
