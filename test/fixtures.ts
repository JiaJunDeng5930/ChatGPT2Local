import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Application } from "../runtime/application";
import { Store } from "../runtime/store";
import { digest } from "../runtime/codec";
import { DEFAULT_LIMITS } from "../runtime/prompts";
import type { Browser, Context, ObjectValue, Placement, Prepared, Snapshot } from "../runtime/contracts";
import { parseRequest } from "../runtime/protocol";

export class FixtureBrowser implements Browser {
  readonly pages = new Map<string, Snapshot>();
  readonly prepares: { operation: string; slot: number; payload: string; attachments: number; placement: Placement }[] = [];
  readonly sends: { operation: string; slot: number }[] = [];
  readonly cancellations: string[] = [];
  readonly reads: string[] = [];
  readonly attachments: string[] = [];
  failObservation = false;
  onSend?: (operation: string, slot: number) => void;

  async prepare(operation: string, slot: number, payload: string, context: Context, placement: Placement): Promise<Prepared> {
    this.prepares.push({ operation, slot, payload, attachments: context.attachments.length, placement });
    const previous = this.pages.get(operation);
    const retained = placement.page ? [...this.pages.values()].find(page => page.page === placement.page) : undefined;
    const page = previous?.page ?? retained?.page ?? `page-${this.pages.size + 1}`;
    const document = previous?.document ?? retained?.document ?? `document-${page}`;
    this.pages.set(operation, { operation, slot, page, document, accepted: false, assistant: "", text: "", signature: "",
      untouched: true, assistantTail: false, baseline: [], facts: { $: "Facts", present: false, running: false, has_text: false,
        completion_control: false, reply_error: false, stopped_badge: false, tools_in_flight: false } });
    return { page, document };
  }

  async send(operation: string, slot: number): Promise<{ clicked: boolean }> {
    this.sends.push({ operation, slot });
    const page = this.pages.get(operation)!;
    page.accepted = true;
    page.facts.running = true;
    this.onSend?.(operation, slot);
    return { clicked: true };
  }

  async snapshot(operation: string): Promise<Snapshot> {
    this.reads.push(operation);
    if (this.failObservation) throw new Error("fixture: lost read receipt");
    const page = this.pages.get(operation);
    if (!page) throw new Error("fixture: page missing");
    return structuredClone(page);
  }

  async inspect(page: string): Promise<Snapshot> {
    const found = [...this.pages.values()].reverse().find(value => value.page === page);
    if (!found) throw new Error("fixture: page missing");
    return structuredClone(found);
  }

  async attach(operation: string, page: string, document: string): Promise<boolean> {
    this.attachments.push(operation);
    const found = this.pages.get(operation);
    return !!found && found.page === page && found.document === document;
  }

  async cancel(operation: string): Promise<void> {
    this.cancellations.push(operation);
    const page = this.pages.get(operation);
    if (page) page.facts.running = false;
  }

  finish(operation: string, text: string): void {
    const page = this.pages.get(operation)!;
    page.text = text;
    page.signature = digest(`${page.document}:${page.slot}:${text}`);
    page.assistant = `assistant-${page.slot}`;
    page.assistantTail = true;
    page.facts = { $: "Facts", present: true, running: false, has_text: text.length > 0,
      completion_control: true, reply_error: false, stopped_badge: false, tools_in_flight: false };
  }
}

export async function eventually(condition: () => boolean, label = "condition", timeout = 5000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error(`Fixture timed out: ${label}`);
    await Bun.sleep(5);
  }
}

const requestKeys = new WeakMap<ObjectValue, string>();

export function requestHeaders(body: ObjectValue, key?: string): Headers {
  const identity = key ?? requestKeys.get(body);
  return new Headers(identity ? { "idempotency-key": identity } : {});
}

export function requestBody(turn = "turn-one", input?: ObjectValue[], full = false): ObjectValue {
  const body: ObjectValue = { model: "chatgpt-web/medium", stream: true, instructions: "Perform the supplied task.",
    input: input ?? [{ type: "message", role: "user", content: [{ type: "input_text", text: "Return a result." }] }],
    tools: full ? [{ type: "function", name: "exec_command", description: "fixture execution", parameters: {
      type: "object", properties: { cmd: { type: "string" } }, required: ["cmd"], additionalProperties: false,
    } }] : [] };
  requestKeys.set(body, turn);
  return body;
}

export function continuationBody(previous: string, input: string | ObjectValue[], key = `next-${previous}`): ObjectValue {
  const body: ObjectValue = { previous_response_id: previous, input, stream: false };
  requestKeys.set(body, key);
  return body;
}

export function fixture(full = false) {
  const home = mkdtempSync(join(tmpdir(), "bend-web-test-"));
  const store = new Store(home);
  const browser = new FixtureBrowser();
  const app = new Application(store, browser, { ...DEFAULT_LIMITS }, 5, 0);
  const parse = (body = requestBody("turn-one", undefined, full), key?: string) => parseRequest(body, requestHeaders(body, key), full ? "full" : "browser-only", store);
  const close = async () => { await app.close(); store.close(); rmSync(home, { recursive: true, force: true }); };
  return { home, store, browser, app, parse, close };
}
