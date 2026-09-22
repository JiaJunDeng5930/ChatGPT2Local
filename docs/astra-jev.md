# Astra Jev internal model

Astra Jev is an internal model path in the existing Codex Web GPT daemon. The daemon keeps one
listener and owns the request lifecycle; selecting `astra-jev` in the existing catalog routes the
request through the retained-history controller before forwarding it to the native Responses
upstream as `gpt-6-astra`.

The controller lives under `src/astra-jev/`. `HistoryStore` retains the bounded previews and Jev
overlay updates for 24 hours of request inactivity. A request must carry the complete retained
input history. `previous_response_id` and delta continuations are rejected because the controller
needs the complete history to preserve the request baseline and lease boundaries. Compaction with
the alias is handled by the native compaction path after only the model name is normalized; it does
not consume a Jev decision.

The model catalog appends the public alias `astra-jev` and displays `Astra Jev`. Its default
reasoning level is `medium`, which is the baseline sent to the retained-history policy. Jev may
adapt the next effort and lease from the retained task state. If the native catalog describes
`gpt-6-astra`, that row supplies the alias metadata, including its context fields. When it does not,
the alias leaves context limits unspecified rather than inventing a window.

The daemon exposes the authenticated control routes used by the launcher bridge:

* `GET /admin/astra-jev` returns the current state and retained history summaries.
* `POST /admin/astra-jev` accepts the provider and optional API-key settings.
* `GET /admin/astra-jev/histories/:id` returns one retained history detail.

The success bodies are the shared camelCase state and history shapes. Errors use the existing
`{ error: { message, code } }` control response. All three routes use the daemon control token.
History listing and detail reads sweep expired idle entries without extending activity.

The selected provider is persisted in `astra-jev/settings.json` under the main application config
directory. Each provider key is persisted in its own `vercel.key`, `typesafe.key`, or
`openrouter.key` file with mode `0600`; keys never enter runtime snapshots, command arguments, logs,
or returned state. Missing keys leave the daemon running and make the state unconfigured. Requests
made before configuration return `jev_credentials_missing`, which the launcher can present as an
actionable setup message. Saving settings updates only future requests; an active request retains
its immutable provider, key, and timeout snapshot.

The renderer uses the existing launcher surface and control transport. No standalone package,
listener, static host, command, or provider installation is part of this feature.
