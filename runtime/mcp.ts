/** JSON-RPC/MCP and outer-tool codecs. Execution remains in Application. */
import { randomBytes } from "node:crypto";
import { Application } from "./application";
import { BridgeError, type ObjectValue } from "./contracts";
import { canonical, digest, jsonResponse, object, readJson } from "./codec";
import { bridgeDeclarations } from "./tool-bridge";
import { validateArguments } from "./protocol";
import { VERSION } from "./config";

function structuredResult(value: ObjectValue): ObjectValue {
  return { content: [{ type: "text", text: canonical(value) }], structuredContent: value };
}

export class ToolMcp {
  constructor(readonly app: Application) {}

  async call(name: string, supplied: unknown, request: string): Promise<ObjectValue> {
    const declaration = bridgeDeclarations().find(tool => tool.name === name);
    if (!declaration) throw new BridgeError("unknown_mcp_tool", "The connector tool is not declared");
    const raw = object(validateArguments({ wire: name, name, kind: "function", schema: object(declaration.inputSchema),
      description: String(declaration.description) }, supplied));
    const token = String(raw.turn_token);
    return this.app.activity(token, `mcp:${request}`, { name, arguments: raw }, async () => {
      try {
        const tools = this.app.store.byCapability(token).context.tools;
        if (name === "web_tool_list") {
          const query = String(raw.query ?? "").toLowerCase();
          const matches = tools.filter(tool => !query || `${tool.name} ${tool.description}`.toLowerCase().includes(query));
          const offset = Number(raw.offset ?? 0), limit = Number(raw.limit ?? 20);
          const page = matches.slice(offset, offset + limit);
          return structuredResult({ tools: page.map(tool => ({ name: tool.name, type: tool.kind, description: tool.description,
            ...(tool.kind === "function" ? { parameters: tool.schema } : {}) })),
            next_offset: offset + page.length < matches.length ? offset + page.length : null });
        }
        const tool = tools.find(tool => tool.name === raw.name);
        if (!tool) throw new BridgeError("unknown_tool", "The caller did not declare this exact tool name");
        if ((tool.kind === "custom") !== (raw.input !== undefined)) throw new BridgeError("invalid_tool_input", "Use arguments for a function and input for a custom tool");
        return await this.app.invoke(token, request, tool.wire, tool.kind === "custom" ? raw.input : raw.arguments);
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: error instanceof BridgeError ? `${error.code}: ${error.message}`
          : "The caller-tool boundary failed. No automatic execution retry occurred." }] };
      }
    });
  }

  async handle(request: Request): Promise<Response> {
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } });
    const rpc = await readJson(request, 8 * 1024 * 1024);
    if (rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string") return jsonResponse({ jsonrpc: "2.0", id: rpc.id ?? null, error: { code: -32600, message: "Invalid JSON-RPC request" } }, 400);
    const id = rpc.id;
    if (id === undefined) return new Response(null, { status: 202 }); // Notifications never cancel a webpage or caller activity.
    if (typeof id !== "string" && typeof id !== "number") throw new BridgeError("invalid_rpc_id", "An RPC identity must be a string or number");
    if (rpc.method === "initialize") {
      const session = randomBytes(32).toString("base64url");
      this.app.store.saveSetting(`mcp-session:${digest(session)}`, true);
      const response = jsonResponse({ jsonrpc: "2.0", id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} },
        serverInfo: { name: "ChatGPT Web Tools", version: VERSION }, instructions: "Every tool call must carry its active turn_token. Transport cancellation is not task cancellation." } });
      response.headers.set("mcp-session-id", session);
      return response;
    }
    const session = request.headers.get("mcp-session-id");
    if (!session || !this.app.store.setting(`mcp-session:${digest(session)}`)) return jsonResponse({ error: "Initialize a new MCP transport session" }, 404);
    let result: ObjectValue;
    try {
      switch (rpc.method) {
        case "ping": result = {}; break;
        case "tools/list": result = { tools: bridgeDeclarations() }; break;
        case "tools/call": {
          const params = object(rpc.params);
          if (typeof params.name !== "string") throw new BridgeError("invalid_tool_name", "A tool name is required");
          result = await this.call(params.name, params.arguments ?? {}, `${session}:${typeof id}:${id}`);
          break;
        }
        default: return jsonResponse({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
      }
    } catch (error) {
      result = { isError: true, content: [{ type: "text", text: error instanceof BridgeError ? `${error.code}: ${error.message}` : "The caller-tool boundary failed. The existing operation was not restarted or cancelled." }] };
    }
    return jsonResponse({ jsonrpc: "2.0", id, result });
  }
}
