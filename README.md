# ChatGPT Web

A local application for running tasks on retained ChatGPT webpages. Version 7 exposes **ChatGPT Web API v1**: callers explicitly choose a conversation with `previous_response_id`, send only new messages, and execute their own tools. The application keeps the original page and durable request receipts.

This is not an OpenAI-compatible model provider. It does not infer conversations from Codex metadata, forward native-model requests, or select reasoning effort through an advisor.

[中文说明](README.zh-CN.md) · [API contract](docs/protocol.md) · [Architecture](docs/rewrite.md) · [Verification](docs/verification.md) · [Troubleshooting](TROUBLESHOOTING.md)

## Run from source

Use the Bun version pinned in `package.json`. Install the pinned compiler and dependencies, then launch the desktop:

```sh
bun install --frozen-lockfile
(cd desktop && bun install --frozen-lockfile)
bun run bend:setup
bun run bend:build
bun run setup
bun run app
```

Open ChatGPT in the embedded browser and sign in there. The desktop owns a persistent browser profile. Its Setup screen starts the checked runtime; it does not edit a caller's model configuration. `bun run dev:app` uses an isolated worktree-specific profile for development.

For a separately managed Chromium/Electron instance, use `bun runtime/cli.ts serve --cdp http://127.0.0.1:9222`. The default API address is `http://127.0.0.1:8787`. Configuration and the local bearer token are stored in the private `application.json` under the selected `--home` directory.

## Call the API

Give each logical request a new `Idempotency-Key`. Retain that key and body for retries. Set `WEB_TOKEN` to the token in your own local configuration:

```sh
curl http://127.0.0.1:8787/v1/responses \
  -H "Authorization: Bearer $WEB_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: example-first-request' \
  -d '{"model":"chatgpt-web/medium","input":"Explain the design."}'
```

After a completed response, keep its `id` and supply only the next input:

```sh
curl http://127.0.0.1:8787/v1/responses \
  -H "Authorization: Bearer $WEB_TOKEN" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: example-second-request' \
  -d '{"previous_response_id":"<the first response ID>","input":"Now compare the alternatives.","stream":true}'
```

Continuation inherits the root model, instructions, tools and output format. Do not resubmit those settings or the old transcript. Each response has one successor. A new root explicitly starts a separate conversation. `bun runtime/cli.ts chat` provides a basic interactive client that maintains this response chain.

`GET /v1/schema` returns the shipped request and response JSON Schemas. See the [complete contract](docs/protocol.md) for tool rounds, error codes, limits, streaming and recovery.

## Caller tools and streaming

To use tools, enable `full` mode in the service configuration and connect **ChatGPT Web Tools** through the desktop's MCP setup. The connector exposes `web_tool_list` and `web_tool_call`. The caller declares its exact function/custom tool names and schemas in the root request, receives a `requires_action` response, executes the calls under its own permissions, and returns the complete result batch using that response's ID.

Tool-result requests continue the waiting connector invocation on the original page. They do not send another webpage message. The application has no built-in shell command translation, Codex tool inventory inference, or native-model execution path.

With `stream:true`, SSE returns provisional full-text snapshots while the webpage is generating, followed by a committed response. Snapshots replace the displayed provisional text; they are not append-only token deltas. Disconnecting a subscriber never cancels, reloads or resends the webpage task.

## Ownership and recovery

The application records request identity, predecessor consumption, page ownership and planned effects in SQLite before dispatch. Completed output and the receipt authorizing its continuation commit together. Concurrent successors cannot both claim the same predecessor.

A missing or changed original page causes an explicit error instead of a replacement-page submission. After a service restart, inspect the retained page and use the response's `/resume` action to reattach observation. `/cancel` is a separate, explicit request to stop the owning webpage turn. Keep the original idempotency key when retrying an unknown result.

## Upgrade from version 6

Stop the old service before migrating its existing profile:

```sh
bun runtime/cli.ts migrate --home <existing-profile>
```

Migration preserves browser data, journals and the database. It backs up changed configuration, removes native forwarding/advisor and automatic-history settings, and performs no browser sends. Update the ChatGPT connector to **ChatGPT Web Tools**. Old provider-compatible response IDs are not new-protocol predecessors; establish a new root with explicit context. Old operations remain inspectable and explicitly cancellable, but cannot resume under the new protocol.

The package name, default home name and desktop application identifier retain their historical values so the upgrade does not silently switch browser profiles. They do not imply Codex API compatibility.

## Development and verification

Pure execution and admission decisions live in `bend/`, with independent specifications and checked proofs. `runtime/` implements JSON, SQLite, browser, HTTP and MCP boundaries. Desktop code hosts the browser and the local control interface. [Architecture](docs/rewrite.md) records the production/proof correspondence and trusted boundaries.

```sh
bun run verify
```

This gate checks proofs, challenges real implementation mutations, compiles the native core, type-checks the runtime, exercises SQLite/HTTP/MCP and the actual Electron DOM against local fixtures, and builds and relocates a self-contained runtime. It does not send real-account ChatGPT messages. Platform packages can be built with `bun run app:package:dir` and checked with `bun run app:smoke`; a configured target is not a claim of tested packaging or signing.

ChatGPT account capabilities and its DOM remain external dependencies. The project does not promise availability, quota bypass, provider-exact token counts, or remote exactly-once execution. See [Security](SECURITY.md), [Contributing](CONTRIBUTING.md), and [upstream attribution](UPSTREAM.md).
