/** Responses/MCP wire codecs. They do not own browser execution state. */
import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import { BridgeError, type Context, type Effort, type Json, type Mode, type ObjectValue, type Tool } from "./contracts";
import { canonical, digest, object } from "./codec";
import { array, compiled, list, type Invocation } from "./kernel";
import type { Operation, Store } from "./store";

export const WEB_MODELS: readonly { id: string; effort: Effort; codexEffort: string; label: string }[] = Object.freeze([
  { id: "chatgpt-web/light", effort: "light", codexEffort: "low", label: "ChatGPT Web · Instant" },
  { id: "chatgpt-web/medium", effort: "medium", codexEffort: "medium", label: "ChatGPT Web · Medium" },
  { id: "chatgpt-web/high", effort: "high", codexEffort: "high", label: "ChatGPT Web · High" },
  { id: "chatgpt-web/xhigh", effort: "xhigh", codexEffort: "xhigh", label: "ChatGPT Web · Extra High" },
  { id: "chatgpt-web/pro", effort: "pro", codexEffort: "ultra", label: "ChatGPT Web · Pro" },
]);

export interface ParsedRequest {
  id: string;
  round: string;
  context: Context;
  stream: boolean;
  body: ObjectValue;
  results: ObjectValue[];
}

const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: true });
addFormats(ajv);
const validators = new Map<string, ValidateFunction>();

function validator(schema: ObjectValue): ValidateFunction {
  const key = digest(canonical(schema));
  const old = validators.get(key);
  if (old) return old;
  let compiled: ValidateFunction;
  try { compiled = ajv.compile(schema); }
  catch { throw new BridgeError("invalid_schema", "A supplied JSON schema is not valid"); }
  // A codec cache is bounded; its eviction does not alter an operation or page.
  if (validators.size >= 128) validators.delete(validators.keys().next().value!);
  validators.set(key, compiled);
  return compiled;
}

export function validateArguments(tool: Tool, value: unknown): ObjectValue | string {
  if (tool.kind === "custom") {
    if (typeof value !== "string") throw new BridgeError("invalid_tool_input", "A freeform tool requires input, not JSON arguments");
    return value;
  }
  const args = object(value, "tool arguments");
  if (!validator(tool.schema)(args)) throw new BridgeError("invalid_tool_arguments", `Arguments do not satisfy the declared schema of ${tool.wire}`);
  return args;
}

export function decodeTools(value: Json | undefined, namespace?: string): Tool[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new BridgeError("invalid_tools", "tools must be an array");
  const result: Tool[] = [];
  for (const raw of value) {
    const tool = object(raw, "tool");
    if (tool.type === "namespace") {
      if (typeof tool.name !== "string" || !tool.name || namespace) throw new BridgeError("invalid_tools", "A tool namespace must have a nonempty, nonnested name");
      result.push(...decodeTools(tool.tools, tool.name === "functions" ? undefined : tool.name));
      continue;
    }
    if (tool.type === "function") {
      const spec = tool.function ? object(tool.function, "function") : tool;
      if (typeof spec.name !== "string" || !/^[A-Za-z0-9_$.-]{1,256}$/.test(spec.name)) throw new BridgeError("invalid_tools", "A function tool requires a valid name");
      const schema = object(spec.parameters ?? { type: "object", properties: {} }, "tool parameters");
      validator(schema);
      result.push({ name: spec.name, wire: namespace ? `${namespace}__${spec.name}` : spec.name,
        ...(namespace ? { namespace } : {}), kind: "function", description: typeof spec.description === "string" ? spec.description : "", schema });
    } else if (tool.type === "custom") {
      if (typeof tool.name !== "string" || !tool.name) throw new BridgeError("invalid_tools", "A custom tool requires a name");
      result.push({ name: tool.name, wire: namespace ? `${namespace}__${tool.name}` : tool.name,
        ...(namespace ? { namespace } : {}), kind: "custom", description: typeof tool.description === "string" ? tool.description : "",
        schema: { type: "string" } });
    } else if (tool.type === "tool_search" && (tool.execution === undefined || tool.execution === "client")) {
      result.push({ wire: "tool_search", name: "tool_search", kind: "tool_search", description: "Discover deferred tools from the outer Codex runtime.",
        schema: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 50 } }, required: ["query"], additionalProperties: false } });
    } else {
      throw new BridgeError("unsupported_tool", `Web tasks cannot execute the undeclared native tool type ${String(tool.type)}. Use native passthrough for server-side tools.`);
    }
  }
  const wires = new Set<string>();
  for (const tool of result) {
    if (wires.has(tool.wire)) throw new BridgeError("duplicate_tool", `The tool wire name ${tool.wire} is ambiguous`);
    wires.add(tool.wire);
  }
  return result;
}

function metadata(body: ObjectValue, headers: Headers): ObjectValue {
  const client = body.client_metadata ? object(body.client_metadata, "client_metadata") : {};
  const raw = client["x-codex-turn-metadata"] ?? headers.get("x-codex-turn-metadata");
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "string") return object(raw, "native turn metadata");
  try { return object(JSON.parse(raw), "native turn metadata"); }
  catch { throw new BridgeError("invalid_turn_metadata", "Native turn metadata is not valid JSON"); }
}

function optionalIdentity(value: Json | undefined, name: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !value.trim() || value.length > 1024) throw new BridgeError("invalid_turn_identity", `${name} is not a valid identity`);
  return value;
}

export function inputRecords(value: Json | undefined): ObjectValue[] {
  if (typeof value === "string") return [{ type: "message", role: "user", content: [{ type: "input_text", text: value }] }];
  if (!Array.isArray(value)) throw new BridgeError("invalid_input", "input must be a string or a complete ordered array of Responses items");
  return value.map(item => {
    const raw = object(item, "input item");
    if (raw.type === undefined && typeof raw.role === "string") return { ...raw, type: "message" };
    if (typeof raw.type !== "string") throw new BridgeError("invalid_input", "Every input item requires a type");
    return raw;
  });
}

/** Transport-assigned message IDs/statuses do not change semantic history. */
export function symbol(item: ObjectValue): string {
  const value = { ...item };
  delete value.id;
  delete value.status;
  delete value.created_at;
  delete value.internal_chat_message_metadata_passthrough;
  if (value.type === "message") {
    if (typeof value.content === "string") value.content = [{ type: "text", text: value.content }];
    if (Array.isArray(value.content)) value.content = value.content.map(raw => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
      const part = { ...raw };
      if (part.type === "input_text" || part.type === "output_text") {
        part.type = "text";
        delete part.annotations;
        delete part.logprobs;
      }
      return part;
    });
  }
  return digest(canonical(value));
}

export function parseRequest(body: ObjectValue, headers: Headers, mode: Mode, store: Store, compactV1 = false): ParsedRequest {
  if (typeof body.model !== "string") throw new BridgeError("invalid_model", "model is required");
  const model = WEB_MODELS.find(row => row.id === body.model);
  if (!model) throw new BridgeError("unknown_web_model", "The selected Web model is not in this profile's catalog");
  if (body.stream !== undefined && typeof body.stream !== "boolean") throw new BridgeError("invalid_stream", "stream must be a boolean");
  let input = inputRecords(body.input);
  if (body.previous_response_id !== undefined && body.previous_response_id !== null) {
    if (typeof body.previous_response_id !== "string") throw new BridgeError("invalid_previous_response", "previous_response_id must be a string");
    const previous = store.previous(body.previous_response_id);
    input = [...previous.input, ...previous.output.map(item => object(item)), ...input];
  }
  const native = metadata(body, headers);
  const thread = optionalIdentity(native.thread_id, "thread_id") ?? optionalIdentity(body.prompt_cache_key, "prompt_cache_key");
  const turn = optionalIdentity(native.turn_id, "turn_id");
  const compactV2 = input.at(-1)?.type === "compaction_trigger";
  const purpose = compactV1 ? "compact-v1" : compactV2 ? "compact-v2" : "response";
  if (input.some(item => item.type === "agent_message" && typeof item.encrypted_content === "string" && !item.content))
    throw new BridgeError("opaque_agent_message", "This Web model cannot decrypt a native agent message. The outer runtime must supply its readable content.");
  if (purpose !== "response") input = input.filter(item => item.type !== "compaction_trigger");
  if (!input.length) throw new BridgeError("empty_input", "A Web request requires at least one context item");
  const instructions = body.instructions === undefined || body.instructions === null ? "" : body.instructions;
  if (typeof instructions !== "string") throw new BridgeError("invalid_instructions", "instructions must be a string");
  const tools = purpose === "response" && mode === "full" ? decodeTools(body.tools) : [];
  const text = body.text === undefined ? undefined : object(body.text, "text controls");
  const textFormat = text?.format === undefined ? undefined : object(text.format, "text format");
  if (textFormat?.type === "json_schema") validator(object(textFormat.schema, "output schema"));
  else if (textFormat && textFormat.type !== "text" && textFormat.type !== "json_object") throw new BridgeError("invalid_text_format", "Unsupported text format");
  const reasoning = body.reasoning ? object(body.reasoning, "reasoning") : {};
  if (reasoning.effort !== undefined && reasoning.effort !== model.codexEffort)
    throw new BridgeError("fixed_web_effort", `${model.id} has immutable effort ${model.codexEffort}; choose another catalog model before starting a new turn`);
  const environment = digest(canonical({ instructions, tools, model: model.id, mode, thread: thread ?? null,
    workspaces: native.workspaces ?? null, cwd: native.cwd ?? null, sandbox: native.sandbox_policy ?? native.sandbox ?? null,
    text: textFormat ?? null, purpose }));
  const suppliedKey = headers.get("idempotency-key");
  if (!turn && (!suppliedKey || suppliedKey.length > 1024))
    throw new BridgeError("operation_identity_required", "Web execution requires native turn_id metadata or an explicit Idempotency-Key. A transport retry must not create another send.");
  // Keep the old native identity representation so an old ownership receipt
  // cannot be escaped by migrating storage or changing provider settings.
  const id = purpose === "response" && turn
    ? `native:${digest(JSON.stringify({ threadId: thread, turnId: turn, purpose: "response" }))}`
    : purpose === "response" ? `request:${digest(canonical({ thread: thread ?? null, key: suppliedKey }))}`
    : `${purpose}:${digest(canonical({ thread: thread ?? null, turn: turn ?? suppliedKey, input, purpose }))}`;
  const symbols = input.map(symbol);
  const results = input.filter(item => ["function_call_output", "custom_tool_call_output", "tool_search_output"].includes(String(item.type)));
  const round = digest(canonical({ id, results: results.map(item => { const copy = { ...item }; delete copy.id; return copy; }) }));
  const context: Context = { model: model.id, effort: model.effort, mode, environment, purpose, instructions, input, symbols, tools, attachments: [],
    ...(textFormat ? { textFormat } : {}), ...(thread ? { thread } : {}), ...(turn ? { turn } : {}) };
  return { id, round, context, results, stream: body.stream === true && !compactV1, body };
}

export function validateContinuation(operation: Operation, parsed: ParsedRequest): void {
  const known = operation.context.symbols;
  const incoming = parsed.context.symbols;
  if (operation.context.environment !== parsed.context.environment) throw new BridgeError("operation_environment_changed", "This operation retains its original model, instructions, tools, and environment. Its webpage remains active; start a distinct user turn to change them.", 409);
  // history_plan requires a proper prefix. A sentinel outside the hexadecimal
  // symbol alphabet allows equal-length idempotent API rounds to use the same
  // checked relation without accepting any changed original item.
  const relation = compiled.history_plan(operation.context.environment, parsed.context.environment, list(known), list([...incoming, "!transport-end"]));
  if (relation.$ !== "Some" || relation.value !== BigInt(known.length)) throw new BridgeError("history_diverged", "The request changed history already submitted to the webpage", 409);
  for (const item of parsed.context.input.slice(known.length)) {
    if (!compiled.transcript_item(String(item.type), typeof item.role === "string" ? item.role : ""))
      throw new BridgeError("unsent_instruction", "A new instruction under the same native turn was not sent to the webpage. It cannot be credited as retained history.", 409);
  }
}

export function toolOutput(invocation: Invocation, tools: readonly Tool[]): ObjectValue {
  const payload = object(JSON.parse(invocation.payload), "native invocation");
  const tool = tools.find(tool => tool.wire === payload.wire);
  if (!tool) throw new Error("A committed invocation lost its declared native tool");
  const identity = { id: `item_${digest(invocation.id).slice(0, 32)}`, call_id: invocation.id, status: "completed" };
  if (tool.kind === "custom") return { ...identity, type: "custom_tool_call", name: tool.name, input: String(payload.input), ...(tool.namespace ? { namespace: tool.namespace } : {}) };
  if (tool.kind === "tool_search") return { ...identity, type: "tool_search_call", execution: "client", arguments: object(payload.arguments, "tool search arguments") };
  return { ...identity, type: "function_call", name: tool.name, arguments: canonical(payload.arguments), ...(tool.namespace ? { namespace: tool.namespace } : {}) };
}

export function responseObject(operation: Operation, round: string, output: ObjectValue[], usage?: { input: number; output: number }): ObjectValue {
  const id = `resp_${digest(`${operation.id}:${round}`).slice(0, 40)}`;
  return { id, object: "response", created_at: Math.floor(operation.created / 1000), status: "completed", error: null, incomplete_details: null,
    model: operation.context.model, output, parallel_tool_calls: true,
    usage: usage ? { input_tokens: usage.input, input_tokens_details: { cached_tokens: 0 }, output_tokens: usage.output,
      output_tokens_details: { reasoning_tokens: 0 }, total_tokens: usage.input + usage.output } : null };
}

export const COMPACTION_PREFIX = "ocx1:";
export const SUMMARY_PREFIX = "Another language model started to solve this problem and produced a summary of its thinking process. You also have access to the state of the tools that were used by that language model. Use this to build on the work that has already been done and avoid duplicating work. Here is the summary produced by the other language model, use the information in this summary to assist with your own analysis:";

export function finalOutput(operation: Operation, text: string): ObjectValue[] {
  const context = operation.context;
  if (context.purpose === "compact-v2") return [{ type: "compaction", id: `cmp_${digest(operation.id).slice(0, 32)}`, encrypted_content: COMPACTION_PREFIX + Buffer.from(text).toString("base64") }];
  if (context.purpose === "compact-v1") return [{ type: "message", role: "user", content: [{ type: "input_text", text: `${SUMMARY_PREFIX}\n${text}` }] }];
  const format = context.textFormat;
  if (format?.type === "json_schema" || format?.type === "json_object") {
    let value: unknown;
    try { value = JSON.parse(text); }
    catch { throw new BridgeError("output_not_json", "The webpage output is not the requested JSON. The page is retained; no regeneration was requested.", 422); }
    if (format.type === "json_object") object(value, "output");
    else if (!validator(object(format.schema))(value)) throw new BridgeError("output_schema_mismatch", "The webpage output does not satisfy the requested schema. The page and tool capability remain open.", 422);
  }
  return [{ type: "message", id: `msg_${digest(operation.id).slice(0, 32)}`, status: "completed", role: "assistant", phase: "final_answer",
    content: [{ type: "output_text", text, annotations: [], logprobs: [] }] }];
}

export function finalReceipt(operation: Operation, text: string, usage?: { input: number; output: number }): string {
  const output = finalOutput(operation, text);
  const value = operation.context.purpose === "compact-v1"
    ? { id: `cmp_${digest(operation.id).slice(0, 32)}`, object: "response.compaction", created_at: Math.floor(operation.created / 1000), output,
      usage: usage ? { input_tokens: usage.input, output_tokens: usage.output, total_tokens: usage.input + usage.output } : null }
    : responseObject(operation, "final", output, usage);
  const encoded = canonical(value);
  if (Buffer.byteLength(encoded) > 32 * 1024 * 1024) throw new BridgeError("output_too_large", "The complete encoded response exceeds 32 MiB. It was not published or regenerated.", 413);
  return encoded;
}

export interface SseEvent { type: string; [key: string]: Json }

/** A completed durable response has one deterministic wire-event expansion. */
export function responseEvents(body: ObjectValue): SseEvent[] {
  const output = Array.isArray(body.output) ? body.output.map(item => object(item)) : [];
  const base = { ...body, output: [], status: "in_progress", usage: null };
  const events: SseEvent[] = [{ type: "response.created", response: base }, { type: "response.in_progress", response: base }];
  output.forEach((item, index) => {
    const itemId = typeof item.id === "string" ? item.id : `item_${digest(canonical(item)).slice(0, 32)}`;
    const started: ObjectValue = { ...item, id: itemId, status: "in_progress" };
    if (item.type === "message") started.content = [];
    if (item.type === "function_call") started.arguments = "";
    if (item.type === "custom_tool_call") started.input = "";
    events.push({ type: "response.output_item.added", output_index: index, item: started });
    if (item.type === "message" && Array.isArray(item.content)) {
      item.content.forEach((raw, contentIndex) => {
        const part = object(raw);
        if (part.type !== "output_text") return;
        const text = String(part.text);
        events.push({ type: "response.content_part.added", item_id: itemId, output_index: index, content_index: contentIndex, part: { type: "output_text", text: "", annotations: [], logprobs: [] } });
        // Chunk a receipt for transport, never re-sample or mutate the source page.
        for (let offset = 0; offset < text.length;) {
          let end = Math.min(offset + 2048, text.length);
          if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]!)) end--;
          events.push({ type: "response.output_text.delta", item_id: itemId, output_index: index, content_index: contentIndex, delta: text.slice(offset, end), logprobs: [] });
          offset = end;
        }
        events.push({ type: "response.output_text.done", item_id: itemId, output_index: index, content_index: contentIndex, text, logprobs: [] });
        events.push({ type: "response.content_part.done", item_id: itemId, output_index: index, content_index: contentIndex, part });
      });
    } else if (item.type === "function_call") {
      events.push({ type: "response.function_call_arguments.delta", item_id: itemId, output_index: index, delta: String(item.arguments) });
      events.push({ type: "response.function_call_arguments.done", item_id: itemId, output_index: index, arguments: String(item.arguments), name: String(item.name) });
    } else if (item.type === "custom_tool_call") {
      events.push({ type: "response.custom_tool_call_input.delta", item_id: itemId, output_index: index, delta: String(item.input) });
      events.push({ type: "response.custom_tool_call_input.done", item_id: itemId, output_index: index, input: String(item.input) });
    }
    events.push({ type: "response.output_item.done", output_index: index, item: { ...item, id: itemId } });
  });
  events.push({ type: "response.completed", response: body });
  return events.map((event, sequence_number) => ({ ...event, sequence_number }));
}

export function invocationIds(operation: Operation): string[] {
  return array(operation.state.broker.invocations).map(invocation => invocation.id);
}
