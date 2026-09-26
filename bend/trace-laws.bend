import Base
import ./domain.bend as D
import ./kernel.bend as K
import ./specification.bend as S
import ./theory/transition-system.bend as T

def cost(decision: D.Decision) -> Nat:
  D.sends(D.effect(decision))

law complete_trace_refinement:
  for events: List<&2, D.Event>
  for state: D.Phase
  {T.run(~D.Phase, ~D.Event, ~D.Decision, ~K.step, ~D.phase, events, state) ==
   T.run(~D.Phase, ~D.Event, ~D.Decision, ~S.transition, ~D.phase, events, state) : List<&2, D.Decision>}

law at_most_once_for_every_finite_trace:
  for events: List<&2, D.Event>
  for state: D.Phase
  {Nat.is_le(T.total(~D.Decision, ~cost,
    T.run(~D.Phase, ~D.Event, ~D.Decision, ~K.step, ~D.phase, events, state)), D.allowance(state)) == True{} : Bool}
