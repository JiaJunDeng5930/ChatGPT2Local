/**
 * Filesystem interpreter for Bend's one-use send permission.
 *
 * An exclusive, fsynced intent file is the point of no return. An exception at
 * ANY later point leaves an unknown outcome; neither a timeout nor process death
 * removes the file. Recovery reads receipts, it never dispatches old effects.
 * This is at-most-once authorization, not exactly-once delivery by ChatGPT.
 */
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync,
  readdirSync, linkSync, unlinkSync, writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { encodeList, type Effect, type Event } from "./core";
import { decodeNat, encodeNat, invokeBend } from "./boundary";
import { canonicalJson } from "./encoding";
import { batchInitialize, batchClaim, batchRestore, batchPlan, batchStep, batchAck, effects, phases, type Batch, type BatchDecision } from "./generated/core.cjs";

export class SubmissionOutcomeUnknownError extends Error {
  constructor() {
    super("A send intent already exists for this turn. Its result is unknown. Inspect the existing ChatGPT tab; this bridge will not stop it or submit the prompt again.");
    this.name = "SubmissionOutcomeUnknownError";
  }
}

function syncDirectory(path: string): void {
  // Windows does not expose POSIX directory fsync. Exclusive creation still
  // protects process concurrency there; power-loss durability is a platform
  // assumption, explicitly covered in the architecture's trust boundary.
  if (process.platform === "win32") return;
  const fd = openSync(path, "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

export function makeDurableDirectory(path: string): void {
  if (existsSync(path)) return;
  const parent = dirname(path);
  makeDurableDirectory(parent);
  try { mkdirSync(path, { mode: 0o700 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  // The directory entry itself must survive power loss, not just its contents.
  syncDirectory(parent);
  syncDirectory(path);
}

export function writeReceipt(path: string, directory: string, value: unknown): void {
  const encoded = canonicalJson(value);
  const temporary = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, "wx", 0o600);
  try {
    writeFileSync(fd, `${encoded}\n`);
    fsyncSync(fd);
  } finally { closeSync(fd); }
  try {
    try {
      // Atomic create-if-absent, unlike rename which can replace another
      // process's completed receipt between an existence check and the write.
      linkSync(temporary, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (canonicalJson(JSON.parse(readFileSync(path, "utf8"))) !== encoded) {
        throw new Error("A durable receipt already exists with different contents");
      }
    }
    syncDirectory(directory);
  } finally { unlinkSync(temporary); }
}

interface FinalReceipt { version: 1; operation: string; definition: string; answer: string }

/** Configuration changes must not mint a second allowance for a native turn. */
export function canonicalSubmissionOperation(operation: string): string {
  const native = /^[a-f0-9]{64}:([a-f0-9]{64})$/.exec(operation);
  return native ? `native:${native[1]}` : operation;
}

export class SubmissionJournal {
  readonly directory: string;
  private batch: Batch = batchInitialize();
  private readonly operation: string;
  private readonly definition: string;

  constructor(private readonly root: string, operation: string, definition?: string) {
    if (!operation) throw new Error("A physical submission requires an operation identity");
    // The directory is already scoped to a browser profile. The caller's
    // volatile provider namespace belongs to observer caches, not send rights.
    this.operation = canonicalSubmissionOperation(operation);
    this.definition = definition ?? this.operation;
    this.directory = join(root, createHash("sha256").update(this.operation).digest("hex"));
  }

  private legacyDirectory(): string | undefined {
    if (!this.operation.startsWith("native:") || !existsSync(this.root)) return undefined;
    let found: string | undefined;
    for (const entry of readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
      const directory = join(this.root, entry.name);
      if (directory === this.directory || readdirSync(directory).length === 0) continue;
      let owner: { operation?: unknown };
      try { owner = JSON.parse(readFileSync(join(directory, "owner.json"), "utf8")); }
      catch { throw new SubmissionOutcomeUnknownError(); }
      if (typeof owner?.operation !== "string") throw new SubmissionOutcomeUnknownError();
      if (canonicalSubmissionOperation(owner.operation) !== this.operation) continue;
      if (found || existsSync(this.directory)) throw new SubmissionOutcomeUnknownError();
      found = directory;
    }
    return found;
  }

  /** Must run before acquiring or navigating a browser surface. */
  recover(): { type: "fresh" } | { type: "completed"; answer: string } {
    const directory = this.legacyDirectory() ?? this.directory;
    if (!existsSync(directory)) return { type: "fresh" };
    const files = readdirSync(directory);
    if (files.length !== 0) this.batch = batchRestore({ $: "PendingIntent" });
    if (files.includes("cancelled.json")) {
      this.batch = batchRestore({ $: "CancellationReceipt" });
      throw new SubmissionOutcomeUnknownError();
    }
    if (files.includes("final.json")) {
      const receipt: FinalReceipt = JSON.parse(readFileSync(join(directory, "final.json"), "utf8"));
      if (receipt.version !== 1 || typeof receipt.operation !== "string"
        || canonicalSubmissionOperation(receipt.operation) !== this.operation || receipt.definition !== this.definition
        || typeof receipt.answer !== "string") {
        throw new Error("Corrupt submission receipt; automatic replay is prohibited");
      }
      this.batch = batchRestore({ $: "FinalReceipt" });
      return { type: "completed", answer: receipt.answer };
    }
    // Even a partially written intent or interrupted final commit is ambiguous.
    if (files.length !== 0) throw new SubmissionOutcomeUnknownError();
    return { type: "fresh" };
  }

  /** Reserve the WHOLE operation, before acquiring a tab or changing its input. */
  acquire(): void {
    // Covers direct callers too; an old configuration-scoped reservation is
    // evidence of possible delivery, not permission to start a new operation.
    if (this.legacyDirectory()) throw new SubmissionOutcomeUnknownError();
    const claim = this.validate(invokeBend(() => batchClaim(this.batch)));
    if (claim.effect.$ !== "NoEffect" || claim.state.$ !== "Unplanned") throw new SubmissionOutcomeUnknownError();
    let fd: number | undefined;
    try {
      makeDurableDirectory(this.directory);
      fd = openSync(join(this.directory, "owner.json"), "wx", 0o600);
      writeFileSync(fd, `${JSON.stringify({ version: 1, operation: this.operation,
        definition: this.definition, reservation: randomUUID() })}\n`);
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      syncDirectory(this.directory);
      this.batch = claim.state;
    } catch (error) {
      this.batch = batchRestore({ $: "PendingIntent" });
      if (fd !== undefined) closeSync(fd);
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new SubmissionOutcomeUnknownError();
      throw error;
    }
  }

  configurePlan(payloads: readonly string[]): void {
    if (payloads.some(value => typeof value !== "string" || !value)) throw new Error("Invalid physical-message fingerprint");
    const created = this.validate(invokeBend(() => batchPlan(this.batch, encodeList(payloads))));
    if (created.effect.$ !== "PrepareSurface") throw new Error("A submission plan must be non-empty and may be installed only once");
    this.batch = created.state;
  }

  private validate(decision: BatchDecision): BatchDecision {
    if (decision.$ !== "BatchDecision" || !["Unclaimed", "Unplanned", "Closed", "Batch"].includes(decision.state.$)
      || !effects.includes(decision.effect.$)) throw new Error("Invalid Bend batch decision");
    if ((decision.state.$ === "Closed" || decision.state.$ === "Batch") && !phases.includes(decision.state.phase.$)) throw new Error("Invalid Bend batch phase");
    if (decision.state.$ === "Batch" && (typeof decision.state.slot !== "bigint" || decision.state.slot < 0n
      || typeof decision.state.current !== "string")) throw new Error("Invalid Bend batch slot");
    if (decision.state.$ === "Batch") decodeNat(decision.state.slot);
    return decision;
  }

  private transition(event: Event): Effect {
    const next = this.validate(invokeBend(() => batchStep(this.batch, { $: event })));
    if (next.effect.$ === "Reject") throw new Error(`Bend rejected ${event} in ${this.batch.$ === "Batch" || this.batch.$ === "Closed" ? this.batch.phase.$ : this.batch.$}`);
    this.batch = next.state;
    return next.effect.$;
  }

  /** Called once per physical message in the pre-authorized multipart plan. */
  authorizeSend(): void {
    const before = this.batch;
    const next = this.validate(invokeBend(() => batchStep(before, { $: "Submit" })));
    if (next.effect.$ !== "SendPrompt" || before.$ !== "Batch" || next.state.$ !== "Batch") {
      throw new SubmissionOutcomeUnknownError();
    }
    let fd: number | undefined;
    try {
      makeDurableDirectory(this.directory);
      fd = openSync(join(this.directory, `intent-${before.slot}.json`), "wx", 0o600);
      writeFileSync(fd, `${JSON.stringify({ version: 1, operation: this.operation, definition: this.definition,
        stage: before.slot.toString(), payload: before.current,
        decision: { phase: next.state.phase.$, effect: next.effect.$ } })}\n`);
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
      syncDirectory(this.directory);
      this.batch = next.state;
    } catch (error) {
      this.batch = batchRestore({ $: "PendingIntent" });
      if (fd !== undefined) closeSync(fd);
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new SubmissionOutcomeUnknownError();
      throw error;
    }
  }

  accepted(): void { this.transition("Accepted"); }

  /** A stage acknowledgment is not the final answer and does not publish one. */
  acknowledgeStage(index: number): void {
    if (!Number.isSafeInteger(index) || index <= 0) throw new Error("Invalid multipart acknowledgement");
    const stage = encodeNat(index, "multipart acknowledgement");
    const next = this.validate(invokeBend(() => batchAck(this.batch, stage)));
    if (next.effect.$ !== "PrepareSurface") throw new Error("Bend rejected the multipart acknowledgement");
    this.batch = next.state;
  }

  uncertain(): void { this.transition("Uncertain"); }

  complete(answer: string): void {
    if (this.transition("Finished") !== "PublishFinal") throw new Error("Final result has no active submission");
    try {
      writeReceipt(join(this.directory, "final.json"), this.directory,
        { version: 1, operation: this.operation, definition: this.definition, answer } satisfies FinalReceipt);
    } catch (error) {
      this.batch = batchRestore({ $: "PendingIntent" });
      throw error;
    }
  }

  cancelByUser(): boolean {
    const effect = this.transition("UserCancel");
    if ((this.batch.$ !== "Closed" && this.batch.$ !== "Batch") || this.batch.phase.$ !== "Cancelled") return false;
    makeDurableDirectory(this.directory);
    writeReceipt(join(this.directory, "cancelled.json"), this.directory,
      { version: 1, operation: this.operation, explicitUserCancellation: true });
    return effect === "StopByUser";
  }
}
