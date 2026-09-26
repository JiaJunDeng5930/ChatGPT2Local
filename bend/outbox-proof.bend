import Base
import ./outbox-domain.bend as D
import ./outbox.bend as K
import ./outbox-specification.bend as S
import ./outbox-laws.bend as L
import ./theory/transition-system.bend as Trace

def offer_refinement(busy: Bool, nonempty: Bool, fresh: Bool, old: D.State,
  calls: List<&2, D.Call>, spent: List<&2, String>, prelude: String) ->
  {K.offer(busy, nonempty, fresh, old, calls, spent, prelude) == S.admit(busy, nonempty, fresh, old, calls, spent, prelude) : D.Decision}:
  match busy nonempty fresh:
    case True{} True{} True{}: {==}
    case True{} True{} False{}: {==}
    case True{} False{} True{}: {==}
    case True{} False{} False{}: {==}
    case False{} True{} True{}: {==}
    case False{} True{} False{}: {==}
    case False{} False{} True{}: {==}
    case False{} False{} False{}: {==}

def receipt_refinement(known: Bool, old: D.State, remaining: List<&2, D.Call>, spent: List<&2, String>, prelude: String) ->
  {K.receive(known, old, remaining, spent, prelude) == S.acknowledge(known, old, remaining, spent, prelude) : D.Decision}:
  match known:
    case True{}: {==}
    case False{}: {==}

def L.transition_refinement(state, event):
  match state:
    case D.Outbox{+pending, +spent, +prelude}:
      match event:
        case D.Offer{+calls, next_prelude}:
          offer_refinement(D.nonempty(pending), D.nonempty(calls), D.fresh(calls, spent),
            D.Outbox{pending, spent, prelude}, calls, spent, next_prelude)
        case D.Receipt{+id}:
          receipt_refinement(D.member(id, D.names(pending)), D.Outbox{pending, spent, prelude}, D.without(id, pending), spent, prelude)

def L.trace_refinement(events, state):
  Trace.refinement(~D.State, ~D.Event, ~D.Decision, ~K.step, ~S.step, ~D.state, ~L.transition_refinement, events, state)

def L.rejected_batch_is_atomic(old, calls, spent, prelude):
  {==}

def L.receipt_preserves_other_head(id, key, payload, rest, different):
  %Equal.sym(Bool, String.eq(id, key), False{}, different) :
    {D.keep(Bool.not(_), D.Call{key, payload}, D.without(id, rest)) ==
     Con{D.Call{key, payload}, D.without(id, rest)} : List<&2, D.Call>}
  {==}

def L.receipt_never_releases_a_spent_identity(known, pending, spent, prelude, remaining):
  match known:
    case True{}: {==}
    case False{}: {==}
