import Base
import ./broker-domain.bend as D
import ./broker-table.bend as M
import ./theory/transition-system.bend as Trace

def initialize(environment: String) -> D.State:
  D.Broker{D.Open{}, environment, 0n, Nil{}, Nil{}}

def reject(state: D.State, reason: D.Rejection) -> D.Decision:
  D.Decision{state, D.Reject{reason}}

def environment(matches: Bool, state: D.State) -> D.Decision:
  match matches:
    case True{}: D.Decision{state, D.EnvironmentAccepted{}}
    case False{}: reject(state, D.EnvironmentChanged{})

def claim(found: Maybe<&2, Bool>, id: String, env: String, revision: Nat,
          activities: List<&2, D.Activity>, invocations: List<&2, D.Invocation>) -> D.Decision:
  match found:
    case None{}:
      D.Decision{D.Broker{D.Open{}, env, 1n+revision, M.activity_put(id, False{}, activities), invocations}, D.ActivityClaimed{}}
    case Some{False{}}:
      D.Decision{D.Broker{D.Open{}, env, revision, activities, invocations}, D.ActivityReplayed{}}
    case Some{True{}}:
      reject(D.Broker{D.Open{}, env, revision, activities, invocations}, D.ActivityAlreadyCompleted{})

def close_activity(was_active: Bool, id: String, env: String, revision: Nat,
                   activities: List<&2, D.Activity>, invocations: List<&2, D.Invocation>) -> D.Decision:
  D.Decision{D.Broker{D.Open{}, env, 1n+revision, M.activity_put(id, True{}, activities), invocations},
    D.ActivityClosed{was_active}}

def complete_activity(found: Maybe<&2, Bool>, id: String, env: String, revision: Nat,
                      activities: List<&2, D.Activity>, invocations: List<&2, D.Invocation>) -> D.Decision:
  match found:
    case None{}: close_activity(False{}, id, env, revision, activities, invocations)
    case Some{False{}}: close_activity(True{}, id, env, revision, activities, invocations)
    case Some{True{}}: D.Decision{D.Broker{D.Open{}, env, revision, activities, invocations}, D.ActivityReceiptReplayed{}}

def enqueue(found: Maybe<&2, D.Invocation>, id: String, payload: String, env: String, revision: Nat,
            activities: List<&2, D.Activity>, invocations: List<&2, D.Invocation>) -> D.Decision:
  match found:
    case None{}:
      D.Decision{D.Broker{D.Open{}, env, 1n+revision, activities,
        M.invocation_put(D.Invocation{id, payload, D.Queued{}}, invocations)}, D.InvocationQueued{}}
    case Some{previous}:
      reject(D.Broker{D.Open{}, env, revision, activities, invocations}, D.DuplicateInvocation{})

def deliver(queued: List<&2, String>, env: String, revision: Nat,
            activities: List<&2, D.Activity>, invocations: List<&2, D.Invocation>) -> D.Decision:
  match queued:
    case Nil{}: D.Decision{D.Broker{D.Open{}, env, revision, activities, invocations}, D.WaitForCalls{}}
    case Con{h, t}:
      D.Decision{D.Broker{D.Open{}, env, revision, activities, M.deliver_all(invocations)}, D.CallsDelivered{Con{h, t}}}

def poll(delivered: List<&2, String>, queued: List<&2, String>, env: String, revision: Nat,
         activities: List<&2, D.Activity>, invocations: List<&2, D.Invocation>) -> D.Decision:
  match delivered:
    case Nil{}: deliver(queued, env, revision, activities, invocations)
    case Con{h, t}: D.Decision{D.Broker{D.Open{}, env, revision, activities, invocations}, D.CallsReplayed{Con{h, t}}}

def replay_result(matches: Bool, state: D.State) -> D.Decision:
  match matches:
    case True{}: D.Decision{state, D.ResultReplayed{}}
    case False{}: reject(state, D.ConflictingResult{})

def finish_found(found: Maybe<&2, D.Invocation>, +digest: String, env: String, revision: Nat,
                 activities: List<&2, D.Activity>, invocations: List<&2, D.Invocation>) -> D.Decision:
  match found:
    case None{}: reject(D.Broker{D.Open{}, env, revision, activities, invocations}, D.CallNotPending{})
    case Some{D.Invocation{id, payload, D.Queued{}}}:
      reject(D.Broker{D.Open{}, env, revision, activities, invocations}, D.CallNotDelivered{})
    case Some{D.Invocation{id, payload, D.Delivered{}}}:
      D.Decision{D.Broker{D.Open{}, env, 1n+revision, activities,
        M.invocation_put(D.Invocation{id, payload, D.Result{digest}}, invocations)}, D.ResultAccepted{}}
    case Some{D.Invocation{id, payload, D.Result{previous}}}:
      replay_result(String.eq(previous, digest), D.Broker{D.Open{}, env, revision, activities, invocations})

def offer(busy: Bool, state: D.State, revision: Nat) -> D.Decision:
  match busy:
    case True{}: D.Decision{state, D.FenceUnavailable{}}
    case False{}: D.Decision{state, D.FenceOffered{revision}}

def commit(allowed: Bool, state: D.State, revision: Nat) -> D.Decision:
  match allowed:
    case False{}: D.Decision{state, D.FenceStale{}}
    case True{}: D.Decision{D.replace_lifetime(state, D.Sealed{revision}), D.FenceCommitted{}}

def open_step(+env: String, +revision: Nat, +activities: List<&2, D.Activity>, +invocations: List<&2, D.Invocation>, event: D.Event) -> D.Decision:
  match event:
    case D.ClaimActivity{+id}: claim(M.activity_get(id, activities), id, env, revision, activities, invocations)
    case D.CompleteActivity{+id}: complete_activity(M.activity_get(id, activities), id, env, revision, activities, invocations)
    case D.Enqueue{+id, payload}: enqueue(M.invocation_get(id, invocations), id, payload, env, revision, activities, invocations)
    case D.Poll{}: poll(M.delivered(invocations), M.queued(invocations), env, revision, activities, invocations)
    case D.CompleteCall{id, digest}: finish_found(M.invocation_get(id, invocations), digest, env, revision, activities, invocations)
    case D.BeginFence{}:
      offer(Bool.or(M.has_activity(activities), M.has_invocation(invocations)),
        D.Broker{D.Open{}, env, revision, activities, invocations}, revision)
    case D.CommitFence{+expected}:
      commit(Bool.and(Nat.is_eq(revision, expected), Bool.not(Bool.or(M.has_activity(activities), M.has_invocation(invocations)))),
        D.Broker{D.Open{}, env, revision, activities, invocations}, expected)
    case D.CheckEnvironment{expected}:
      environment(String.eq(env, expected), D.Broker{D.Open{}, env, revision, activities, invocations})
    case D.Retire{}:
      D.Decision{D.Broker{D.Retired{}, env, revision, activities, invocations}, D.OwnerRetired{}}

def late_activity(found: Maybe<&2, Bool>, state: D.State) -> D.Decision:
  match found:
    case Some{True{}}: D.Decision{state, D.ActivityReceiptReplayed{}}
    case _: D.Decision{state, D.LateActivityReceipt{}}

def sealed_result(found: Maybe<&2, D.Invocation>, digest: String, state: D.State) -> D.Decision:
  match found:
    case Some{D.Invocation{id, payload, D.Result{previous}}}: replay_result(String.eq(previous, digest), state)
    case _: reject(state, D.OwnerClosed{})

def sealed_step(+sealed_revision: Nat, +env: String, +revision: Nat,
                +activities: List<&2, D.Activity>, +invocations: List<&2, D.Invocation>, event: D.Event) -> D.Decision:
  match event:
    case D.ClaimActivity{id}: reject(D.Broker{D.Sealed{sealed_revision}, env, revision, activities, invocations}, D.OwnerClosed{})
    case D.Enqueue{id, payload}: reject(D.Broker{D.Sealed{sealed_revision}, env, revision, activities, invocations}, D.OwnerClosed{})
    case D.Poll{}: reject(D.Broker{D.Sealed{sealed_revision}, env, revision, activities, invocations}, D.OwnerClosed{})
    case D.CompleteActivity{id}:
      late_activity(M.activity_get(id, activities), D.Broker{D.Sealed{sealed_revision}, env, revision, activities, invocations})
    case D.CompleteCall{id, digest}:
      sealed_result(M.invocation_get(id, invocations), digest, D.Broker{D.Sealed{sealed_revision}, env, revision, activities, invocations})
    case D.BeginFence{}:
      offer(Bool.or(M.has_activity(activities), M.has_invocation(invocations)),
        D.Broker{D.Sealed{sealed_revision}, env, revision, activities, invocations}, sealed_revision)
    case D.CommitFence{+expected}:
      commit(Bool.and(Nat.is_eq(sealed_revision, expected), Bool.not(Bool.or(M.has_activity(activities), M.has_invocation(invocations)))),
        D.Broker{D.Sealed{sealed_revision}, env, revision, activities, invocations}, expected)
    case D.CheckEnvironment{expected}:
      environment(String.eq(env, expected), D.Broker{D.Sealed{sealed_revision}, env, revision, activities, invocations})
    case D.Retire{}:
      D.Decision{D.Broker{D.Retired{}, env, revision, activities, invocations}, D.OwnerRetired{}}

def retired_step(state: D.State, event: D.Event) -> D.Decision:
  match event:
    case D.Retire{}: D.Decision{state, D.RetirementReplayed{}}
    case D.CompleteActivity{id}: D.Decision{state, D.LateActivityReceipt{}}
    case _: reject(state, D.OwnerClosed{})

def step(state: D.State, event: D.Event) -> D.Decision:
  match state:
    case D.Broker{D.Open{}, env, revision, activities, invocations}: open_step(env, revision, activities, invocations, event)
    case D.Broker{D.Sealed{sealed_revision}, env, revision, activities, invocations}:
      sealed_step(sealed_revision, env, revision, activities, invocations, event)
    case D.Broker{D.Retired{}, env, revision, activities, invocations}:
      retired_step(D.Broker{D.Retired{}, env, revision, activities, invocations}, event)

def run(events: List<&2, D.Event>, state: D.State) -> List<&2, D.Decision>:
  Trace.run(~D.State, ~D.Event, ~D.Decision, ~step, ~D.state, events, state)
