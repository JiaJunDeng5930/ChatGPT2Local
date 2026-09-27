import { createHash, timingSafeEqual } from "node:crypto";
import { BridgeError, type Json, type ObjectValue } from "./contracts";

export function object(value: unknown, label = "value"): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new BridgeError("invalid_request", `${label} must be an object`);
  return value as ObjectValue;
}

export function canonical(value: unknown, depth = 0): string {
  if (depth > 100) throw new BridgeError("invalid_request", "JSON nesting exceeds 100 levels");
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(item => canonical(item, depth + 1)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key], depth + 1)}`).join(",")}}`;
  }
  throw new BridgeError("invalid_request", "The request must contain only JSON values");
}

export function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function equalSecret(left: string, right: string): boolean {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
}

export function boundedJson(value: unknown, limit: number): string {
  const text = canonical(value);
  if (Buffer.byteLength(text) > limit) throw new BridgeError("payload_too_large", `Payload exceeds ${limit} UTF-8 bytes`, 413);
  return text;
}

export async function readJson(request: Request, limit: number): Promise<ObjectValue> {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit))
    throw new BridgeError("payload_too_large", `Request exceeds ${limit} UTF-8 bytes`, 413);
  if (!request.body) throw new BridgeError("invalid_request", "A JSON body is required");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new BridgeError("payload_too_large", `Request exceeds ${limit} UTF-8 bytes`, 413);
      chunks.push(value);
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    const value: unknown = JSON.parse(text);
    canonical(value); // Reject excessive nesting before any durable admission.
    return object(value, "request");
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof BridgeError) throw error;
    throw new BridgeError("invalid_json", "The request must be valid UTF-8 JSON");
  } finally {
    reader.releaseLock();
  }
}

export function jsonResponse(value: Json | Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof BridgeError) return jsonResponse({ error: { code: error.code, message: error.message } }, error.status);
  // Raw filesystem, browser, upstream, and credential errors are not public API text.
  return jsonResponse({ error: { code: "boundary_failure", message: "An external boundary failed. No browser retry or cancellation was requested. Inspect the local application." } }, 503);
}
