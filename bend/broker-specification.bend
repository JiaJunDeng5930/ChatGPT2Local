import Base
import ./broker-domain.bend as D
import ./broker-table.bend as M
import ./theory/transition-system.bend as Trace

# Owner protocol, expressed by the meaning of each incoming operation. The
# association-list primitives are shared data semantics; no implementation or
# implementation-selected scheduler is an input to this specification.
def refusal(state: D.State, reason: D.Rejection) -> D.Decision:
  D.Decision{state, D.Reject{reason}}

def environment(equal: Bool, state: D.State) -> D.Decision:
  match equal:
    case False{}: refusal(state, D.EnvironmentChanged{})
    case True{}: D.Decision{state, D.EnvironmentAccepted{}}

def claim(receipt: Maybe<&2, Bool>, id: String, env: String, revision: Nat,
          activities: List<&2, D.Activity>, calls: List<&2, D.Invocation>) -> D.Decision:
  match receipt:
    case Some{True{}}: refusal(D.Broker{D.Open{}, env, revision, activities, calls}, D.ActivityAlreadyCompleted{})
    case Some{False{}}: D.Decision{D.Broker{D.Open{}, env, revision, activities, calls}, D.ActivityReplayed{}}
    case None{}: D.Decision{D.Broker{D.Open{}, env, 1n+revision,
      M.activity_put(id, False{}, activities), calls}, D.ActivityClaimed{}}

def release(receipt: Maybe<&2, Bool>, id: String, env: String, revision: Nat,
            activities: List<&2, D.Activity>, calls: List<&2, D.Invocation>) -> D.Decision:
  match receipt:
    case Some{True{}}: D.Decision{D.Broker{D.Open{}, env, revision, activities, calls}, D.ActivityReceiptReplayed{}}
    case Some{False{}}: D.Decision{D.Broker{D.Open{}, env, 1n+revision,
      M.activity_put(id, True{}, activities), calls}, D.ActivityClosed{True{}}}
    # A cleanup can precede a delayed claim. Retain its tombstone; it is not a
    # no-op just because no live lease was found at this instant.
    case None{}: D.Decision{D.Broker{D.Open{}, env, 1n+revision,
      M.activity_put(id, True{}, activities), calls}, D.ActivityClosed{False{}}}

def enqueue(previous: Maybe<&2, D.Invocation>, id: String, payload: String,
            env: String, revision: Nat, activities: List<&2, D.Activity>, calls: List<&2, D.Invocation>) -> D.Decision:
  match previous:
    case Some{entry}: refusal(D.Broker{D.Open{}, env, revision, activities, calls}, D.DuplicateInvocation{})
    case None{}: D.Decision{D.Broker{D.Open{}, env, 1n+revision, activities,
      M.invocation_put(D.Invocation{id, payload, D.Queued{}}, calls)}, D.InvocationQueued{}}

def poll(delivered: List<&2, String>, queued: List<&2, String>, env: String,
         revision: Nat, activities: List<&2, D.Activity>, calls: List<&2, D.Invocation>) -> D.Decision:
  match delivered queued:
    case Con{h, t} _: D.Decision{D.Broker{D.Open{}, env, revision, activities, calls}, D.CallsReplayed{Con{h, t}}}
    case Nil{} Nil{}: D.Decision{D.Broker{D.Open{}, env, revision, activities, calls}, D.WaitForCalls{}}
    case Nil{} Con{h, t}: D.Decision{D.Broker{D.Open{}, env, revision, activities,
      M.deliver_all(calls)}, D.CallsDelivered{Con{h, t}}}

def replay(equal: Bool, state: D.State) -> D.Decision:
  match equal:
    case False{}: refusal(state, D.ConflictingResult{})
    case True{}: D.Decision{state, D.ResultReplayed{}}

def result(previous: Maybe<&2, D.Invocation>, +digest: String, env: String,
           revision: Nat, activities: List<&2, D.Activity>, calls: List<&2, D.Invocation>) -> D.Decision:
  match previous:
    case None{}: refusal(D.Broker{D.Open{}, env, revision, activities, calls}, D.CallNotPending{})
    case Some{D.Invocation{id, payload, D.Queued{}}}:
      refusal(D.Broker{D.Open{}, env, revision, activities, calls}, D.CallNotDelivered{})
    case Some{D.Invocation{id, payload, D.Result{old}}}:
      replay(String.eq(old, digest), D.Broker{D.Open{}, env, revision, activities, calls})
    case Some{D.Invocation{id, payload, D.Delivered{}}}:
      D.Decision{D.Broker{D.Open{}, env, 1n+revision, activities,
        M.invocation_put(D.Invocation{id, payload, D.Result{digest}}, calls)}, D.ResultAccepted{}}

def offer(busy: Bool, state: D.State, revision: Nat) -> D.Decision:
  match busy:
    case False{}: D.Decision{state, D.FenceOffered{revision}}
    case True{}: D.Decision{state, D.FenceUnavailable{}}

# The independent predicate names both obligations. A revision match alone is
# insufficient, including when a caller presents a revision without BeginFence.
def seal(same_revision: Bool, has_activity: Bool, has_call: Bool,
         state: D.State, revision: Nat) -> D.Decision:
  match same_revision has_activity has_call:
    case True{} False{} False{}:
      D.Decision{D.replace_lifetime(state, D.Sealed{revision}), D.FenceCommitted{}}
    case _ _ _: D.Decision{state, D.FenceStale{}}

def fence_is_safe(effect: D.Effect, busy: Bool) -> Bool:
  match effect:
    case D.FenceCommitted{}: Bool.not(busy)
    case _: True{}

def late_activity(receipt: Maybe<&2, Bool>, state: D.State) -> D.Decision:
  match receipt:
    case None{}: D.Decision{state, D.LateActivityReceipt{}}
    case Some{False{}}: D.Decision{state, D.LateActivityReceipt{}}
    case Some{True{}}: D.Decision{state, D.ActivityReceiptReplayed{}}

def sealed_result(receipt: Maybe<&2, D.Invocation>, digest: String, state: D.State) -> D.Decision:
  match receipt:
    case Some{D.Invocation{id, payload, D.Result{old}}}: replay(String.eq(old, digest), state)
    case _: refusal(state, D.OwnerClosed{})

def claim_owner(state: D.State, +id: String) -> D.Decision:
  match state:
    case D.Broker{D.Open{}, env, revision, +activities, calls}:
      claim(M.activity_get(id, activities), id, env, revision, activities, calls)
    case D.Broker{lifetime, env, revision, activities, calls}:
      refusal(D.Broker{lifetime, env, revision, activities, calls}, D.OwnerClosed{})

def release_owner(state: D.State, +id: String) -> D.Decision:
  match state:
    case D.Broker{D.Open{}, env, revision, +activities, calls}:
      release(M.activity_get(id, activities), id, env, revision, activities, calls)
    case D.Broker{D.Sealed{r}, env, revision, +activities, calls}:
      late_activity(M.activity_get(id, activities), D.Broker{D.Sealed{r}, env, revision, activities, calls})
    case D.Broker{D.Retired{}, env, revision, activities, calls}:
      D.Decision{D.Broker{D.Retired{}, env, revision, activities, calls}, D.LateActivityReceipt{}}

def enqueue_owner(state: D.State, +id: String, payload: String) -> D.Decision:
  match state:
    case D.Broker{D.Open{}, env, revision, activities, +calls}:
      enqueue(M.invocation_get(id, calls), id, payload, env, revision, activities, calls)
    case D.Broker{lifetime, env, revision, activities, calls}:
      refusal(D.Broker{lifetime, env, revision, activities, calls}, D.OwnerClosed{})

def poll_owner(state: D.State) -> D.Decision:
  match state:
    case D.Broker{D.Open{}, env, revision, activities, +calls}:
      poll(M.delivered(calls), M.queued(calls), env, revision, activities, calls)
    case D.Broker{lifetime, env, revision, activities, calls}:
      refusal(D.Broker{lifetime, env, revision, activities, calls}, D.OwnerClosed{})

def result_owner(state: D.State, id: String, digest: String) -> D.Decision:
  match state:
    case D.Broker{D.Open{}, env, revision, activities, +calls}:
      result(M.invocation_get(id, calls), digest, env, revision, activities, calls)
    case D.Broker{D.Sealed{r}, env, revision, activities, +calls}:
      sealed_result(M.invocation_get(id, calls), digest, D.Broker{D.Sealed{r}, env, revision, activities, calls})
    case D.Broker{D.Retired{}, env, revision, activities, calls}:
      refusal(D.Broker{D.Retired{}, env, revision, activities, calls}, D.OwnerClosed{})

def offer_owner(state: D.State) -> D.Decision:
  match state:
    case D.Broker{D.Open{}, env, +revision, +activities, +calls}:
      offer(Bool.or(M.has_activity(activities), M.has_invocation(calls)),
        D.Broker{D.Open{}, env, revision, activities, calls}, revision)
    case D.Broker{D.Sealed{+r}, env, revision, +activities, +calls}:
      offer(Bool.or(M.has_activity(activities), M.has_invocation(calls)),
        D.Broker{D.Sealed{r}, env, revision, activities, calls}, r)
    case D.Broker{D.Retired{}, env, revision, activities, calls}:
      refusal(D.Broker{D.Retired{}, env, revision, activities, calls}, D.OwnerClosed{})

def seal_owner(state: D.State, +expected: Nat) -> D.Decision:
  match state:
    case D.Broker{D.Open{}, env, +revision, +activities, +calls}:
      seal(Nat.is_eq(revision, expected), M.has_activity(activities), M.has_invocation(calls),
        D.Broker{D.Open{}, env, revision, activities, calls}, expected)
    case D.Broker{D.Sealed{+r}, env, revision, +activities, +calls}:
      seal(Nat.is_eq(r, expected), M.has_activity(activities), M.has_invocation(calls),
        D.Broker{D.Sealed{r}, env, revision, activities, calls}, expected)
    case D.Broker{D.Retired{}, env, revision, activities, calls}:
      refusal(D.Broker{D.Retired{}, env, revision, activities, calls}, D.OwnerClosed{})

def environment_owner(state: D.State, expected: String) -> D.Decision:
  match state:
    case D.Broker{D.Retired{}, env, revision, activities, calls}:
      refusal(D.Broker{D.Retired{}, env, revision, activities, calls}, D.OwnerClosed{})
    case D.Broker{lifetime, +env, revision, activities, calls}:
      environment(String.eq(env, expected), D.Broker{lifetime, env, revision, activities, calls})

def retire_owner(state: D.State) -> D.Decision:
  match state:
    case D.Broker{D.Retired{}, env, revision, activities, calls}:
      D.Decision{D.Broker{D.Retired{}, env, revision, activities, calls}, D.RetirementReplayed{}}
    case D.Broker{lifetime, env, revision, activities, calls}:
      D.Decision{D.Broker{D.Retired{}, env, revision, activities, calls}, D.OwnerRetired{}}

# Unlike the state-indexed implementation, resolve by the incoming command.
def step(state: D.State, event: D.Event) -> D.Decision:
  match event:
    case D.ClaimActivity{id}: claim_owner(state, id)
    case D.CompleteActivity{id}: release_owner(state, id)
    case D.Enqueue{id, payload}: enqueue_owner(state, id, payload)
    case D.Poll{}: poll_owner(state)
    case D.CompleteCall{id, digest}: result_owner(state, id, digest)
    case D.BeginFence{}: offer_owner(state)
    case D.CommitFence{revision}: seal_owner(state, revision)
    case D.CheckEnvironment{environment}: environment_owner(state, environment)
    case D.Retire{}: retire_owner(state)

def run(events: List<&2, D.Event>, state: D.State) -> List<&2, D.Decision>:
  Trace.run(~D.State, ~D.Event, ~D.Decision, ~step, ~D.state, events, state)
