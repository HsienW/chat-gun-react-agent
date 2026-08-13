# Tool and MCP Security Configuration

<p>
  <a href="./tool-security-isolation.en.md">English</a> |
  <a href="./tool-security-isolation.md">繁體中文</a>
</p>

Native tools and MCP tools loaded through `backend/src/tools/registry.ts` are wrapped by `backend/src/platform/tool-governance.ts`. Tools imported directly by a graph do not receive this protection automatically. When adding an agent or tool, prefer the registry or provide equivalent restrictions at the call site. High-risk tools must still enforce their own input, network, and filesystem restrictions.

## Tool Allowlist and Denylist

When `TOOL_ALLOWLIST` is not empty, only the listed tools are loaded. `TOOL_DENYLIST` always takes precedence and blocks matching names.

```env
TOOL_ALLOWLIST=calculator_tool,web_search,web_fetch,current_weather,weather_forecast
TOOL_DENYLIST=web_fetch
```

Tools can also be disabled individually. Tool names are converted to uppercase and separated with underscores:

```env
TOOL_WEB_FETCH_ENABLED=false
```

## Execution Limits

Default settings:

```env
TOOL_AUDIT_ENABLED=true
TOOL_TIMEOUT_MS=15000
TOOL_MAX_INPUT_CHARS=8000
TOOL_MAX_OUTPUT_CHARS=24000
```

Each tool can override these values:

```env
TOOL_WEB_FETCH_TIMEOUT_MS=12000
TOOL_WEB_FETCH_MAX_INPUT_CHARS=4000
TOOL_WEB_FETCH_MAX_OUTPUT_CHARS=12000
```

A tool is not executed when its input exceeds the limit. Output exceeding the limit is truncated. Timeouts and caller cancellation are passed to the tool through an `AbortSignal`; the tool itself must support the signal to stop external I/O that has already started.

## Audit Logs and Metrics

The governance wrapper records the following audit events:

- `tool.load`
- `tool.invoke.start`
- `tool.invoke.success`
- `tool.invoke.failure`
- `tool.blocked`

Events contain the tool name, duration, and input and output lengths. Failure events also retain `Error.message`, but do not record the complete tool input. Tool implementations must not include credentials, complete third-party responses, or other sensitive data in error messages. Tool execution also emits metrics. When Opik is enabled, tool calls appear under the corresponding agent trace.

## `web_fetch`

`web_fetch` accepts only public HTTP or HTTPS URLs and applies the following restrictions:

- Rejects URLs containing embedded usernames or passwords.
- Allows only ports `80` and `443` by default.
- Rejects `localhost` and explicitly listed IPv4 and IPv6 ranges, including loopback, RFC 1918 private IPv4, IPv4 link-local, shared address space, benchmarking, IPv6 unique-local and link-local, and multicast ranges.
- Resolves all DNS results before fetching a domain and rejects the request if any result falls within a blocked range.
- Revalidates the URL, port, and DNS on every redirect, with a maximum of three redirects.
- Limits response bodies to 1,000,000 bytes.
- Applies a 12-second timeout to each fetch, in addition to the outer tool governance timeout.
- Returns at most 12,000 characters by default. A request may adjust this limit up to 30,000 characters.

Add any additional required ports explicitly to the allowlist:

```env
WEB_FETCH_ALLOWED_PORTS=80,443,8443
```

Allowing another port expands outbound access. Public deployments should still enforce an egress firewall or proxy at the network layer; application-level URL validation does not replace complete network isolation.

The backend supports `HTTPS_PROXY` and `HTTP_PROXY`. If a proxy URL contains credentials, logs redact the username and password.

## Filesystem MCP

MCP Servers are loaded only when `MCP_LOAD_ON_START=true`. Filesystem MCP access is constrained by both a single working directory and the allowed roots:

```env
MCP_LOAD_ON_START=true
MCP_FILESYSTEM_ENABLED=true
MCP_FILESYSTEM_PATH=/srv/chat-gun/workspace
MCP_FILESYSTEM_ALLOWED_ROOTS=/srv/chat-gun/workspace
```

`MCP_FILESYSTEM_PATH` must be located within at least one allowed root; otherwise, the Filesystem MCP Server is skipped. When allowed roots are not configured, access defaults to the backend process's current working directory.

Use the operating system's path delimiter for multiple roots:

```text
Windows: C:\safe-a;D:\safe-b
Linux/macOS: /srv/safe-a:/srv/safe-b
```

Do not configure the repository root, a user's home directory, or an entire drive as an allowed root. Create a dedicated directory and restrict the process's read and write permissions at the operating-system level.

## Brave Search MCP

```env
MCP_LOAD_ON_START=true
MCP_BRAVE_SEARCH_ENABLED=true
BRAVE_API_KEY=your_brave_api_key
```

`BRAVE_API_KEY` is provided only to the Brave Search MCP subprocess. The built-in `web_search` tool uses `TAVILY_API_KEY`; the two keys are not shared.

## Deployment Considerations

- MCP Servers run as stdio subprocesses. Allowed roots enforced in application code do not replace a container, OS account, or process sandbox.
- Do not add MCP Servers from unknown sources to a production image.
- Tool and MCP output is untrusted data and must not be treated directly as system instructions, HTML, or shell commands.
- Third-party tool output may contain personal data or credentials. Apply a field allowlist and redaction before sending it to logs, traces, or hosted observability services.
- Tool permissions must not be decided by the model alone. High-risk or side-effecting operations require authorization at a trusted API or service boundary.
