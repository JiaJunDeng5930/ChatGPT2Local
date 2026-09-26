/** Atomic foreign-value boundary for the shared recorder / replica protocol. */
import * as bend from "./generated/core.cjs";
import { BEND_NAT_MAX, decodeNat, encodeNat, invokeBend } from "./boundary";

export interface ProgressSnapshot {
  revision: number;
  lastToolBatchRevision: number;
  activeToolCalls: number;
  lastProgressAt?: number;
}

export function progressNat(value: number, name: string): bigint {
  return encodeNat(value, `progress ${name}`);
}

function safeNumber(value: bigint): number {
  return decodeNat(value);
}

function project(snapshot: bend.ProgressSnapshot): ProgressSnapshot {
  if (snapshot.$ !== "Snapshot" || !["None", "Some"].includes(snapshot.time.$)) throw new Error("Invalid Bend progress snapshot");
  return {
    revision: safeNumber(snapshot.revision), lastToolBatchRevision: safeNumber(snapshot.batch), activeToolCalls: safeNumber(snapshot.active),
    ...(snapshot.time.$ === "Some" ? { lastProgressAt: safeNumber(snapshot.time.value) } : {}),
  };
}

export function encodeProgressSnapshot(snapshot: ProgressSnapshot): bend.ProgressSnapshot {
  try {
    const result: bend.ProgressSnapshot = { $: "Snapshot", revision: progressNat(snapshot.revision, "revision"),
      batch: progressNat(snapshot.lastToolBatchRevision, "batch revision"), active: progressNat(snapshot.activeToolCalls, "active calls"),
      time: snapshot.lastProgressAt === undefined ? { $: "None" } : { $: "Some", value: progressNat(snapshot.lastProgressAt, "timestamp") } };
    if (!bend.progressValid(result)) throw new Error("Invalid structural snapshot");
    return result;
  } catch {
    throw new Error("ChatGPT external progress snapshot is invalid");
  }
}

export function progressFailure(effect: bend.ProgressEffect, retirementError?: Error): Error {
  if (effect.$ !== "Reject") return new Error(`Unexpected Bend progress effect: ${effect.$}`);
  switch (effect.reason.$) {
    case "WrongRole": return new Error("ChatGPT external progress operation was sent to the wrong owner");
    case "EmptyBatch": return new Error("ChatGPT external progress requires a non-empty tool batch");
    case "NoPendingCall": return new Error("ChatGPT external progress received a tool result without an active call");
    case "InvalidBatch": return new Error("ChatGPT tool-boundary acknowledgement has an invalid batch revision");
    case "InvalidSnapshot": return new Error("ChatGPT external progress snapshot is invalid");
    case "RegressedSnapshot": return new Error("ChatGPT external progress snapshot regressed against the observed state");
    case "ConflictingSnapshot": return new Error("ChatGPT external progress received conflicting bytes for one snapshot revision");
    case "OwnerRetired": return retirementError ?? new Error("ChatGPT external progress owner was retired");
  }
}

export class VerifiedProgress {
  #state: bend.ProgressState;

  constructor(role: bend.ProgressRole) {
    if (role !== "Recorder" && role !== "Replica") throw new Error("Invalid Bend progress role");
    this.#state = bend.progressInitialize({ $: role });
  }

  snapshot(): ProgressSnapshot { return project(this.#state.snapshot); }
  observed(): number { return safeNumber(this.#state.observed); }

  dispatch(event: bend.ProgressEvent): bend.ProgressEffect {
    const nat = (value: bigint) => { if (typeof value !== "bigint" || value < 0n || value > BEND_NAT_MAX) throw new Error("Invalid Bend progress natural number"); };
    if (!event || typeof event !== "object") throw new Error("Invalid Bend progress event");
    switch (event.$) {
      case "RecordBatch": nat(event.count); nat(event.now); break;
      case "RecordResult": nat(event.now); break;
      case "CheckBatch": case "Acknowledge": nat(event.revision); break;
      case "Import": encodeProgressSnapshot(project(event.snapshot)); break;
      case "Retire": break;
      default: throw new Error("Invalid Bend progress event tag");
    }
    const decision = invokeBend(() => bend.progressStep(this.#state, event));
    if (decision.$ !== "Decision" || decision.state.$ !== "Progress" || typeof decision.state.retired !== "boolean") {
      throw new Error("Invalid Bend progress decision");
    }
    // Checking output bounds precedes committing the entire state. In particular,
    // overflow or a bad timestamp cannot partially increment an active-call count.
    project(decision.state.snapshot);
    safeNumber(decision.state.observed);
    this.#state = decision.state;
    return decision.effect;
  }
}
