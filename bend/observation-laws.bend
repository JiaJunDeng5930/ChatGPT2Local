import Base
import ./observation-domain.bend as O
import ./observation.bend as K
import ./observation-specification.bend as S

law evidence_refinement:
  for facts: O.Facts
  {K.eligible(facts) == S.eligible(facts) : Bool}

law transition_refinement:
  for state: O.State
  for event: O.Event
  {K.step(state, event) == S.step(event, state) : O.Decision}

law uncertainty_only_observes:
  for state: O.State
  {O.effect(K.step(state, O.Uncertain{})) == O.ObserveOnly{} : O.Effect}

law uncertainty_keeps_tool_boundary:
  for state: O.State
  {O.revision(O.state(K.step(state, O.Uncertain{}))) == O.revision(state) : Nat}
