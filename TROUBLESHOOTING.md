# Troubleshooting

Run `bun runtime/cli.ts doctor --home <profile>` and inspect the desktop Activity page. Keep the original request body, idempotency key and response ID. Do not delete ownership records, repeat a task under a new key, or reload the page to repair an unknown result.

## API request rejected

`idempotency_key_required` means the POST lacks its request key. Give each new logical request a unique `Idempotency-Key`; retry the same logical request with its original key and body.

`idempotency_conflict` means that key was already used for different content. Recover the original request rather than guessing that it was never sent. Only `stream` can change on a retry; see the normalization rules in [the protocol](docs/protocol.md).

`invalid_request` usually means a field is not part of this API. Read `GET /v1/schema`. Codex metadata, provider-native model names, `reasoning` overrides, and full-history compatibility fields are not accepted. A continuation supplies only `previous_response_id`, `input`, and optionally `stream`.

`previous_response_pending` means the previous request has not returned a committed tool-call batch or final answer. Observe it through its original POST/key or `GET /v1/responses/{id}` first.

`previous_response_consumed` means another request already continues this response. Retry that successor with its own original key. Creating a second successor is not a retry or a branch operation.

`previous_response_not_found` means the ID is absent from this profile's new-protocol request records. Verify the profile and API version. Old compatible-provider IDs are not converted during migration.

`previous_response_unavailable` means the original page, document, final answer or ownership changed. Inspect that page. The application will not create a replacement conversation. A new root is a separate caller decision and requires explicit context.

`message_too_large` rejects the whole prompt before admission. Shorten the input or stage it through explicit requests. The application does not split, summarize, truncate or silently omit content. Token budgets are local estimates, not provider context-window measurements.

## Tools do not run

Use `full` mode, restart the service after configuration changes, and connect **ChatGPT Web Tools**. The connector has only `web_tool_list` and `web_tool_call`. Every call must carry the current turn capability, and requested tool names must match the caller's root declarations exactly.

The service does not execute a shell tool by itself. The caller receives `requires_action`, applies its own permissions, and returns the complete result batch. `tool_results_required` rejects a new message while calls are pending. `tool_results_mismatch` rejects partial, duplicate, foreign or incorrectly typed call IDs. Function and custom results use distinct item types.

An MCP `content` result is an explicit object containing supported text/image blocks. Strings are always plain text, even when they look like JSON. No Codex gateway or namespace lookup is available.

## Observation interrupted or transport disconnected

A disconnected JSON/SSE subscriber does not stop the page. Repeat the same request/key or retrieve its resource to observe the retained result. Streaming text snapshots are provisional; only the terminal response is a committed answer or tool-call batch.

An observation failure pauses reads and records a fault. Inspect the original page, then call `POST /v1/responses/{id}/resume` with `{}`. This only reattaches observation. It cannot repair a missing document or authorize a new Send.

When a tool completed while the page could not be observed, the service requires explicit confirmation before accepting its current answer. Only after reviewing the actual page and tool results, call resume with `{"confirm":true}`. Do not automate that confirmation as a generic retry handler.

To stop the owning webpage turn, call `POST /v1/responses/{id}/cancel` with `{}` or use the desktop's explicit cancel action. Earlier committed response resources remain immutable after this action. Its acknowledgement means the Stop request was handled locally, not that remote execution is proved to have stopped.

## Upgrade or ownership failure

Stop the old runtime before running `bun runtime/cli.ts migrate --home <profile>`. Migration takes exclusive ownership, preserves the database and browser data, and saves changed old configuration in `application.json.before-v7`. Removed native/advisor settings otherwise fail configuration validation rather than being silently used.

Historical operations remain available for inspection and explicit cancellation. They do not become new-protocol requests, and their old response IDs cannot be continued. Establish a new root with caller-supplied context when ready.

An unresolved older submission journal may deliberately block new sends. Inspect and resolve its exact ownership mapping with the migration command rather than deleting the journal. A stale or uncertain effect is not evidence that no message was submitted.

## Browser and platform evidence

The fixture suite runs actual Electron and the production browser adapter against a local page. It validates the boundary implementation without consuming account quota. It does not certify the current DOM, account entitlements, connector availability or remote execution behavior of a logged-in ChatGPT account.

Changed or ambiguous model controls fail instead of selecting a fallback effort. Collect a minimal, sanitized reproduction before changing selectors. Report the application version, caller/API version, OS, selected effort, mode and error category. Never upload cookies, tokens, raw task/tool text, `application.sqlite`, browser profiles or ownership capabilities.
