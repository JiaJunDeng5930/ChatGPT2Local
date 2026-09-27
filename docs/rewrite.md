# Bend application rewrite

This replaces the pre-migration implementation, rather than wrapping it. The
existing checked Bend definitions are reusable migration work; `src/`, the old
launcher, and their implementation-specific tests are not the new runtime.

## Requirements and ownership

| Observable behavior | Authority | External boundary |
| --- | --- | --- |
| An uncertain webpage is never stopped, reloaded, resubmitted, or discarded automatically | Bend turn and application transitions | Browser commands |
| Every physical send consumes a committed, one-use allowance | Bend batch transition | SQLite transaction before browser activation |
| A repeated native turn attaches to the same operation | Durable operation identity | Unique database key; request decoder |
| A transport disconnect removes only that transport's subscription | Bend lifecycle | HTTP/SSE cancellation |
| Recovery reconstructs decisions, without replaying physical effects | Bend recovery | Database and browser attachment |
| A retained webpage receives only a confirmed, compatible history suffix | Bend history and surface evidence | Logical DOM identities and canonical input encoding |
| A tool result cannot be mistaken for a new user turn | Bend transcript admission and broker | Responses/MCP codecs |
| Final output cannot overtake an outstanding tool or a changed answer | Bend observation and broker fence | DOM observations; output encoding before commit |
| Context, images, and explicit compaction are not silently dropped | Bend plan and request protocol | Token/byte measurement, attachments, structured-output validation |
| The desktop and CLI use one application, not separate state machines | Compiled Bend application API | Electron, Bun, filesystem, process and network adapters |

The product retains the Responses bridge, native passthrough, browser-only and
full connector modes, the six Codex Native tools, explicit compaction, retained
web conversations, isolated development operation, configuration and diagnostics,
desktop tabs, packaging, and the optional Astra Jev route. These are delivery
requirements, not evidence that a particular integration has already passed.

## Persistence and effects

A database transaction computes a Bend decision and encodes its complete state,
reply, and effect intents before committing. Physical effects are marked claimed
before execution. A claimed effect without a receipt is unknown, not retryable.
The runtime never interprets effects from old transactions during replay.

Read-only observation is separate from command execution. A failed observation
does not grant any command authority. Only an explicit user cancellation or page
closure can request cancellation. Completing an HTTP request is not cancelling a
webpage, and completing an MCP request is not completing its native turn.

An old ownership journal is migration input, not dead code to be ignored. An
unresolved old operation must remain blocked from a second send. Migration must
not make an existing operation fresh merely by changing its storage format.

## Evidence

Pure production modules must be in the root proof closure. Independent
specifications must not depend on their implementations. A clean build checks
the pinned compiler and Base, checks actual proof terms, and only then emits the
production library and native executable. There is no host-language fallback.

Boundary tests exercise database failures, process death, duplicate requests,
SSE disconnects, MCP delivery, browser DOM evidence, and package execution.
Semantic mutation checks must first type-check the changed implementation, then
fail its actual proof. A timeout, missing import, or syntax error is not a detected
semantic regression. Real ChatGPT/account and platform-specific checks are
reported separately from local fixtures; neither is inferred from the other.
