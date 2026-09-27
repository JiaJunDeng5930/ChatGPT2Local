/** JSON-RPC/MCP and outer-tool codecs. Execution remains in Application. */
import { randomBytes } from "node:crypto";
import { Application } from "./application";
import { BridgeError, type ObjectValue, type Tool } from "./contracts";
import { canonical, digest, jsonResponse, object, readJson } from "./codec";
import { NATIVE_TOOLS } from "./native-tools";
import { validateArguments } from "./protocol";
import { VERSION } from "./config";

function structuredResult(value: ObjectValue): ObjectValue {
  return { content: [{ type: "text", text: canonical(value) }], structuredContent: value };
}

function gateway(tool: Tool): boolean { return tool.kind === "custom" && tool.name === "exec" && !tool.namespace; }

const EMIT = `
function emit(value) {
  if (value && Array.isArray(value.content)) { for (const part of value.content) emit(part); return; }
  if (value && value.type === 'image') { image(value); return; }
  if (value && value.type === 'text') { text(value.text); return; }
  text(typeof value === 'string' ? value : JSON.stringify(value));
}
emit(result);`;

export class NativeMcp {
  constructor(readonly app: Application) {}

  private async nested(token: string, request: string, wire: string, value: unknown): Promise<ObjectValue> {
    const op = this.app.store.byCapability(token);
    const entry = op.context.tools.find(gateway);
    if (!entry) throw new BridgeError("native_tool_unavailable", "This native turn has no declared tool with that name and no exec gateway", 409);
    const script = `const name = ${JSON.stringify(wire)};
if (typeof ALL_TOOLS === 'undefined' || !ALL_TOOLS.some(t => t.name === name) || typeof tools[name] !== 'function')
  throw new Error('The requested exact native tool is unavailable');
const result = await tools[name](${canonical(value)});${EMIT}`;
    return this.app.invoke(token, request, entry.wire, script);
  }

  async call(name: string, supplied: unknown, request: string): Promise<ObjectValue> {
    const raw = object(supplied);
    if (typeof raw.turn_token !== "string") throw new BridgeError("capability_required", "The active turn_token is required");
    return this.app.activity(raw.turn_token, `mcp:${request}`, { name, arguments: raw }, async () => {
      try { return await this.dispatch(name, raw, request); }
      catch (error) { return { isError: true, content: [{ type: "text", text: error instanceof BridgeError ? `${error.code}: ${error.message}` : "The native tool boundary rejected this request. No automatic execution retry occurred." }] }; }
    });
  }

  private async dispatch(name: string, supplied: unknown, request: string): Promise<ObjectValue> {
    const declaration = NATIVE_TOOLS.find(tool => tool.name === name);
    if (!declaration) throw new BridgeError("unknown_mcp_tool", "The MCP tool is not declared");
    const args = object(validateArguments({ wire: name, name, kind: "function", schema: declaration.inputSchema, description: declaration.description }, supplied));
    const token = String(args.turn_token);
    const operation = this.app.store.byCapability(token);
    const tools = operation.context.tools;
    const { turn_token: _token, ...input } = args;
    if (name === "codex_tool_inventory") {
      const query = String(input.query ?? "").trim().toLowerCase();
      const offset = Number(input.offset ?? 0), limit = Number(input.limit ?? 20);
      const direct = tools.filter(tool => !query || `${tool.wire}\n${tool.description}`.toLowerCase().includes(query));
      const rows: ObjectValue[] = direct.map(tool => ({ wire_name: tool.wire, name: tool.name, kind: tool.kind === "custom" ? "freeform" : tool.kind,
        description: tool.description, ...(input.include_schema === false ? {} : { parameters: tool.schema }) }));
      const entry = tools.find(gateway);
      if (entry) {
        const excluded = tools.map(tool => tool.wire);
        const script = `if (typeof ALL_TOOLS === 'undefined' || !Array.isArray(ALL_TOOLS)) throw new Error('Native registry unavailable');
const exclude = new Set(${JSON.stringify(excluded)}), needle = ${JSON.stringify(query)};
const rows = ALL_TOOLS.filter(t => typeof t.name === 'string' && !exclude.has(t.name))
 .filter(t => !needle || (t.name + '\\n' + (t.description || '')).toLowerCase().includes(needle));
text(JSON.stringify(rows.map(t => ({wire_name:t.name, name:t.name, description:t.description || '', kind:t.type === 'custom' ? 'freeform' : 'gateway',
 ...(t.parameters ? {parameters:t.parameters} : {})}))));`;
        const result = await this.app.invoke(token, `${request}:registry`, entry.wire, script);
        if (result.isError) return result;
        const parts = Array.isArray(result.content) ? result.content.map(part => object(part)).filter(part => part.type === "text") : [];
        if (parts.length !== 1) throw new BridgeError("invalid_native_inventory", "The outer registry did not return one structured catalog", 502);
        const nested: unknown = JSON.parse(String(parts[0]!.text));
        if (!Array.isArray(nested)) throw new Error("Invalid outer catalog");
        for (const raw of nested) {
          const row = object(raw);
          if (typeof row.wire_name !== "string" || !/^[A-Za-z0-9_$.-]{1,1000}$/.test(row.wire_name)) throw new Error("Invalid exact outer wire name");
          rows.push(row);
        }
      }
      const page = rows.slice(offset, offset + limit);
      for (const row of page) this.app.store.putBlob(operation.id, `discovered:${row.wire_name}`, canonical(row));
      const value = structuredResult({ tools: page, total: rows.length, next_offset: offset + page.length < rows.length ? offset + page.length : null,
        discovery_tools: rows.length === 0 ? tools.filter(tool => tool.kind === "tool_search").map(tool => ({ wire_name: tool.wire, parameters: tool.schema })) : [] });
      return value;
    }
    if (name === "codex_tool_call") {
      if ((input.arguments === undefined) === (input.input === undefined)) throw new BridgeError("ambiguous_tool_input", "Supply exactly one of arguments or input");
      const wire = String(input.wire_name);
      const tool = tools.find(tool => tool.wire === wire);
      if (tool) {
        if ((tool.kind === "custom") !== (input.input !== undefined)) throw new BridgeError("wrong_tool_input_kind", "Use input for a freeform tool and arguments for a function tool");
        return this.app.invoke(token, request, wire, input.input ?? input.arguments);
      }
      if (!this.app.store.blob(operation.id, `discovered:${wire}`)) throw new BridgeError("tool_not_discovered", "Use an exact wire_name returned by this turn's inventory");
      return this.nested(token, request, wire, input.input ?? input.arguments);
    }
    const names: Record<string, string[]> = { codex_exec: ["exec_command", "shell_command"], codex_write_stdin: ["write_stdin"],
      codex_apply_patch: ["apply_patch"], codex_view_image: ["view_image"] };
    const candidates = tools.filter(tool => !tool.namespace && names[name]!.includes(tool.name));
    if (candidates.length > 1) throw new BridgeError("ambiguous_native_tool", "Several native tools match the requested adapter; use the exact inventory name");
    const tool = candidates[0];
    const value = name === "codex_apply_patch" ? input.patch : input;
    if (tool) {
      const translated = tool.name === "shell_command" ? this.shellArguments(input) : value;
      return this.app.invoke(token, request, tool.wire, translated);
    }
    if (name !== "codex_exec") return this.nested(token, request, names[name]![0]!, value);
    const entry = tools.find(gateway);
    if (!entry) throw new BridgeError("native_command_unavailable", "The outer task declares neither a command tool nor a native exec gateway", 409);
    const shell = this.shellArguments(input);
    const script = `if (typeof ALL_TOOLS === 'undefined') throw new Error('Native registry unavailable');
const candidates = ALL_TOOLS.filter(t => t.name === 'exec_command' || t.name === 'shell_command');
if (candidates.length !== 1) throw new Error('Exactly one native command tool is required');
const name = candidates[0].name;
const result = await tools[name](name === 'exec_command' ? ${canonical(input)} : ${canonical(shell)});${EMIT}`;
    return this.app.invoke(token, request, entry.wire, script);
  }

  private shellArguments(input: ObjectValue): ObjectValue {
    const { cmd, yield_time_ms, tty, max_output_tokens, ...rest } = input;
    return { ...rest, command: cmd!, ...(yield_time_ms === undefined ? {} : { timeout_ms: yield_time_ms }) };
  }

  async handle(request: Request): Promise<Response> {
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
    const rpc = await readJson(request, 8 * 1024 * 1024);
    if (rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string") return jsonResponse({ jsonrpc: "2.0", id: rpc.id ?? null, error: { code: -32600, message: "Invalid JSON-RPC request" } }, 400);
    const id = rpc.id;
    if (id === undefined) return new Response(null, { status: 202 }); // Notifications never cancel a webpage or native activity.
    if (typeof id !== "string" && typeof id !== "number") throw new BridgeError("invalid_rpc_id", "An RPC identity must be a string or number");
    if (rpc.method === "initialize") {
      const session = randomBytes(32).toString("base64url");
      this.app.store.saveSetting(`mcp-session:${digest(session)}`, true);
      const response = jsonResponse({ jsonrpc: "2.0", id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} },
        serverInfo: { name: "Codex Native2", version: VERSION }, instructions: "Every tool call must carry its active turn_token. Transport cancellation is not task cancellation." } });
      response.headers.set("mcp-session-id", session);
      return response;
    }
    const session = request.headers.get("mcp-session-id");
    if (!session || !this.app.store.setting(`mcp-session:${digest(session)}`)) return jsonResponse({ error: "Initialize a new MCP transport session" }, 404);
    let result: ObjectValue;
    try {
      switch (rpc.method) {
        case "ping": result = {}; break;
        case "tools/list": result = { tools: [...NATIVE_TOOLS].map(tool => ({ ...tool })) }; break;
        case "tools/call": {
          const params = object(rpc.params);
          if (typeof params.name !== "string") throw new BridgeError("invalid_tool_name", "A tool name is required");
          result = await this.call(params.name, params.arguments ?? {}, `${session}:${typeof id}:${id}`);
          break;
        }
        default: return jsonResponse({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
      }
    } catch (error) {
      result = { isError: true, content: [{ type: "text", text: error instanceof BridgeError ? `${error.code}: ${error.message}` : "The native boundary failed. The existing operation was not restarted or cancelled." }] };
    }
    return jsonResponse({ jsonrpc: "2.0", id, result });
  }
}
