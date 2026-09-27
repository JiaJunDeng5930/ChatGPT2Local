# Codex Web · Bend

A local Codex Responses provider backed by a user-authenticated ChatGPT webpage. Version 6 is a redesign: the operation, tool, history, observation, and adaptive-routing decisions execute from checked Bend source. TypeScript handles browser, SQLite, HTTP, filesystem, and process boundaries. The desktop is a small Electron window host; it does not contain a second task state machine.

[中文](README.zh-CN.md) · [Design and proof scope](docs/rewrite.md) · [Verification](docs/verification.md) · [Upstream relationship](UPSTREAM.md)

This repository is an independent Bend-based rewrite descended from [`miuuyy/codex-chatgpt-web`](https://github.com/miuuyy/codex-chatgpt-web). It does not merge or rebase the original repository. Relevant upstream protocol, ChatGPT DOM, model-capability, security, and observable bug fixes are reviewed and reimplemented against this architecture; see [`UPSTREAM.md`](UPSTREAM.md).

## Run from source

Use Bun **1.4.0**, Python 3, Node, and a C compiler on macOS or Linux. The exact Bend compiler and Base hashes are in `bend/toolchain.json`; do not substitute another compiler or an old proof receipt.

```sh
bun install --frozen-lockfile
(cd desktop && bun install --frozen-lockfile)
bun run bend:setup
bun run bend:build
bun run app
```

The first desktop start creates `~/.codex-chatgpt-web/application.json`, starts the new runtime, and displays the application page. Select **Open ChatGPT / sign in** and sign in directly in the embedded browser. Cookies stay in its private persistent browser partition. No Chrome-cookie import or account modification is performed.

Use **Install Codex model profile**, or `bun run install-models`. This adds an isolated profile without changing your existing default provider or other profiles:

```sh
codex --profile web
```

Available website models are `chatgpt-web/light`, `medium`, `high`, `xhigh`, and `pro`. The actual account must expose the requested control. A free-account Think switch supports light/medium only. Unsupported or ambiguous selections fail before submission rather than silently substituting a model. Set `efforts` in `application.json` to the capabilities of the account you intend to use, then reinstall the model catalog.

The default `browser-only` mode deliberately has no outer native tool executor. Use full mode for coding tasks requiring native tools.

## Native Codex tools

The `full` mode exposes the six Codex Native2 MCP tools. Each call must include the active operation's capability. Commands, file changes, images, and discovered tools are executed by the outer Codex runtime, which retains its own sandbox and approval policy. The website bridge does not execute model-provided shell commands directly.

Run `bun runtime/cli.ts configure` with a complete validated configuration on stdin, or edit the private `application.json` while the runtime is stopped. Set `mode` to `full` and set `browser.connectorName` to the exact connector name in ChatGPT (default: `Codex Native2`). Restart the service explicitly after configuration changes.

An installed `tunnel-client` can expose the MCP **stdio** adapter:

```sh
bun runtime/cli.ts tunnel-connect --key-file /private/path/runtime-key --tunnel-id YOUR_TUNNEL_ID
bun runtime/cli.ts tunnel-run
```

The registration points the tunnel at `codex-chatgpt-web mcp`, which connects to the one running local service. Configure the corresponding connector in ChatGPT with the same name. Keep the tunnel running while using full mode. Neither service nor tunnel crashes cause an automatic restart of a webpage task. Do not expose the local dashboard or bearer-protected Responses API as a public tunnel.

Native model requests that are not prefixed `chatgpt-web/` use the configured native upstream. A named `native.keyEnv` selects that credential explicitly; an empty variable is an error, not permission to fall back to another account. Shared Codex login credentials are only forwarded to their official upstream, not arbitrary third-party hosts.

## Task and history semantics

A website operation requires a stable native turn identity or an `Idempotency-Key`. Reconnecting with the same identity observes the existing task or replays a committed result. The operation claims a send durably **before** activating the browser button. A missing receipt after that point remains unknown; it does not authorize another send.

Detection failures, transport disconnects, rate-limit/error-looking pages, stale observations, and runtime recovery do not reload, regenerate, stop, or resend the page. The application pauses an uncertain observer and retains the task. **Resume observation** reconnects only to the original document. **Confirm current answer** is an explicit user attestation, not automatic terminal detection. **Cancel task** is the only application command that requests Stop.

The website already owns its conversation. A completed page is reused only if the environment, transcript prefix, original document, and final answer receipt all agree. A subsequent operation sends only the new suffix. Edited, branched, incomplete, missing, or already claimed histories are not silently treated as an API context. Separate genuine operations may use separate pages; an uncertain existing operation never gets a replacement page.

Long initial contexts are planned into bounded staging messages before admission. Each planned part is a separate one-use slot. A staging timeout does not create another slot. API-requested compaction is explicit; the application does not independently compact or restart a website conversation.

## Controls and isolated development

```sh
bun runtime/cli.ts --help
bun runtime/cli.ts doctor
bun runtime/cli.ts status
bun runtime/cli.ts resume OPERATION_ID
bun runtime/cli.ts cancel OPERATION_ID
bun run dev:app
```

`doctor` performs read-only reachability checks. `--home PATH` selects all private application storage. `dev:app` uses a worktree-specific `.state` directory and separate browser identity, not your regular profile. CLI-only operation can use `serve --cdp http://127.0.0.1:9222` with an already running authenticated Chromium endpoint.

Closing the desktop window hides it so tasks continue. Explicit **Quit** closes the browser after a warning; this is not a promise that a remote response has been cancelled. A crashed renderer or lost document remains unavailable, rather than being reconstructed and resubmitted. A second runtime cannot acquire the same profile's OS-backed ownership lock.

## Migration from earlier versions

The old implementation directories are removed, not retained as a fallback. New executable sources are `bend/`, `runtime/`, and `desktop/`; new tests and tooling are `test/` and `tools/`.

The migration reads unambiguous installation settings from the previous `config.json` but leaves that file and `submission-journal/` intact. Old ownership receipts are imported into the new store and block duplicate submissions. An unidentified legacy receipt blocks new admission until explicitly inspected and mapped. Stop the old runtime before opening the same profile with version 6.

```sh
bun runtime/cli.ts setup
bun runtime/cli.ts migrate
# Only after inspecting the original receipt and exact native identity:
bun runtime/cli.ts migrate unmapped:JOURNAL_ID native:SHA256_ID
```

`migrate` can validate a store against the current checked state schema; it never replays an old physical effect. Old browser cookies and pages are not impersonated as new ownership receipts. Do not erase unknown records to force a retry.

## Optional adaptive native reasoning

`astra-jev` is a separate native API route, not a website model. Configure `jev` with `baseUrl`, `model`, `keyEnv`, and `targetModel`, plus a native upstream. The advisor receives the request to choose a reasoning effort and a bounded lease. Only an exact history extension in the same environment can reuse that advice.

Both advisor and native forwarding attempts have durable one-use identities. Invalid advice does not fall back to a guessed effort. A crashed forwarding attempt remains unknown and is not repeated. An SSE disconnect only detaches the observer. The configured native target must actually support the advisor's effort vocabulary. Advice sends task context to the chosen external service; enable it only when that disclosure is acceptable.

## Verify and package

```sh
bun run verify
bun run app:package:dir
```

`verify` freshly checks the proof closure, challenges the checker, refutes type-correct semantic mutations, compares native and generated-JavaScript decisions, runs SQLite/process/HTTP/MCP/real-Electron tests, builds a standalone runtime, and smoke-tests that bundle. Linux GUI tests require an X display (`xvfb-run -a bun run verify`). Evidence is written to `.build/`; the runtime bundle is in `dist/runtime/` and desktop packages in `desktop/release/`.

Production decisions use Bend-emitted JavaScript with generated boundary validators. `.build/bend-core` is a separately compiled native decision probe, **not** a claim that Chromium, SQLite, the entire TypeScript IO layer, or Electron are formally verified. The current native compiler pin supports macOS/Linux. A configured Windows package target is not evidence of a checked or tested Windows release.

All automated browser tests use a local fixture and a temporary profile, not a real ChatGPT account. Those tests do not certify today's account-specific DOM, network service behavior, signing, or notarization. See [verification scope](docs/verification.md) before making release claims.
