/** Typed DOM observations enter the checked Bend observer; no second tracker. */
import {
  observationEligible, observationInitialize, observationStep,
  type ObservationDecision, type ObservationEvent, type ObservationFacts,
} from "./generated/core.cjs";
import { canonicalJson, digest } from "./encoding";
import { decodeNat, encodeNat, invokeBend } from "./boundary";

export interface CompletionEvidence {
  responsePresent: boolean;
  running: boolean;
  currentText: string;
  currentHtml?: string;
  completionActionVisible: boolean;
  replyErrorVisible?: boolean;
  stoppedThinkingVisible?: boolean;
  externalToolCallsInFlight?: boolean;
}

export function natural(value: number, field: string): bigint {
  return encodeNat(value, field);
}

function facts(evidence: CompletionEvidence): ObservationFacts {
  if (typeof evidence.currentText !== "string"
    || (evidence.currentHtml !== undefined && typeof evidence.currentHtml !== "string")
    || [evidence.responsePresent, evidence.running, evidence.completionActionVisible].some(value => typeof value !== "boolean")
    || [evidence.replyErrorVisible, evidence.stoppedThinkingVisible, evidence.externalToolCallsInFlight]
      .some(value => value !== undefined && typeof value !== "boolean")) {
    throw new Error("Invalid DOM observation at the Bend boundary");
  }
  return { $: "Facts", present: evidence.responsePresent, running: evidence.running,
    has_text: evidence.currentText.length > 0, completion_control: evidence.completionActionVisible,
    reply_error: evidence.replyErrorVisible === true, stopped_badge: evidence.stoppedThinkingVisible === true,
    tools_in_flight: evidence.externalToolCallsInFlight === true };
}

export function hasCompletionEvidence(evidence: CompletionEvidence): boolean {
  return observationEligible(facts(evidence));
}

const effects = new Set([
  "ObserveOnly", "WaitForTools", "WaitForPostToolAnswer", "CandidateReady",
  "BoundaryCaptured", "DuplicateBoundary", "RejectBoundary",
]);

export class VerifiedCompletionObserver {
  private state = observationInitialize();
  private readonly stableMs: bigint;

  constructor(stableMs: number) { this.stableMs = natural(stableMs, "completion stability window"); }

  private transition(event: ObservationEvent, commit = true): ObservationDecision {
    const decision = invokeBend(() => observationStep(this.state, event));
    if (decision.$ !== "Decision" || !effects.has(decision.effect.$)
      || !["Watching", "Candidate"].includes(decision.state.$)
      || typeof decision.state.revision !== "bigint" || decision.state.revision < 0n) {
      throw new Error("Invalid Bend observation decision");
    }
    decodeNat(decision.state.revision);
    if (decision.state.$ === "Candidate") decodeNat(decision.state.since);
    if (commit) this.state = decision.state;
    return decision;
  }

  needsToolBatchObservation(revision: number): boolean {
    const decision = this.transition({ $: "CaptureBoundary", revision: natural(revision, "tool batch revision"), text: "" }, false);
    if (decision.effect.$ === "RejectBoundary") throw new Error("ChatGPT completion received an invalid tool-batch revision");
    return decision.effect.$ === "BoundaryCaptured";
  }

  observeToolBatch(revision: number, currentText: string): boolean {
    if (typeof currentText !== "string") throw new Error("Invalid pre-tool answer observation");
    const decision = this.transition({ $: "CaptureBoundary", revision: natural(revision, "tool batch revision"), text: digest(currentText) });
    if (decision.effect.$ === "RejectBoundary") throw new Error("ChatGPT completion received an invalid tool-batch revision");
    return decision.effect.$ === "BoundaryCaptured";
  }

  uncertain(): void { this.transition({ $: "Uncertain" }); }

  update(evidence: CompletionEvidence, now = Date.now()): boolean {
    return this.transition({ $: "Sample", facts: facts(evidence),
      text: digest(evidence.currentText),
      signature: digest(canonicalJson([evidence.currentText, evidence.currentHtml ?? evidence.currentText])),
      now: natural(now, "observation time"), stable_ms: this.stableMs,
    }).effect.$ === "CandidateReady";
  }
}
