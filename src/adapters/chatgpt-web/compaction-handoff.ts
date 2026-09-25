import type { CodexParsedRequest } from "../../types";
import { extractChatGptCompactionSourceRevision } from "./environment";

export const LATEST_USER_PROMPT_MARKER = "CODEX_LATEST_USER_PROMPT_JSON";

function userPromptText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  const text = content.flatMap(part => {
    if (!part || typeof part !== "object" || Array.isArray(part)) return [];
    const value = part as { type?: unknown; text?: unknown };
    return (value.type === "input_text" || value.type === "text") && typeof value.text === "string"
      ? [value.text]
      : [];
  }).join("\n");
  return text || undefined;
}

export function canonicalizeCompactionHandoff(
  parsed: CodexParsedRequest,
  summary: string,
): string {
  const normalized = summary.trim();
  if (!normalized) throw new Error("ChatGPT returned an empty structured compaction handoff");
  const latestUserPrompt = userPromptText(extractChatGptCompactionSourceRevision(parsed).content);
  if (latestUserPrompt === undefined) {
    throw new Error("ChatGPT compaction source has no canonical latest user prompt");
  }
  const appendix = `${LATEST_USER_PROMPT_MARKER}\n${JSON.stringify(latestUserPrompt)}`;
  const markerOffset = normalized.lastIndexOf(`\n${LATEST_USER_PROMPT_MARKER}\n`);
  if (markerOffset < 0) return `${normalized}\n\n${appendix}`;
  if (normalized.slice(markerOffset + 1).trimEnd() !== appendix) {
    throw new Error("ChatGPT compaction handoff contains a conflicting latest-user marker");
  }
  return normalized;
}

interface CachedCompactionRun {
  ownerKey: string;
  traceIds: ReadonlySet<string>;
  nativeThreadId?: string;
  nativeTurnId?: string;
  abort: AbortController;
  active: boolean;
  promise: Promise<string>;
  settlement: Promise<void>;
}

export interface StructuredCompactionOwner {
  ownerKey: string;
  traceIds: readonly string[];
  nativeThreadId?: string;
  nativeTurnId?: string;
}

const structuredCompactionRuns = new Map<string, CachedCompactionRun>();
const structuredCompactionOwners = new Map<string, Promise<void>>();
const structuredCompactionInterruptions = new Map<string, Error>();

function nativeTurnIdentityKey(threadId: string, turnId: string): string {
  if (!threadId.trim() || !turnId.trim()) {
    throw new Error("Structured compaction requires non-empty native thread and turn ids");
  }
  return JSON.stringify([threadId, turnId]);
}

function rememberStructuredCompactionInterruption(threadId: string, turnId: string, reason: Error): void {
  const identity = nativeTurnIdentityKey(threadId, turnId);
  if (!structuredCompactionInterruptions.has(identity)) {
    structuredCompactionInterruptions.set(identity, reason);
  }
}

function structuredCompactionInterruption(owner: StructuredCompactionOwner): Error | undefined {
  if (owner.nativeThreadId === undefined && owner.nativeTurnId === undefined) return undefined;
  return structuredCompactionInterruptions.get(
    nativeTurnIdentityKey(owner.nativeThreadId ?? "", owner.nativeTurnId ?? ""),
  );
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("ChatGPT compaction aborted", "AbortError");
}

function withCompactionAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      value => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      error => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export function existingStructuredCompactionRun(key: string): Promise<string> | undefined {
  return structuredCompactionRuns.get(key)?.promise;
}

export function runStructuredCompactionOnce(
  key: string,
  owner: StructuredCompactionOwner,
  start: (operatorSignal: AbortSignal, retainOwnershipUntil: (settlement: Promise<void>) => void) => Promise<string>,
): Promise<string> {
  const existing = structuredCompactionRuns.get(key);
  if (existing) return existing.promise;
  const interrupted = structuredCompactionInterruption(owner);
  if (interrupted) return Promise.reject(interrupted);
  const abort = new AbortController();
  const previousOwner = structuredCompactionOwners.get(owner.ownerKey);
  const physicalSettlements: Promise<void>[] = previousOwner ? [previousOwner] : [];
  const promise = Promise.resolve().then(async () => {
    if (previousOwner) await withCompactionAbort(previousOwner, abort.signal);
    if (abort.signal.aborted) throw abortReason(abort.signal);
    return start(abort.signal, settlement => { physicalSettlements.push(settlement); });
  });
  let run!: CachedCompactionRun;
  let settlement!: Promise<void>;
  settlement = promise.then(
    () => undefined,
    () => undefined,
  ).then(async () => {
    await Promise.allSettled(physicalSettlements);
    run.active = false;
    if (structuredCompactionOwners.get(owner.ownerKey) === settlement) {
      structuredCompactionOwners.delete(owner.ownerKey);
    }
  });
  run = {
    ownerKey: owner.ownerKey,
    traceIds: new Set(owner.traceIds),
    ...(owner.nativeThreadId ? { nativeThreadId: owner.nativeThreadId } : {}),
    ...(owner.nativeTurnId ? { nativeTurnId: owner.nativeTurnId } : {}),
    abort,
    active: true,
    promise,
    settlement,
  };
  structuredCompactionRuns.set(key, run);
  structuredCompactionOwners.set(owner.ownerKey, run.settlement);
  return promise;
}

async function cancelStructuredCompactionRuns(
  matches: (run: CachedCompactionRun) => boolean,
  reason: Error,
): Promise<number> {
  const runs = [...structuredCompactionRuns.values()].filter(run => run.active && matches(run));
  for (const run of runs) {
    if (!run.abort.signal.aborted) run.abort.abort(reason);
  }
  await Promise.allSettled(runs.map(run => run.settlement));
  return runs.length;
}

export function cancelStructuredCompactionNativeTurn(
  threadId: string,
  turnId: string,
  reason: Error,
): { cancelled: number; settlement: Promise<void> } {
  rememberStructuredCompactionInterruption(threadId, turnId, reason);
  const runs = [...structuredCompactionRuns.values()].filter(run => (
    run.active
    && run.nativeThreadId === threadId
    && run.nativeTurnId === turnId
  ));
  for (const run of runs) {
    if (!run.abort.signal.aborted) run.abort.abort(reason);
  }
  return {
    cancelled: runs.length,
    settlement: Promise.allSettled(runs.map(run => run.settlement)).then(() => undefined),
  };
}

export function cancelStructuredCompactionTrace(traceId: string, reason: Error): Promise<number> {
  return cancelStructuredCompactionRuns(run => run.traceIds.has(traceId), reason);
}

export function cancelAllStructuredCompactions(reason: Error): Promise<number> {
  return cancelStructuredCompactionRuns(() => true, reason);
}
