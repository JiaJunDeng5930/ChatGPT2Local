/** Checked ABI of the pinned Bend 2.0.27 backend, not a claim of unbounded runtime Nats. */
export const BEND_NAT_MAX = 281_474_976_710_655n;

export function encodeNat(value: number, name = "value"): bigint {
  if (!Number.isSafeInteger(value) || value < 0 || value > Number(BEND_NAT_MAX)) {
    throw new Error(`Bend ${name} must be a finite integer in 0..2^48-1`);
  }
  return BigInt(value);
}

export function decodeNat(value: bigint): number {
  if (typeof value !== "bigint" || value < 0n || value > BEND_NAT_MAX) {
    throw new Error("Bend value exceeds the wire integer boundary (0..2^48-1)");
  }
  return Number(value);
}

export function invokeBend<T>(call: () => T): T {
  try { return call(); }
  catch (error) {
    // The pinned emitter throws this string, rather than an Error. Keep errors
    // usable by all host catch paths, without inventing a fallback transition.
    if (error === "bend: a Nat past the largest immediate 2^48-1") {
      throw new Error("Bend value exceeds the wire integer boundary (0..2^48-1)", { cause: error });
    }
    throw error instanceof Error ? error : new Error(`Bend execution failed: ${String(error)}`, { cause: error });
  }
}
