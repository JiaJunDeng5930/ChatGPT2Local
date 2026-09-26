import Base
import ./progress-domain.bend as D
import ./progress.bend as K
import ./progress-specification.bend as S

law transition_refinement:
  for state: D.State
  for event: D.Event
  {K.step(state, event) == S.step(state, event) : D.Decision}

law trace_refinement:
  for events: List<&2, D.Event>
  for state: D.State
  {K.run(events, state) == S.run(events, state) : List<&2, D.Decision>}

law initial_snapshot:
  for role: D.Role
  {D.snapshot(K.initialize(role)) == D.Snapshot{0n, 0n, 0n, None{}} : D.Snapshot}

law retirement_is_not_model_progress:
  for state: D.State
  {D.time(D.snapshot(D.state(K.step(state, D.Retire{})))) == D.time(D.snapshot(state)) : Maybe<&2, Nat>}

def is_after(time: Maybe<&2, Nat>, previous: Nat) -> Bool:
  match time:
    case None{}: False{}
    case Some{now}: Nat.is_ge(now, previous)

law recording_never_rewinds_a_clock:
  for previous: Nat
  for now: Nat
  {is_after(K.touch(Some{previous}, now), previous) == True{} : Bool}

law an_unknown_batch_cannot_be_acknowledged:
  for newer: Bool
  for role: D.Role
  for snapshot: D.Snapshot
  for observed: Nat
  for batches: List<&2, Nat>
  for revision: Nat
  {K.acknowledge(False{}, newer, role, snapshot, observed, batches, revision) ==
   D.Decision{D.Progress{role, snapshot, observed, batches, False{}}, D.Reject{D.InvalidBatch{}}} : D.Decision}
