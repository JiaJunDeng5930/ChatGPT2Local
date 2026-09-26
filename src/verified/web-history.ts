/** Durable browser-history receipts. History selection itself is implemented in Bend. */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { CodexMessage, CodexParsedRequest, CodexThinkingContent } from "../types";
import { historyOffset, selectHistory } from "./core";
import { transcriptItem } from "./generated/core.cjs";
import { makeDurableDirectory, writeReceipt } from "./submission-journal";
import { canonicalJson, digest } from "./encoding";
export { canonicalJson, digest } from "./encoding";

function reasoningContent(part: CodexThinkingContent): unknown {
  const { itemId: _itemId, signature, ...content } = part;
  let normalizedSignature: unknown = signature;
  if (signature) {
    try {
      const raw = JSON.parse(signature) as Record<string, unknown>;
      if (raw && raw.type === "reasoning" && raw.encrypted_content === undefined) {
        const { id: _id, ...semantic } = raw;
        normalizedSignature = semantic;
      }
    } catch { /* A real opaque signature remains exact. */ }
  }
  return { ...content, ...(normalizedSignature !== undefined ? { signature: normalizedSignature } : {}) };
}

function messageSymbol(message: CodexMessage): string {
  const { timestamp: _timestamp, ...semantic } = message;
  if (semantic.role === "assistant") {
    const { model: _model, ...assistant } = semantic;
    return digest(canonicalJson({ ...assistant,
      content: assistant.content.map(part => part.type === "thinking" ? reasoningContent(part) : part),
      ...(assistant.content.every(part => part.type === "text") ? { phase: assistant.phase ?? "final_answer" } : {}),
    }));
  }
  return digest(canonicalJson({ ...semantic,
    content: typeof semantic.content === "string" ? [{ type: "text", text: semantic.content }] : semantic.content,
  }));
}

export function historyMessages(parsed: CodexParsedRequest): string[] { return parsed.context.messages.map(messageSymbol); }

export function historyEnvironment(parsed: CodexParsedRequest): string {
  return digest(canonicalJson({
    model: parsed.modelId,
    system: parsed.context.systemPrompt ?? [],
    tools: parsed.context.tools ?? [],
    options: parsed.options,
  }));
}

export function transcriptExtends(initial: CodexParsedRequest, current: CodexParsedRequest): boolean {
  if (historyEnvironment(initial) !== historyEnvironment(current)) return false;
  if (initial === current) return true;
  const before = (initial._rawBody as { input?: unknown } | undefined)?.input;
  const after = (current._rawBody as { input?: unknown } | undefined)?.input;
  if (!Array.isArray(before) || !Array.isArray(after)) return false;
  const offset = historyOffset("native-round", "native-round", before.map(canonicalJson), after.map(canonicalJson));
  if (offset === undefined) return false;
  return after.slice(offset).every(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const value = item as Record<string, unknown>;
    const kind = typeof value.type === "string" ? value.type : typeof value.role === "string" ? "message" : "";
    const role = typeof value.role === "string" ? value.role : "";
    return transcriptItem(kind, role);
  });
}

interface Receipt {
  version: 1;
  scope: string;
  operation: string;
  key: string;
  environment: string;
  messages: string[];
  answerDigest: string;
}

export interface WebHistoryPlan {
  key: string;
  offset?: number;
  expectedAnswerDigest?: string;
  expectedOperation?: string;
}

function decodeReceipt(text: string, scope: string): Receipt {
  const value = JSON.parse(text) as Partial<Receipt>;
  const hash = (x: unknown): x is string => typeof x === "string" && /^[a-f0-9]{64}$/.test(x);
  if (!value || value.version !== 1 || value.scope !== scope || typeof value.operation !== "string"
    || !hash(value.key) || !hash(value.environment) || !hash(value.answerDigest)
    || !Array.isArray(value.messages) || !value.messages.every(hash)) {
    throw new Error("Invalid browser history receipt; continuation requires reconciliation");
  }
  return value as Receipt;
}

export class WebHistoryStore {
  constructor(private readonly root: string) {}

  private directory(scope: string): string { return join(this.root, digest(scope)); }

  select(scope: string, operation: string, parsed: CodexParsedRequest): WebHistoryPlan {
    const directory = this.directory(scope);
    const receipts = existsSync(directory) ? readdirSync(directory).filter(name => /^[a-f0-9]{64}\.json$/.test(name))
      .map(name => decodeReceipt(readFileSync(join(directory, name), "utf8"), scope)) : [];
    const selection = selectHistory(receipts, historyEnvironment(parsed), historyMessages(parsed));
    if (selection) {
      const receipt = receipts.find(item => item.key === selection.key && item.messages.length === selection.offset);
      if (!receipt) throw new Error("Bend selected a history receipt that was not loaded");
      return { key: selection.key, offset: selection.offset,
        expectedAnswerDigest: receipt.answerDigest, expectedOperation: receipt.operation };
    }
    return { key: digest(canonicalJson(["web-history-v1", scope, operation])) };
  }

  remember(scope: string, operation: string, plan: WebHistoryPlan,
           parsed: CodexParsedRequest, answer: string, output?: readonly CodexMessage[]): void {
    const directory = this.directory(scope);
    makeDurableDirectory(directory);
    const receipt: Receipt = {
      version: 1, scope, operation, key: plan.key,
      environment: historyEnvironment(parsed),
      messages: [...historyMessages(parsed), ...(output ?? [{ role: "assistant", phase: "final_answer",
        content: [{ type: "text", text: answer }], timestamp: 0 } satisfies CodexMessage]).map(messageSymbol)],
      answerDigest: digest(answer),
    };
    const path = join(directory, `${digest(operation)}.json`);
    if (existsSync(path)) {
      if (canonicalJson(decodeReceipt(readFileSync(path, "utf8"), scope)) !== canonicalJson(receipt)) {
        throw new Error("A completed operation cannot rewrite its browser history receipt");
      }
      return;
    }
    writeReceipt(path, directory, receipt);
  }
}
