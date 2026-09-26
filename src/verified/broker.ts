/** In-process effect interpreter boundary; the only owner state is the Bend value. */
import * as bend from "./generated/core.cjs";
import { decodeNat, invokeBend } from "./boundary";

export type { BrokerEffect, BrokerEvent } from "./generated/core.cjs";

function nonempty(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value) throw new Error("Invalid string at the Bend broker boundary");
}

/** Never expose the mutable foreign representation to callers or persisted JSON. */
export class VerifiedBroker {
  #state: bend.BrokerState;

  constructor(environment: string) {
    nonempty(environment);
    this.#state = bend.brokerInitialize(environment);
  }

  dispatch(event: bend.BrokerEvent): bend.BrokerEffect {
    // The JS emitter assumes well-typed inputs. Unknown tags must not reach its
    // exhaustive-match fallback, even when a caller bypasses TypeScript.
    if (!event || typeof event !== "object") throw new Error("Invalid Bend broker event");
    switch (event.$) {
      case "ClaimActivity": case "CompleteActivity": nonempty(event.id); break;
      case "Enqueue": nonempty(event.id); nonempty(event.payload); break;
      case "CompleteCall": nonempty(event.id); nonempty(event.digest); break;
      case "CheckEnvironment": nonempty(event.environment); break;
      case "CommitFence":
        decodeNat(event.revision);
        break;
      case "Poll": case "BeginFence": case "Retire": break;
      default: throw new Error("Invalid Bend broker event tag");
    }
    const decision = invokeBend(() => bend.brokerStep(this.#state, event));
    if (decision.$ !== "Decision" || decision.state.$ !== "Broker"
      || typeof decision.state.revision !== "bigint" || decision.state.revision < 0n) {
      throw new Error("Invalid decision from the Bend broker boundary");
    }
    decodeNat(decision.state.revision);
    this.#state = decision.state;
    return decision.effect;
  }
}

export function brokerIds(list: bend.List<string>): string[] {
  const ids: string[] = [];
  let cursor = list;
  while (cursor.$ === "Con") {
    nonempty(cursor.head);
    ids.push(cursor.head);
    cursor = cursor.tail;
  }
  if (cursor.$ !== "Nil") throw new Error("Invalid Bend broker delivery list");
  return ids;
}

export function brokerRevision(value: bigint): number {
  return decodeNat(value);
}
