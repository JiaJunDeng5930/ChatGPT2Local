import Base
import ./domain.bend as D
import ./batch-domain.bend as B
import ./batch.bend as K
import ./batch-specification.bend as S
import ./theory/transition-system.bend as T

law reservation_refinement:
  for state: B.State
  {K.claim(state) == S.claim(state) : B.Decision}

law reservation_is_once_only:
  for state: B.State
  {B.effect(K.claim(B.state(K.claim(state)))) == D.Reject{} : D.Effect}

law preparation_requires_reservation:
  for payloads: List<&2, String>
  {K.plan(B.Unclaimed{}, payloads) == B.BatchDecision{B.Unclaimed{}, D.Reject{}} : B.Decision}

law restored_operations_cannot_send:
  for receipt: B.Restoration
  {B.effect(K.step(K.restore(receipt), D.Submit{})) == D.Reject{} : D.Effect}

law plan_has_exactly_its_declared_budget:
  for payloads: List<&2, String>
  {B.potential(B.state(K.plan(B.Unplanned{}, payloads))) == List.length(&2, String, payloads) : Nat}

law plan_refinement:
  for state: B.State
  for payloads: List<&2, String>
  {K.plan(state, payloads) == S.plan(state, payloads) : B.Decision}

law control_refinement:
  for state: B.State
  for event: D.Event
  {K.step(state, event) == S.step(event, state) : B.Decision}

law acknowledgement_refinement:
  for state: B.State
  for stage: Nat
  {K.acknowledge(state, stage) == S.acknowledge(stage, state) : B.Decision}

law transition_refinement:
  for state: B.State
  for input: B.Input
  {K.transition(state, input) == S.transition(state, input) : B.Decision}

law control_budget:
  for state: B.State
  for event: D.Event
  {Nat.is_le(Nat.add(B.cost(K.step(state, event)), B.potential(B.state(K.step(state, event)))), B.potential(state)) == True{} : Bool}

law acknowledgement_budget:
  for state: B.State
  for stage: Nat
  {Nat.is_le(Nat.add(B.cost(K.acknowledge(state, stage)), B.potential(B.state(K.acknowledge(state, stage)))), B.potential(state)) == True{} : Bool}

law transition_budget:
  for state: B.State
  for input: B.Input
  {Nat.is_le(Nat.add(B.cost(K.transition(state, input)), B.potential(B.state(K.transition(state, input)))), B.potential(state)) == True{} : Bool}

law every_finite_trace_refines:
  for state: B.State
  for events: List<&2, B.Input>
  {T.run(~B.State, ~B.Input, ~B.Decision, ~K.transition, ~B.state, events, state) ==
   T.run(~B.State, ~B.Input, ~B.Decision, ~S.transition, ~B.state, events, state) : List<&2, B.Decision>}

law every_finite_trace_within_budget:
  for state: B.State
  for events: List<&2, B.Input>
  {Nat.is_le(T.total(~B.Decision, ~B.cost,
    T.run(~B.State, ~B.Input, ~B.Decision, ~K.transition, ~B.state, events, state)), B.potential(state)) == True{} : Bool}
