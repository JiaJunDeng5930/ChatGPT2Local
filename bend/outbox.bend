import Base
import ./outbox-domain.bend as D
import ./theory/transition-system.bend as Trace

def initialize() -> D.State:
  D.Outbox{Nil{}, Nil{}, ""}

# Admission computes a decision for the WHOLE batch before any bytes are made
# visible. A duplicate near the end cannot leave the earlier calls installed.
def offer(busy: Bool, nonempty: Bool, fresh: Bool, old: D.State,
          +calls: List<&2, D.Call>, spent: List<&2, String>, prelude: String) -> D.Decision:
  match busy nonempty fresh:
    case True{} _ _: D.Decision{old, D.Reject{D.PendingBatch{}}}
    case False{} False{} _: D.Decision{old, D.Reject{D.EmptyBatch{}}}
    case False{} True{} False{}: D.Decision{old, D.Reject{D.DuplicateCall{}}}
    case False{} True{} True{}:
      D.Decision{D.Outbox{calls, List.append(&2, String, D.names(calls), spent), prelude}, D.BatchPublished{}}

def receive(known: Bool, old: D.State, +remaining: List<&2, D.Call>,
            spent: List<&2, String>, prelude: String) -> D.Decision:
  match known:
    case False{}: D.Decision{old, D.Reject{D.UnknownCall{}}}
    case True{}: D.Decision{D.Outbox{remaining, spent, D.prelude_for(remaining, prelude)}, D.ReceiptRecorded{}}

def step(state: D.State, event: D.Event) -> D.Decision:
  match state:
    case D.Outbox{+pending, +spent, +prelude}:
      match event:
        case D.Offer{+calls, next_prelude}:
          offer(D.nonempty(pending), D.nonempty(calls), D.fresh(calls, spent),
            D.Outbox{pending, spent, prelude}, calls, spent, next_prelude)
        case D.Receipt{+id}:
          receive(D.member(id, D.names(pending)), D.Outbox{pending, spent, prelude},
            D.without(id, pending), spent, prelude)

def run(events: List<&2, D.Event>, state: D.State) -> List<&2, D.Decision>:
  Trace.run(~D.State, ~D.Event, ~D.Decision, ~step, ~D.state, events, state)
