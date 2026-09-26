import Base
import ./broker-domain.bend as D
import ./broker-table.bend as M
import ./broker-table-proof.bend as TableProof
import ./broker.bend as K
import ./broker-specification.bend as S
import ./broker-laws.bend as L
import ./theory/transition-system.bend as Trace

def environment_refinement(equal: Bool, state: D.State) ->
  {K.environment(equal, state) == S.environment(equal, state) : D.Decision}:
  match equal:
    case True{}: {==}
    case False{}: {==}

def claim_refinement(receipt: Maybe<&2, Bool>, id: String, env: String, revision: Nat,
  activities: List<&2, D.Activity>, calls: List<&2, D.Invocation>) ->
  {K.claim(receipt, id, env, revision, activities, calls) == S.claim(receipt, id, env, revision, activities, calls) : D.Decision}:
  match receipt:
    case None{}: {==}
    case Some{False{}}: {==}
    case Some{True{}}: {==}

def release_refinement(receipt: Maybe<&2, Bool>, id: String, env: String, revision: Nat,
  activities: List<&2, D.Activity>, calls: List<&2, D.Invocation>) ->
  {K.complete_activity(receipt, id, env, revision, activities, calls) == S.release(receipt, id, env, revision, activities, calls) : D.Decision}:
  match receipt:
    case None{}: {==}
    case Some{False{}}: {==}
    case Some{True{}}: {==}

def enqueue_refinement(previous: Maybe<&2, D.Invocation>, id: String, payload: String,
  env: String, revision: Nat, activities: List<&2, D.Activity>, calls: List<&2, D.Invocation>) ->
  {K.enqueue(previous, id, payload, env, revision, activities, calls) == S.enqueue(previous, id, payload, env, revision, activities, calls) : D.Decision}:
  match previous:
    case None{}: {==}
    case Some{entry}: {==}

def poll_refinement(delivered: List<&2, String>, queued: List<&2, String>, env: String,
  revision: Nat, activities: List<&2, D.Activity>, calls: List<&2, D.Invocation>) ->
  {K.poll(delivered, queued, env, revision, activities, calls) == S.poll(delivered, queued, env, revision, activities, calls) : D.Decision}:
  match delivered queued:
    case Nil{} Nil{}: {==}
    case Nil{} Con{h, t}: {==}
    case Con{h, t} _: {==}

def replay_refinement(equal: Bool, state: D.State) ->
  {K.replay_result(equal, state) == S.replay(equal, state) : D.Decision}:
  match equal:
    case True{}: {==}
    case False{}: {==}

def result_refinement(previous: Maybe<&2, D.Invocation>, +digest: String, env: String,
  revision: Nat, activities: List<&2, D.Activity>, calls: List<&2, D.Invocation>) ->
  {K.finish_found(previous, digest, env, revision, activities, calls) == S.result(previous, digest, env, revision, activities, calls) : D.Decision}:
  match previous:
    case None{}: {==}
    case Some{D.Invocation{id, payload, D.Queued{}}}: {==}
    case Some{D.Invocation{id, payload, D.Delivered{}}}: {==}
    case Some{D.Invocation{id, payload, D.Result{old}}}:
      replay_refinement(String.eq(old, digest), D.Broker{D.Open{}, env, revision, activities, calls})

def offer_refinement(busy: Bool, state: D.State, revision: Nat) ->
  {K.offer(busy, state, revision) == S.offer(busy, state, revision) : D.Decision}:
  match busy:
    case True{}: {==}
    case False{}: {==}

def seal_refinement(same: Bool, activity: Bool, call: Bool, state: D.State, revision: Nat) ->
  {K.commit(Bool.and(same, Bool.not(Bool.or(activity, call))), state, revision) ==
   S.seal(same, activity, call, state, revision) : D.Decision}:
  match same activity call:
    case False{} False{} False{}: {==}
    case False{} False{} True{}: {==}
    case False{} True{} False{}: {==}
    case False{} True{} True{}: {==}
    case True{} False{} False{}: {==}
    case True{} False{} True{}: {==}
    case True{} True{} False{}: {==}
    case True{} True{} True{}: {==}

def late_activity_refinement(receipt: Maybe<&2, Bool>, state: D.State) ->
  {K.late_activity(receipt, state) == S.late_activity(receipt, state) : D.Decision}:
  match receipt:
    case None{}: {==}
    case Some{False{}}: {==}
    case Some{True{}}: {==}

def sealed_result_refinement(receipt: Maybe<&2, D.Invocation>, digest: String, state: D.State) ->
  {K.sealed_result(receipt, digest, state) == S.sealed_result(receipt, digest, state) : D.Decision}:
  match receipt:
    case None{}: {==}
    case Some{D.Invocation{id, payload, D.Queued{}}}: {==}
    case Some{D.Invocation{id, payload, D.Delivered{}}}: {==}
    case Some{D.Invocation{id, payload, D.Result{old}}}: replay_refinement(String.eq(old, digest), state)

def open_refinement(+env: String, +revision: Nat, +activities: List<&2, D.Activity>,
  +calls: List<&2, D.Invocation>, event: D.Event) ->
  {K.step(D.Broker{D.Open{}, env, revision, activities, calls}, event) ==
   S.step(D.Broker{D.Open{}, env, revision, activities, calls}, event) : D.Decision}:
  match event:
    case D.ClaimActivity{+id}: claim_refinement(M.activity_get(id, activities), id, env, revision, activities, calls)
    case D.CompleteActivity{+id}: release_refinement(M.activity_get(id, activities), id, env, revision, activities, calls)
    case D.Enqueue{+id, payload}: enqueue_refinement(M.invocation_get(id, calls), id, payload, env, revision, activities, calls)
    case D.Poll{}: poll_refinement(M.delivered(calls), M.queued(calls), env, revision, activities, calls)
    case D.CompleteCall{id, digest}: result_refinement(M.invocation_get(id, calls), digest, env, revision, activities, calls)
    case D.BeginFence{}: offer_refinement(Bool.or(M.has_activity(activities), M.has_invocation(calls)),
      D.Broker{D.Open{}, env, revision, activities, calls}, revision)
    case D.CommitFence{+expected}: seal_refinement(Nat.is_eq(revision, expected), M.has_activity(activities), M.has_invocation(calls),
      D.Broker{D.Open{}, env, revision, activities, calls}, expected)
    case D.CheckEnvironment{expected}: environment_refinement(String.eq(env, expected), D.Broker{D.Open{}, env, revision, activities, calls})
    case D.Retire{}: {==}

def sealed_refinement(+sealed: Nat, +env: String, revision: Nat, +activities: List<&2, D.Activity>,
  +calls: List<&2, D.Invocation>, event: D.Event) ->
  {K.step(D.Broker{D.Sealed{sealed}, env, revision, activities, calls}, event) ==
   S.step(D.Broker{D.Sealed{sealed}, env, revision, activities, calls}, event) : D.Decision}:
  match event:
    case D.ClaimActivity{id}: {==}
    case D.CompleteActivity{id}: late_activity_refinement(M.activity_get(id, activities), D.Broker{D.Sealed{sealed}, env, revision, activities, calls})
    case D.Enqueue{id, payload}: {==}
    case D.Poll{}: {==}
    case D.CompleteCall{id, digest}: sealed_result_refinement(M.invocation_get(id, calls), digest, D.Broker{D.Sealed{sealed}, env, revision, activities, calls})
    case D.BeginFence{}: offer_refinement(Bool.or(M.has_activity(activities), M.has_invocation(calls)),
      D.Broker{D.Sealed{sealed}, env, revision, activities, calls}, sealed)
    case D.CommitFence{+expected}: seal_refinement(Nat.is_eq(sealed, expected), M.has_activity(activities), M.has_invocation(calls),
      D.Broker{D.Sealed{sealed}, env, revision, activities, calls}, expected)
    case D.CheckEnvironment{expected}: environment_refinement(String.eq(env, expected), D.Broker{D.Sealed{sealed}, env, revision, activities, calls})
    case D.Retire{}: {==}

def retired_refinement(env: String, revision: Nat, activities: List<&2, D.Activity>,
  calls: List<&2, D.Invocation>, event: D.Event) ->
  {K.step(D.Broker{D.Retired{}, env, revision, activities, calls}, event) ==
   S.step(D.Broker{D.Retired{}, env, revision, activities, calls}, event) : D.Decision}:
  match event:
    case D.ClaimActivity{id}: {==}
    case D.CompleteActivity{id}: {==}
    case D.Enqueue{id, payload}: {==}
    case D.Poll{}: {==}
    case D.CompleteCall{id, digest}: {==}
    case D.BeginFence{}: {==}
    case D.CommitFence{expected}: {==}
    case D.CheckEnvironment{expected}: {==}
    case D.Retire{}: {==}

def L.transition_refinement(state, event):
  match state:
    case D.Broker{D.Open{}, env, revision, activities, calls}: open_refinement(env, revision, activities, calls, event)
    case D.Broker{D.Sealed{sealed}, env, revision, activities, calls}: sealed_refinement(sealed, env, revision, activities, calls, event)
    case D.Broker{D.Retired{}, env, revision, activities, calls}: retired_refinement(env, revision, activities, calls, event)

def L.trace_refinement(events, state):
  Trace.refinement(~D.State, ~D.Event, ~D.Decision, ~K.step, ~S.step, ~D.state, ~L.transition_refinement, events, state)

def seal_safe(same: Bool, activity: Bool, call: Bool, state: D.State, revision: Nat) ->
  {S.fence_is_safe(D.effect(K.commit(Bool.and(same, Bool.not(Bool.or(activity, call))), state, revision)),
     Bool.or(activity, call)) == True{} : Bool}:
  match same activity call:
    case False{} False{} False{}: {==}
    case False{} False{} True{}: {==}
    case False{} True{} False{}: {==}
    case False{} True{} True{}: {==}
    case True{} False{} False{}: {==}
    case True{} False{} True{}: {==}
    case True{} True{} False{}: {==}
    case True{} True{} True{}: {==}

def completion_guard(state: D.State, +expected: Nat) ->
  {S.fence_is_safe(D.effect(K.step(state, D.CommitFence{expected})), M.busy(state)) == True{} : Bool}:
  match state:
    case D.Broker{D.Open{}, env, +current, +activities, +calls}:
      seal_safe(Nat.is_eq(current, expected), M.has_activity(activities), M.has_invocation(calls),
        D.Broker{D.Open{}, env, current, activities, calls}, expected)
    case D.Broker{D.Sealed{+sealed}, env, current, +activities, +calls}:
      seal_safe(Nat.is_eq(sealed, expected), M.has_activity(activities), M.has_invocation(calls),
        D.Broker{D.Sealed{sealed}, env, current, activities, calls}, expected)
    case D.Broker{D.Retired{}, env, current, activities, calls}: {==}

def L.completion_never_crosses_an_outstanding_obligation(state, revision):
  completion_guard(state, revision)

def L.sealed_rejects_enqueue(sealed_revision, env, revision, activities, calls, id, payload):
  {==}

def L.retired_cannot_reopen(env, revision, activities, calls, event):
  match event:
    case D.ClaimActivity{id}: {==}
    case D.CompleteActivity{id}: {==}
    case D.Enqueue{id, payload}: {==}
    case D.Poll{}: {==}
    case D.CompleteCall{id, digest}: {==}
    case D.BeginFence{}: {==}
    case D.CommitFence{expected}: {==}
    case D.CheckEnvironment{expected}: {==}
    case D.Retire{}: {==}

def L.poll_replay(id, rest, queued, env, revision, activities, calls):
  {==}

def L.early_result_rejected(id, payload, digest, env, revision, activities, calls):
  {==}

def L.completed_activity_cannot_restart(id, env, revision, activities, calls):
  {==}
