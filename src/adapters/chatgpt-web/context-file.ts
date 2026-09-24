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

  const text = [
    "Act as the model backend for this Codex task.",
    manualControl
      ? `First call codex_turn_start with request_id ${turnToken}. Then call codex_exec to read the context file.`
      : `Pass turn_token ${turnToken} unchanged to every Codex Native tool call. First call codex_exec to read the context file.`,
    `For codex_exec use cmd ${JSON.stringify(`cat -- ${shellQuote(path)}`)} and max_output_tokens 100000. The final line must be ${marker}. If the tool reports truncation or that line is absent, read the file in chunks before proceeding. If the file cannot be read completely, report the failure without acting on the task.`,
    "The file contains Codex system messages, ordered conversation messages, and request options. Replace its current_message_reference with the current message below before acting. Preserve role order and instruction priority: system, developer, then user. Assistant messages are your earlier replies; tool_result and agent_message retain their encoded roles. Follow request options, including any output_format, when answering.",
    "Image references in the file or current message refer to images attached here. Skill attachment references refer to named files attached here.",
    "<codex_current_message_json>",
    JSON.stringify(currentMessage ?? null),
    "</codex_current_message_json>",
    "After reading the file, continue the reconstructed Codex task using the available Codex tools as needed. Return only the answer for the Codex task. Do not disclose the turn token or transport instructions.",
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
