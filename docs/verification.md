# What verification establishes

`bun run verify` executes the current proof checker, not an acceptance flag from a previous build. `tools/build.py` checks the pinned compiler identity, exact Base bytes, source closure, forbidden holes/unsafe declarations, independent-specification import boundaries, and complete runtime schema generation. The production decision code is the emitted Bend program.

`tools/proof_tests.py` challenges missing, false, unfilled, circular, and unchecked proofs. It mutates real production branches in a temporary source tree, first checks the mutated API as a valid pure program, and then requires the actual proof root to refute it. A syntax/import failure does not count. It separately tests import/source-closure guards and compares all 63 turn state/event decisions between native C compilation and emitted JavaScript.

The theory modules supply reusable transition/iteration, sequence, finite-map, and natural-number lemmas. Domain proofs instantiate them where the correspondence is established. The application composition proves specific authorization, nonintervention, tool-fence, and local-result properties. This is not presented as a proof of every behavior of Electron, SQLite, JavaScript, or the operating system.

The executable boundary tests cover real SQLite rollback and process locks; kill/recover behavior; immutable native RPC identities; HTTP admission and SSE detachment; native tool results returning to the same operation; advisor lease races; generated-domain decoding; and Codex profile preservation. Electron tests use the production desktop, CDP adapter, editor, model controls, exact connector selection, one-shot submitter, document ownership, and retained history against a rendered local fixture.

The build gate bundles a self-contained runtime with pinned production dependencies and Bun, hashes its artifacts, launches it under a fresh home, and checks its actual service. Native and generated artifacts are reconstructed before their hashes are checked. `.build/verification.json` and `.build/release-verification.json` are evidence outputs, not proof bypass inputs.

## Limits

All automated webpage requests target a local fixture. The gate does not spend a user's ChatGPT quota, certify a current account's DOM, execute a second model agent, or certify a third-party tunnel service. A changed external interface must fail safely and be inspected; it must not be handled by submitting again.

The OS-backed exclusive lock and SQLite FULL-synchronous transactions are trusted infrastructure boundaries. Browser document identity and completion controls are external observations. A committed activation guard cannot prove what a remote server did if its response is lost. These assumptions are recorded rather than disguised as pure theorems.

Local results establish only the platform actually used. CI is configured to run the fresh gate on macOS and Linux, with an X server for Linux Electron tests. Signing, notarization, installer permissions, and additional platforms require separate evidence. In particular, a Windows packaging configuration is not a checked Windows compiler or release.
