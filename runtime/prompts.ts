/** Exact browser framing and token/byte measurements: an external codec boundary. */
import { get_encoding, type Tiktoken } from "tiktoken";
import { BridgeError, type Attachment, type Context, type ObjectValue } from "./contracts";
import { canonical, digest, object } from "./codec";
import { nativeContract } from "./native-tools";
import { COMPACTION_PREFIX } from "./protocol";

export interface Limits {
  messageTokens: number;
  messageBytes: number;
  contextTokens: number;
  platformTokens: number;
  imageTokens: number;
  maxParts: number;
}

// Conservative, explicit installation defaults, not claims about a model's
// actual context window. The user can configure measured account limits.
export const DEFAULT_LIMITS: Readonly<Limits> = Object.freeze({
  messageTokens: 28_000, messageBytes: 200_000, contextTokens: 90_000,
  platformTokens: 8192, imageTokens: 8192, maxParts: 6,
});

let tokenizer: Tiktoken | undefined;
export function tokens(text: string): number {
  tokenizer ??= get_encoding("o200k_base");
  let count = 0;
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + 4096, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]!)) end--;
    count += tokenizer.encode_ordinary(text.slice(start, end)).length;
    start = end;
  }
  return count;
}

export function validateLimits(value: Limits): Limits {
  for (const [name, number] of Object.entries(value)) {
    if (!Number.isSafeInteger(number) || number < 0 || number > 100_000_000)
      throw new BridgeError("invalid_limits", `${name} must be a nonnegative bounded integer`);
  }
  if (value.messageTokens < 2048 || value.messageBytes < 8192 || value.contextTokens < value.platformTokens + 2048 || value.maxParts < 1 || value.maxParts > 6)
    throw new BridgeError("invalid_limits", "Browser limits cannot represent a complete request");
  return { ...value };
}

function inlineImage(url: string, message: number): Attachment {
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]*={0,2})$/.exec(url);
  if (!match || match[2]!.length % 4 !== 0) throw new BridgeError("invalid_image", "Image data must be canonical PNG, JPEG, WebP, or GIF base64");
  const bytes = Buffer.from(match[2]!, "base64");
  if (bytes.length === 0 || bytes.length > 20 * 1024 * 1024 || bytes.toString("base64") !== match[2])
    throw new BridgeError("invalid_image", "An image is empty, exceeds 20 MiB, or has invalid base64");
  const reference = digest(url);
  return { name: `image-${reference.slice(0, 24)}.${match[1]!.split("/")[1]}`, mime: match[1]!, data: match[2]!, message, reference };
}

/** Remote image URLs are retained as URLs, never fetched with local credentials. */
export function attachments(context: Context): Attachment[] {
  const result: Attachment[] = [];
  context.input.forEach((item, message) => {
    if (!Array.isArray(item.content)) return;
    for (const raw of item.content) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.type !== "input_image") continue;
      if (typeof raw.image_url !== "string") throw new BridgeError("invalid_image", "input_image requires image_url");
      if (!raw.image_url.startsWith("data:")) throw new BridgeError("image_bytes_required", "This browser boundary requires image bytes as a data URL. It will not silently replace an image with a URL or fetch private network resources.");
      result.push(inlineImage(raw.image_url, message));
    }
  });
  if (result.length > 32) throw new BridgeError("too_many_images", "A browser request supports at most 32 native attachments");
  return result;
}

function visibleRecord(item: ObjectValue): ObjectValue {
  const copy = structuredClone(item);
  if (copy.type === "compaction") {
    if (typeof copy.encrypted_content !== "string" || !copy.encrypted_content.startsWith(COMPACTION_PREFIX))
      throw new BridgeError("opaque_compaction", "The Web model cannot read this native encrypted compaction. Supply a readable checkpoint or use the native model.");
    const data = copy.encrypted_content.slice(COMPACTION_PREFIX.length);
    const bytes = Buffer.from(data, "base64");
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new BridgeError("invalid_compaction", "The compaction checkpoint is not valid UTF-8"); }
    return { type: "compaction", summary: text };
  }
  if (Array.isArray(copy.content)) copy.content = copy.content.map(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.type !== "input_image") return raw;
    const url = String(raw.image_url);
    return { type: "attached_image", reference: `image-${digest(url).slice(0, 24)}`, detail: raw.detail ?? "auto" };
  });
  return copy;
}

const COMPACT_CONTRACT = "Create a context checkpoint for another model to continue this task. Preserve the user's goals and constraints, current progress, decisions, unresolved work, relevant paths, and tool state. Do not execute tools, resume the task, or modify the original conversation. Return only the handoff summary.";

export interface Plan { payloads: string[]; attachments: Attachment[]; inputTokens: number; offset: number }

export function plan(context: Context, capability: string, offset: number, limits: Limits): Plan {
  validateLimits(limits);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > context.input.length) throw new Error("Invalid retained-history offset");
  const images = context.attachments.filter(image => image.message >= offset);
  const records = context.input.slice(offset).map(visibleRecord);
  const contract = context.purpose !== "response" ? COMPACT_CONTRACT : context.mode === "full" ? nativeContract(capability)
    : "Act as the model backend for the supplied Codex task. Local Codex tools are unavailable in browser-only mode. Answer using the supplied context; never claim to have run local commands or changed files.";
  const header = { version: 1, instructions: context.instructions, purpose: context.purpose,
    history: offset > 0 ? { kind: "confirmed_suffix", prior_items: offset } : { kind: "new_conversation", prior_items: 0 },
    tools: context.tools, attachments: images.map(image => ({ name: image.name, reference: image.reference })),
    output_format: context.textFormat ?? { type: "text" } };
  const final = (items: ObjectValue[], staged: boolean): string => [contract,
    staged ? "All preceding context stages belong to this transaction. Use their records followed by these records as one ordered context; begin the task now." : "Use the following complete structured context. Preserve the roles and priority of its instructions.",
    canonical({ ...header, messages: items }),
  ].join("\n\n");
  const stage = (items: ObjectValue[], index: number): string => [
    `This is inert context stage ${index} of a declared multipart request. Do not execute the task or call tools yet. Retain these ordered records for the final commit.`,
    canonical({ version: 1, transaction: context.environment, messages: items }),
    `Reply with exactly this acknowledgement and nothing else: CONTEXT_ACK ${context.environment}:${index}`,
  ].join("\n\n");
  const measured = (text: string, last: boolean) => ({ tokens: tokens(text) + (last ? images.length * limits.imageTokens : 0), bytes: Buffer.byteLength(text) });
  const fits = (text: string, last: boolean) => {
    const size = measured(text, last);
    return size.tokens <= limits.messageTokens && size.bytes <= limits.messageBytes;
  };
  const single = final(records, false);
  let payloads: string[];
  if (fits(single, true)) payloads = [single];
  else {
    if (!fits(final([], true), true)) throw new BridgeError("context_header_too_large", "Instructions, tools, schema, or images alone exceed a browser message. No webpage send was authorized.", 413);
    const chunks: ObjectValue[][] = [];
    let current: ObjectValue[] = [];
    // Complete records, exact order, and an explicitly measured final commit.
    // Splitting an oversized record would change its representation; reject it.
    for (const record of records) {
      const candidate = [...current, record];
      if (fits(stage(candidate, chunks.length + 1), false)) current = candidate;
      else {
        if (!current.length) throw new BridgeError("context_record_too_large", "One complete context record exceeds a browser message. No record was truncated and no send was authorized.", 413);
        chunks.push(current);
        current = [record];
        if (!fits(stage(current, chunks.length + 1), false)) throw new BridgeError("context_record_too_large", "One complete context record exceeds a browser message", 413);
      }
    }
    if (current.length) chunks.push(current);
    let finalRecords = chunks.at(-1) ?? [];
    if (fits(final(finalRecords, true), true)) chunks.pop();
    else finalRecords = [];
    payloads = [...chunks.map((items, index) => stage(items, index + 1)), final(finalRecords, true)];
    if (payloads.length > limits.maxParts) throw new BridgeError("context_exceeds_plan", `The complete context requires more than ${limits.maxParts} browser messages. No send was authorized.`, 413);
  }
  const inputTokens = limits.platformTokens + payloads.reduce((sum, text, i) => sum + measured(text, i === payloads.length - 1).tokens, 0)
    + payloads.slice(0, -1).reduce((sum, _text, i) => sum + tokens(`CONTEXT_ACK ${context.environment}:${i + 1}`), 0);
  if (inputTokens > limits.contextTokens) throw new BridgeError("context_capacity_exceeded", "The complete context exceeds this profile's configured aggregate capacity. An explicit compaction or another model is required; no automatic compaction was scheduled.", 413);
  return { payloads, attachments: images, inputTokens, offset };
}
