## ADDED Requirements

### Requirement: Qwen Provider Selection
Backend Runtime MUST support `LLM_PROVIDER=qwen` as a first-class provider and MUST report provider diagnostics as `qwen` when selected.

#### Scenario: Explicit Qwen provider is selected
- **GIVEN** runtime configuration contains `LLM_PROVIDER=qwen`
- **WHEN** Backend creates an LLM gateway
- **THEN** the selected provider MUST be `qwen`
- **AND** diagnostics MUST identify the endpoint kind as OpenAI-compatible Chat Completions
- **AND** missing `GEMINI_API_KEY` MUST NOT prevent Qwen gateway creation

#### Scenario: Existing providers remain selectable
- **GIVEN** runtime configuration selects `gemini`, `ccr`, or `openai-compatible`
- **WHEN** Backend creates an LLM gateway
- **THEN** the selected provider MUST preserve the existing provider semantics
- **AND** Qwen environment variables MUST NOT override the explicit non-Qwen provider

### Requirement: Qwen Environment Variables
Backend Runtime MUST support Qwen-specific environment variables for base URL, API key, and purpose-specific models while preserving existing aliases.

#### Scenario: Qwen environment variables configure the request
- **GIVEN** `LLM_PROVIDER=qwen`
- **AND** `QWEN_BASE_URL`, `QWEN_API_KEY`, and `QWEN_CHAT_MODEL` are configured
- **WHEN** Backend invokes a chat model for chat purpose
- **THEN** the request MUST use the configured Qwen base URL
- **AND** the request MUST use the configured Qwen model
- **AND** the request MUST send the API key only as an authorization credential

#### Scenario: Existing aliases remain compatible
- **GIVEN** Backend is configured with `OPENAI_COMPATIBLE_*`, `OPENAI_*`, or `CCR_*` aliases
- **WHEN** Backend selects the corresponding existing provider
- **THEN** the aliases MUST continue to configure base URL, API key, provider, and model as before

### Requirement: OpenAI-Compatible Chat Completions
Qwen Runtime MUST use the OpenAI-compatible Chat Completions request and response contract.

#### Scenario: Chat Completions endpoint is built correctly
- **GIVEN** a Qwen or OpenAI-compatible base URL ending with or without a slash
- **WHEN** Backend invokes the provider
- **THEN** the final endpoint MUST be exactly one `/chat/completions` suffix after the compatible API base path

#### Scenario: Text response is parsed
- **GIVEN** the provider returns a successful Chat Completions response with `choices[0].message.content`
- **WHEN** Backend parses the response
- **THEN** Backend MUST return a LangChain AI message containing the provider content
- **AND** Backend MUST preserve available model, finish reason, usage, and response metadata

### Requirement: Capability-Aware Model Resolution
Backend Runtime MUST resolve models by provider and model purpose without relying on model-name substring checks to change domain behavior.

#### Scenario: Qwen purpose-specific model is resolved
- **GIVEN** `LLM_PROVIDER=qwen`
- **AND** purpose-specific Qwen model variables are configured
- **WHEN** Backend creates models for chat, math, research, vision, or tool purposes
- **THEN** each model MUST use the matching Qwen purpose-specific variable
- **AND** configured legacy model overrides MUST remain backward compatible

#### Scenario: Gemini fallback remains available
- **GIVEN** no explicit non-Gemini provider is configured
- **WHEN** Backend creates the default gateway
- **THEN** Backend MUST keep Gemini as the fallback provider
- **AND** the Gemini SDK dependency MUST remain usable

### Requirement: JSON Mode Response Format
Backend Runtime MUST support JSON-only model calls through Chat Completions `response_format`.

#### Scenario: Planner uses JSON object response format
- **GIVEN** a planner, weather extraction, or repair call requires JSON-only output
- **WHEN** Backend invokes a Qwen-capable Chat Completions model
- **THEN** the request body MUST include `response_format: { "type": "json_object" }`
- **AND** the returned JSON MUST still pass Runtime Validation before use

#### Scenario: Invalid JSON is reported safely
- **GIVEN** the provider returns malformed JSON where JSON is required
- **WHEN** Backend parses the provider response
- **THEN** Backend MUST return or throw a structured parse error
- **AND** the error details MUST NOT include API keys, authorization headers, or full sensitive response bodies

### Requirement: Vision Model Routing
Backend Runtime MUST route image analysis requests to a vision-capable model and preserve existing image safety constraints.

#### Scenario: Qwen vision model receives image content parts
- **GIVEN** a validated user message contains `image_url` content parts, including data URLs
- **AND** `LLM_PROVIDER=qwen`
- **WHEN** Backend performs image analysis
- **THEN** Backend MUST use the Qwen vision model for vision purpose
- **AND** the Chat Completions request MUST preserve supported text and image content parts

#### Scenario: Vision is unsupported
- **GIVEN** the selected provider or model purpose does not support vision
- **WHEN** Backend receives an image analysis request
- **THEN** Backend MUST return a structured provider capability error or explicit degradation
- **AND** Backend MUST NOT silently report success

### Requirement: Tool Calling and bindTools
Qwen Runtime MUST support LangChain-style `bindTools` over OpenAI-compatible Chat Completions.

#### Scenario: Tools are sent to provider
- **GIVEN** Backend binds structured tools to a Qwen-capable model
- **WHEN** the model is invoked
- **THEN** the request body MUST include OpenAI-compatible `tools`
- **AND** each tool MUST be represented as a function with name, description, and JSON Schema parameters
- **AND** `tool_choice` MUST default to `auto` unless a compatible option overrides it

#### Scenario: Provider tool calls become LangChain tool calls
- **GIVEN** the provider returns `choices[0].message.tool_calls`
- **WHEN** Backend parses the response
- **THEN** Backend MUST create a LangChain AI message with `tool_calls`
- **AND** each tool call MUST preserve id, name, parsed args, and `type: "tool_call"`

### Requirement: ToolMessage Round Trip
Backend Runtime MUST preserve tool call ids and tool result messages across model turns.

#### Scenario: Tool result is sent to next model turn
- **GIVEN** a model emits a tool call
- **AND** Backend executes the tool and receives a ToolMessage
- **WHEN** Backend sends the next request to Qwen Chat Completions
- **THEN** the previous assistant tool call id MUST be preserved
- **AND** the ToolMessage MUST be serialized with the matching `tool_call_id`
- **AND** the model MUST be able to emit a final assistant answer after receiving the tool result

### Requirement: MCP Agent Remains Backend-Executed
MCP Agent MUST continue to execute MCP through Backend MCP Client, ToolRegistry, ToolNode, and model `bindTools`; it MUST NOT delegate MCP execution to Bailian-hosted Responses API tools.

#### Scenario: MCP Agent works with Qwen provider
- **GIVEN** Backend loads local or MCP tools through ToolRegistry
- **AND** `LLM_PROVIDER=qwen`
- **WHEN** MCP Agent binds tools and invokes the model
- **THEN** it MUST NOT fail because the selected model lacks `bindTools`
- **AND** ToolNode MUST remain responsible for executing tool calls

#### Scenario: MCP tool governance remains active
- **GIVEN** MCP tools are loaded
- **WHEN** Backend exposes them to the model through `bindTools`
- **THEN** existing Backend tool governance, allowlist, audit, and tool execution boundaries MUST remain in effect

### Requirement: Provider-Specific Error Mapping
Backend Runtime MUST map provider failures to structured error codes without relying on natural-language text matching as the primary classifier.

#### Scenario: HTTP provider errors are categorized
- **GIVEN** Qwen or OpenAI-compatible provider returns HTTP 401, 403, 429, 400, or 5xx
- **WHEN** Backend creates an error envelope
- **THEN** the error code MUST distinguish auth, quota/rate limit, bad request, and provider server error categories
- **AND** provider metadata MUST identify the selected provider

#### Scenario: Network, timeout, abort, and parse errors are categorized
- **GIVEN** provider invocation fails due to network error, timeout/abort, or invalid JSON
- **WHEN** Backend creates an error envelope
- **THEN** the error code MUST distinguish network, timeout, and provider response parse errors
- **AND** error details MUST NOT leak credentials

### Requirement: Usage and Model Metadata Normalization
Backend Runtime MUST normalize available provider usage and model metadata while tolerating unknown provider fields.

#### Scenario: Usage metadata is available
- **GIVEN** the provider returns usage and model metadata
- **WHEN** Backend creates the AI message
- **THEN** token usage MUST be exposed through LangChain-compatible usage metadata when possible
- **AND** provider model, finish reason, endpoint kind, and response id MUST be preserved in response metadata when available

#### Scenario: Usage metadata is missing
- **GIVEN** the provider response omits usage metadata
- **WHEN** Backend creates the AI message
- **THEN** the message MUST still be usable
- **AND** missing usage fields MUST NOT be treated as provider failure

### Requirement: Credential Safety
Backend Runtime and OpenSpec artifacts MUST NOT contain real API keys, tokens, or credentials.

#### Scenario: Credential is configured by environment
- **GIVEN** Qwen or other provider credentials are needed
- **WHEN** Backend runtime starts
- **THEN** credentials MUST be read from environment or provider auth flow
- **AND** repository files, tests, OpenSpec, and example files MUST NOT contain real credentials

#### Scenario: Credential appears in provider failure
- **GIVEN** a provider failure includes credential-shaped data in a response or thrown error
- **WHEN** Backend reports diagnostics
- **THEN** diagnostics MUST redact or omit credential-shaped data

### Requirement: Live Smoke Verification Is Explicit
Backend Runtime MUST distinguish automated mock verification from live Qwen／Bailian smoke verification.

#### Scenario: Live smoke is not run
- **GIVEN** no real `QWEN_API_KEY` or approved live test is available
- **WHEN** the change is reported
- **THEN** the report MUST state that live Qwen／Bailian smoke was not verified
- **AND** mock tests MUST NOT be described as live production validation
