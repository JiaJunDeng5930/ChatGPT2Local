# Astra Jev proxy

`astra-jev` is an independent Bun HTTP/SSE proxy for the managed `gpt-6-astra`
Responses model. It keeps the retained history and Jev controller in its own
directory and does not use the main application's adapter or state store.

The service listens on `127.0.0.1:17842` by default. Start it from this
checkout with a Jev provider key:

```sh
ASTRA_JEV_JEV_API_KEY=jev-provider-key bun run astra-jev
```

The key is used only for the Jev decision request. The default Vercel provider
uses `AI_GATEWAY_API_KEY`; Typesafe and OpenRouter can use
`TYPESAFE_API_KEY` and `OPENROUTER_API_KEY` respectively. The explicit
`ASTRA_JEV_JEV_API_KEY` takes precedence over those provider-specific names.
The proxy never sends the incoming Codex bearer token to Jev.

The managed Responses request is sent to
`https://chatgpt.com/backend-api/codex` by default. The proxy forwards the
incoming `Authorization` header and account headers to that upstream. Set
`ASTRA_JEV_UPSTREAM_API_KEY` to use a dedicated upstream bearer key instead;
this overrides the incoming authorization header for the upstream request.

Useful configuration variables and equivalent CLI options are:

| Variable | CLI | Default |
| --- | --- | --- |
| `ASTRA_JEV_HOST` | `--host` | `127.0.0.1` |
| `ASTRA_JEV_PORT` | `--port` | `17842` |
| `ASTRA_JEV_HOME` | `--home` | `~/.astra-jev` |
| `ASTRA_JEV_UPSTREAM_BASE_URL` | `--upstream-base-url` | `https://chatgpt.com/backend-api/codex` |
| `ASTRA_JEV_JEV_PROVIDER` | `--jev-provider` | `vercel` |
| `ASTRA_JEV_SUPPORTED_EFFORTS` | `--supported-efforts` | `low,medium,high` |
| `ASTRA_JEV_JEV_TIMEOUT_MS` | `--jev-timeout-ms` | `30000` |

The provider must be one of `vercel`, `typesafe`, or `openrouter`. The service
uses the provider endpoints and model identities expected by Jev:

* Vercel: `https://ai-gateway.vercel.sh/v1/evaluate`, model
  `typesafe-ai/jev`, restricted to the `typesafe-ai` gateway provider.
* Typesafe: `https://api.typesafe.ai/v1/systemone`, model `jev-latest`.
* OpenRouter: `https://openrouter.ai/api/alpha/decisions`, model
  `typesafe/jev-1.13`, restricted to Typesafe with fallbacks disabled.

The service advertises only `gpt-6-astra` at `/v1/models`. A request must carry
the complete retained `input` array on every call. `previous_response_id`
continuations and delta continuations return an explicit HTTP 400, as do
missing, empty, or malformed inputs. Native compaction items are accepted when
they are part of that complete input history. Request-level
`reasoning.effort`, `prompt_cache_key`, `instructions`, `tools`, and caller
input items are preserved; the proxy does not write a default effort into the
request. Jev can add a wire-level `configuration_update` at a validated input
boundary, and the lease decision includes the current generation. New user
boundaries or tool failures can end a lease early, while an identical HTTP
retry reuses its persisted decision.

Histories are namespaced by the configured upstream, account identifier when
available, and a stable thread identity. The identity is taken from
`thread_id` in `client_metadata["x-codex-turn-metadata"]`, the same metadata
header, a session ID header, or `prompt_cache_key`; a `turn_id` alone is not an
identity. Retention is 24 hours since actual request activity. The read-only
UI exposes the latest eight message previews, with each preview bounded to
4,000 characters. Full request histories, tool bodies, bearer tokens, and
images are not persisted by the store. UI reads do not extend retention.

The local UI and read-only endpoints are available at `/`, `/api/status`,
`/api/histories`, and `/api/histories/:id`. Responses transport is HTTP/SSE;
a `GET` WebSocket attempt at `/v1/responses` returns HTTP 426 so a Codex
client can fall back to HTTP/SSE. The proxy does not enable permissive CORS or
serve arbitrary filesystem paths.

For a stock Codex client, the following is a manual example of the relevant
provider entries. It is illustrative only; this project does not modify an
installed Codex configuration.

```toml
[model_providers.astra-jev]
name = "Astra Jev local proxy"
base_url = "http://127.0.0.1:17842/v1"
wire_api = "responses"
supports_websockets = false
requires_openai_auth = true

# In the profile or command that selects the provider:
model = "gpt-6-astra"
model_provider = "astra-jev"
```

The native backend setup above expects the client to provide its normal
Bearer token; `requires_openai_auth = true` keeps that behavior. Start the
proxy first, then select the provider in the client using the client's normal
configuration mechanism.

This implementation is independently structured from the reference project
[Astra Ares](https://github.com/miuuyy/Astra-Ares). That project informed the
provider contract and lease concepts; its source and prompts are not copied
here.

Verification status: this change was not tested, typechecked, built, started,
or exercised against a model provider, as required by the implementation
scope.
