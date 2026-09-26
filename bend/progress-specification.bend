import Base
import ./progress-domain.bend as D
import ./theory/transition-system.bend as Trace

# Command-oriented contract: recording and replaying are distinct roles. An
# acknowledgement names an actual observed batch, not any integer below a bound.
def refuse(state: D.State, reason: D.Rejection) -> D.Decision:
  D.Decision{state, D.Reject{reason}}

def clock(previous: Maybe<&2, Nat>, now: Nat) -> Maybe<&2, Nat>:
  match previous:
    case Some{old}: Some{Nat.max(old, now)}
    case None{}: Some{now}

def add_batch(count: Nat, +revision: Nat, batch: Nat, active: Nat, time: Maybe<&2, Nat>,
              observed: Nat, batches: List<&2, Nat>, now: Nat) -> D.Decision:
  match count:
    case 1n+n: D.Decision{D.Progress{D.Recorder{}, D.Snapshot{1n+revision, 1n+revision, Nat.add(active, 1n+n), clock(time, now)},
      observed, Con{1n+revision, batches}, False{}}, D.ProgressChanged{}}
    case 0n: refuse(D.Progress{D.Recorder{}, D.Snapshot{revision, batch, active, time}, observed, batches, False{}}, D.EmptyBatch{})

def remove_call(active: Nat, revision: Nat, batch: Nat, time: Maybe<&2, Nat>,
                observed: Nat, batches: List<&2, Nat>, now: Nat) -> D.Decision:
  match active:
    case 1n+n: D.Decision{D.Progress{D.Recorder{}, D.Snapshot{1n+revision, batch, n, clock(time, now)}, observed, batches, False{}}, D.ProgressChanged{}}
    case 0n: refuse(D.Progress{D.Recorder{}, D.Snapshot{revision, batch, 0n, time}, observed, batches, False{}}, D.NoPendingCall{})

def check(known: Bool, observed: Bool, state: D.State) -> D.Decision:
  match known observed:
    case True{} True{}: D.Decision{state, D.ObservationKnown{}}
    case True{} False{}: D.Decision{state, D.ObservationNeeded{}}
    case False{} _: refuse(state, D.InvalidBatch{})

def acknowledge(known: Bool, newer: Bool, role: D.Role, snapshot: D.Snapshot,
                observed: Nat, batches: List<&2, Nat>, revision: Nat) -> D.Decision:
  match known newer:
    case True{} True{}: D.Decision{D.Progress{role, snapshot, revision, batches, False{}}, D.ObservationCommitted{}}
    case True{} False{}: D.Decision{D.Progress{role, snapshot, observed, batches, False{}}, D.ObservationReplayed{}}
    case False{} _: refuse(D.Progress{role, snapshot, observed, batches, False{}}, D.InvalidBatch{})

def stamp_valid(time: Maybe<&2, Nat>, revision: Nat) -> Bool:
  match time revision:
    case None{} 0n: True{}
    case Some{t} 1n+n: True{}
    case _ _: False{}

def valid(snapshot: D.Snapshot) -> Bool:
  match snapshot:
    case D.Snapshot{+revision, +batch, active, time}:
      Bool.and(Nat.is_le(batch, revision),
        Bool.and(Bool.or(Nat.is_eq(active, 0n), Nat.is_gt(batch, 0n)), stamp_valid(time, revision)))

def time_forward(old: Maybe<&2, Nat>, next: Maybe<&2, Nat>) -> Bool:
  match old next:
    case Some{a} None{}: False{}
    case Some{a} Some{b}: Nat.is_le(a, b)
    case None{} _: True{}

def time_equal(old: Maybe<&2, Nat>, next: Maybe<&2, Nat>) -> Bool:
  match old next:
    case Some{a} Some{b}: Nat.is_eq(a, b)
    case None{} None{}: True{}
    case _ _: False{}

def frame_equal(a: D.Snapshot, b: D.Snapshot) -> Bool:
  match a b:
    case D.Snapshot{ar, ab, ac, at} D.Snapshot{br, bb, bc, bt}:
      Bool.and(Nat.is_eq(ar, br), Bool.and(Nat.is_eq(ab, bb), Bool.and(Nat.is_eq(ac, bc), time_equal(at, bt))))

def forward(a: D.Snapshot, b: D.Snapshot) -> Bool:
  match a b:
    case D.Snapshot{ar, ab, ac, at} D.Snapshot{br, bb, bc, bt}:
      Bool.and(Nat.is_le(ab, bb), time_forward(at, bt))

def repeated(equal: Bool, state: D.State) -> D.Decision:
  match equal:
    case False{}: refuse(state, D.ConflictingSnapshot{})
    case True{}: D.Decision{state, D.FrameIgnored{}}

def accept_snapshot(snapshot: D.Snapshot, observed: Nat, batches: List<&2, Nat>) -> D.Decision:
  match snapshot:
    case D.Snapshot{revision, +batch, active, time}:
      D.Decision{D.Progress{D.Replica{}, D.Snapshot{revision, batch, active, time}, observed, Con{batch, batches}, False{}}, D.ProgressChanged{}}

def accept(ordered: Bool, old: D.Snapshot, next: D.Snapshot, observed: Nat,
           batches: List<&2, Nat>) -> D.Decision:
  match ordered:
    case True{}: accept_snapshot(next, observed, batches)
    case False{}: refuse(D.Progress{D.Replica{}, old, observed, batches, False{}}, D.RegressedSnapshot{})

def import_order(order: Cmp, +old: D.Snapshot, +next: D.Snapshot, observed: Nat,
                 batches: List<&2, Nat>) -> D.Decision:
  match order:
    case GT{}: accept(forward(old, next), old, next, observed, batches)
    case EQ{}: repeated(frame_equal(old, next), D.Progress{D.Replica{}, old, observed, batches, False{}})
    case LT{}: D.Decision{D.Progress{D.Replica{}, old, observed, batches, False{}}, D.FrameIgnored{}}

def import_valid(well_formed: Bool, +old: D.Snapshot, +next: D.Snapshot, observed: Nat,
                 batches: List<&2, Nat>) -> D.Decision:
  match well_formed:
    case True{}: import_order(Nat.cmp(D.revision(next), D.revision(old)), old, next, observed, batches)
    case False{}: refuse(D.Progress{D.Replica{}, old, observed, batches, False{}}, D.InvalidSnapshot{})

def batch_command(state: D.State, count: Nat, now: Nat) -> D.Decision:
  match state:
    case D.Progress{D.Recorder{}, D.Snapshot{r, b, a, t}, observed, batches, False{}}:
      add_batch(count, r, b, a, t, observed, batches, now)
    case D.Progress{D.Replica{}, snapshot, observed, batches, False{}}:
      refuse(D.Progress{D.Replica{}, snapshot, observed, batches, False{}}, D.WrongRole{})
    case D.Progress{role, snapshot, observed, batches, True{}}:
      refuse(D.Progress{role, snapshot, observed, batches, True{}}, D.OwnerRetired{})

def result_command(state: D.State, now: Nat) -> D.Decision:
  match state:
    case D.Progress{D.Recorder{}, D.Snapshot{r, b, a, t}, observed, batches, False{}}:
      remove_call(a, r, b, t, observed, batches, now)
    case D.Progress{D.Replica{}, snapshot, observed, batches, False{}}:
      refuse(D.Progress{D.Replica{}, snapshot, observed, batches, False{}}, D.WrongRole{})
    case D.Progress{role, snapshot, observed, batches, True{}}:
      refuse(D.Progress{role, snapshot, observed, batches, True{}}, D.OwnerRetired{})

def check_command(state: D.State, +revision: Nat) -> D.Decision:
  match state:
    case D.Progress{role, snapshot, +observed, +batches, False{}}:
      check(Bool.and(Nat.is_gt(revision, 0n), D.member(revision, batches)), Nat.is_le(revision, observed),
        D.Progress{role, snapshot, observed, batches, False{}})
    case D.Progress{role, snapshot, observed, batches, True{}}:
      refuse(D.Progress{role, snapshot, observed, batches, True{}}, D.OwnerRetired{})

def acknowledge_command(state: D.State, +revision: Nat) -> D.Decision:
  match state:
    case D.Progress{role, snapshot, +observed, +batches, False{}}:
      acknowledge(Bool.and(Nat.is_gt(revision, 0n), D.member(revision, batches)), Nat.is_gt(revision, observed), role, snapshot, observed, batches, revision)
    case D.Progress{role, snapshot, observed, batches, True{}}:
      refuse(D.Progress{role, snapshot, observed, batches, True{}}, D.OwnerRetired{})

def import_command(state: D.State, +next: D.Snapshot) -> D.Decision:
  match state:
    case D.Progress{D.Replica{}, old, observed, batches, False{}}:
      import_valid(valid(next), old, next, observed, batches)
    case D.Progress{D.Recorder{}, old, observed, batches, False{}}:
      refuse(D.Progress{D.Recorder{}, old, observed, batches, False{}}, D.WrongRole{})
    case D.Progress{role, old, observed, batches, True{}}:
      refuse(D.Progress{role, old, observed, batches, True{}}, D.OwnerRetired{})

# Closing only removes outstanding-observation obligations. It cannot mint a
# model-progress timestamp or claim that the web response has completed.
def retire_command(state: D.State) -> D.Decision:
  match state:
    case D.Progress{role, snapshot, observed, batches, True{}}:
      D.Decision{D.Progress{role, snapshot, observed, batches, True{}}, D.RetirementReplayed{}}
    case D.Progress{role, D.Snapshot{r, b, 0n, t}, observed, batches, False{}}:
      D.Decision{D.Progress{role, D.Snapshot{r, b, 0n, t}, observed, batches, True{}}, D.OwnerClosed{}}
    case D.Progress{role, D.Snapshot{r, b, 1n+n, t}, observed, batches, False{}}:
      D.Decision{D.Progress{role, D.Snapshot{1n+r, b, 0n, t}, observed, batches, True{}}, D.OwnerClosed{}}

def step(state: D.State, event: D.Event) -> D.Decision:
  match event:
    case D.RecordBatch{count, now}: batch_command(state, count, now)
    case D.RecordResult{now}: result_command(state, now)
    case D.CheckBatch{revision}: check_command(state, revision)
    case D.Acknowledge{revision}: acknowledge_command(state, revision)
    case D.Import{next}: import_command(state, next)
    case D.Retire{}: retire_command(state)

def run(events: List<&2, D.Event>, state: D.State) -> List<&2, D.Decision>:
  Trace.run(~D.State, ~D.Event, ~D.Decision, ~step, ~D.state, events, state)
