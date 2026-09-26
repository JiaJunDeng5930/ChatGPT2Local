import type { ChatGptMarkdownBuffer } from "./markdown";

/**
 * Single-writer browser effect boundary: encode the full answer before asking
 * Bend's broker to seal its tool obligations. No formatting work is deferred
 * until after that irreversible fence. A stale/lost fence does not consume the
 * pending output, so subsequent observation cannot lose or duplicate its tail.
 */
export async function commitChatGptCompletion(
  buffer: ChatGptMarkdownBuffer,
  visibleText: string,
  fence?: () => Promise<boolean>,
): Promise<{ markdown: string; delta: string } | undefined> {
  if (visibleText === "api_tool unavailable") {
    throw new Error("ChatGPT selected mode rejected the Codex Native MCP tool (api_tool unavailable)");
  }
  const prepared = buffer.prepareFinish();
  if (!prepared.markdown && visibleText) {
    throw new Error("ChatGPT completed with visible text that could not be serialized as Markdown");
  }
  if (fence && !await fence()) return undefined;
  prepared.commit();
  return { markdown: prepared.markdown, delta: prepared.delta };
}
