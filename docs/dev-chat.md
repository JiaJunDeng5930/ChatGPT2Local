# DEV chat harness

The repository DEV chat exercises current source code without routing the native Codex app through
that working tree. It is intended for browser, MCP, tool-round, repeat-request, and compaction
development while the normal launcher, its ChatGPT account, and the maintainer's active Codex
session remain usable.

## Prerequisites

- Use the repository-pinned Bun version.
- Install a launcher built from the same working tree.
- Start the isolated launcher with `bun run dev:launcher`.
- It skips the normal marketing onboarding and opens the setup surface directly. Sign in inside the
  window labelled **DEV**. This may be a different ChatGPT account.
- Run its browser smoke test and initialize the DEV profile. Complete MCP setup only when testing
  simulated tool rounds; browser, effort, context-limit, and compaction work in browser-only mode.
  The launcher stores any MCP credentials only in the DEV home and supervises only that isolated
  tunnel. Create the ChatGPT connector as `Codex Native2 DEV`; keep `Codex Native2` unchanged.

Nothing is copied from the normal launcher. The DEV command fails closed if its own launcher,
browser descriptor, credentials, or connector are not ready. It never falls back to the production
profile, another model, a fake browser, or a second connector.

## Run

One browser-only message:

```bash
bun run dev:launcher
bun run src/cli.ts dev status
bun run dev:chat smoke "Reply with exactly: DEV READY"
```

Persistent interactive chat:

```bash
bun run dev:chat compaction-lab
```

After optional Full/MCP setup, the same command also exposes simulated outer tools:

```bash
bun run dev:chat tool-lab "Use a command tool and explain the simulated receipt"
```

The direct DEV tool `mcp__dev_simulator__large_context_payload` accepts the explicit arguments
`segment` (1, 2, or 3) and `target_tokens` (1,000 to 95,000). It returns deterministic, coherent,
inert prose through the real simulated MCP-result path so a live named chat can exercise history
retention and explicit compaction without embedding a giant fixture in the user prompt. It is advertised
directly rather than through deferred tool search so the test can prove the requested call happened.

Reusing the same name continues its canonical Responses history. Sequential native messages in the
same compaction epoch may reuse one Temporary Chat, exactly like production. Every message receives
a new turn-bound MCP token, and all MCP tool rounds for that message remain inside the same ChatGPT
response. Each distinct canonical compaction input uses one execution through the fresh-compaction
runtime path; repeated identical inputs attach to or replay that execution. The source Web execution
and its page keep their normal lifecycle throughout compaction. The complete named history remains
owned by the existing prompt compiler. New
chats use the cheapest account-supported browser mode:
Instant (`light`) when Sol is available, otherwise Luna. Override it with `--model` or `/model`.

Interactive commands:

```text
/status
/fill 30000
/send-fill 12000
/compact
/model high
/reset yes
/help
/exit
```

`/fill N` appends deterministic inert text measured by the production tokenizer. It does not open
ChatGPT, and subsequent messages keep the full history without triggering compaction by token
count. `/compact` explicitly calls the same `compactRequest` handler used by the Responses route.
Luna rejects that separate compaction request with HTTP 409, matching production.

`/send-fill N` sends deterministic inert text as the current message through the live browser. Use
it to exercise the one-message composer budget and multi-chunk prompt insertion independently of
history growth. The normal model-specific browser preflight still applies and fails closed above
the measured transport limit.

## Skills as files experiment

**Settings → Skills as files (experimental)** is off by default in both launcher profiles.
It uploads only skills explicitly selected in Codex and identified by native selected-skill
metadata. Skill discovery and reading other skills through tools are unchanged. The CLI setup
flags are `--skill-attachments` and `--inline-skills`.

Each UTF-8 `.txt` attachment contains the original skill envelope, including its path or resource
authority. Its filename uses the skill name and a content digest to distinguish changed versions.
Files are generated in memory, with no persistent file cache. Retained chats send only new context;
a fresh chat reconstructs its attachments from canonical history. Files and images share the
10-attachment limit, and skill content still counts toward context and message token budgets.
An unsupported browser helper or rejected upload produces an error instead of silently omitting
instructions. This remains experimental: moving instructions into attachments does not guarantee
that ChatGPT will follow them more reliably.

## Bigger Context experiment

Both launcher profiles expose **Bigger Context (experimental)** in Settings. It is disabled by
default. The switch updates the profile's canonical runtime configuration through the normal setup
transaction; it is not a launcher-only preference. Production setup also rewrites the managed
Codex model catalog and asks you to restart Codex. The DEV CLI reads the same setting from its
isolated runtime configuration on each command.

When enabled, the adapter first checks whether the full prompt fits in one message and within the
measured aggregate browser capacity. If not, it tries two messages, then six. The final context part
also commits the transaction and starts the task, so there is no extra request. Each choice depends
only on the compiled messages and measured browser capacities; it does not trigger compaction.

Each stage contains complete semantic records, never a raw JSON string cut in the middle. The model
must return an exact transaction-bound SHA-256 acknowledgement before the next part is sent.
Images, the MCP connector, and the private `turn_token` are attached only to the final part.
In Full/MCP mode, each distinct canonical explicit-compaction input runs once through the separate
fresh-compaction runtime. An identical request attaches to or replays that execution. The source Web
execution, page, CDP connection, broker, and MCP capability keep their ordinary lifecycle before,
during, and after compaction. Compaction does not send a checkpoint through the source response,
cancel or revoke source work, or clean up the source. It has no handoff timeout or fallback attempt.
The result still passes through pure summary canonicalization and the normal replacement-history
response. Browser-only mode retains the six-message summarization flow for explicit compaction and
its complete expanded history.

Any missing or malformed acknowledgement remains a protocol error and is never treated as success.
No later part or final commit is sent on that acknowledgement, and the adapter does not
automatically retry or start a fresh Temporary Chat. Passive observation continues so the user can
handle the page; the execution and MCP work remain available until a valid completion or explicit
user cancellation/page closure.
An intentional user-started Native turn is a separate execution; repeated requests for the same
Native turn attach to its original execution because Codex's built-in OpenAI provider retry settings
cannot be overridden. The adapter's
aggregate browser capacity scales to 3× while the switch is active, but every individual stage must
still fit the selected ChatGPT mode's measured one-message boundary. Web model catalog rows do not
advertise a numeric context window or automatic compaction threshold.

Small turns use one request. Two-part turns use one inert staging request and one final request;
six-part turns use five staging requests and one final request. Browser-only explicit compaction
also uses six parts. Inert stages use the fastest available mode that fits their complete messages; the final
part uses the selected execution effort. Large turns may increase the probability of
rate limits or a temporary account cooldown. The experiment is intentionally unavailable for Luna:
Luna's later requests still include the accumulated transcript inside the same measured
28,000-token browser transport budget.

Browser-only chats do not advertise outer tools and never claim simulated effects. Full setup keeps
the launcher-owned DEV tunnel ready so ChatGPT can create and validate `Codex Native2 DEV` before a
CLI chat starts. Each named chat attaches its broker to that tunnel, while every dispatched action
still returns an explicit simulation receipt.

The default isolated home is:

```text
~/.codex-chatgpt-web-dev/
├── config.json
├── codex-home/
├── launcher/                 # Electron userData, cookies, login, logs, window state
├── chats/<name>.json
├── runtime/
└── tunnel/
```

Set `CODEX_WEB_GPT_DEV_HOME` to choose another absolute DEV home. Generic `--home`,
`CODEX_CHATGPT_WEB_HOME`, `CODEX_HOME`, and `CODEX_WEB_GPT_LAUNCHER_DATA_DIR` never collapse the DEV
launcher into production storage.

## Isolation contract

The DEV driver:

- requires a descriptor explicitly marked `development` and a config explicitly marked
  `dev-harness`;
- uses a separate Electron `userData` directory and a separate persistent browser partition, so
  cookies, OAuth state, local storage, account selection, and launcher state cannot cross profiles;
- uses an isolated sandbox `CODEX_HOME` but never writes a Codex route into it;
- does not call setup, route connect/disconnect, service start/stop, or uninstall;
- does not start `Bun.serve` or bind the configured Responses port;
- rejects any attempt to start the Responses server from a `dev-harness` config;
- does not edit the normal `~/.codex/config.toml` or integration journal;
- leases an isolated DEV-launcher browser tab and runs the working-tree browser helper;
- owns the private DEV broker socket only for the command's lifetime;
- reuses the isolated tunnel supervised by the DEV launcher and never starts a competing alias;
- can run beside the production launcher, Responses port, and tunnel because none of their homes,
  browser partitions, descriptors, broker sockets, profiles, or aliases are shared;
- refuses to run Full-mode tool rounds until the launcher-owned DEV tunnel is ready;
- exposes ordinary structural tools, then returns a universal receipt containing
  `simulated: true` and `side_effects_performed: false` for every dispatched action.

The simulator has no keyword-to-result table and never claims that a command, patch, image read,
user interaction, or external mutation actually happened.
