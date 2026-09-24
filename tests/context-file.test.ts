import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { stageChatGptWebContext } from "../src/adapters/chatgpt-web/context-file";
import { CHATGPT_WEB_MODEL_ID } from "../src/adapters/chatgpt-web/model";
import { compileChatGptWebPrompt } from "../src/adapters/chatgpt-web/prompt";
import type { CodexParsedRequest } from "../src/types";

test("tool-capable browser prompt reads prior Codex context from a temporary file", () => {
  const parsed: CodexParsedRequest = {
    modelId: CHATGPT_WEB_MODEL_ID,
    context: {
      systemPrompt: ["system rule"],
      messages: [
        { role: "developer", content: "large developer instructions", timestamp: 1 },
        { role: "user", content: "earlier request", timestamp: 2 },
        { role: "assistant", content: [{ type: "text", text: "earlier answer" }], timestamp: 3 },
        { role: "user", content: "current request", timestamp: 4 },
      ],
    },
    stream: true,
    options: { reasoning: "high" },
  };
  const token = "turn_12345678901234567890123456789012";
  const compiled = compileChatGptWebPrompt(parsed, {
    localToolsEnabled: true, solAvailable: true, extraHighAvailable: true, proAvailable: true,
  }, token);
  const staged = stageChatGptWebContext(compiled, parsed, token);
  const path = staged.text.match(/cat -- '([^']+)'/)?.[1];
  expect(path).toBeDefined();
  try {
    expect(staged.text).toContain("current request");
    expect(staged.text).not.toContain("large developer instructions");
    expect(staged.text).not.toContain("earlier request");
    const file = readFileSync(path!, "utf8");
    const [json, marker] = file.trimEnd().split("\n");
    expect(marker).toMatch(/^CODEX_CONTEXT_END [a-f0-9]{64}$/);
    const context = JSON.parse(json!) as { system: string[]; messages: Array<{ role: string; content: unknown }> };
    expect(context.system).toEqual(["system rule"]);
    expect(context.messages.map(message => message.role)).toEqual([
      "developer", "user", "assistant", "current_message_reference",
    ]);
    expect(context.messages[0]?.content).toBe("large developer instructions");
  } finally {
    staged.release();
  }
  expect(existsSync(path!)).toBe(false);
});
