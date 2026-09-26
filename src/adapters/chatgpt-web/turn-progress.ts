import { VerifiedProgress, encodeProgressSnapshot, progressFailure, progressNat, type ProgressSnapshot } from "../../verified/progress";
import type { ProgressEffect, ProgressEvent } from "../../verified/generated/core.cjs";

export type ChatGptExternalTurnProgressSnapshot = ProgressSnapshot;

interface ProgressWaiter {
  afterRevision: number;
  resolve: (snapshot: ChatGptExternalTurnProgressSnapshot) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

interface ToolBatchObservationWaiter {
  revision: number;
  resolve: () => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

/**
 * The read surface the browser worker depends on.
 *
 * The worker never records activity; it observes the daemon's progress and acknowledges only the
 * pre-dispatch answer boundary it captured. Declaring the dependency as this interface lets the
 * launcher helper process mirror the same causal contract without owning the recording side.
 */
export interface ChatGptTurnProgressReader {
  snapshot(): ChatGptExternalTurnProgressSnapshot;
  waitForChange(afterRevision: number, signal?: AbortSignal): Promise<ChatGptExternalTurnProgressSnapshot>;
  /** Confirm that the browser captured its answer projection before this batch was dispatched. */
  acknowledgeToolBatch(revision: number): Promise<void>;
}

/**
 * Carries only proven Codex MCP activity into the browser worker.
 *
 * It is deliberately not a completion channel: browser-visible text and terminal state remain
 * owned by the ChatGPT DOM. A valid current-turn tool request only proves that submission was
 * accepted and that the model is still making progress while its DOM is temporarily unavailable.
 */
abstract class ChatGptTurnProgressBroadcaster implements ChatGptTurnProgressReader {
  private readonly waiters = new Set<ProgressWaiter>();

  abstract snapshot(): ChatGptExternalTurnProgressSnapshot;
  abstract acknowledgeToolBatch(revision: number): Promise<void>;

  waitForChange(afterRevision: number, signal?: AbortSignal): Promise<ChatGptExternalTurnProgressSnapshot> {
    if (!Number.isSafeInteger(afterRevision) || afterRevision < 0) {
      throw new Error("ChatGPT external progress revision must be a non-negative safe integer");
    }
    const current = this.snapshot();
    if (current.revision > afterRevision) return Promise.resolve(current);
    if (signal?.aborted) {
      return Promise.reject(new DOMException("ChatGPT external progress wait aborted", "AbortError"));
    }
    return new Promise((resolve, reject) => {
      const waiter: ProgressWaiter = { afterRevision, resolve, reject, ...(signal ? { signal } : {}) };
      if (signal) {
        waiter.onAbort = () => {
          this.waiters.delete(waiter);
          reject(new DOMException("ChatGPT external progress wait aborted", "AbortError"));
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      this.waiters.add(waiter);
    });
  }

  protected notify(snapshot: ChatGptExternalTurnProgressSnapshot): void {
    for (const waiter of [...this.waiters]) {
      if (snapshot.revision <= waiter.afterRevision) continue;
      this.waiters.delete(waiter);
      if (waiter.signal && waiter.onAbort) {
        waiter.signal.removeEventListener("abort", waiter.onAbort);
      }
      waiter.resolve({ ...snapshot });
    }
  }
}

export class ChatGptExternalTurnProgress extends ChatGptTurnProgressBroadcaster {
  private readonly owner = new VerifiedProgress("Recorder");
  /** Host exception resource, not the source of the retirement state. */
  private retirementError?: Error;
  private readonly toolBatchObservationWaiters = new Set<ToolBatchObservationWaiter>();

  snapshot(): ChatGptExternalTurnProgressSnapshot {
    return this.owner.snapshot();
  }

  recordToolBatch(count: number, now = Date.now()): number {
    this.apply({ $: "RecordBatch", count: progressNat(count, "batch size"), now: progressNat(now, "timestamp") });
    const snapshot = this.snapshot();
    this.notify(snapshot);
    return snapshot.lastToolBatchRevision;
  }

  async acknowledgeToolBatch(revision: number): Promise<void> {
    const effect = this.apply({ $: "Acknowledge", revision: progressNat(revision, "batch revision") });
    if (effect.$ === "ObservationReplayed") return;
    const observed = this.owner.observed();
    for (const waiter of [...this.toolBatchObservationWaiters]) {
      if (waiter.revision > observed) continue;
      this.toolBatchObservationWaiters.delete(waiter);
      if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener("abort", waiter.onAbort);
      waiter.resolve();
    }
  }

  waitForToolBatchObservation(revision: number, signal?: AbortSignal): Promise<void> {
    let effect: ProgressEffect;
    try { effect = this.apply({ $: "CheckBatch", revision: progressNat(revision, "batch revision") }); }
    catch (error) { return Promise.reject(error); }
    if (effect.$ === "ObservationKnown") return Promise.resolve();
    if (signal?.aborted) {
      return Promise.reject(new DOMException("ChatGPT tool-boundary observation aborted", "AbortError"));
    }
    return new Promise((resolve, reject) => {
      const waiter: ToolBatchObservationWaiter = { revision, resolve, reject, ...(signal ? { signal } : {}) };
      if (signal) {
        waiter.onAbort = () => {
          this.toolBatchObservationWaiters.delete(waiter);
          reject(new DOMException("ChatGPT tool-boundary observation aborted", "AbortError"));
        };
        signal.addEventListener("abort", waiter.onAbort, { once: true });
      }
      this.toolBatchObservationWaiters.add(waiter);
    });
  }

  recordToolResult(now = Date.now()): void {
    this.apply({ $: "RecordResult", now: progressNat(now, "timestamp") });
    this.notify(this.snapshot());
  }

  /** Retire every unresolved batch when the broker capability can no longer accept its result. */
  retire(error: Error): boolean {
    if (!(error instanceof Error)) throw new Error("ChatGPT external progress retirement requires an error");
    const beforeRevision = this.snapshot().revision;
    if (this.apply({ $: "Retire" }).$ === "RetirementReplayed") return false;
    this.retirementError = error;
    for (const waiter of this.toolBatchObservationWaiters) {
      if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener("abort", waiter.onAbort);
      waiter.reject(error);
    }
    this.toolBatchObservationWaiters.clear();
    const snapshot = this.snapshot();
    if (snapshot.revision !== beforeRevision) this.notify(snapshot);
    return true;
  }

  assertToolBatchActive(revision: number): void {
    this.apply({ $: "CheckBatch", revision: progressNat(revision, "batch revision") });
  }

  private apply(event: ProgressEvent): ProgressEffect {
    const effect = this.owner.dispatch(event);
    if (effect.$ === "Reject") throw progressFailure(effect, this.retirementError);
    return effect;
  }
}

/**
 * Replays daemon-recorded progress inside the launcher browser helper process.
 *
 * The browser worker runs out of process from the Codex MCP broker, so the recording instance
 * cannot be shared with it. A mirror supplies causal answer-boundary evidence; it never supplies
 * cancellation authority. Delayed acknowledgements commit through the same monotonic Bend state.
 */
export class ChatGptMirroredTurnProgress extends ChatGptTurnProgressBroadcaster {
  private readonly owner = new VerifiedProgress("Replica");

  constructor(
    private readonly onToolBatchObserved?: (revision: number) => Promise<void> | void,
  ) {
    super();
  }

  snapshot(): ChatGptExternalTurnProgressSnapshot {
    return this.owner.snapshot();
  }

  async acknowledgeToolBatch(revision: number): Promise<void> {
    const event = { $: "CheckBatch" as const, revision: progressNat(revision, "batch revision") };
    const check = this.owner.dispatch(event);
    if (check.$ === "Reject") throw progressFailure(check);
    if (check.$ === "ObservationKnown") return;
    await this.onToolBatchObserved?.(revision);
    // The remote receipt may complete after a newer receipt. Re-evaluate against
    // the current model instead of restoring the revision captured before await.
    const effect = this.owner.dispatch({ $: "Acknowledge", revision: event.revision });
    if (effect.$ === "Reject") throw progressFailure(effect);
  }

  /** Ignores stale or replayed frames so out-of-order delivery cannot rewind observed liveness. */
  apply(next: ChatGptExternalTurnProgressSnapshot): boolean {
    const effect = this.owner.dispatch({ $: "Import", snapshot: encodeProgressSnapshot(next) });
    if (effect.$ === "Reject") throw progressFailure(effect);
    if (effect.$ === "FrameIgnored") return false;
    this.notify(this.snapshot());
    return true;
  }
}

export function assertChatGptTurnProgressSnapshot(
  value: ChatGptExternalTurnProgressSnapshot,
): void {
  encodeProgressSnapshot(value);
}

export function chatGptExternalProgressIsLive(
  snapshot: ChatGptExternalTurnProgressSnapshot | undefined,
  now: number,
  graceMs: number,
): boolean {
  if (!snapshot) return false;
  if (!Number.isFinite(now) || !Number.isFinite(graceMs) || graceMs < 0) {
    throw new Error("ChatGPT external progress liveness inputs are invalid");
  }
  return snapshot.activeToolCalls > 0
    || (snapshot.lastProgressAt !== undefined && now - snapshot.lastProgressAt < graceMs);
}

/** Only unresolved native tool calls veto browser-turn completion. */
export function chatGptExternalToolCallsAreInFlight(
  snapshot: ChatGptExternalTurnProgressSnapshot | undefined,
): boolean {
  return (snapshot?.activeToolCalls ?? 0) > 0;
}
