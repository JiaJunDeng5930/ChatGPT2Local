# Keep browser executions under explicit lifecycle control

Status: Accepted

Date: 2026-09-25

## Context

Browser error text, page controls, heartbeat silence, stale connector menus, observation faults, and
instruction changes do not reliably show that the user no longer needs the page or its in-flight
MCP work. Treating those signals as lifecycle commands can interrupt work the user is still
watching, revoke a capability while a call is pending, or start duplicate browser work.

Codex rejects `request_max_retries` and `stream_max_retries` overrides for the built-in OpenAI
provider (`Built-in providers cannot be overridden`). Native transport retries therefore remain
outside this project's control, and the adapter must recognize a repeated request as the same
execution rather than claiming to disable the retry.

The retained-source compaction handoff also conflicted with explicit lifecycle control: completing
the handoff required cancelling the source execution and revoking its MCP capability, even when the
user still needed that page or its pending tool work. Compaction therefore needs an independent
execution rather than taking over the source execution.

## Decision

Explicit user page close/stop, cancellation, and application shutdown are the destructive controls
for unfinished browser work and its retained capabilities. Normal completion releases execution
capacity without closing the page or its CDP connection. A page error marker is passive observation
data: it cannot be reported as a successful answer, and observation continues so the user can handle
the page and let it complete. Other observation exceptions are recorded; a failed observation
operation is not retried, but it does not abort, reload, resend, rebind, disconnect, evict, or revoke
the page, its CDP connection, MCP broker, or attached request. A request disconnect only detaches
its observer.

Normal completion returns the real result and releases running execution capacity while keeping the
page and CDP connection open. Active page ownership and MCP capabilities do not expire
automatically. There is no fixed browser-tab or concurrent-execution limit, and capacity pressure
does not evict pages. Repeated Native requests attach to or replay the original execution; a
deliberately new user-started Native turn has its own execution and does not cancel an earlier turn.
Ordinary Native execution identity is thread + turn + purpose and stays stable through in-turn
context, model-metadata, and tool-result changes. Compaction identity retains the full compaction
input; id-less fallback retains its existing full-request identity. Each distinct canonical
compaction input runs once through the existing fresh-compaction runtime path; an identical request
attaches to or replays that execution. Compaction leaves the ordinary source execution, page, CDP
connection, broker, and MCP capability on their normal lifecycle before, during, and after the
compaction. There is no handoff timeout, fallback attempt, or source cleanup. The existing pure
summary canonicalization and compaction response semantics remain in place.

## Consequences

Completed pages and unresolved error pages remain available for inspection until the user closes
them or shuts down the application. Page error markers continue to be observed and can be handled
manually; a separate observation-operation failure can leave the attached request waiting for
explicit user action. Native retries may still occur, but they do not create another browser
submission for the same execution. A deliberate retry must be a new user-started turn; the adapter
does not silently retry or replace failed work.
