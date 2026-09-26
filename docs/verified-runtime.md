# Verified browser execution

The browser is a stateful participant, not a stateless model endpoint. A failed
observation does not prove a failed submission. An API disconnect does not cancel
the website. A conversation identifier does not prove that the current document
contains the history the caller expects.

Bend owns submission allowances, history selection, completion eligibility,
tool obligations, replay and page lease decisions. TypeScript and Electron
interpret those decisions through files, browser observations, network connections
and user controls. The frontend, browser engine, codecs and operating system are
not claimed to be formally verified.

## Concept and proof entry points

Start with `bend/PROOF.bend` for the assembled evidence and `bend/api.bend` for
production functions. The proof root imports implementations of the laws, not
just declarations. The daemon and Electron share
`src/verified/generated/core.cjs`; `launcher/electron/verified-core.cjs` loads
that artifact. There is no handwritten transition fallback if it is missing.

| Concept | Specification and proof modules under `bend/` | Production interpretation |
| --- | --- | --- |
| One physical send allowance | `specification`, `LAWS`, `turn-proof`, `trace-proof` | `src/verified/core.ts`, `submission-journal.ts` |
| Reserved multipart plan and ordered acknowledgements | `batch-specification`, `batch-laws`, `batch-proof` | Submission journal and browser send/acknowledgement hooks |
| Completed webpage history | `history-specification`, `history-laws`, `history-proof` | `web-history.ts` and adapter prompt preparation |
| API-round records the current page can already know | `transcript-specification`, `transcript-laws`, `transcript-proof` | `transcriptExtends` and shared turn execution |
| Same-document continuation evidence | `surface-specification`, `surface-laws`, `surface-proof` | `page-history.ts` and browser read/compare/consume |
| Completion and post-tool observation | `observation-specification`, `observation-laws`, `observation-proof` | `observation.ts` and browser completion tracker |
| Tool obligations and final revision fence | `broker-specification`, `broker-laws`, `broker-proof` | `broker.ts`, `turn-broker.ts`, completion publication |
| Progress, tool delivery and response replay | `progress-*`, `outbox-*`, `replay-*` | Corresponding verified interpreters and `turn-execution.ts` |
| Page retention and observer ownership | `lease-specification`, `lease-laws`, `lease-proof` | Electron `browser-host.cjs` |

Evidence modules have the `.bend` suffix. Short interpreter names are under
`src/verified/`; browser/turn modules are under `src/adapters/chatgpt-web/`.

Refinements compare complete successor states and effect/reply decisions. Turn
and batch trace theorems quantify over arbitrary finite event lists, not a test
bound. A send consumes its allowance; uncertainty, recovery and disconnect cannot
manufacture another. A multipart request has the allowance of its declared
physical plan, not an unlimited retry budget.

Specifications cannot import their corresponding implementations, even through
transitive relative imports. History selection is specified using Base's right
fold over eligible receipts; its implementation uses its own traversal. The
refinement includes environment equality, a nonempty proper prefix, longest-prefix
selection and deterministic receipt-identity tie breaking. Transcript admission
uses membership in a finite protocol language. Both reuse pinned Base list
operations instead of introducing parallel fold and membership libraries.

The small `bend/theory/` modules are locally checked supporting proofs, not
imported Lean/Rocq certificates. Natural-language requirements, browser observation
meaning and the abstract model still require semantic review.

## Submission is a durable, one-way decision

The logical operation identity is distinct from a display trace ID, provider
configuration fingerprint and browser page key. Changing a configuration cannot
create a second allowance for the same native operation.

`SubmissionJournal` reserves exclusive ownership on disk. After preparation
determines the physical payloads, it records the exact plan. Immediately before
activating Send, it durably records that particular send intent. Only then may
the browser interpreter click. Exclusive file creation prevents a conflicting
receipt from overwriting an existing one; file and directory flushes are part of
the persistence boundary.

The activation callback checks the control and clicks within one browser task.
An explicit `unavailable` result means that callback did not click and permits
another readiness observation. A lost or thrown callback response is different:
it may have clicked. The interpreter observes the original submission baseline
instead of clicking again.

A completed journal can return its recorded answer without opening a page.
Incomplete or corrupt ownership records do not become fresh operations after
restart. They preserve an unknown outcome and deny a new send. Old journal
locations are checked before granting a reservation. Recovery does not silently
delete evidence or replay historical effects.

This prioritizes safety over automatic progress. A crash after reservation but
before clicking can leave an unused allowance unavailable. That is preferable
to guessing the request was never sent. Do not clear such evidence while its
page or operation may still be active. Inspect the existing page and use explicit
cancellation or a deliberately new task as appropriate.

## Confirmed history is not just a conversation key

The native API transcript, a completed operation's confirmed message prefix and
the retained page's live document are separate objects. Without an eligible
receipt, a new operation imports its full context into a new conversation. With
a compatible receipt, Bend selects the longest nonempty completed prefix strictly
shorter than the input. Only after the selected page proves its live evidence
does it receive the remaining suffix. An exact completed request uses operation
replay, not an empty browser submission.

The environment includes the model, instructions, tools and request options.
Message fingerprints discard selected transport-only metadata but preserve
semantic content. An edited prefix or different interpretation cannot be credited
as retained history. Inside an already-running native turn, assistant observations
and tool protocol records may extend its known transcript; unsent user/developer
instructions cannot. Reattaching a transport round alone never justifies another
browser send.

Each completed receipt has an immutable identity derived from its operation and
checked against its filename. Several receipts can share a page key and message
count. Bend therefore selects the **receipt identity**, and the host retrieves
exactly that receipt. Looking up only page key and prefix length could substitute
another branch or environment after a correct pure selection. The version-1 disk
receipt schema is retained.

The selected page must also present its same-document witness, matching operation
and answer digest, an idle assistant tail and no recorded trusted interaction.
The final answer is read from the live document and compared with the receipt.
Witness consumption is compare-and-consume: a stale positive decision cannot erase
an intervening change. Failure denies that continuation rather than silently
copying assumed history to a replacement page.

This is not a cryptographic attestation of ChatGPT's internal history. The host
assumes exclusive ownership while preparing/sending its leased turn, a valid DOM
projection and collision-resistant digests. An external service or concurrent
manual document mutation is outside the pure proof. Browser upgrades remain an
integration boundary.

## Completion is separate from successful serialization

Bend's completion observer checks settled response evidence and post-tool
observation boundaries. In Full mode the broker offers a revision fence only
when tool obligations can close. A fresh browser observation follows the fence
candidate; an old revision cannot close newly arrived work.

Before committing that irreversible fence, `commitChatGptCompletion` prepares
the entire final Markdown output. A tool-unavailable sentinel, inconsistent
snapshot or visible text that cannot be encoded is not a final answer. Failure
leaves the broker open. A stale fence or lost fence response does not consume
the pending output, so a later observation can replace the uncommitted tail.

After acceptance, the prepared result is committed without calling the formatter
again. Streaming batches also prepare before applying: a later conversion failure
cannot swallow an earlier block's delta. The buffer has one writer; an obsolete
prepared candidate cannot overwrite newer observations. These host guarantees
are tested with the actual generated Bend broker and injected serialization and
transport failures. They are not a Bend proof of the Markdown library.

## Unknown observations do not control webpages

Page errors, missing controls, heartbeat silence and unresponsive renderers are
observations, not cancellation authority. Unknown pages remain protected and
inspectable. A replacement helper cannot acquire a page merely because its old
observer exited. HTTP reconnection and replay do not create new physical browser
requests.

This also applies outside task tabs. A home-page security-check response reports
a diagnostic but never automatically reloads the page: it may contain a manually
running conversation. Home, sign-in, bootstrap and refresh observation deadlines
do not call browser Stop. Sign-in error observations retain the page. Successful
authentication may close its completed popup; explicit user close, navigation,
refresh, sign-out and cancellation remain deliberate operations under the existing
ownership restrictions.

If the OS denies the boot-time probe, the launcher still loads. Unknown boot
evidence cannot establish that a recorded owner predates the current boot and
does not authorize reclaiming or terminating that process.

## Reproduce and interpret the evidence

Install the pinned dependencies in the root and `launcher/`, then use the compiler
described by `bend/toolchain.json`:

```sh
bun run bend:setup
bun run bend:build
bun run verify
```

`bend:build` checks the pure root and regenerates the shared JavaScript and native
probe. Review and commit generated JavaScript with the corresponding sources;
never hand-edit it. `bend:check` requires an exact match to the current sources.
`bend:verify` runs the full Bend/native gate. `verify` additionally runs dependency
audits, both application suites, typechecks, frontend and runtime builds, license
notices and a relocated local runtime smoke test.

The gate tests missing proofs, false proofs, holes, unchecked recursion and
circular recursion. Only the exact pure success diagnostic is accepted. The
pinned compiler can return zero while reporting unchecked/foreign code, so exit
status alone is insufficient.

Semantic mutants must first remain well typed under the production entry. The
assembled proof must then reject them for the intended equality/type mismatch.
Syntax errors, missing imports and timeouts do not count. Native/JavaScript
conformance compares complete encoded decisions for every production export,
including natural-number representation, Unicode, tags and malformed foreign
input. These are compiler/ABI probes, not substitutes for quantified proofs.

Reports under `.cache/bend/` record the actual run. A trusted build receipt binds
exact Bend sources, generated code, production host sources, dependencies and
gate/build scripts. Changing an interpreter or adding a host source invalidates
it. `BEND_PROOF_RECEIPT` explicitly imports trusted evidence, not an automatic cache
bypass; CI additionally requires the same repository, commit, run and attempt.
The receipt is a checked build record, not a signature or a proof of host code.

Local gates do not prove ChatGPT, the OS, SHA-256, the Bend compiler or its target
runtimes correct. Foreign-number decoding enforces its supported bounds.
Account-bound ChatGPT/MCP/Codex flows and signed packages on other OSes remain the
separate gates in [Release validation](release-validation.md). Local success does
not claim those checks ran or spend model quota to simulate them.
