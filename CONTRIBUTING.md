# Development

Install the pinned dependencies and compiler using README.md. Use an isolated `--home` or `bun run dev:app`; never exercise test mutations against a logged-in personal profile.

Business decisions belong in `bend/`. Changes to those decisions need a stated meaning, an independent specification or clearly bounded safety theorem, actual production bindings, and a checked proof. Do not recreate the state machine in TypeScript, count a hand-written simulator as execution evidence, or treat an old verification manifest as permission to skip the checker.

The `runtime/` directory interprets committed effects and validates external values. Encode and bound the whole decision before committing. Claim external effects before performing them. After a claimed effect loses its receipt, preserve uncertainty; never replay it. Keep per-operation physical effect ordering even when JavaScript promises interleave.

Changes to the public API must update `docs/protocol.md` and its request/response schemas. Callers explicitly own continuation, context staging and tool execution. Do not reintroduce history inference, provider compatibility fields, command aliases, native forwarding or advisor routing through convenience code. A response identity belongs to an admitted request; tool rounds and browser-message turns are distinct.

Run `bun run verify` for the fresh gate. New mutations must type-check the mutated production entry and fail the actual proof for a semantic mismatch, not a syntax error. Browser regressions belong in the isolated Electron fixture suite. Tests must not send real-account messages, run model subagents, overwrite a user profile, or silently skip the real UI boundary.

Use `bun run app:package:dir` to inspect a platform package. A release needs the exact build manifest, fresh verification evidence, platform smoke evidence, and any claimed signing/notarization evidence. Do not describe a configured target as a tested target.
