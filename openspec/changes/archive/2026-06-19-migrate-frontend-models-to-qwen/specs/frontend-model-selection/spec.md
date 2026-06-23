## ADDED Requirements

### Requirement: Qwen Model Options
Frontend MUST expose Qwen/Bailian model IDs in the model selector and MUST NOT expose Gemini model IDs as selectable runtime model options.

#### Scenario: Qwen models are selectable
- **WHEN** a user opens the model selector
- **THEN** the visible model options MUST correspond to Qwen/Bailian model IDs
- **AND** Gemini model IDs MUST NOT be valid selectable model IDs

#### Scenario: Unknown model id is rejected
- **WHEN** frontend receives an unknown model id from the model selector
- **THEN** frontend MUST reject it through centralized model validation
- **AND** the selected model state MUST remain unchanged

### Requirement: Qwen Default Model
Frontend MUST use a Qwen/Bailian text model as the default model for new submissions.

#### Scenario: New conversation starts with Qwen default
- **WHEN** the input form initializes for a new conversation
- **THEN** the selected model MUST be the configured Qwen default
- **AND** submitting Deep Research MUST send that model through the existing `reasoning_model` field

### Requirement: Frontend Credential Safety
Frontend MUST NOT store Qwen/Bailian provider credentials or call Qwen/Bailian provider endpoints directly.

#### Scenario: Frontend submits through existing runtime path
- **WHEN** the user submits a prompt with a selected Qwen model
- **THEN** frontend MUST continue submitting through the existing BFF/LangGraph runtime path
- **AND** frontend MUST NOT include Qwen API keys, authorization headers, or provider credentials in browser-exposed configuration

### Requirement: Request Shape Compatibility
Frontend MUST preserve the existing model submission shape while changing only the allowed model values.

#### Scenario: Deep Research request uses existing field
- **WHEN** a Deep Research request is submitted
- **THEN** frontend MUST continue sending the selected model as the existing `reasoning_model` string
- **AND** no frontend/bff public API route or payload shape MUST change

#### Scenario: Cancel remains independent of model selection
- **WHEN** a user cancels an in-flight request
- **THEN** cancellation behavior MUST remain unchanged
- **AND** model selection MUST NOT cause a terminal cancelled state to resume running
