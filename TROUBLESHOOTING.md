# Troubleshooting

This guide matches the Bend-based runtime and desktop application in version 6. It deliberately avoids recovery steps that can create a second webpage submission.

## Start with read-only diagnostics

Run the application diagnostics before changing configuration or retrying a task:

```sh
bun runtime/cli.ts doctor
bun runtime/cli.ts status
```

`doctor` checks configuration, the local service, and browser reachability without sending, reloading, stopping, or retrying a webpage. `status` reports durable operation state. Keep `~/.codex-chatgpt-web/application.json`, `application.sqlite`, the desktop browser profile, turn capabilities, cookies, API keys, Tunnel IDs, prompts, and private tool output out of public bug reports.

## Models do not appear in Codex

Install the isolated model profile, then launch Codex with that profile:

```sh
bun run install-models
codex --profile web
```

The installer preserves unrelated Codex configuration. If Codex was already running, restart that Codex process so it reloads its model catalog. The configured ChatGPT account must expose the effort selected by the profile; an unsupported or ambiguous effort is rejected before webpage submission.

## ChatGPT sign-in is missing

Open the desktop application and use **Open ChatGPT / sign in**. Sign in inside the embedded browser. Version 6 keeps that browser identity in its own persistent desktop profile and does not import Chrome cookies.

If the page cannot be reached, run `doctor`. Do not delete the profile merely to force another task submission; browser identity and durable operation identity are separate concerns.

## A task becomes uncertain or observation fails

An observation failure does not prove that the webpage failed. The runtime therefore leaves the original page running and pauses that observer. It does not reload, regenerate, stop, allocate a replacement page, or resend the request.

Inspect the original page, then resume observation explicitly:

```sh
bun runtime/cli.ts resume OPERATION_ID
```

If a tool completed while the page could not be observed, inspect the current answer and explicitly attest that it is the completed answer before allowing completion detection to continue:

```sh
bun runtime/cli.ts resume OPERATION_ID --confirm
```

If the recorded original document no longer exists, resume fails. Creating a fresh page is not a recovery action for that operation.

## Cancel a task

Cancellation is an explicit user command:

```sh
bun runtime/cli.ts cancel OPERATION_ID
```

Only the recorded owned page may receive the Stop action. Transport disconnects, HTTP/SSE cancellation, process restart, DOM read failures, error-looking pages, and runtime recovery do not authorize cancellation.

## A repeated request appears after a disconnect

The same native turn identity or `Idempotency-Key` attaches to the durable operation. A physical send is claimed in SQLite before browser activation. If execution was claimed and its receipt was lost, the state remains unknown; the runtime does not issue another send.

Use `status` to inspect the existing operation. Do not change its identity to force a new request.

## Conversation history is not reused

A retained ChatGPT page is reusable only when its recorded page and document still match, the previous assistant answer is still the tail, the interpretation environment agrees, and the incoming transcript is a compatible extension of the recorded history. Edited, branched, shortened, manually extended, or missing pages are not treated as equivalent API history.

A new genuine operation may use a new page. An uncertain existing operation keeps ownership of its original page and is never replaced automatically.

## Full mode or Codex Native2 tools do not connect

Set `mode` to `full` in the private application configuration, restart the service explicitly, and connect the ChatGPT connector named by that configuration. If using the OpenAI tunnel client, configure and run it explicitly:

```sh
bun runtime/cli.ts tunnel-connect --key-file /private/path/to/key --tunnel-id TUNNEL_ID
bun runtime/cli.ts tunnel-run
```

The runtime does not restart the tunnel automatically. Native tools execute in the outer Codex runtime under its own approval and sandbox policy; the webpage bridge does not execute shell commands itself.

## Migration blocks new work

Run:

```sh
bun runtime/cli.ts migrate
```

Legacy ownership receipts continue to block duplicate sends. If migration reports an `unmapped:...` identity, inspect the original receipt and map it only when the exact native identity is known:

```sh
bun runtime/cli.ts migrate unmapped:JOURNAL_ID native:SHA256_ID
```

Deleting an unknown record to make the operation fresh defeats the at-most-once boundary and is not a supported recovery method.

## Development or packaged application failure

Run the fresh verification gate:

```sh
bun run verify
```

For a desktop delivery change, also build and smoke-test the actual platform directory package:

```sh
bun run app:package:dir
bun run app:smoke
```

`verify` checks the Bend proof closure, semantic mutations, TypeScript, SQLite/process/HTTP/MCP boundaries, a real local Electron fixture, a relocated standalone runtime bundle, and a fresh Bend build. Local fixtures do not certify the current live ChatGPT DOM, another operating system, Apple notarization, or a real account tier.

## Report a bug

Include the application version, Codex version, operating system, account tier, integration mode, exact selected model, minimal reproduction, complete final error, sanitized `doctor` output, and the relevant operation phase or fault code from `status`. State whether the same problem occurs in a fresh Codex task.

Do not attach the application database, browser profile, cookies, authorization headers, API keys, Tunnel IDs, turn capabilities, full prompts, or private native tool output. For execution-authority or capability-leakage issues, use the private security-reporting channel described in `SECURITY.md`.
