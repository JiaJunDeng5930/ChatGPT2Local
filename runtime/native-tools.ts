/** One declaration supplies MCP discovery and the browser's execution contract. */
import type { ObjectValue } from "./contracts";

const string = (maxLength = 100_000): ObjectValue => ({ type: "string", maxLength });
const integer = (minimum: number, maximum: number): ObjectValue => ({ type: "integer", minimum, maximum });
const token = { type: "string", minLength: 20, maxLength: 256 };
const object = { type: "object", additionalProperties: true };

export interface NativeToolDeclaration {
  name: string;
  description: string;
  inputSchema: ObjectValue;
  annotations?: ObjectValue;
}

function declaration(name: string, description: string, properties: ObjectValue, required: string[] = []): NativeToolDeclaration {
  return { name, description, inputSchema: { type: "object", properties: { turn_token: token, ...properties },
    required: ["turn_token", ...required], additionalProperties: false } };
}

export const NATIVE_TOOLS: readonly NativeToolDeclaration[] = Object.freeze([
  declaration("codex_exec", "Run the command tool advertised by this outer Codex turn. The outer runtime owns execution, sandboxing, and approvals. If session_id is returned, use codex_write_stdin with the same turn_token.", {
    cmd: { ...string(100_000), minLength: 1 }, workdir: string(16_384), yield_time_ms: integer(250, 30_000),
    max_output_tokens: integer(1, 1_000_000), tty: { type: "boolean" },
    sandbox_permissions: { enum: ["use_default", "require_escalated"] }, justification: string(),
    prefix_rule: { type: "array", items: string() },
  }, ["cmd"]),
  declaration("codex_write_stdin", "Continue a native command session or poll it. A timeout is not completion; preserve the session_id and the same turn_token.", {
    session_id: integer(0, Number.MAX_SAFE_INTEGER), chars: string(1_000_000), yield_time_ms: integer(250, 300_000), max_output_tokens: integer(1, 1_000_000),
  }, ["session_id"]),
  declaration("codex_apply_patch", "Apply a patch with the native Codex patch tool. The outer runtime performs the file change and approvals.", {
    patch: { ...string(5_000_000), minLength: 1 },
  }, ["patch"]),
  declaration("codex_view_image", "View an image through the native Codex image tool. Use an absolute path. The outer runtime supplies the actual image.", {
    path: { ...string(16_384), minLength: 1 }, detail: { enum: ["high", "original"] },
  }, ["path"]),
  { ...declaration("codex_tool_inventory", "List exact tools and their wire names in this outer Codex turn. Follow next_offset. Use a returned wire_name with codex_tool_call; do not guess names or arguments.", {
    query: string(500), offset: integer(0, 100_000), limit: integer(1, 50), include_schema: { type: "boolean" },
  }), annotations: { readOnlyHint: true, idempotentHint: true } },
  declaration("codex_tool_call", "Invoke an exact tool returned by codex_tool_inventory. Supply arguments for a function tool or input for a freeform tool, never both. The outer Codex runtime owns execution and approvals.", {
    wire_name: { ...string(1000), minLength: 1 }, arguments: object, input: string(5_000_000),
  }, ["wire_name"]),
]);

export function nativeContract(capability: string): string {
  return [
    "Act as the model backend for the current Codex task. Finish the user's task using the supplied context and actual native tools.",
    "Every Codex Native call in this response must use the following active turn_token, including calls after tool results:",
    capability,
    "Any earlier turn_token in this retained webpage belongs to an earlier turn and is not authority for this one.",
    "The outer Codex runtime owns all commands, file changes, approvals, sessions, and its tool registry. Do not simulate results or substitute this webpage's execution environment.",
    ...NATIVE_TOOLS.map(tool => `${tool.name}: ${tool.description}\nInput schema: ${JSON.stringify(tool.inputSchema)}`),
    "Return only the task answer. Do not disclose turn_token. A disconnected transport or a tool timeout does not complete, cancel, or restart the task.",
  ].join("\n\n");
}
