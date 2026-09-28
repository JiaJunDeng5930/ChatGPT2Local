# ChatGPT Web API v1

This API runs tasks on retained ChatGPT webpages. It is not an OpenAI Responses API implementation or a Codex provider. It borrows `input`, `previous_response_id`, function-call items and SSE where they fit the actual browser boundary.

The caller chooses which response to continue, supplies only new messages or tool results, and executes its own tools. The server retains request receipts and the original webpage. It never searches message history to choose a page.

## HTTP contract

The default base URL is `http://127.0.0.1:8787`. All `/v1/*` endpoints require `Authorization: Bearer <application.json token>`. POST bodies use `Content-Type: application/json`. The service is a local, single-user application, not a multi-tenant endpoint. Callers sharing a profile also share its authorization and idempotency-key namespace.

| Endpoint | Meaning |
| --- | --- |
| `GET /v1/models` | Configured webpage effort choices, never native-provider models. |
| `GET /v1/schema` | `{protocol, request, response}` containing the JSON Schemas. |
| `POST /v1/responses` | Admit or observe one idempotent request; JSON or SSE output. |
| `GET /v1/responses/{id}` | Obtain a response resource without allocating or sending a browser message. |
| `POST /v1/responses/{id}/resume` | Reattach observation to the original page. Body `{}` or `{"confirm":true}`. |
| `POST /v1/responses/{id}/cancel` | Explicitly cancel the owning webpage turn. Body `{}`. |

Resume and cancel return `{"ok":true,"response_id":"..."}` after accepting the action. Cancel is an explicit Stop request, not a claim that a remote server acknowledged Stop. `confirm:true` means the user inspected the original page and confirms that its present answer includes all tool results. Neither action creates a page, resends a prompt, or executes caller tools.

Other routes, including `/responses`, compaction endpoints, native-provider forwarding and model-profile installation, are absent. The local desktop retains its separate authenticated `/control/*` interface.

## Request identity

Every `POST /v1/responses` requires an `Idempotency-Key`: 1–256 printable non-space ASCII characters. Use a new globally unique value, such as a UUID, for each new logical request. Retain both that value and its original body until its response is known.

Reusing a key with the same body observes or replays the original request. It does not allocate, prepare or send a second browser message. Reusing it with different content returns `409 idempotency_conflict`. Changing `stream` is allowed when retrying. JSON object-key order is insignificant; array order and other fields remain significant. Omitted and null `previous_response_id` are equivalent. A string input and an equivalent message array are different request bodies.

Keys identify requests, not conversations. Two root requests with identical messages and different keys create different pages. There is no implicit deduplication by message text, task ID, thread ID or history prefix.

Admission reserves a durable response ID before browser effects. Successful POST responses include `X-Response-Id`, `Location`, and `X-Web-Protocol: chatgpt-web.v1`. Treat response IDs as opaque. A failed validation or page-eligibility check does not consume a new key. An accepted request whose external effect becomes uncertain retains its key; changing keys is not a safe automatic retry strategy.

## Starting and continuing

A root request has no predecessor and requires a model:

```json
{
  "model": "chatgpt-web/medium",
  "instructions": "Answer the user's questions.",
  "input": "Explain this design.",
  "stream": true
}
```

The supported model IDs are `chatgpt-web/light`, `chatgpt-web/medium`, `chatgpt-web/high`, `chatgpt-web/xhigh`, and `chatgpt-web/pro`. These select webpage controls; they do not name native API models. A configured or account-unavailable effort fails instead of silently using another effort.

`instructions`, `tools`, and `text.format` are optional root settings. `stream` defaults to false. Tools default to an empty array. The service must be configured in `full` mode to admit caller tools; otherwise it returns `tools_disabled`. A root without tools uses browser-only execution even when the service allows tools.

After a `completed` response, send only the new messages:

```json
{
  "previous_response_id": "<the completed response ID>",
  "input": "Now compare it with the alternative.",
  "stream": true
}
```

Do not resend the old messages or assistant output. The predecessor identifies the exact existing page. Continuations inherit the root model, effort, instructions, tools and output format. Supplying any of those settings again is an error, including supplying an identical value. Only `previous_response_id`, `input`, and `stream` are allowed on a continuation.

Each response can have one successor. Competing successors, including those admitted concurrently, return `409 previous_response_consumed`. Retrying the winning successor's original key still works. To branch, change settings or replace context with a summary, create a new root and explicitly supply the desired context. The server does not clone conversations or synthesize summaries.

A completed predecessor is usable only while its original document, ownership marker and final answer remain intact. Navigation, manual conversation edits, missing pages and conflicting ownership reject continuation. The server does not silently allocate a replacement page. An `in_progress` ID is observable but cannot yet be used as a predecessor; first obtain its committed `requires_action` or `completed` response.

## Message and image input

`input` is either a nonempty string or a nonempty homogeneous array. Message records have `type:"message"`, a `role` of `system`, `developer`, `user`, or `assistant`, and `content` as a nonempty string or an array of parts:

```json
{
  "type": "message",
  "role": "user",
  "content": [
    {"type": "input_text", "text": "Describe the image."},
    {"type": "input_image", "image_url": "data:image/png;base64,<bytes>"}
  ]
}
```

Messages are framed as structured context in a webpage message; these role labels do not create actual provider-side system/developer messages. Instructions remain subject to the webpage's own behavior and policies.

Images must be canonical base64 data URLs for PNG, JPEG, WebP or GIF. Each image is limited to 20 MiB and each request to 32 images, also subject to the overall HTTP limit. Remote URLs, local paths and arbitrary file parts are rejected rather than fetched or silently omitted.

One message request produces one complete browser prompt. The default budget is 28,000 estimated tokens and 200,000 UTF-8 prompt bytes, with an 8,192-token platform allowance and 8,192-token allowance per image. These are configurable admission budgets, not claims about the provider's context window. Oversize input returns `413 message_too_large` before request admission. The caller performs any staging or summarization as explicit requests. No automatic multipart prompt sequence or compaction endpoint exists.

## Caller tools

Declare flat, unique tool names at the root. Names match `[A-Za-z0-9_$.-]{1,256}`. Function tools require synchronous JSON Schema draft-07 parameters. Custom tools receive a string. No nested registry, command aliases or runtime-specific gateway is inferred.

```json
{
  "model": "chatgpt-web/high",
  "input": "Inspect the project.",
  "tools": [
    {"type":"function","name":"project.read","description":"Read a project file","parameters":{"type":"object","properties":{"path":{"type":"string"}},"required":["path"],"additionalProperties":false}},
    {"type":"custom","name":"project.patch","description":"Apply a textual patch"}
  ]
}
```

A tool response has `status:"requires_action"` and an `output` array of calls. A `function_call` contains `id`, `call_id`, `name`, and an **object** `arguments`, not a JSON-encoded string. A `custom_tool_call` contains the same identities and a string `input` instead of `arguments`.

The caller executes or declines the calls under its own permissions and sandbox. It returns exactly one result for each call in that response, together in the next request:

```json
{
  "previous_response_id": "<the requires_action response ID>",
  "input": [
    {"type":"function_call_output","call_id":"<call ID>","output":"The file contents."}
  ],
  "stream": true
}
```

Use `custom_tool_call_output` for a custom call. Results cannot be mixed with messages. Missing, duplicated, foreign or incorrectly typed call IDs reject the entire request. The complete batch's result blobs and state transition commit atomically. These requests continue the waiting connector invocation on the same page; they do not click Send again. Each tool round receives a new response ID and idempotency key.

`output` strings are delivered verbatim. Other JSON values are rendered as JSON text, except an object with a `content` property: that shape is reserved for an MCP tool result. It must contain only a `content` array of text/image blocks, optional boolean `isError`, and optional object `structuredContent`. For example, `{"content":[{"type":"text","text":"Access declined"}],"isError":true}` returns a tool failure to the model. Encode opaque JSON with a reserved `content` field as a string instead. JSON-looking strings are never reparsed into rich results.

The webpage connector exposes only `web_tool_list` and `web_tool_call`, declared in `runtime/tool-bridge.ts`. Every call includes the current turn capability. MCP session IDs identify transport sessions, not execution authority. The exact caller tools and their schemas come from the admitted request. No tool runs in the server merely because its name resembles a shell or Codex command.

## Responses and streaming

The full resource follows `runtime/response-resource.schema.json`:

```json
{
  "id":"<response ID>",
  "object":"web.response",
  "protocol":"chatgpt-web.v1",
  "created_at":1790000000,
  "previous_response_id":null,
  "status":"completed",
  "model":"chatgpt-web/medium",
  "output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"The answer."}]}],
  "usage":{"input_tokens":100,"output_tokens":5,"total_tokens":105,"estimated":true}
}
```

`created_at` is the request's admission time in Unix seconds. Usage is an estimate for the framed browser message and final text, not the provider's accounting, billing or full conversation/tool-result context. Non-final responses have null usage.

An uncommitted resource can be `in_progress`, `interrupted` with an error, or `cancelled`. A committed response is immutable: `requires_action` records the calls returned by that API request; `completed` records its final answer. A later continuation or cancellation does not rewrite earlier committed responses. A response's status is not a live status report for all later requests in its conversation.

For `stream:true`, the response uses SSE:

| Event | Payload and meaning |
| --- | --- |
| `response.in_progress` | `response_id`, `previous_response_id`; admission/observation has begun, not a new Send receipt. |
| `response.output_text.snapshot` | `response_id`, complete provisional `text`, `provisional:true`. Replace the displayed provisional text. |
| `response.requires_action` | `response`: the committed full tool-call resource. |
| `response.completed` | `response`: the committed full final resource. |
| `error` | `response_id`, `code`, `message`; the original task is retained for inspection. |

Successful streams finish with `data: [DONE]`. Heartbeat comments are not progress or completion evidence. Snapshots may revise or shrink, are not append-only token deltas, and may be coalesced under backpressure. The terminal resource is authoritative. There is no event-log or `Last-Event-ID` replay contract: repeat the same POST/key to observe the current state or replay its committed result.

Disconnecting JSON/SSE subscribers, timing out a client, or restarting the service does not cancel or resend the webpage task. Restart restores durable state without reconnecting or repeating browser effects. Inspect the retained page and use `resume` explicitly where needed. When an interrupted POST returns an HTTP error, its retained identity is still available through `X-Response-Id` and the original key.

## Errors and recovery

Errors use `{"error":{"code":"...","message":"..."}}`. Schema/key errors are `400`; authentication is `401`; host/origin violations are `403`; unknown response IDs are `404`; oversized input is `413`. Browser completion that fails an explicit JSON output contract returns or records `422`-class boundary errors without regenerating an answer. After SSE headers, failures use the `error` event instead of changing the HTTP status.

The principal `409` conflicts are `idempotency_conflict`, `previous_response_pending`, `previous_response_consumed`, `previous_response_unavailable`, `messages_required`, `tool_results_required`, and `tool_results_mismatch`. An interrupted observer can return `operation_interrupted`; explicit cancellation can return `operation_cancelled`. Read the error and inspect the existing resource before deciding what to do. Do not blanket-retry a new key after an unknown outcome.

Request registration, predecessor consumption, page claiming and planned effects are one SQLite transaction. Final output and its continuation receipt are another atomic transaction. The Bend admission function decides from storage facts inside the transaction; optimistic page inspection alone cannot authorize a competing successor. Database/OS guarantees, observed DOM facts and digest collision resistance remain explicit trusted boundaries, not claims proved about external systems.

## Migration from version 6

Stop the old service, then run `bun runtime/cli.ts migrate --home <existing-profile>`. Migration preserves browser data, journals and the database, backs up changed configuration as `application.json.before-v7`, and removes native forwarding, Jev and automatic-history budget settings. Update the ChatGPT connector name to **ChatGPT Web Tools**, or set an explicit connector name in the local configuration.

Old provider-compatible response IDs and request metadata are not converted into v1 identities. Historical operations remain available for inspection and explicit cancellation, but cannot be resumed as new-protocol operations. A caller must establish a new root with explicit context. Migration sends no messages. The historical package name, home-directory name and desktop application identifier remain unchanged so this upgrade does not silently create a different browser profile.

The `previous_response_id` naming reference is OpenAI's [conversation-state guide](https://developers.openai.com/api/docs/guides/conversation-state). This document and the shipped schemas, not that API's additional behaviors, define this implementation's contract.
