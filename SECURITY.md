# Security boundaries

The application is a local, single-user bridge. Its state directory contains task text, tool results, turn capabilities, configuration, and browser login data. Keep it private and do not attach its database or profile to public issues. Diagnostics intentionally omit task content and capabilities.

The control interface and ChatGPT Web API bind to literal loopback addresses and require a local bearer token. Callers sharing a profile share its authorization and idempotency-key namespace; this is not a multi-tenant service. The browser-control host has a separate capability. The MCP transport uses persistent session identities; every operation-bearing tool call additionally requires the active turn capability. A tunnel must expose the stdio MCP adapter, not the dashboard or the entire local API.

The embedded webpage has no Node integration or preload bridge. The desktop shell's limited IPC is available only to the trusted shell main frame. Browser permissions are denied by default. Chromium's local debugging interface is powerful: other processes under the same OS user can potentially inspect it. This is not an isolation boundary against a compromised local account.

Tools are delegated to the caller's executor under its own approval and sandbox policy. The server accepts only the tools declared in the root request and validates result correlation before delivering a complete batch. It does not infer shell commands, load Codex credentials, forward requests to native-model providers, or disclose context to an advisor. Remote image URLs are rejected without fetching. Role labels inside the framed prompt do not create provider-side privileged messages.

The durable send claim provides at-most-once activation by this interpreter under the stated database and browser assumptions. It does not prove remote exactly-once execution, prevent an external browser extension from submitting, or make DOM observations infallible. Webpage uncertainty never authorizes automatic interruption, retry, regeneration, replacement-page submission, or quota-consuming fallback.

Report suspected capability leakage or execution-authority bugs privately to the repository maintainers. A useful report includes a minimal local reproduction, versions, and sanitized event categories—not cookies, bearer tokens, task contents, or private caller-tool outputs.
