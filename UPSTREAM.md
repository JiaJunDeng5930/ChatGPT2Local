# Upstream relationship

This repository is an independent rewrite descended from:

- Original project: `miuuyy/codex-chatgpt-web`
- Upstream remote: `git@github.com:miuuyy/codex-chatgpt-web.git`

The current architecture is intentionally independent. The upstream `main` branch is a source of change signals and behavioral evidence; it is not a branch to merge or rebase into this repository.

## Changes worth reviewing

Review upstream changes that can alter externally observable behavior or compatibility, especially:

- ChatGPT DOM and browser interaction changes;
- Codex / Responses protocol changes;
- model, effort, connector, and capability changes;
- security fixes;
- account/session behavior relevant to the browser boundary;
- user-visible bug fixes whose underlying requirement still applies here.

For each relevant change, identify the behavior or requirement it establishes, then implement that behavior against the Bend state machine and the current TypeScript/Electron boundaries. Do not copy an old `src/` or `launcher/` implementation merely to preserve source similarity.

## Changes normally ignored

Upstream refactors, file moves, launcher internals, tests tied only to the old architecture, and implementation details without a relevant observable requirement do not need to be ported.

## Git policy

- `origin/main` is the authoritative development line for this project.
- `upstream/main` is read-only reference material.
- Do not merge or rebase `upstream/main` into `main`.
- Small architecture-independent fixes may be cherry-picked only when their semantics remain valid here; semantic reimplementation is the default.
- `pre-bend-rewrite` marks the last pre-rewrite baseline inherited from the former fork.

The original project remains credited through Git history, the MIT license, and the attribution above.
