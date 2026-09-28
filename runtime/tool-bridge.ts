/** One declaration supplies MCP discovery and the webpage's tool contract. */
import type { ObjectValue } from "./contracts";

const token = { type: "string", minLength: 20, maxLength: 256 };
export const BRIDGE_TOOLS = [
  { name: "web_tool_list", description: "List the caller's declared tools for this turn. Use exact returned names and schemas.",
    inputSchema: { type: "object", required: ["turn_token"], additionalProperties: false, properties: {
      turn_token: token, query: { type: "string", maxLength: 500 }, offset: { type: "integer", minimum: 0, maximum: 256 },
      limit: { type: "integer", minimum: 1, maximum: 50 },
    } }, annotations: { readOnlyHint: true, idempotentHint: true } },
  { name: "web_tool_call", description: "Ask the caller to execute one declared tool. Supply arguments for a function or input for a custom tool, never both.",
    inputSchema: { type: "object", required: ["turn_token", "name"], additionalProperties: false,
      oneOf: [{ required: ["arguments"], not: { required: ["input"] } }, { required: ["input"], not: { required: ["arguments"] } }],
      properties: { turn_token: token, name: { type: "string", minLength: 1, maxLength: 256 },
        arguments: { type: "object" }, input: { type: "string", maxLength: 5_000_000 } } } },
] as const;

export function toolContract(capability: string): string {
  return [
    "Use the caller's declared tools through the ChatGPT Web Tools connector. The caller owns execution, permissions, and results.",
    `Every connector call in this turn must include this turn_token: ${capability}`,
    "Earlier turn tokens in this conversation are not authority for the current turn. Do not disclose the token in the answer.",
    ...BRIDGE_TOOLS.map(tool => `${tool.name}: ${tool.description}\nInput schema: ${JSON.stringify(tool.inputSchema)}`),
    "Never invent tool names or results, and do not substitute this webpage's execution environment for the caller's tools.",
    "A disconnected HTTP observer does not complete, cancel, or restart this task.",
  ].join("\n\n");
}

export function bridgeDeclarations(): ObjectValue[] {
  return JSON.parse(JSON.stringify(BRIDGE_TOOLS)) as ObjectValue[];
}
