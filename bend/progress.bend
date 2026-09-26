import Base
import ./progress-domain.bend as D
import ./theory/transition-system.bend as Trace
import ./theory/nat-maximum.bend as Maximum

def initialize(role: D.Role) -> D.State:
  D.Progress{role, D.Snapshot{0n, 0n, 0n, None{}}, 0n, Nil{}, False{}}

def reject(state: D.State, reason: D.Rejection) -> D.Decision:
  D.Decision{state, D.Reject{reason}}

def touch(previous: Maybe<&2, Nat>, now: Nat) -> Maybe<&2, Nat>:
  match previous:
    case None{}: Some{now}
    case Some{old}: Some{Maximum.maximum(old, now)}

def batch(count: Nat, +revision: Nat, previous_batch: Nat, active: Nat,
          time: Maybe<&2, Nat>, observed: Nat, batches: List<&2, Nat>, now: Nat) -> D.Decision:
  match count:
    case 0n: reject(D.Progress{D.Recorder{}, D.Snapshot{revision, previous_batch, active, time}, observed, batches, False{}}, D.EmptyBatch{})
    case 1n+n:
      D.Decision{D.Progress{D.Recorder{}, D.Snapshot{1n+revision, 1n+revision, Nat.add(active, 1n+n), touch(time, now)},
        observed, Con{1n+revision, batches}, False{}}, D.ProgressChanged{}}

def result(active: Nat, revision: Nat, previous_batch: Nat, time: Maybe<&2, Nat>,
           observed: Nat, batches: List<&2, Nat>, now: Nat) -> D.Decision:
  match active:
    case 0n: reject(D.Progress{D.Recorder{}, D.Snapshot{revision, previous_batch, 0n, time}, observed, batches, False{}}, D.NoPendingCall{})
    case 1n+n:
      D.Decision{D.Progress{D.Recorder{}, D.Snapshot{1n+revision, previous_batch, n, touch(time, now)}, observed, batches, False{}}, D.ProgressChanged{}}

def check(known: Bool, observed: Bool, state: D.State) -> D.Decision:
  match known observed:
    case False{} _: reject(state, D.InvalidBatch{})
    case True{} False{}: D.Decision{state, D.ObservationNeeded{}}
    case True{} True{}: D.Decision{state, D.ObservationKnown{}}

def acknowledge(known: Bool, newer: Bool, role: D.Role, snapshot: D.Snapshot,
                observed: Nat, batches: List<&2, Nat>, revision: Nat) -> D.Decision:
  match known newer:
    case False{} _: reject(D.Progress{role, snapshot, observed, batches, False{}}, D.InvalidBatch{})
    case True{} False{}: D.Decision{D.Progress{role, snapshot, observed, batches, False{}}, D.ObservationReplayed{}}
    case True{} True{}: D.Decision{D.Progress{role, snapshot, revision, batches, False{}}, D.ObservationCommitted{}}

def timestamp_valid(revision: Nat, time: Maybe<&2, Nat>) -> Bool:
  match revision time:
    case 0n None{}: True{}
    case 1n+n Some{t}: True{}
    case _ _: False{}

def valid(snapshot: D.Snapshot) -> Bool:
  match snapshot:
    case D.Snapshot{+revision, +batch, active, time}:
      Bool.and(Nat.is_le(batch, revision),
        Bool.and(Bool.or(Nat.is_eq(active, 0n), Nat.is_gt(batch, 0n)), timestamp_valid(revision, time)))

def time_forward(old: Maybe<&2, Nat>, next: Maybe<&2, Nat>) -> Bool:
  match old next:
    case None{} _: True{}
    case Some{a} Some{b}: Nat.is_le(a, b)
    case Some{a} None{}: False{}

def time_same(a: Maybe<&2, Nat>, b: Maybe<&2, Nat>) -> Bool:
  match a b:
    case None{} None{}: True{}
    case Some{x} Some{y}: Nat.is_eq(x, y)
    case _ _: False{}

def frame_equal(a: D.Snapshot, b: D.Snapshot) -> Bool:
  match a b:
    case D.Snapshot{ar, ab, ac, at} D.Snapshot{br, bb, bc, bt}:
      Bool.and(Nat.is_eq(ar, br), Bool.and(Nat.is_eq(ab, bb), Bool.and(Nat.is_eq(ac, bc), time_same(at, bt))))

def forward(a: D.Snapshot, b: D.Snapshot) -> Bool:
  match a b:
    case D.Snapshot{ar, ab, ac, at} D.Snapshot{br, bb, bc, bt}:
      Bool.and(Nat.is_le(ab, bb), time_forward(at, bt))

def same_frame(equal: Bool, state: D.State) -> D.Decision:
  match equal:
    case True{}: D.Decision{state, D.FrameIgnored{}}
    case False{}: reject(state, D.ConflictingSnapshot{})

def accept_snapshot(snapshot: D.Snapshot, observed: Nat, batches: List<&2, Nat>) -> D.Decision:
  match snapshot:
    case D.Snapshot{revision, +batch, active, time}:
      D.Decision{D.Progress{D.Replica{}, D.Snapshot{revision, batch, active, time}, observed, Con{batch, batches}, False{}}, D.ProgressChanged{}}

def accept_frame(ordered: Bool, old: D.Snapshot, +next: D.Snapshot, observed: Nat,
                 batches: List<&2, Nat>) -> D.Decision:
  match ordered:
    case False{}: reject(D.Progress{D.Replica{}, old, observed, batches, False{}}, D.RegressedSnapshot{})
    case True{}: accept_snapshot(next, observed, batches)

def import_order(order: Cmp, +old: D.Snapshot, +next: D.Snapshot, observed: Nat,
                 batches: List<&2, Nat>) -> D.Decision:
  match order:
    case LT{}: D.Decision{D.Progress{D.Replica{}, old, observed, batches, False{}}, D.FrameIgnored{}}
    case EQ{}: same_frame(frame_equal(old, next), D.Progress{D.Replica{}, old, observed, batches, False{}})
    case GT{}: accept_frame(forward(old, next), old, next, observed, batches)

def import_valid(valid: Bool, +old: D.Snapshot, +next: D.Snapshot, observed: Nat,
                 batches: List<&2, Nat>) -> D.Decision:
  match valid:
    case False{}: reject(D.Progress{D.Replica{}, old, observed, batches, False{}}, D.InvalidSnapshot{})
    case True{}: import_order(Nat.cmp(D.revision(next), D.revision(old)), old, next, observed, batches)

def retire(role: D.Role, revision: Nat, batch: Nat, active: Nat, time: Maybe<&2, Nat>,
           observed: Nat, batches: List<&2, Nat>) -> D.Decision:
  match active:
    case 0n: D.Decision{D.Progress{role, D.Snapshot{revision, batch, 0n, time}, observed, batches, True{}}, D.OwnerClosed{}}
    case 1n+n: D.Decision{D.Progress{role, D.Snapshot{1n+revision, batch, 0n, time}, observed, batches, True{}}, D.OwnerClosed{}}

def recorder(snapshot: D.Snapshot, +observed: Nat, +batches: List<&2, Nat>, event: D.Event) -> D.Decision:
  match snapshot:
    case D.Snapshot{+revision, +previous_batch, active, time}:
      match event:
        case D.RecordBatch{count, now}: batch(count, revision, previous_batch, active, time, observed, batches, now)
        case D.RecordResult{now}: result(active, revision, previous_batch, time, observed, batches, now)
        case D.CheckBatch{+r}: check(Bool.and(Nat.is_gt(r, 0n), D.member(r, batches)), Nat.is_le(r, observed),
          D.Progress{D.Recorder{}, D.Snapshot{revision, previous_batch, active, time}, observed, batches, False{}})
        case D.Acknowledge{+r}: acknowledge(Bool.and(Nat.is_gt(r, 0n), D.member(r, batches)), Nat.is_gt(r, observed), D.Recorder{},
          D.Snapshot{revision, previous_batch, active, time}, observed, batches, r)
        case D.Import{next}: reject(D.Progress{D.Recorder{}, D.Snapshot{revision, previous_batch, active, time}, observed, batches, False{}}, D.WrongRole{})
        case D.Retire{}: retire(D.Recorder{}, revision, previous_batch, active, time, observed, batches)

def retire_snapshot(snapshot: D.Snapshot, observed: Nat, batches: List<&2, Nat>) -> D.Decision:
  match snapshot:
    case D.Snapshot{revision, batch, active, time}: retire(D.Replica{}, revision, batch, active, time, observed, batches)

def replica(+snapshot: D.Snapshot, +observed: Nat, +batches: List<&2, Nat>, event: D.Event) -> D.Decision:
  match event:
    case D.RecordBatch{count, now}: reject(D.Progress{D.Replica{}, snapshot, observed, batches, False{}}, D.WrongRole{})
    case D.RecordResult{now}: reject(D.Progress{D.Replica{}, snapshot, observed, batches, False{}}, D.WrongRole{})
    case D.CheckBatch{+r}: check(Bool.and(Nat.is_gt(r, 0n), D.member(r, batches)), Nat.is_le(r, observed),
      D.Progress{D.Replica{}, snapshot, observed, batches, False{}})
    case D.Acknowledge{+r}: acknowledge(Bool.and(Nat.is_gt(r, 0n), D.member(r, batches)), Nat.is_gt(r, observed), D.Replica{}, snapshot, observed, batches, r)
    case D.Import{+next}: import_valid(valid(next), snapshot, next, observed, batches)
    case D.Retire{}: retire_snapshot(snapshot, observed, batches)

def open_step(role: D.Role, snapshot: D.Snapshot, observed: Nat, batches: List<&2, Nat>, event: D.Event) -> D.Decision:
  match role:
    case D.Recorder{}: recorder(snapshot, observed, batches, event)
    case D.Replica{}: replica(snapshot, observed, batches, event)

def closed_step(state: D.State, event: D.Event) -> D.Decision:
  match event:
    case D.Retire{}: D.Decision{state, D.RetirementReplayed{}}
    case _: reject(state, D.OwnerRetired{})

def step(state: D.State, event: D.Event) -> D.Decision:
  match state:
    case D.Progress{role, snapshot, observed, batches, False{}}: open_step(role, snapshot, observed, batches, event)
    case D.Progress{role, snapshot, observed, batches, True{}}:
      closed_step(D.Progress{role, snapshot, observed, batches, True{}}, event)

def run(events: List<&2, D.Event>, state: D.State) -> List<&2, D.Decision>:
  Trace.run(~D.State, ~D.Event, ~D.Decision, ~step, ~D.state, events, state)
