# Remove automatic compaction from ChatGPT Web routes

Status: Accepted

Date: 2026-09-23

## Context

ChatGPT Web has physical browser limits that differ from the model's nominal context size. Numeric
context and auto-compaction fields in the Codex model catalog let Codex schedule compaction before
those limits are reached. Luna also maintained a private rolling summary and resumed with a
checkpoint instead of sending its full canonical history. These automatic behaviors duplicated
context policy across Codex, the adapter, and persisted Web state, while explicit compaction already
has a dedicated Responses contract.

## Decision

All ChatGPT Web catalog rows set `context_window`, `max_context_window`,
`effective_context_window_percent`, and `auto_compact_token_limit` to `null`. Native catalog rows
are unchanged. The adapter owns physical per-message and aggregate browser budgets and rejects an
oversized compiled request before browser submission; it never truncates history to fit.

Luna sends the complete canonical history on each request and fails explicitly when it exceeds the
measured 28,000-token browser transport budget. Remove its rolling checkpoint prompt, worker callback,
IPC event, and persisted checkpoint state. DEV chat follows the same policy: token count never
triggers compaction, while `/compact` remains an explicit command.

Bigger Context chooses inline, two-part, or six-part transport from the compiled prompt and measured
physical budgets. If six parts still exceed a limit, existing preflight returns an explicit error.
The `/responses/compact` route remains intact, including explicit six-part summarization, retained
handoff behavior, and Luna's HTTP 409 response. Managed `remote_compaction_v2` configuration remains
unchanged.

## Consequences

Web turns retain their complete history until the browser's measured capacity is reached, where they
fail visibly instead of starting an automatic summary. Users can still request compaction explicitly
through the existing Responses endpoint. DEV status reports input usage and physical capacity rather
than an automatic threshold. Bigger Context's part selection now follows actual compiled payloads
and transport limits; native model context behavior remains independent.
