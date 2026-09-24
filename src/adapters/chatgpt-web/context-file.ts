import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CodexParsedRequest } from "../../types";
import type { CompiledChatGptWebPrompt } from "./prompt";

interface ContextEnvelope {
  version: number;
  system: unknown[];
  messages: Array<{ role: string; origin?: string; [key: string]: unknown }>;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function stageChatGptWebContext(
  compiled: CompiledChatGptWebPrompt,
  parsed: CodexParsedRequest,
  turnToken: string,
  manualControl = false,
): CompiledChatGptWebPrompt & { release: () => void } {
  if (compiled.multipart) throw new Error("File-backed Codex context does not use multipart browser transport");
  const opening = "<codex_context_json>\n";
  const closing = "\n</codex_context_json>";
  const start = compiled.text.indexOf(opening);
  const end = compiled.text.indexOf(closing, start + opening.length);
  if (start < 0 || end < 0) throw new Error("Compiled Codex context is missing its JSON envelope");
  const envelope = JSON.parse(compiled.text.slice(start + opening.length, end)) as ContextEnvelope;
  if (envelope.version !== 3 || !Array.isArray(envelope.system) || !Array.isArray(envelope.messages)) {
    throw new Error("Compiled Codex context has an invalid JSON envelope");
  }

  const latestUserIndex = envelope.messages.findLastIndex(message =>
    message.role === "user" && message.origin !== "codex_skill"
  );
  const currentIndex = latestUserIndex >= 0 ? latestUserIndex : envelope.messages.length - 1;
  const currentMessage = currentIndex >= 0 ? envelope.messages[currentIndex] : undefined;
  if (currentIndex >= 0) {
    envelope.messages[currentIndex] = { role: "current_message_reference" };
  }
  const context = JSON.stringify({
    version: envelope.version,
    system: envelope.system,
    messages: envelope.messages,
    request_options: {
      ...(parsed.options.verbosity ? { verbosity: parsed.options.verbosity } : {}),
      ...(parsed.options.outputFormat ? { output_format: parsed.options.outputFormat } : {}),
    },
  });
  const digest = createHash("sha256").update(context).digest("hex");
  const marker = `CODEX_CONTEXT_END ${digest}`;
  const directory = mkdtempSync(join(tmpdir(), "codex-chatgpt-context-"));
  const path = join(directory, "context.json.txt");
  try {
    writeFileSync(path, `${context}\n${marker}\n`, { encoding: "utf8", mode: 0o600 });
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }

  const turnReference = manualControl ? { request_id: turnToken } : { turn_token: turnToken };
  const readArguments = {
    ...turnReference,
    cmd: `cat -- ${shellQuote(path)}`,
    max_output_tokens: 100000,
  };
  const referenceKey = manualControl ? "request_id" : "turn_token";
  const toolInstructions = [
    "Codex Native tool calls (use the exact declared MCP tool names and JSON arguments):",
    manualControl
      ? "codex_turn_start({request_id}) connects this Zero Risk request; call it before any other Codex Native tool."
      : "Every Codex Native call in this response must include the same turn_token, including calls after tool results.",
    `codex_exec({${referenceKey}, cmd, workdir?, yield_time_ms?, max_output_tokens?, tty?, sandbox_permissions?, justification?, prefix_rule?}) runs a native command. If it returns session_id, continue with codex_write_stdin({${referenceKey}, session_id, chars?, yield_time_ms?, max_output_tokens?}).`,
    `codex_apply_patch({${referenceKey}, patch}) applies a native patch. codex_view_image({${referenceKey}, path, detail?}) views a local image; detail is high or original.`,
    `codex_tool_inventory({${referenceKey}, query?, offset?, limit?, include_schema?}) lists available outer Codex tools, their exact wire_name and, when include_schema is true, their arguments. Follow next_offset to inspect further pages when needed.`,
    `codex_tool_call({${referenceKey}, wire_name, arguments? or input?}) invokes a tool returned by codex_tool_inventory. Use arguments for a function tool and input for a freeform tool; never supply both. Follow that tool's declared schema. The outer Codex runtime performs execution and approvals.`,
    ...(manualControl
      ? ["When all work is finished, call codex_turn_complete({request_id, final_answer}) with the complete answer to Codex."]
      : []),
  ];
  const text = [
    "Act as the model backend for the Codex task. Use the attached Codex Native MCP tools to read the task context before acting.",
    ...toolInstructions,
    manualControl
      ? `First call codex_turn_start with ${JSON.stringify({ request_id: turnToken })}. Then call codex_exec with ${JSON.stringify(readArguments)}.`
      : `First call codex_exec with ${JSON.stringify(readArguments)}. Pass the same turn_token to every later Codex Native call.`,
    `The final file line must be ${marker}. If a tool reports truncation, read the remaining part before acting. If codex_exec is blocked before reaching Codex, use codex_tool_inventory to find an available native read tool and codex_tool_call to invoke it.`,
    "The file contains the original system messages, ordered conversation messages, and request options. Replace current_message_reference with the current message below at that position; preserve system, developer, and user priority.",
    "<codex_current_message_json>",
    JSON.stringify(currentMessage ?? null),
    "</codex_current_message_json>",
    manualControl
      ? "After reading the complete file, continue the Codex task and send its complete answer through codex_turn_complete. Do not disclose the request_id in the answer."
      : "After reading the complete file, continue the Codex task. Return only the task answer and do not disclose the turn_token.",
  ].join("\n");

  return {
    ...compiled,
    text,
    release: () => {
      try {
        rmSync(directory, { recursive: true, force: true });
      } catch (error) {
        console.error(`[chatgpt-web] could not remove staged Codex context: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
}
