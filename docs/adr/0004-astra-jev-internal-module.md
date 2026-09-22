# Integrate Astra Jev as an internal model module

Status: Accepted

Date: 2026-09-23

## Context

The `astra-jev` model needs retained history, Jev effort and lease decisions, raw Responses
HTTP/SSE forwarding, and a small settings surface. The existing application already owns the
Responses listener, control-token authorization, request cancellation, and launcher lifecycle.
Running a second proxy introduced a second port, a second lifecycle, a second configuration home,
and a separate user-visible setup flow.

## Decision

Keep the controller, settings store, Jev client, history store, and raw stream handling in the
internal `src/astra-jev/` module. The main daemon creates one `AstraJevService` and routes the
existing `astra-jev` catalog alias through it before native passthrough. The service normalizes the
model name on a cloned outbound body and forwards through the existing authenticated native
Responses transport as `gpt-6-astra`; it does not invoke the ChatGPT Web parser.

The daemon owns the three authenticated admin routes for state, settings, and retained history.
The launcher bridge and renderer use those routes through the existing runtime lifecycle. Provider
keys are stored one per provider under the main config directory's `astra-jev/` directory with
`0600` permissions. Missing keys are represented as unconfigured state and do not prevent daemon
startup. A settings save changes only future request snapshots.

## Consequences

There is one listener and one shutdown path. The old standalone package, command, port, static host,
and independent configuration directory are removed. The model catalog can append the alias without
altering native or ChatGPT Web rows. History reads sweep expired idle entries without refreshing
activity, and active requests retain the settings and Jev client captured at their start.
