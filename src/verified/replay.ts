/** Native HTTP replay interpreter. Canonical bytes, not mutable observer objects, are authoritative. */
import type { AdapterEvent } from "../types";
import type { BrokerToolRequest } from "../adapters/chatgpt-web/turn-broker";
import * as bend from "./generated/core.cjs";
import { invokeBend } from "./boundary";
import { encodeList } from "./core";
import { canonicalJson, digest } from "./encoding";

function array<T>(list: bend.List<T>): T[] {
  const result: T[] = [];
  for (let cursor = list; cursor.$ !== "Nil"; cursor = cursor.tail) {
    if (cursor.$ !== "Con") throw new Error("Invalid Bend replay list");
    result.push(cursor.head);
  }
  return result;
}

function nonempty(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value) throw new Error("Invalid native replay identity");
}

export class VerifiedOutbox {
  #state = bend.outboxInitialize();

  offer(requests: readonly BrokerToolRequest[], reasoning: readonly string[], events: readonly AdapterEvent[]): void {
    const calls = encodeList(requests.map(request => {
      nonempty(request.callId);
      return { $: "Call" as const, id: request.callId, payload: canonicalJson(request) };
    }));
    this.apply({ $: "Offer", calls, prelude: canonicalJson({ reasoning, events }) });
  }

  receipt(id: string): void { nonempty(id); this.apply({ $: "Receipt", id }); }
  contains(id: string): boolean { nonempty(id); return bend.outboxContains(this.#state, id); }

  pending(): BrokerToolRequest[] {
    return array(this.#state.pending).map(call => {
      const result = JSON.parse(call.payload) as BrokerToolRequest;
      if (call.$ !== "Call" || result.callId !== call.id) throw new Error("Invalid Bend outbox payload identity");
      return result;
    });
  }

  prelude(): { reasoning: string[]; events: AdapterEvent[] } {
    return this.#state.prelude ? JSON.parse(this.#state.prelude) : { reasoning: [], events: [] };
  }

  private apply(event: bend.OutboxEvent): void {
    const decision = invokeBend(() => bend.outboxStep(this.#state, event));
    if (decision.$ !== "Decision" || decision.state.$ !== "Outbox") throw new Error("Invalid Bend outbox decision");
    if (decision.effect.$ === "Reject") {
      switch (decision.effect.reason.$) {
        case "PendingBatch": throw new Error("cannot emit a new ChatGPT tool batch while the previous batch is unresolved");
        case "EmptyBatch": throw new Error("cannot emit an empty ChatGPT tool batch");
        case "DuplicateCall": throw new Error("duplicate ChatGPT bridge tool call id");
        case "UnknownCall": throw new Error("ChatGPT bridge tool result does not match an outstanding call");
      }
    }
    this.#state = decision.state;
  }
}

export class VerifiedReplayJournal {
  #state = bend.replayInitialize();
  #failure?: Error;

  events(): AdapterEvent[] {
    return array(this.#state.events).map(frame => {
      const event = JSON.parse(frame.payload) as AdapterEvent;
      if (frame.$ !== "Frame" || event.type !== frame.kind) throw new Error("Invalid Bend replay frame identity");
      return event;
    });
  }
  reasoning(): string[] { return array(this.#state.reasoning); }
  closed(): boolean { return bend.replayClosed(this.#state); }
  terminal(): boolean { return bend.replayTerminal(this.#state); }
  failure(): Error | undefined { return this.#state.status.$ === "Failed" ? this.#failure : undefined; }

  append(events: readonly AdapterEvent[]): void {
    if (events.length === 0) return;
    this.apply({ $: "Append", events: encodeList(events.map(event => {
      nonempty(event.type);
      return { $: "Frame" as const, kind: event.type, payload: canonicalJson(event) };
    })) });
  }

  reason(parts: readonly string[]): void {
    if (parts.length === 0) return;
    if (parts.some(part => typeof part !== "string")) throw new Error("Invalid native replay reasoning");
    this.apply({ $: "Reason", parts: encodeList(parts) });
  }

  seal(): void { this.apply({ $: "Seal" }); }

  fail(error: Error): void {
    if (!(error instanceof Error)) throw new Error("Native replay failure requires an Error resource");
    const effect = this.apply({ $: "Fail", reason: digest(canonicalJson({ name: error.name, message: error.message })) });
    if (effect.$ === "FailureRecorded") this.#failure = error;
  }

  private apply(event: bend.ReplayEvent): bend.ReplayDecision["effect"] {
    const decision = invokeBend(() => bend.replayStep(this.#state, event));
    if (decision.$ !== "Decision" || decision.state.$ !== "Journal") throw new Error("Invalid Bend replay decision");
    if (decision.effect.$ === "Reject") throw new Error(`cannot append to or alter a completed ChatGPT native round: ${decision.effect.reason.$}`);
    this.#state = decision.state;
    return decision.effect;
  }
}
