## What this changes

<!-- Describe one focused behavior change. Link the issue or prior discussion when applicable.
Large features, broad refactors, rewrites, new providers, and core architecture changes are normally
not accepted without prior maintainer discussion; prior discussion does not guarantee acceptance. -->

Fixes #

## Evidence

<!-- Give the reproduction before the change and the exact result afterward. Browser UI changes need observed DOM evidence, not guessed selectors. -->

## Scope and invariants

- [ ] I read and followed `CONTRIBUTING.md`.
- [ ] This is a small, focused change with no unrelated cleanup or generated rewrite.
- [ ] The change stays focused on the explicit ChatGPT Web API and retained webpages; it does not add a generic provider or unrelated product surface.
- [ ] Model, predecessor, effort, connector, and capability selection remain explicit with no silent fallback or false-success path.
- [ ] If this touches caller tools or MCP, every available Web effort retains the same turn-bound capability and Browser-only gains no broker or connector.
- [ ] Terms and trademark claims remain factual; this change is not marketed as a quota or rate-limit bypass.

## Verification

- [ ] I ran `bun install --frozen-lockfile` in the repository root and `desktop/`.
- [ ] I ran `bun run verify` with the Bun version pinned by `package.json`.
- [ ] I added or updated a focused regression test for behavior changes.
- [ ] I inspected the affected behavior through the appropriate browser or executable boundary.
- [ ] If this changes tool execution or continuation, I exercised the caller API and MCP path and named the local-fixture or real-account boundaries actually tested.
- [ ] If this changes ChatGPT browser UI handling, I included observed DOM evidence and a reproducible fixture instead of broadening selectors speculatively.
- [ ] If this changes the desktop host, I preserved macOS, Windows, and Linux packaging and named the platform packages actually built below.
- [ ] I did not commit browser state, credentials, Tunnel IDs, raw logs, generated artifacts, or private paths.
- [ ] I did not include an unrelated dependency update, release artifact, or version change.

## Platform or account validation

<!-- List the platforms, account tiers, Browser-only/Full modes, and packaged builds actually exercised. Write "not run" for anything not verified. -->
