# backend-query-workflow Specification

## Purpose
Define the backend query workflow contracts for LangGraph state safety, workflow invariants, tool validation, structured output fallback, runtime events, stable error handling, and regression coverage.

## Requirements

### Requirement: LangGraph State MUST Be Serializable And Checkpoint-Safe
Backend query workflow LangGraph state MUST remain serializable and safe for checkpoint resume.

#### Scenario: State fields use JSON-safe values
- **WHEN** Backend defines query workflow state annotations
- **THEN** state fields MUST use JSON-safe values or LangGraph-serializable message values
- **AND** state fields MUST NOT store functions, sockets, streams, AbortControllers, provider clients, credentials, or raw response objects

#### Scenario: Optional fields are safe for older checkpoints
- **GIVEN** a checkpoint does not contain an optional query workflow field
- **WHEN** Backend resumes the graph
- **THEN** the graph MUST rely on annotation defaults or explicit undefined-safe handling
- **AND** resume MUST NOT fail because the optional field is absent

#### Scenario: Resume behavior remains deterministic
- **GIVEN** Backend resumes from a checkpoint
- **WHEN** a query workflow node reads state
- **THEN** the node MUST treat state as serialized data
- **AND** the node MUST NOT depend on live handles from a previous process

### Requirement: Query Workflow MUST Define Explicit Invariants
Backend query workflow MUST define lifecycle, terminal state, and error convergence invariants before future workflow changes are accepted.

#### Scenario: Query workflow lifecycle is explicit
- **WHEN** Backend documents the query workflow
- **THEN** the lifecycle MUST describe planning, execution, synthesis, and terminal completion
- **AND** graph routes MUST remain stable machine identifiers owned by backend code

#### Scenario: Terminal state does not return to progress
- **GIVEN** a query workflow has reached a terminal response
- **WHEN** late progress, tool, finish, or error data arrives
- **THEN** the workflow MUST NOT move back to running or executing
- **AND** late data MUST be ignored or converged idempotently

#### Scenario: Error path converges to terminal output
- **GIVEN** tool execution, model invocation, or structured output parsing fails
- **WHEN** Backend handles the failure
- **THEN** the workflow MUST converge to terminal output with a safe error code and safe message
- **AND** the workflow MUST NOT expose stack traces, credentials, or raw sensitive provider bodies

#### Scenario: Cancel path converges to terminal output
- **GIVEN** a query workflow is running or executing
- **WHEN** cancellation is observed
- **THEN** the workflow MUST converge to a terminal cancelled response
- **AND** cancellation MUST NOT leave the workflow in a running state

#### Scenario: Invariants are updated before workflow changes
- **WHEN** a future change modifies query routing, answer mode, tool execution, or synthesis behavior
- **THEN** the change MUST update the query workflow invariant documentation first
- **AND** owner review MUST confirm the invariant remains coherent

### Requirement: Tool Input And Output MUST Use Runtime Validation
Backend query workflow tools MUST validate input at runtime and handle output parsing safely.

#### Scenario: Tool input is invalid
- **GIVEN** a planner or model provides invalid tool input
- **WHEN** Backend invokes the tool through the governed tool boundary
- **THEN** Backend MUST return a safe validation error
- **AND** Backend MUST NOT expose raw provider errors, stack traces, credentials, or unchecked tool input

#### Scenario: Tool output does not match expected structure
- **GIVEN** a tool returns content that cannot be parsed as the expected structured result
- **WHEN** Backend consumes the output
- **THEN** Backend MUST fall back to a safe generic error or raw-content-safe path
- **AND** parse failure MUST NOT crash the workflow

#### Scenario: Tool output contains unsafe content
- **GIVEN** tool output contains HTML, script text, prompt-like instructions, or other untrusted content
- **WHEN** Backend passes the output to synthesis or frontend-facing contracts
- **THEN** Backend MUST treat the output as untrusted data
- **AND** Backend MUST NOT execute or render it as trusted instructions or markup

### Requirement: Structured Output Validation MUST Have A Three-Level Failure Path
Backend structured output validation MUST use parse, coercion or repair, and deterministic fallback paths.

#### Scenario: JSON parse fails
- **GIVEN** the model returns content that cannot be parsed as the required JSON object
- **WHEN** Backend parses the structured output
- **THEN** Backend MUST record a parse failure diagnostic
- **AND** Backend MUST continue through retry or fallback without exposing raw parser exceptions as public contract fields

#### Scenario: Parsed JSON fails schema expectations
- **GIVEN** JSON parses but does not satisfy the expected domain shape
- **WHEN** Backend coerces the structured output
- **THEN** Backend MUST coerce only known safe fields
- **AND** Backend MUST reject or ignore unsupported fields rather than trusting model output

#### Scenario: Deterministic fallback is used
- **GIVEN** parse, retry, or coercion cannot produce a valid workflow plan
- **WHEN** Backend continues the workflow
- **THEN** Backend MUST use a deterministic fallback plan or clarification
- **AND** the workflow MUST NOT remain in a running state

### Requirement: Runtime Events MUST Pass Schema Validation
Backend runtime events MUST use the `AgentRuntimeEvent` union and deterministic timestamp assignment.

#### Scenario: Runtime event uses a known variant
- **GIVEN** Backend emits a runtime event
- **WHEN** the event is created
- **THEN** the event MUST conform to the backend `AgentRuntimeEvent` union
- **AND** each variant MUST have a stable `type` discriminator

#### Scenario: Unknown event variant is supported
- **GIVEN** a future backend event type is not known to older consumers
- **WHEN** Backend needs to carry that event through the runtime contract
- **THEN** Backend MUST support an `agent.unknown` variant
- **AND** frontend event parsing MUST remain forward compatible

#### Scenario: Event timestamp is deterministic under test
- **WHEN** Backend creates a runtime event
- **THEN** the `ts` field MUST be assigned from a deterministic timestamp source such as `Date.now()`
- **AND** tests MUST be able to mock that timestamp source

### Requirement: Tool Result Status And Error Codes MUST Be Stable
Backend tool result and error contracts MUST use stable machine identifiers.

#### Scenario: Tool result uses discriminated status
- **GIVEN** a tool returns a structured result
- **WHEN** Backend or frontend consumes it
- **THEN** `status` MUST be a stable discriminator such as `success`, `needs_clarification`, `not_found`, or `error`
- **AND** unknown statuses MUST use a safe fallback path

#### Scenario: Error code comes from structured sources
- **WHEN** Backend reports a tool or provider error
- **THEN** the public error code MUST come from structured status, error name, or allowlisted cause code
- **AND** regex or natural-language message matching MUST NOT determine the public error code

#### Scenario: Unknown error code remains compatible
- **GIVEN** Backend receives an unknown error code
- **WHEN** the error is exposed across BFF or frontend contracts
- **THEN** consumers MUST be able to classify it as a safe generic error
- **AND** Backend MUST preserve diagnostic details only as safe telemetry

### Requirement: Query Workflow MUST Have Regression Test Matrix
Backend query workflow changes MUST be covered by reproducible tests.

#### Scenario: Success path has regression coverage
- **WHEN** the backend test suite runs
- **THEN** it MUST include deterministic coverage for the query workflow success path
- **AND** tests MUST not require live provider calls

#### Scenario: Error path has regression coverage
- **WHEN** the backend test suite runs
- **THEN** it MUST cover structured output parse failure, fallback behavior, and provider or tool error handling
- **AND** errors MUST converge to safe terminal behavior

#### Scenario: Timeout or cancel path has regression coverage
- **WHEN** the backend test suite runs
- **THEN** it MUST cover timeout or cancellation-sensitive behavior where applicable
- **AND** terminal behavior MUST not return to running

#### Scenario: Unknown event or status has regression coverage
- **WHEN** the backend test suite runs
- **THEN** it MUST cover unknown runtime event or unknown status fallback
- **AND** unknown values MUST not crash consumers
