/** ChatGPT Web API v1. Request schemas are codecs; admission is checked Bend. */
import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { BridgeError, type Context, type Effort, type Json, type Mode, type ObjectValue, type Tool } from "./contracts";
import { canonical, digest, object } from "./codec";
import type { Invocation } from "./kernel";
import type { Operation, RequestRecord, Store } from "./store";
import requestSchema from "./response.schema.json";
import responseSchema from "./response-resource.schema.json";

export const PROTOCOL = "chatgpt-web.v1";
export const REQUEST_SCHEMA = requestSchema;
export const RESPONSE_SCHEMA = responseSchema;
export const WEB_MODELS: readonly { id: string; effort: Effort; label: string }[] = Object.freeze([
  { id: "chatgpt-web/light", effort: "light", label: "ChatGPT Web · Instant" },
  { id: "chatgpt-web/medium", effort: "medium", label: "ChatGPT Web · Medium" },
  { id: "chatgpt-web/high", effort: "high", label: "ChatGPT Web · High" },
  { id: "chatgpt-web/xhigh", effort: "xhigh", label: "ChatGPT Web · Extra High" },
  { id: "chatgpt-web/pro", effort: "pro", label: "ChatGPT Web · Pro" },
]);

export interface RequestIdentity {
  round: string;
  responseId: string;
  fingerprint: string;
  previous: string | null;
  kind: "Messages" | "Results";
}

export interface ParsedRequest extends RequestIdentity {
  id: string;
  context: Context;
  stream: boolean;
  results: ObjectValue[];
}

const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: true });
addFormats(ajv);
const validateRequest = ajv.compile(requestSchema);
const validators = new Map<string, ValidateFunction>();

function validator(schema: ObjectValue): ValidateFunction {
  const key = digest(canonical(schema));
  const old = validators.get(key);
  if (old) return old;
  let compiled: ValidateFunction;
  try { compiled = ajv.compile(schema); }
  catch { throw new BridgeError("invalid_schema", "A supplied JSON schema is not valid"); }
  if ("$async" in compiled && compiled.$async) throw new BridgeError("invalid_schema", "Tool and output schemas must be synchronous JSON Schema draft-07");
  if (validators.size >= 128) validators.delete(validators.keys().next().value!);
  validators.set(key, compiled);
  return compiled;
}

export function validateArguments(tool: Tool, value: unknown): ObjectValue | string {
  if (tool.kind === "custom") {
    if (typeof value !== "string") throw new BridgeError("invalid_tool_input", "A freeform tool requires a string input");
    return value;
  }
  const args = object(value, "tool arguments");
  if (!validator(tool.schema)(args)) throw new BridgeError("invalid_tool_arguments", `Arguments do not satisfy the declared schema of ${tool.wire}`);
  return args;
}

export function decodeTools(value: Json | undefined): Tool[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new BridgeError("invalid_tools", "tools must be an array");
  const names = new Set<string>();
  return value.map(raw => {
    const tool = object(raw, "tool");
    if (typeof tool.name !== "string" || !/^[A-Za-z0-9_$.-]{1,256}$/.test(tool.name)) throw new BridgeError("invalid_tools", "A tool requires a valid name");
    if (names.has(tool.name)) throw new BridgeError("duplicate_tool", `The tool name ${tool.name} is ambiguous`);
    names.add(tool.name);
    if (tool.type !== "function" && tool.type !== "custom") throw new BridgeError("unsupported_tool", "Only caller-executed function and custom tools are supported");
    const schema = tool.type === "function" ? object(tool.parameters, "tool parameters") : { type: "string" };
    validator(schema);
    return { name: tool.name, wire: tool.name, kind: tool.type,
      description: typeof tool.description === "string" ? tool.description : "", schema };
  });
}

export function inputRecords(value: Json): ObjectValue[] {
  return typeof value === "string"
    ? [{ type: "message", role: "user", content: [{ type: "input_text", text: value }] }]
    : (value as Json[]).map(item => object(item, "input item"));
}

/** A result round supplies the complete, exact batch returned by its parent. */
function validateResults(input: ObjectValue[], output: Json): void {
  if (!Array.isArray(output)) throw new Error("A committed tool response lost its output");
  const expected = new Map(output.map(raw => {
    const call = object(raw);
    return [String(call.call_id), call.type === "custom_tool_call" ? "custom_tool_call_output" : "function_call_output"];
  }));
  if (input.length !== expected.size) throw new BridgeError("tool_results_mismatch", "Supply exactly one result for every call in previous_response_id", 409);
  for (const result of input) {
    const id = String(result.call_id);
    if (expected.get(id) !== result.type) throw new BridgeError("tool_results_mismatch", "A tool result is duplicated, unknown, or has the wrong type", 409);
    expected.delete(id);
  }
}

export function parseRequest(body: ObjectValue, headers: Headers, mode: Mode, store: Store): ParsedRequest {
  const suppliedKey = headers.get("idempotency-key");
  if (!suppliedKey || !/^[\x21-\x7e]{1,256}$/.test(suppliedKey))
    throw new BridgeError("idempotency_key_required", "Supply an Idempotency-Key of 1–256 printable ASCII characters without spaces");
  if (!validateRequest(body)) throw new BridgeError("invalid_request", `Request does not satisfy ChatGPT Web API v1: ${ajv.errorsText(validateRequest.errors)}`);
  const input = inputRecords(body.input!);
  const kind = input[0]!.type === "message" ? "Messages" : "Results";
  const previous = typeof body.previous_response_id === "string" ? body.previous_response_id : null;
  const semantic: ObjectValue = { ...body, previous_response_id: previous };
  delete semantic.stream;
  const round = digest(suppliedKey);
  const identity: RequestIdentity = { round, responseId: `resp_${round}`, fingerprint: digest(canonical(semantic)), previous, kind };
  const admission = store.admission(identity);
  const cached = store.request(round);
  if (admission.$ === "Replay") {
    if (!cached) throw new Error("A replay has no durable request");
    return { ...identity, id: cached.operation, context: store.get(cached.operation).context,
      stream: body.stream === true, results: kind === "Results" ? input : [] };
  }
  if (previous) {
    const parent = store.previous(previous);
    if (admission.$ === "DeliverResults") {
      validateResults(input, parent.body.output!);
      return { ...identity, id: parent.operation.id, context: parent.operation.context, stream: body.stream === true, results: input };
    }
    // Inherit settings, not messages. The predecessor points to the actual page.
    const { measurement: _measurement, ...settings } = parent.operation.context;
    return { ...identity, id: `web:${round}`, context: { ...settings, input, attachments: [] }, stream: body.stream === true, results: [] };
  }
  const model = WEB_MODELS.find(row => row.id === body.model)!;
  const tools = decodeTools(body.tools);
  if (mode !== "full" && tools.length) throw new BridgeError("tools_disabled", "This profile has caller tools disabled");
  const instructions = typeof body.instructions === "string" ? body.instructions : "";
  const textFormat = body.text === undefined ? undefined : object(object(body.text).format);
  if (textFormat?.type === "json_schema") validator(object(textFormat.schema));
  const effectiveMode: Mode = tools.length ? "full" : "browser-only";
  const environment = digest(canonical({ instructions, tools, model: model.id, mode: effectiveMode, text: textFormat ?? null }));
  const context: Context = { model: model.id, effort: model.effort, mode: effectiveMode, environment, instructions,
    input, tools, attachments: [], ...(textFormat ? { textFormat } : {}) };
  return { ...identity, id: `web:${round}`, context, results: [], stream: body.stream === true };
}

export function toolOutput(invocation: Invocation, tools: readonly Tool[]): ObjectValue {
  const payload = object(JSON.parse(invocation.payload), "tool invocation");
  const tool = tools.find(tool => tool.wire === payload.wire);
  if (!tool) throw new Error("A committed invocation lost its declared tool");
  const identity = { id: `item_${digest(invocation.id).slice(0, 32)}`, call_id: invocation.id };
  return tool.kind === "custom"
    ? { ...identity, type: "custom_tool_call", name: tool.name, input: String(payload.input) }
    : { ...identity, type: "function_call", name: tool.name, arguments: object(payload.arguments, "tool arguments") };
}

export function responseObject(operation: Operation, request: RequestRecord, output: ObjectValue[], usage: Json = null): ObjectValue {
  return { id: request.response_id, object: "web.response", protocol: PROTOCOL,
    created_at: Math.floor(request.created / 1000), previous_response_id: request.previous,
    status: output.some(item => item.type === "function_call" || item.type === "custom_tool_call") ? "requires_action" : "completed",
    model: operation.context.model, output, usage };
}

export function finalOutput(operation: Operation, text: string): ObjectValue[] {
  const format = operation.context.textFormat;
  if (format?.type === "json_schema" || format?.type === "json_object") {
    let value: unknown;
    try { value = JSON.parse(text); }
    catch { throw new BridgeError("output_not_json", "The webpage output is not the requested JSON; no regeneration occurred", 422); }
    if (format.type === "json_object") object(value, "output");
    else if (!validator(object(format.schema))(value)) throw new BridgeError("output_schema_mismatch", "The webpage output does not satisfy the requested schema; the page is retained", 422);
  }
  return [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }];
}

/** Internal final receipt. Public response identities belong to requests. */
export function finalReceipt(operation: Operation, text: string, usage: { input: number; output: number }): string {
  const encoded = canonical({ output: finalOutput(operation, text),
    usage: { input_tokens: usage.input, output_tokens: usage.output, total_tokens: usage.input + usage.output, estimated: true } });
  if (Buffer.byteLength(encoded) > 32 * 1024 * 1024) throw new BridgeError("output_too_large", "The complete response exceeds 32 MiB; it was not published or regenerated", 413);
  return encoded;
}

export interface SseEvent { type: string; [key: string]: Json }
export function* responseEvents(response: ObjectValue): Generator<SseEvent> {
  yield { type: `response.${response.status}`, response };
}
