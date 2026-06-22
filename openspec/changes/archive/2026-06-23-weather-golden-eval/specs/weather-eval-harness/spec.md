## ADDED Requirements

### Requirement: Weather Eval Harness MUST Support Deterministic, Mock Integration, And Opt-In Live Smoke Modes

The weather eval harness MUST execute the matrix in separate modes so deterministic and mock coverage can run by default while live provider checks remain opt-in.

#### Scenario: Deterministic mode runs without external providers
- **WHEN** deterministic mode is executed
- **THEN** it MUST run without network access, live model calls, or live weather provider calls
- **AND** it MUST be suitable for the default backend test suite

#### Scenario: Mock integration mode uses controlled fixtures
- **WHEN** mock integration mode is executed
- **THEN** it MUST use controlled provider and model fixtures
- **AND** it MUST exercise Planner, resolver, tool, and terminal outcome boundaries where applicable

#### Scenario: Live smoke mode is opt-in
- **WHEN** live smoke is not explicitly enabled
- **THEN** live provider and live model cases MUST be skipped
- **AND** default CI MUST NOT depend on external provider availability

### Requirement: Weather Eval Harness MUST Produce A Reusable Baseline Report

The harness MUST produce a report that future weather phases can use for regression comparison.

#### Scenario: Report includes observed and expected summaries
- **WHEN** the harness completes
- **THEN** the report MUST include each case id, mode, expected outcome summary, observed outcome summary, and result classification
- **AND** the report MUST identify known gaps separately from unexpected failures

#### Scenario: Report is stable enough for comparison
- **WHEN** the same deterministic or mock inputs are executed repeatedly
- **THEN** stable cases SHOULD produce comparable report output
- **AND** nondeterministic details such as wall-clock timestamps MUST NOT be required for pass/fail comparison

#### Scenario: Report avoids sensitive data
- **WHEN** the report is generated
- **THEN** it MUST NOT include API keys, authorization headers, credentials, full prompts, raw provider bodies, or unbounded tool outputs
- **AND** diagnostic details MUST be structured and size-limited

### Requirement: Weather Eval Harness MUST Simulate Failure, Timeout, And Cancellation

The harness MUST provide controlled ways to exercise provider errors, malformed outputs, timeouts, and cancellation semantics.

#### Scenario: Provider error simulation
- **WHEN** a provider-error fixture is executed
- **THEN** the observed outcome MUST preserve provider-error semantics
- **AND** the harness MUST NOT coerce it into not-found

#### Scenario: Timeout simulation
- **WHEN** a timeout fixture is executed
- **THEN** the observed outcome MUST preserve timeout semantics
- **AND** the final state MUST not return to running

#### Scenario: Cancellation simulation
- **WHEN** a cancellation fixture is executed
- **THEN** the observed outcome MUST preserve cancellation semantics
- **AND** cancellation MUST be distinguishable from timeout and generic provider error

#### Scenario: Malformed Planner output simulation
- **WHEN** malformed structured output is supplied by a fixture
- **THEN** the harness MUST observe the runtime validation or fallback path
- **AND** the result MUST converge to a structured failure or clarification outcome

### Requirement: Weather Eval Harness MUST Keep Fixtures Out Of Runtime Resolution

Fixture data used by the harness MUST remain test-only and MUST NOT become a production resolver or Planner fallback.

#### Scenario: Fixtures are isolated from runtime behavior
- **WHEN** runtime weather code is reviewed
- **THEN** eval fixture data MUST NOT be imported as production city mapping, keyword mapping, phrase stripping, or resolver allowlist
- **AND** provider-backed resolver behavior MUST remain the geographic authority

#### Scenario: Fixture city examples do not authorize hardcoding
- **WHEN** a fixture contains a stable city example
- **THEN** that example MUST be used only for test input or mock provider output
- **AND** it MUST NOT be used to special-case the runtime query path

### Requirement: Weather Eval Harness MUST Be Reusable By Future Weather Phases

The harness MUST allow future phases to add forecast and clarification assertions without rewriting the Phase 1 matrix contract.

#### Scenario: Forecast phase extends existing cases
- **WHEN** a future forecast capability is added
- **THEN** forecast-like known-gap cases MUST be convertible into passing forecast assertions
- **AND** current-observation cases MUST remain available for regression

#### Scenario: Clarification phase extends existing cases
- **WHEN** a future clarification workflow is added
- **THEN** ambiguous-location known-gap cases MUST be convertible into passing multi-turn assertions
- **AND** missing-location and provider-error cases MUST remain distinct

#### Scenario: Unknown future observed fields are tolerated
- **WHEN** future phases add extra observed outcome fields
- **THEN** the harness MUST continue comparing Phase 1 required fields
- **AND** it MUST not fail solely because additional structured fields are present
