import Base
import ./outbox-domain.bend as D
import ./outbox.bend as K
import ./outbox-specification.bend as S

law transition_refinement:
  for state: D.State
  for event: D.Event
  {K.step(state, event) == S.step(state, event) : D.Decision}

law trace_refinement:
  for events: List<&2, D.Event>
  for state: D.State
  {K.run(events, state) == S.run(events, state) : List<&2, D.Decision>}

law rejected_batch_is_atomic:
  for old: D.State
  for calls: List<&2, D.Call>
  for spent: List<&2, String>
  for prelude: String
  {D.state(K.offer(False{}, True{}, False{}, old, calls, spent, prelude)) == old : D.State}

law receipt_preserves_other_head:
  for id: String
  for key: String
  for payload: String
  for rest: List<&2, D.Call>
  for different: {String.eq(id, key) == False{} : Bool}
  {D.without(id, Con{D.Call{key, payload}, rest}) ==
   Con{D.Call{key, payload}, D.without(id, rest)} : List<&2, D.Call>}

law receipt_never_releases_a_spent_identity:
  for known: Bool
  for pending: List<&2, D.Call>
  for spent: List<&2, String>
  for prelude: String
  for remaining: List<&2, D.Call>
  {spent_of(D.state(K.receive(known, D.Outbox{pending, spent, prelude}, remaining, spent, prelude))) == spent : List<&2, String>}

def spent_of(state: D.State) -> List<&2, String>:
  match state:
    case D.Outbox{pending, spent, prelude}: spent
