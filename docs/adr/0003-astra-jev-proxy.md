# Run Astra Jev as an independent local Responses proxy

Status: Superseded

Superseded by [ADR 0004](0004-astra-jev-internal-module.md). The independent listener, package,
CLI, and `~/.astra-jev` storage described below are no longer part of the architecture.

`gpt-6-astra` management needs a request path that can retain complete caller
history, ask Jev for an effort and lease decision, and still preserve the
native Responses HTTP/SSE stream. The existing web adapter and its state store
have different ownership and lifecycle rules, so adding this behavior to the
main application would make history, credentials, and request cancellation
cross those boundaries.

Run Astra Jev as a separate Bun service under `astra-jev/`. The service binds
to loopback port `17842` by default, owns `~/.astra-jev` (or
`ASTRA_JEV_HOME`), and uses the fixed `HistoryStore` and `JevClient` contracts.
Its POST `/v1/responses` route also accepts `/responses`; GET on either route
returns 426 to make the HTTP/SSE fallback explicit. The proxy validates the
managed model and full retained input before asking Jev, then forwards the
prepared JSON to a configurable standard Responses upstream while preserving
the upstream status, headers, and stream bytes. It removes only hop-by-hop and
invalidated content-length headers.

History identity is derived from the retained thread metadata, a session
header, or `prompt_cache_key`, and is namespaced by upstream and available
account ID. The `turn_id` is not an identity. The upstream bearer credential
is forwarded only to the configured Responses service, while Jev receives a
separate provider key from its own environment variables. No local Codex
credential/configuration files are read.

The service exposes read-only status/history APIs and a static UI. History
reads do not refresh retention. Request bodies and final output previews have
explicit bounds; the store retains only bounded message previews and overlay
metadata. Stream completion, upstream failure, parse failure, and client
cancellation all release the history session. A configurable upstream API
key can replace the incoming bearer credential without changing the caller's
JSON fields or top-level reasoning settings.

This keeps the service independently startable and reviewable while avoiding a
new dependency on the main application's lifecycle. The provider and lease
semantics were informed by [Astra Ares](https://github.com/miuuyy/Astra-Ares),
but this proxy has its own implementation and does not copy its prompts.

Consequences:

* Clients must send complete retained input on every managed request. The
  proxy returns HTTP 400 for `previous_response_id` and delta continuations.
* Only `gpt-6-astra` is advertised and managed; the service does not invent a
  local model alias.
* WebSocket transport is intentionally unavailable; native Codex clients
  need `wire_api = "responses"` and `supports_websockets = false`.
* The service has an independent 24-hour retention policy and requires a Jev
  provider key before it can make a managed decision.
