import Base
import ./domain.bend as D
import ./kernel.bend as K
import ./specification.bend as S
import ./LAWS.bend as L
import ./turn-proof.bend as TurnProof
import ./trace-laws.bend as Trace
import ./theory/transition-system.bend as T

def Trace.complete_trace_refinement(events, state):
  T.refinement(~D.Phase, ~D.Event, ~D.Decision, ~K.step, ~S.transition, ~D.phase, ~L.turn_refinement, events, state)

def Trace.at_most_once_for_every_finite_trace(events, state):
  T.budget(~D.Phase, ~D.Event, ~D.Decision, ~K.step, ~D.phase, ~Trace.cost, ~D.allowance, ~L.send_allowance, events, state)
