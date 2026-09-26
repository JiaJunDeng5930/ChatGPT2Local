import Base
import ./progress-domain.bend as D
import ./progress.bend as K
import ./progress-specification.bend as S
import ./progress-laws.bend as L
import ./theory/transition-system.bend as Trace
import ./theory/nat-maximum.bend as Maximum

def clock_refinement(previous: Maybe<&2, Nat>, now: Nat) ->
  {K.touch(previous, now) == S.clock(previous, now) : Maybe<&2, Nat>}:
  match previous:
    case None{}: {==}
    case Some{old}: Equal.cong(Nat, Maybe<&2, Nat>, n => Some{n}, Maximum.maximum(old, now), Nat.max(old, now), Maximum.refinement(old, now))

def batch_refinement(count: Nat, revision: Nat, batch: Nat, active: Nat, time: Maybe<&2, Nat>,
  observed: Nat, batches: List<&2, Nat>, now: Nat) ->
  {K.batch(count, revision, batch, active, time, observed, batches, now) ==
   S.add_batch(count, revision, batch, active, time, observed, batches, now) : D.Decision}:
  match count:
    case 0n: {==}
    case 1n+n:
      %clock_refinement(time, now) :
        {D.Decision{D.Progress{D.Recorder{}, D.Snapshot{1n+revision, 1n+revision, Nat.add(active, 1n+n), K.touch(time, now)},
          observed, Con{1n+revision, batches}, False{}}, D.ProgressChanged{}} ==
         D.Decision{D.Progress{D.Recorder{}, D.Snapshot{1n+revision, 1n+revision, Nat.add(active, 1n+n), _},
          observed, Con{1n+revision, batches}, False{}}, D.ProgressChanged{}} : D.Decision}
      {==}

def result_refinement(active: Nat, revision: Nat, batch: Nat, time: Maybe<&2, Nat>,
  observed: Nat, batches: List<&2, Nat>, now: Nat) ->
  {K.result(active, revision, batch, time, observed, batches, now) ==
   S.remove_call(active, revision, batch, time, observed, batches, now) : D.Decision}:
  match active:
    case 0n: {==}
    case 1n+n:
      %clock_refinement(time, now) :
        {D.Decision{D.Progress{D.Recorder{}, D.Snapshot{1n+revision, batch, n, K.touch(time, now)}, observed, batches, False{}}, D.ProgressChanged{}} ==
         D.Decision{D.Progress{D.Recorder{}, D.Snapshot{1n+revision, batch, n, _}, observed, batches, False{}}, D.ProgressChanged{}} : D.Decision}
      {==}

def check_refinement(known: Bool, observed: Bool, state: D.State) ->
  {K.check(known, observed, state) == S.check(known, observed, state) : D.Decision}:
  match known observed:
    case True{} True{}: {==}
    case True{} False{}: {==}
    case False{} True{}: {==}
    case False{} False{}: {==}

def acknowledge_refinement(known: Bool, newer: Bool, role: D.Role, snapshot: D.Snapshot,
  observed: Nat, batches: List<&2, Nat>, revision: Nat) ->
  {K.acknowledge(known, newer, role, snapshot, observed, batches, revision) ==
   S.acknowledge(known, newer, role, snapshot, observed, batches, revision) : D.Decision}:
  match known newer:
    case True{} True{}: {==}
    case True{} False{}: {==}
    case False{} True{}: {==}
    case False{} False{}: {==}

def stamp_refinement(revision: Nat, time: Maybe<&2, Nat>) ->
  {K.timestamp_valid(revision, time) == S.stamp_valid(time, revision) : Bool}:
  match revision time:
    case 0n None{}: {==}
    case 0n Some{t}: {==}
    case 1n+n None{}: {==}
    case 1n+n Some{t}: {==}

def valid_refinement(snapshot: D.Snapshot) -> {K.valid(snapshot) == S.valid(snapshot) : Bool}:
  match snapshot:
    case D.Snapshot{revision, batch, active, time}:
      %stamp_refinement(revision, time) :
        {Bool.and(Nat.is_le(batch, revision), Bool.and(Bool.or(Nat.is_eq(active, 0n), Nat.is_gt(batch, 0n)), K.timestamp_valid(revision, time))) ==
         Bool.and(Nat.is_le(batch, revision), Bool.and(Bool.or(Nat.is_eq(active, 0n), Nat.is_gt(batch, 0n)), _)) : Bool}
      {==}

def time_forward_refinement(old: Maybe<&2, Nat>, next: Maybe<&2, Nat>) ->
  {K.time_forward(old, next) == S.time_forward(old, next) : Bool}:
  match old next:
    case None{} None{}: {==}
    case None{} Some{t}: {==}
    case Some{t} None{}: {==}
    case Some{a} Some{b}: {==}

def time_equal_refinement(old: Maybe<&2, Nat>, next: Maybe<&2, Nat>) ->
  {K.time_same(old, next) == S.time_equal(old, next) : Bool}:
  match old next:
    case None{} None{}: {==}
    case None{} Some{t}: {==}
    case Some{t} None{}: {==}
    case Some{a} Some{b}: {==}

def frame_equal_refinement(a: D.Snapshot, b: D.Snapshot) -> {K.frame_equal(a, b) == S.frame_equal(a, b) : Bool}:
  match a b:
    case D.Snapshot{ar, ab, ac, at} D.Snapshot{br, bb, bc, bt}:
      %time_equal_refinement(at, bt) :
        {Bool.and(Nat.is_eq(ar, br), Bool.and(Nat.is_eq(ab, bb), Bool.and(Nat.is_eq(ac, bc), K.time_same(at, bt)))) ==
         Bool.and(Nat.is_eq(ar, br), Bool.and(Nat.is_eq(ab, bb), Bool.and(Nat.is_eq(ac, bc), _))) : Bool}
      {==}

def forward_refinement(a: D.Snapshot, b: D.Snapshot) -> {K.forward(a, b) == S.forward(a, b) : Bool}:
  match a b:
    case D.Snapshot{ar, ab, ac, at} D.Snapshot{br, bb, bc, bt}:
      %time_forward_refinement(at, bt) :
        {Bool.and(Nat.is_le(ab, bb), K.time_forward(at, bt)) == Bool.and(Nat.is_le(ab, bb), _) : Bool}
      {==}

def repeated_refinement(equal: Bool, state: D.State) ->
  {K.same_frame(equal, state) == S.repeated(equal, state) : D.Decision}:
  match equal:
    case True{}: {==}
    case False{}: {==}

def accept_snapshot_refinement(snapshot: D.Snapshot, observed: Nat, batches: List<&2, Nat>) ->
  {K.accept_snapshot(snapshot, observed, batches) == S.accept_snapshot(snapshot, observed, batches) : D.Decision}:
  match snapshot:
    case D.Snapshot{r, b, a, t}: {==}

def accept_refinement(ordered: Bool, old: D.Snapshot, next: D.Snapshot, observed: Nat, batches: List<&2, Nat>) ->
  {K.accept_frame(ordered, old, next, observed, batches) == S.accept(ordered, old, next, observed, batches) : D.Decision}:
  match ordered:
    case False{}: {==}
    case True{}: accept_snapshot_refinement(next, observed, batches)

def order_refinement(order: Cmp, +old: D.Snapshot, +next: D.Snapshot, observed: Nat, batches: List<&2, Nat>) ->
  {K.import_order(order, old, next, observed, batches) == S.import_order(order, old, next, observed, batches) : D.Decision}:
  match order:
    case LT{}: {==}
    case EQ{}:
      %frame_equal_refinement(old, next) :
        {K.same_frame(K.frame_equal(old, next), D.Progress{D.Replica{}, old, observed, batches, False{}}) ==
         S.repeated(_, D.Progress{D.Replica{}, old, observed, batches, False{}}) : D.Decision}
      repeated_refinement(K.frame_equal(old, next), D.Progress{D.Replica{}, old, observed, batches, False{}})
    case GT{}:
      %forward_refinement(old, next) :
        {K.accept_frame(K.forward(old, next), old, next, observed, batches) == S.accept(_, old, next, observed, batches) : D.Decision}
      accept_refinement(K.forward(old, next), old, next, observed, batches)

def import_refinement(valid: Bool, +old: D.Snapshot, +next: D.Snapshot, observed: Nat, batches: List<&2, Nat>) ->
  {K.import_valid(valid, old, next, observed, batches) == S.import_valid(valid, old, next, observed, batches) : D.Decision}:
  match valid:
    case False{}: {==}
    case True{}: order_refinement(Nat.cmp(D.revision(next), D.revision(old)), old, next, observed, batches)

def retire_refinement(role: D.Role, revision: Nat, batch: Nat, active: Nat, time: Maybe<&2, Nat>,
  observed: Nat, batches: List<&2, Nat>) ->
  {K.retire(role, revision, batch, active, time, observed, batches) ==
   S.retire_command(D.Progress{role, D.Snapshot{revision, batch, active, time}, observed, batches, False{}}) : D.Decision}:
  match active:
    case 0n: {==}
    case 1n+n: {==}

def recorder_refinement(snapshot: D.Snapshot, +observed: Nat, +batches: List<&2, Nat>, event: D.Event) ->
  {K.step(D.Progress{D.Recorder{}, snapshot, observed, batches, False{}}, event) ==
   S.step(D.Progress{D.Recorder{}, snapshot, observed, batches, False{}}, event) : D.Decision}:
  match snapshot:
    case D.Snapshot{revision, batch, active, time}:
      match event:
        case D.RecordBatch{count, now}: batch_refinement(count, revision, batch, active, time, observed, batches, now)
        case D.RecordResult{now}: result_refinement(active, revision, batch, time, observed, batches, now)
        case D.CheckBatch{+r}: check_refinement(Bool.and(Nat.is_gt(r, 0n), D.member(r, batches)), Nat.is_le(r, observed),
          D.Progress{D.Recorder{}, D.Snapshot{revision, batch, active, time}, observed, batches, False{}})
        case D.Acknowledge{+r}: acknowledge_refinement(Bool.and(Nat.is_gt(r, 0n), D.member(r, batches)), Nat.is_gt(r, observed),
          D.Recorder{}, D.Snapshot{revision, batch, active, time}, observed, batches, r)
        case D.Import{next}: {==}
        case D.Retire{}: retire_refinement(D.Recorder{}, revision, batch, active, time, observed, batches)

def replica_retire(snapshot: D.Snapshot, observed: Nat, batches: List<&2, Nat>) ->
  {K.retire_snapshot(snapshot, observed, batches) == S.retire_command(D.Progress{D.Replica{}, snapshot, observed, batches, False{}}) : D.Decision}:
  match snapshot:
    case D.Snapshot{r, b, a, t}: retire_refinement(D.Replica{}, r, b, a, t, observed, batches)

def replica_refinement(+snapshot: D.Snapshot, +observed: Nat, +batches: List<&2, Nat>, event: D.Event) ->
  {K.step(D.Progress{D.Replica{}, snapshot, observed, batches, False{}}, event) ==
   S.step(D.Progress{D.Replica{}, snapshot, observed, batches, False{}}, event) : D.Decision}:
  match event:
    case D.RecordBatch{count, now}: {==}
    case D.RecordResult{now}: {==}
    case D.CheckBatch{+r}: check_refinement(Bool.and(Nat.is_gt(r, 0n), D.member(r, batches)), Nat.is_le(r, observed),
      D.Progress{D.Replica{}, snapshot, observed, batches, False{}})
    case D.Acknowledge{+r}: acknowledge_refinement(Bool.and(Nat.is_gt(r, 0n), D.member(r, batches)), Nat.is_gt(r, observed),
      D.Replica{}, snapshot, observed, batches, r)
    case D.Import{+next}:
      %valid_refinement(next) :
        {K.import_valid(K.valid(next), snapshot, next, observed, batches) == S.import_valid(_, snapshot, next, observed, batches) : D.Decision}
      import_refinement(K.valid(next), snapshot, next, observed, batches)
    case D.Retire{}: replica_retire(snapshot, observed, batches)

def closed_refinement(role: D.Role, snapshot: D.Snapshot, observed: Nat, batches: List<&2, Nat>, event: D.Event) ->
  {K.step(D.Progress{role, snapshot, observed, batches, True{}}, event) ==
   S.step(D.Progress{role, snapshot, observed, batches, True{}}, event) : D.Decision}:
  match role snapshot event:
    case D.Recorder{} D.Snapshot{r, b, a, t} D.RecordBatch{count, now}: {==}
    case D.Recorder{} D.Snapshot{r, b, a, t} D.RecordResult{now}: {==}
    case D.Recorder{} D.Snapshot{r, b, a, t} D.CheckBatch{revision}: {==}
    case D.Recorder{} D.Snapshot{r, b, a, t} D.Acknowledge{revision}: {==}
    case D.Recorder{} D.Snapshot{r, b, a, t} D.Import{next}: {==}
    case D.Recorder{} D.Snapshot{r, b, 0n, t} D.Retire{}: {==}
    case D.Recorder{} D.Snapshot{r, b, 1n+n, t} D.Retire{}: {==}
    case D.Replica{} D.Snapshot{r, b, a, t} D.RecordBatch{count, now}: {==}
    case D.Replica{} D.Snapshot{r, b, a, t} D.RecordResult{now}: {==}
    case D.Replica{} D.Snapshot{r, b, a, t} D.CheckBatch{revision}: {==}
    case D.Replica{} D.Snapshot{r, b, a, t} D.Acknowledge{revision}: {==}
    case D.Replica{} D.Snapshot{r, b, a, t} D.Import{next}: {==}
    case D.Replica{} D.Snapshot{r, b, 0n, t} D.Retire{}: {==}
    case D.Replica{} D.Snapshot{r, b, 1n+n, t} D.Retire{}: {==}

def L.transition_refinement(state, event):
  match state:
    case D.Progress{D.Recorder{}, snapshot, observed, batches, False{}}: recorder_refinement(snapshot, observed, batches, event)
    case D.Progress{D.Replica{}, snapshot, observed, batches, False{}}: replica_refinement(snapshot, observed, batches, event)
    case D.Progress{role, snapshot, observed, batches, True{}}: closed_refinement(role, snapshot, observed, batches, event)

def L.trace_refinement(events, state):
  Trace.refinement(~D.State, ~D.Event, ~D.Decision, ~K.step, ~S.step, ~D.state, ~L.transition_refinement, events, state)

def L.initial_snapshot(role):
  {==}

def retire_time(role: D.Role, revision: Nat, batch: Nat, active: Nat, time: Maybe<&2, Nat>, observed: Nat, batches: List<&2, Nat>) ->
  {D.time(D.snapshot(D.state(K.retire(role, revision, batch, active, time, observed, batches)))) == time : Maybe<&2, Nat>}:
  match active:
    case 0n: {==}
    case 1n+n: {==}

def L.retirement_is_not_model_progress(state):
  match state:
    case D.Progress{D.Recorder{}, D.Snapshot{r, b, a, t}, observed, batches, False{}}: retire_time(D.Recorder{}, r, b, a, t, observed, batches)
    case D.Progress{D.Replica{}, D.Snapshot{r, b, a, t}, observed, batches, False{}}: retire_time(D.Replica{}, r, b, a, t, observed, batches)
    case D.Progress{role, snapshot, observed, batches, True{}}: {==}

def L.recording_never_rewinds_a_clock(previous, now):
  +old = previous
  +next = now
  %Equal.sym(Maybe<&2, Nat>, K.touch(Some{old}, next), S.clock(Some{old}, next), clock_refinement(Some{old}, next)) :
    {L.is_after(_, old) == True{} : Bool}
  Nat.max_ge_l(old, next)

def L.an_unknown_batch_cannot_be_acknowledged(newer, role, snapshot, observed, batches, revision):
  match newer:
    case True{}: {==}
    case False{}: {==}
