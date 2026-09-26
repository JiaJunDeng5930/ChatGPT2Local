/** A single lossless JSON transport identity for history, requests and receipts. */
import { createHash } from "node:crypto";

export function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }

export function canonicalJson(value: unknown): string {
  const ancestors = new Set<object>();
  const encode = (item: unknown): string => {
    if (item === null || typeof item === "string" || typeof item === "boolean") return JSON.stringify(item);
    // -0 is encoded as 0 by the JSON transport as well. Non-finite values are
    // rejected instead of being silently changed to null by JSON.stringify.
    if (typeof item === "number" && Number.isFinite(item)) return JSON.stringify(item);
    if (!item || typeof item !== "object" || ancestors.has(item)) throw new Error("Unsupported or cyclic value at the canonical JSON boundary");
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype) {
      throw new Error("Unsupported object at the canonical JSON boundary");
    }
    ancestors.add(item);
    try {
      const fields = Object.getOwnPropertyDescriptors(item);
      const valueAt = (key: string): unknown => {
        const descriptor = fields[key];
        if (!descriptor || !("value" in descriptor)) throw new Error("Sparse arrays and accessors are not JSON transport values");
        return descriptor.value;
      };
      if (Array.isArray(item)) return `[${Array.from({ length: item.length }, (_, index) => encode(valueAt(String(index)))).join(",")}]`;
      return `{${Object.keys(fields).filter(key => fields[key]!.enumerable && valueAt(key) !== undefined).sort()
        .map(key => `${JSON.stringify(key)}:${encode(valueAt(key))}`).join(",")}}`;
    } finally { ancestors.delete(item); }
  };
  return encode(value);
}
