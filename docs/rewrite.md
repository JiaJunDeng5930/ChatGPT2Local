# Explicit webpage requests

## Responsibility split

The caller knows its task, history, tool executor and intended conversation. The webpage owns a persistent conversation with observable browser state. The API makes their relationship explicit rather than reconstructing it from provider-compatible request history.

Version 7 removes the history-prefix selector, transcript reconciliation, Codex metadata identity, automatic context staging, native-model proxy, advisor routing and caller-profile installation. A root request creates a page. A completed response plus new messages creates the next turn on that exact page. A tool-call response plus results continues the waiting invocation without another Send.

The caller keeps request bodies and idempotency keys for retry, response IDs for continuation, and any desired history for an explicit new root. The server keeps admitted request records, immutable response receipts, tool-call results and original-page ownership. It does not need a second accumulated transcript.

## Pure policy and production binding

`bend/request-domain.bend` defines request-key evidence, predecessor state, input kind, admission decisions and rejection reasons. `request-specification.bend` states the public meaning independently. `request.bend` implements it. `request-laws.bend` and `request-proof.bend` establish full refinement, repeat-request replay and consumed-predecessor rejection. The production API exports `request_admit`; TypeScript invokes the emitted, checked function.

An unseen key and a root message authorize `NewPage`. An unseen key, completed available predecessor and messages authorize `Append`. An unseen key, tool-call predecessor and results authorize `DeliverResults`. A repeated key replays its original request even after its predecessor was consumed. A conflicting key or unusable predecessor is rejected with a specific reason.

These are finite algebraic cases, proved directly using the language's equality and data constructors. The existing application/broker/lease/observation proofs continue to govern effect authority, tool fences, completion and recovery. The generic transition-system theory remains the basis of the turn trace and activation-budget proofs. The new API does not duplicate those decisions in another handwritten runtime state machine.

## JSON and database boundaries

`runtime/response.schema.json` defines request syntax and `response-resource.schema.json` defines response resources. `protocol.ts` validates external values, normalizes input and serializes output. It does not accept provider-specific extensions. Tool-argument validation and exact result-batch matching are codec/correlation checks at the caller boundary.

The `requests` table binds a hashed idempotency key to its fingerprint, predecessor, response ID, operation, input kind and admission time. `previous` has a unique constraint. Every admission rereads these facts and invokes the Bend rule inside the SQLite transaction that claims the page, registers the request and installs its planned effects. A preliminary DOM inspection does not replace the transactional recheck.

`operations` holds the existing checked application state and physical browser binding. Several tool-result API rounds can refer to the same operation. A subsequent user-message request creates a new operation on the same page. Cached response bodies belong to request rounds, not to an inferred transcript. Historical schema columns can remain inert during migration without participating in current policy.

Physical effects are claimed before execution and ordered per operation. Unknown external outcomes preserve uncertainty. The application never repairs them by replaying a claimed Send, regenerating an answer or allocating another page.

## Completion and continuation

The browser adapter records page/document identity and verifies the original assistant reply, idle state and absence of unrelated edits. `surface_resume` checks the corresponding evidence. An unavailable or changed document prevents continuation.

The final output and its new continuation receipt commit in the same transaction. Publishing a final answer without its page authority would create a race at the next API request. Conversely, replaying an old answer must not release a successor's current claim. The store checks both conditions when persisting final receipts.

Tool-call output freezes a batch of caller invocation IDs. A result request must name that response and return exactly that batch. Result blobs and the checked state transition commit together. Caller results are delivered into the original MCP waits; they are not wrapped into a second webpage prompt. Existing broker/local-activity fences prevent a pre-tool answer from becoming final.

## Transport and representation

The webpage connector declares only two tools in `runtime/tool-bridge.ts`; both MCP discovery and the prompt contract use those declarations. The caller's flat tool declarations supply all executable names and schemas. There is no runtime-specific command translation or inferred inventory.

One admitted message has one complete, bounded prompt. Context staging, summarization and branching are explicit caller operations. Continuation inherits its root settings, keeping the webpage's execution environment stable.

SSE observes the same durable request as JSON. Provisional text events contain full snapshots because webpage text can be revised rather than strictly appended. They can be coalesced under backpressure. A committed response is authoritative and replayable. Disconnect is an observer event, not execution cancellation. Restart restores state; reconnecting to a surviving original page requires explicit resume.

## Scope of guarantees

The Bend proofs cover the pure decisions under their supplied evidence. JSON parsing/schema validation, fingerprints, SQLite uniqueness and atomicity, process locks, DOM identity and external effect observations are trusted or tested boundaries. The project does not claim a proof of SQLite, Chromium, network delivery, model compliance or remote exactly-once execution.

Boundary tests exercise transaction races and rollback, failed final-receipt commits, batch-result rollback, reopened storage, JSON/SSE behavior, caller-tool MCP transport and actual Electron DOM ownership. Pure-policy refinement is checked rather than sampled as another test table. [Verification](verification.md) records which evidence comes from each gate.
