# runtime-env-defaults Specification

## Purpose
TBD - created by archiving change default-runtime-env-to-qwen. Update Purpose after archive.
## Requirements
### Requirement: Qwen Default Runtime Environment
Backend deployment examples MUST default the model runtime provider to Qwen/Bailian while keeping provider credentials out of version-controlled files.

#### Scenario: Backend env example defaults to Qwen
- **WHEN** a developer reads the backend environment example
- **THEN** the default provider MUST be Qwen
- **AND** Qwen base URL and purpose-specific model variables MUST be present
- **AND** any Qwen credential placeholder MUST be empty or clearly non-secret

#### Scenario: Existing non-Qwen aliases remain documented
- **WHEN** an operator needs a non-Qwen provider during transition
- **THEN** existing non-Qwen alias names MAY remain documented as optional compatibility settings
- **AND** they MUST NOT make Gemini the default provider in the example

### Requirement: Compose Qwen Passthrough
Compose deployment configuration MUST pass Qwen runtime variables into the backend service and MUST NOT pass Gemini API credentials by default.

#### Scenario: Compose config exposes Qwen runtime variables
- **WHEN** the compose backend service starts
- **THEN** it MUST receive `LLM_PROVIDER=qwen` by default
- **AND** it MUST receive Qwen base URL and purpose-specific model variables
- **AND** it MUST receive `QWEN_API_KEY` only from the operator environment

#### Scenario: Compose config does not expose Gemini credential
- **WHEN** the compose configuration is reviewed
- **THEN** `GEMINI_API_KEY` MUST NOT be present in the backend service environment
- **AND** Gemini fallback removal MUST remain out of scope for this change

### Requirement: Browser Credential Isolation
Qwen/Bailian provider settings MUST remain backend-only and MUST NOT be added to browser-exposed frontend environment variables.

#### Scenario: Frontend env example remains credential-free
- **WHEN** frontend environment examples are reviewed
- **THEN** they MUST NOT include `QWEN_API_KEY`
- **AND** they MUST NOT include provider Authorization headers or model provider credentials

