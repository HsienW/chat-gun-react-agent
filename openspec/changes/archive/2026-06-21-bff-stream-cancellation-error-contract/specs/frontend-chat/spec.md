## ADDED Requirements

### Requirement: Frontend chat MUST classify BFF stream error codes structurally

Frontend chat MUST map BFF stream error codes to local stream terminal kinds without parsing display text.

#### Scenario: BFF timeout code is received

- **WHEN** frontend receives an `ErrorEnvelope` with code `bff_timeout` or `upstream_timeout`
- **THEN** frontend MUST classify the stream failure as `timeout`
- **AND** timeout MUST remain an error terminal state rather than successful completion

#### Scenario: BFF client disconnect code is received

- **WHEN** frontend receives an `ErrorEnvelope` with code `client_disconnected`
- **THEN** frontend MUST classify it as an abort-like terminal signal
- **AND** reducer terminal idempotency MUST prevent cancelled or errored state from re-entering running

#### Scenario: BFF upstream stream error is received

- **WHEN** frontend receives an `ErrorEnvelope` or SSE error frame with code `upstream_stream_error`
- **THEN** frontend MUST classify it as `generic` stream error unless a more specific structured code exists
- **AND** frontend MUST display a safe user-facing error message

#### Scenario: Unknown BFF stream error code is received

- **WHEN** frontend receives an unknown BFF stream error code
- **THEN** frontend MUST safely degrade to generic stream error
- **AND** frontend MUST NOT parse natural-language message text to infer state

### Requirement: Frontend chat MUST handle trailing SSE error frame safely

Frontend chat MUST not crash or silently treat a trailing SSE `event: error` as normal success.

#### Scenario: SDK surfaces trailing SSE error through error callback

- **WHEN** the LangGraph SDK exposes the trailing SSE error frame via stream error callback
- **THEN** frontend MUST parse the structured `ErrorEnvelope`
- **AND** dispatch an error terminal transition

#### Scenario: SDK surfaces trailing SSE error through update callback

- **WHEN** the LangGraph SDK exposes the trailing SSE error frame as an update event
- **THEN** frontend MUST either convert it to a structured stream error or safely skip it without crashing
- **AND** it MUST NOT append malformed activity data that causes terminal state regression
