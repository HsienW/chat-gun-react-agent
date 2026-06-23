## ADDED Requirements

### Requirement: Qwen Is The Default Runtime Provider
Backend model runtime MUST default to Qwen/Bailian when no explicit supported provider is configured.

#### Scenario: No provider is configured
- **WHEN** backend model runtime resolves the provider without `LLM_PROVIDER`
- **THEN** the selected provider MUST be `qwen`
- **AND** diagnostics MUST identify the endpoint kind as OpenAI-compatible Chat Completions

#### Scenario: Qwen provider remains selectable
- **GIVEN** runtime configuration contains `LLM_PROVIDER=qwen`
- **WHEN** backend creates an LLM gateway
- **THEN** the selected provider MUST be `qwen`
- **AND** missing `GEMINI_API_KEY` MUST NOT affect gateway creation

### Requirement: Gemini Runtime Provider Removed
Backend model runtime MUST NOT expose Gemini as a selectable provider and MUST NOT construct Gemini SDK chat models.

#### Scenario: Gemini provider is requested
- **GIVEN** runtime configuration contains `LLM_PROVIDER=gemini`
- **WHEN** backend resolves the LLM provider
- **THEN** backend MUST fail fast with an unsupported provider error
- **AND** backend MUST NOT fall back to Gemini

#### Scenario: Gemini dependency is absent
- **WHEN** backend dependencies are installed
- **THEN** `@langchain/google-genai` MUST NOT be present as a backend dependency
- **AND** backend runtime code MUST NOT import `@langchain/google-genai`

### Requirement: Existing Non-Gemini Providers Remain Available
Backend model runtime MUST preserve Qwen, CCR, and generic OpenAI-compatible provider behavior after Gemini removal.

#### Scenario: CCR provider remains selectable
- **GIVEN** runtime configuration contains `LLM_PROVIDER=ccr`
- **WHEN** backend creates an LLM gateway
- **THEN** the selected provider MUST be `ccr`
- **AND** the endpoint kind MUST remain Anthropic messages

#### Scenario: OpenAI-compatible provider remains selectable
- **GIVEN** runtime configuration contains `LLM_PROVIDER=openai-compatible`
- **WHEN** backend creates an LLM gateway
- **THEN** the selected provider MUST be `openai-compatible`
- **AND** the endpoint kind MUST remain OpenAI-compatible Chat Completions

### Requirement: No Gemini Runtime Code Path
Backend source runtime paths MUST NOT contain Gemini-specific provider code after the removal.

#### Scenario: Backend source is searched
- **WHEN** backend source files are searched for Gemini provider identifiers
- **THEN** no backend runtime source file MUST contain Gemini-specific imports, provider enum values, endpoint kinds, fallback models, or credential checks

### Requirement: Public API And MCP Compatibility
Gemini removal MUST NOT change frontend/bff public APIs, LangGraph Graph IDs, MCP execution architecture, or tool governance.

#### Scenario: Runtime provider is removed
- **WHEN** Gemini provider code is removed
- **THEN** existing Graph IDs MUST remain unchanged
- **AND** BFF routes and frontend request shape MUST remain unchanged
- **AND** MCP tools MUST still execute through backend ToolRegistry and ToolNode
