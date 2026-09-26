import Base
import ./broker-domain.bend as D
import ./broker.bend as K
import ./broker-specification.bend as S
import ./broker-table.bend as M

law transition_refinement:
  for state: D.State
  for event: D.Event
  {K.step(state, event) == S.step(state, event) : D.Decision}

law trace_refinement:
  for events: List<&2, D.Event>
  for state: D.State
  {K.run(events, state) == S.run(events, state) : List<&2, D.Decision>}

law completion_never_crosses_an_outstanding_obligation:
  for state: D.State
  for revision: Nat
  {S.fence_is_safe(D.effect(K.step(state, D.CommitFence{revision})), M.busy(state)) == True{} : Bool}

law sealed_rejects_enqueue:
  for sealed_revision: Nat
  for env: String
  for revision: Nat
  for activities: List<&2, D.Activity>
  for calls: List<&2, D.Invocation>
  for id: String
  for payload: String
  {K.step(D.Broker{D.Sealed{sealed_revision}, env, revision, activities, calls}, D.Enqueue{id, payload}) ==
   D.Decision{D.Broker{D.Sealed{sealed_revision}, env, revision, activities, calls}, D.Reject{D.OwnerClosed{}}} : D.Decision}

law retired_cannot_reopen:
  for env: String
  for revision: Nat
  for activities: List<&2, D.Activity>
  for calls: List<&2, D.Invocation>
  for event: D.Event
  {D.lifetime(D.state(K.step(D.Broker{D.Retired{}, env, revision, activities, calls}, event))) == D.Retired{} : D.Lifetime}

# Replaying a poll is a delivery receipt, never another invocation allocation.
law poll_replay:
  for id: String
  for rest: List<&2, String>
  for queued: List<&2, String>
  for env: String
  for revision: Nat
  for activities: List<&2, D.Activity>
  for calls: List<&2, D.Invocation>
  {K.poll(Con{id, rest}, queued, env, revision, activities, calls) ==
   D.Decision{D.Broker{D.Open{}, env, revision, activities, calls}, D.CallsReplayed{Con{id, rest}}} : D.Decision}

law early_result_rejected:
  for id: String
  for payload: String
  for digest: String
  for env: String
  for revision: Nat
  for activities: List<&2, D.Activity>
  for calls: List<&2, D.Invocation>
  {K.finish_found(Some{D.Invocation{id, payload, D.Queued{}}}, digest, env, revision, activities, calls) ==
   D.Decision{D.Broker{D.Open{}, env, revision, activities, calls}, D.Reject{D.CallNotDelivered{}}} : D.Decision}

law completed_activity_cannot_restart:
  for id: String
  for env: String
  for revision: Nat
  for activities: List<&2, D.Activity>
  for calls: List<&2, D.Invocation>
  {K.claim(Some{True{}}, id, env, revision, activities, calls) ==
   D.Decision{D.Broker{D.Open{}, env, revision, activities, calls}, D.Reject{D.ActivityAlreadyCompleted{}}} : D.Decision}
