/** Foreign-value decoding only. All transition/history decisions execute Bend. */
import * as bend from "./generated/core.cjs";
export type { Phase, Event, Effect } from "./generated/core.cjs";

export function decide(phase: bend.Phase, event: bend.Event): { phase: bend.Phase; effect: bend.Effect } {
  // The compiler assumes well-typed inputs and uses the final constructor as an
  // exhaustive match fallback. Never pass unvalidated JSON across that boundary.
  if (!bend.phases.includes(phase) || !bend.events.includes(event)) {
    throw new Error("Invalid value at the Bend turn boundary");
  }
  const result = bend.turnStep({ $: phase }, { $: event });
  if (result.$ !== "Decision" || !bend.phases.includes(result.phase.$) || !bend.effects.includes(result.effect.$)) {
    throw new Error("Invalid decision from the Bend turn boundary");
  }
  return { phase: result.phase.$, effect: result.effect.$ };
}

export function encodeList<T>(values: readonly T[]): bend.List<T> {
  let result: bend.List<T> = { $: "Nil" };
  for (let i = values.length - 1; i >= 0; i--) {
    result = { $: "Con", head: values[i]!, tail: result };
  }
  return result;
}

function list(values: readonly string[]): bend.List<string> {
  if (values.some(value => typeof value !== "string")) throw new Error("History symbols must be strings");
  return encodeList(values);
}

export function historyOffset(
  knownEnvironment: string, environment: string,
  known: readonly string[], incoming: readonly string[],
): number | undefined {
  if (typeof knownEnvironment !== "string" || typeof environment !== "string") {
    throw new Error("Invalid history environment");
  }
  const result = bend.historyPlan(knownEnvironment, environment, list(known), list(incoming));
  if (result.$ === "None") return undefined;
  if (result.$ !== "Some" || typeof result.value !== "bigint" || result.value < 0n
    || result.value > BigInt(incoming.length)) throw new Error("Invalid Bend history offset");
  return Number(result.value);
}

export interface HistoryCandidate { key: string; environment: string; messages: readonly string[] }

export function selectHistory(
  receipts: readonly HistoryCandidate[], environment: string, incoming: readonly string[],
): { key: string; offset: number } | undefined {
  if (typeof environment !== "string") throw new Error("Invalid history environment");
  const encoded = receipts.map(receipt => {
    if (typeof receipt.key !== "string" || typeof receipt.environment !== "string") throw new Error("Invalid history receipt");
    return { $: "Receipt" as const, key: receipt.key, environment: receipt.environment, messages: list(receipt.messages) };
  });
  const result = bend.historySelect(encodeList(encoded), environment, list(incoming));
  if (result.$ === "NewConversation") return undefined;
  if (result.$ !== "ReuseConversation" || typeof result.key !== "string"
    || typeof result.offset !== "bigint" || result.offset < 1n || result.offset >= BigInt(incoming.length)) {
    throw new Error("Invalid Bend history selection");
  }
  return { key: result.key, offset: Number(result.offset) };
}
