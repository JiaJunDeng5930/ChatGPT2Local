/** Exact browser framing and token/byte measurements: an external codec boundary. */
import { get_encoding, type Tiktoken } from "tiktoken";
import { BridgeError, type Attachment, type Context, type ObjectValue } from "./contracts";
import { canonical, digest, object } from "./codec";
import { toolContract } from "./tool-bridge";

export interface Limits {
  messageTokens: number;
  messageBytes: number;
  platformTokens: number;
  imageTokens: number;
}

// Conservative, explicit installation defaults, not claims about a model's
// actual context window. The user can configure measured account limits.
export const DEFAULT_LIMITS: Readonly<Limits> = Object.freeze({
  messageTokens: 28_000, messageBytes: 200_000, platformTokens: 8192, imageTokens: 8192,
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
  for (const name of ["messageTokens", "messageBytes", "platformTokens", "imageTokens"] as const) {
    const number = value[name];
    if (!Number.isSafeInteger(number) || number < 0 || number > 100_000_000)
      throw new BridgeError("invalid_limits", `${name} must be a nonnegative bounded integer`);
  }
  if (value.messageTokens < 2048 || value.messageBytes < 8192)
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

/** Images must carry their bytes; remote URLs are rejected without fetching. */
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
  if (Array.isArray(copy.content)) copy.content = copy.content.map(raw => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.type !== "input_image") return raw;
    const url = String(raw.image_url);
    return { type: "attached_image", reference: `image-${digest(url).slice(0, 24)}`, detail: raw.detail ?? "auto" };
  });
  return copy;
}

export interface Plan { payloads: string[]; attachments: Attachment[]; inputTokens: number }

export function plan(context: Context, capability: string, continuation: boolean, limits: Limits): Plan {
  validateLimits(limits);
  const contract = context.mode === "full" ? toolContract(capability)
    : "Answer the supplied task using this conversation and the new messages. Caller tools are unavailable; never claim to have executed local commands or changed files.";
  const payload = [contract,
    continuation ? "Continue this exact conversation with the following new messages. Preserve their roles and instruction priority."
      : "Start a new conversation using the following messages. Preserve their roles and instruction priority.",
    canonical({ protocol: "chatgpt-web.v1", instructions: context.instructions,
      tools: context.tools, messages: context.input.map(visibleRecord),
      attachments: context.attachments.map(image => ({ name: image.name, reference: image.reference })),
      output_format: context.textFormat ?? { type: "text" } }),
  ].join("\n\n");
  const inputTokens = limits.platformTokens + tokens(payload) + context.attachments.length * limits.imageTokens;
  if (inputTokens > limits.messageTokens || Buffer.byteLength(payload) > limits.messageBytes)
    throw new BridgeError("message_too_large", "This complete message exceeds the configured token or byte budget. Shorten it or stage context explicitly; nothing was sent", 413);
  return { payloads: [payload], attachments: context.attachments, inputTokens };
}
