import Base
import ./outbox-domain.bend as D
import ./theory/transition-system.bend as Trace

# The finite-list predicates describe identities and payloads, not permission.
# Policy is stated in command order here, independently of the implementation.
def admit(busy: Bool, nonempty: Bool, fresh: Bool, old: D.State,
          +calls: List<&2, D.Call>, spent: List<&2, String>, prelude: String) -> D.Decision:
  match busy nonempty fresh:
    case False{} True{} True{}:
      D.Decision{D.Outbox{calls, List.append(&2, String, D.names(calls), spent), prelude}, D.BatchPublished{}}
    case False{} True{} False{}: D.Decision{old, D.Reject{D.DuplicateCall{}}}
    case False{} False{} _: D.Decision{old, D.Reject{D.EmptyBatch{}}}
    case True{} _ _: D.Decision{old, D.Reject{D.PendingBatch{}}}

def acknowledge(known: Bool, old: D.State, +remaining: List<&2, D.Call>,
                spent: List<&2, String>, prelude: String) -> D.Decision:
  match known:
    case True{}: D.Decision{D.Outbox{remaining, spent, D.prelude_for(remaining, prelude)}, D.ReceiptRecorded{}}
    case False{}: D.Decision{old, D.Reject{D.UnknownCall{}}}

def offer_command(state: D.State, +calls: List<&2, D.Call>, prelude: String) -> D.Decision:
  match state:
    case D.Outbox{+pending, +spent, old_prelude}:
      admit(D.nonempty(pending), D.nonempty(calls), D.fresh(calls, spent),
        D.Outbox{pending, spent, old_prelude}, calls, spent, prelude)

def receipt_command(state: D.State, +id: String) -> D.Decision:
  match state:
    case D.Outbox{+pending, +spent, +prelude}:
      acknowledge(D.member(id, D.names(pending)), D.Outbox{pending, spent, prelude},
        D.without(id, pending), spent, prelude)

def step(state: D.State, event: D.Event) -> D.Decision:
  match event:
    case D.Offer{calls, prelude}: offer_command(state, calls, prelude)
    case D.Receipt{id}: receipt_command(state, id)

def run(events: List<&2, D.Event>, state: D.State) -> List<&2, D.Decision>:
  Trace.run(~D.State, ~D.Event, ~D.Decision, ~step, ~D.state, events, state)
