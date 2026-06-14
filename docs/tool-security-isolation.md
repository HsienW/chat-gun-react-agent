# Tool Security Isolation

## Scope Assessment

Tool isolation belongs at two layers:

1. Governance wrapper: every local and MCP tool should pass through the same policy gate before the agent can invoke it.
2. Tool-specific guardrails: high-risk tools still need native constraints because a generic wrapper cannot understand URL, filesystem, or process semantics.

Current high-risk areas:

- `backend/src/platform/tool-governance.ts`: central point for enablement, audit, timeout, and size limits.
- `backend/src/tools/web-fetch.ts`: outbound HTTP fetch, SSRF, redirect, and response-size risks.
- `backend/src/tools/mcp-loader.ts`: MCP stdio process launch and filesystem root exposure.
- `backend/src/tools/registry.ts`: common loading path used by agent graphs.

## Implemented Controls

- Global and per-tool enablement:
  - `TOOL_ALLOWLIST`
  - `TOOL_DENYLIST`
  - `TOOL_<TOOL_NAME>_ENABLED`

- Execution containment:
  - `TOOL_TIMEOUT_MS`
  - `TOOL_<TOOL_NAME>_TIMEOUT_MS`
  - `TOOL_MAX_INPUT_CHARS`
  - `TOOL_MAX_OUTPUT_CHARS`
  - per-tool input and output override variables

- Auditing and metrics:
  - `tool.invoke.start`
  - `tool.invoke.success`
  - `tool.invoke.failure`
  - `tool.blocked`
  - raw tool input is not logged by the governance wrapper

- `web_fetch` isolation:
  - only `http` and `https`
  - blocks embedded credentials
  - blocks localhost and private/reserved IP ranges
  - validates DNS results before fetch
  - validates redirect targets
  - limits redirects
  - limits response bytes
  - restricts ports through `WEB_FETCH_ALLOWED_PORTS`

- MCP filesystem isolation:
  - `MCP_FILESYSTEM_PATH` defaults to `process.cwd()`
  - `MCP_FILESYSTEM_ALLOWED_ROOTS` limits filesystem exposure
  - filesystem MCP server is skipped if the configured path is outside allowed roots

## Remaining Enterprise Gaps

- Hard process sandboxing for MCP stdio servers, such as container isolation, seccomp/AppArmor, or Windows Job Objects.
- Per-tenant/user tool policy and quotas.
- Approval workflow for destructive tools.
- Egress proxy with DNS pinning to reduce DNS rebinding risk after validation.
- Centralized audit sink, alerting, and anomaly detection.
- Secret redaction at the tool implementation layer for outputs returned by third-party MCP tools.
