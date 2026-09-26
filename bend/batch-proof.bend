import Base
import ./domain.bend as D
import ./batch-domain.bend as B
import ./batch.bend as K
import ./batch-specification.bend as S
import ./batch-laws.bend as L
import ./kernel.bend as TurnKernel
import ./specification.bend as TurnSpec
import ./LAWS.bend as TurnLaws
import ./turn-proof.bend as TurnProof
import ./theory/nat-order.bend as Order
import ./theory/transition-system.bend as T

def L.reservation_refinement(state):
  match state:
    case B.Unclaimed{}: {==}
    case B.Unplanned{}: {==}
    case B.Closed{p}: {==}
    case B.Batch{p, n, c, r}: {==}

def L.reservation_is_once_only(state):
  match state:
    case B.Unclaimed{}: {==}
    case B.Unplanned{}: {==}
    case B.Closed{p}: {==}
    case B.Batch{p, n, c, r}: {==}

def L.preparation_requires_reservation(payloads):
  {==}

def L.restored_operations_cannot_send(receipt):
  match receipt:
    case B.PendingIntent{}: {==}
    case B.FinalReceipt{}: {==}
    case B.CancellationReceipt{}: {==}

def L.plan_has_exactly_its_declared_budget(payloads):
  match payloads:
    case Nil{}: {==}
    case Con{h, t}: {==}

def payload_representation(d: D.Decision, n: Nat, c: String, r: List<&2, String>) ->
  {K.with_phase(d, n, c, r) == S.payload(d, n, c, r) : B.Decision}:
  match d:
    case D.Decision{p, e}: {==}

def closed_representation(d: D.Decision) ->
  {K.with_closed(d) == S.closed(d) : B.Decision}:
  match d:
    case D.Decision{p, e}: {==}

def lifted(+p: D.Phase, +e: D.Event, n: Nat, c: String, r: List<&2, String>) ->
  {K.with_phase(TurnKernel.step(p, e), n, c, r) == S.payload(TurnSpec.step(e, p), n, c, r) : B.Decision}:
  %payload_representation(TurnSpec.step(e, p), n, c, r) :
    {K.with_phase(TurnKernel.step(p, e), n, c, r) == _ : B.Decision}
  %TurnLaws.turn_refinement(p, e) :
    {K.with_phase(TurnKernel.step(p, e), n, c, r) == K.with_phase(_, n, c, r) : B.Decision}
  {==}

def lifted_closed(+p: D.Phase, +e: D.Event) ->
  {K.with_closed(TurnKernel.step(p, e)) == S.closed(TurnSpec.step(e, p)) : B.Decision}:
  %closed_representation(TurnSpec.step(e, p)) :
    {K.with_closed(TurnKernel.step(p, e)) == _ : B.Decision}
  %TurnLaws.turn_refinement(p, e) :
    {K.with_closed(TurnKernel.step(p, e)) == K.with_closed(_) : B.Decision}
  {==}

def L.plan_refinement(state, payloads):
  match state:
    case B.Unclaimed{}:
      match payloads:
        case Nil{}: {==}
        case Con{h, t}: {==}
    case B.Unplanned{}:
      match payloads:
        case Nil{}: {==}
        case Con{h, t}: {==}
    case B.Closed{+p}: {==}
    case B.Batch{+p, +n, +c, +r}: {==}

def finished_refinement(p: D.Phase, n: Nat, c: String, r: List<&2, String>) ->
  {K.finish(B.Batch{p, n, c, r}) == S.step(D.Finished{}, B.Batch{p, n, c, r}) : B.Decision}:
  match r:
    case Nil{}: lifted(p, D.Finished{}, n, c, Nil{})
    case Con{h, t}: {==}

def L.control_refinement(state, event):
  match state:
    case B.Unclaimed{}:
      match event:
        case D.Prepare{}: {==}
        case D.Submit{}: {==}
        case D.Accepted{}: {==}
        case D.Finished{}: {==}
        case D.Uncertain{}: {==}
        case D.Attach{}: {==}
        case D.Detach{}: {==}
        case D.Recover{}: {==}
        case D.UserCancel{}: {==}
    case B.Unplanned{}:
      match event:
        case D.Prepare{}: {==}
        case D.Submit{}: {==}
        case D.Accepted{}: {==}
        case D.Finished{}: {==}
        case D.Uncertain{}: {==}
        case D.Attach{}: {==}
        case D.Detach{}: {==}
        case D.Recover{}: {==}
        case D.UserCancel{}: {==}
    case B.Closed{+p}:
      match event:
        case D.Prepare{}: {==}
        case D.Submit{}: {==}
        case D.Accepted{}: lifted_closed(p, D.Accepted{})
        case D.Finished{}: lifted_closed(p, D.Finished{})
        case D.Uncertain{}: lifted_closed(p, D.Uncertain{})
        case D.Attach{}: lifted_closed(p, D.Attach{})
        case D.Detach{}: lifted_closed(p, D.Detach{})

        case D.Recover{}: lifted_closed(p, D.Recover{})
        case D.UserCancel{}: lifted_closed(p, D.UserCancel{})
    case B.Batch{+p, +n, +c, +r}:
      match event:
        case D.Prepare{}: lifted(p, D.Prepare{}, n, c, r)
        case D.Submit{}: lifted(p, D.Submit{}, n, c, r)
        case D.Accepted{}: lifted(p, D.Accepted{}, n, c, r)
        case D.Finished{}: finished_refinement(p, n, c, r)
        case D.Uncertain{}: lifted(p, D.Uncertain{}, n, c, r)
        case D.Attach{}: lifted(p, D.Attach{}, n, c, r)
        case D.Detach{}: lifted(p, D.Detach{}, n, c, r)

        case D.Recover{}: lifted(p, D.Recover{}, n, c, r)
        case D.UserCancel{}: lifted(p, D.UserCancel{}, n, c, r)

def acknowledge_active(matches: Bool, p: D.Phase, n: Nat, c: String, h: String, t: List<&2, String>) ->
  {K.advance(matches, p, n, c, h, t) == S.advance(matches, p, n, c, h, t) : B.Decision}:
  match matches:
    case False{}: {==}
    case True{}: {==}

def acknowledgement_payload(p: D.Phase, +n: Nat, c: String, h: String, t: List<&2, String>, +stage: Nat) ->
  {K.acknowledge(B.Batch{p, n, c, Con{h, t}}, stage) == S.acknowledge(stage, B.Batch{p, n, c, Con{h, t}}) : B.Decision}:
  match p:
    case D.Fresh{}:
      {==}
    case D.Prepared{}:
      {==}
    case D.Attempted{}:
      %Order.equality_symmetric(1n+n, stage) :
        {K.advance(Nat.is_eq(1n+n, stage), D.Attempted{}, n, c, h, t) == S.advance(_, D.Attempted{}, n, c, h, t) : B.Decision}
      acknowledge_active(Nat.is_eq(1n+n, stage), D.Attempted{}, n, c, h, t)
    case D.Running{}:
      %Order.equality_symmetric(1n+n, stage) :
        {K.advance(Nat.is_eq(1n+n, stage), D.Running{}, n, c, h, t) == S.advance(_, D.Running{}, n, c, h, t) : B.Decision}
      acknowledge_active(Nat.is_eq(1n+n, stage), D.Running{}, n, c, h, t)
    case D.Unknown{}:
      %Order.equality_symmetric(1n+n, stage) :
        {K.advance(Nat.is_eq(1n+n, stage), D.Unknown{}, n, c, h, t) == S.advance(_, D.Unknown{}, n, c, h, t) : B.Decision}
      acknowledge_active(Nat.is_eq(1n+n, stage), D.Unknown{}, n, c, h, t)
    case D.Completed{}:
      {==}
    case D.Cancelled{}:
      {==}

def L.acknowledgement_refinement(state, stage):
  match state:
    case B.Unclaimed{}: {==}
    case B.Unplanned{}: {==}
    case B.Closed{+p}: {==}
    case B.Batch{p, n, c, Nil{}}: {==}
    case B.Batch{p, n, c, Con{h, t}}: acknowledgement_payload(p, n, c, h, t, stage)

def L.transition_refinement(state, input):
  match input:
    case B.Control{e}: L.control_refinement(state, e)
    case B.StageAcknowledged{n}: L.acknowledgement_refinement(state, n)

def finished_empty_budget(p: D.Phase, n: Nat, c: String) ->
  {Nat.is_le(Nat.add(B.cost(K.finish(B.Batch{p, n, c, Nil{}})), B.potential(B.state(K.finish(B.Batch{p, n, c, Nil{}})))), B.potential(B.Batch{p, n, c, Nil{}})) == True{} : Bool}:
  match p:
    case D.Fresh{}: {==}
    case D.Prepared{}: {==}
    case D.Attempted{}: {==}
    case D.Running{}: {==}
    case D.Unknown{}: {==}
    case D.Completed{}: {==}
    case D.Cancelled{}: {==}

def finished_budget(p: D.Phase, n: Nat, c: String, r: List<&2, String>) ->
  {Nat.is_le(Nat.add(B.cost(K.finish(B.Batch{p, n, c, r})), B.potential(B.state(K.finish(B.Batch{p, n, c, r})))), B.potential(B.Batch{p, n, c, r})) == True{} : Bool}:
  match r:
    case Nil{}: finished_empty_budget(p, n, c)
    case Con{h, t}: Order.reflexive(Nat.add(D.allowance(p), 1n+List.length(&2, String, t)))

def closed_budget(p: D.Phase, event: D.Event) ->
  {Nat.is_le(Nat.add(B.cost(K.step(B.Closed{p}, event)), B.potential(B.state(K.step(B.Closed{p}, event)))), 0n) == True{} : Bool}:
  match p:
    case D.Fresh{}:
      match event:
        case D.Prepare{}: {==}
        case D.Submit{}: {==}
        case D.Accepted{}: {==}
        case D.Finished{}: {==}
        case D.Uncertain{}: {==}
        case D.Attach{}: {==}
        case D.Detach{}: {==}
        case D.Recover{}: {==}
        case D.UserCancel{}: {==}
    case D.Prepared{}:
      match event:
        case D.Prepare{}: {==}
        case D.Submit{}: {==}
        case D.Accepted{}: {==}
        case D.Finished{}: {==}
        case D.Uncertain{}: {==}
        case D.Attach{}: {==}
        case D.Detach{}: {==}
        case D.Recover{}: {==}
        case D.UserCancel{}: {==}
    case D.Attempted{}:
      match event:
        case D.Prepare{}: {==}
        case D.Submit{}: {==}
        case D.Accepted{}: {==}
        case D.Finished{}: {==}
        case D.Uncertain{}: {==}
        case D.Attach{}: {==}
        case D.Detach{}: {==}
        case D.Recover{}: {==}
        case D.UserCancel{}: {==}
    case D.Running{}:
      match event:
        case D.Prepare{}: {==}
        case D.Submit{}: {==}
        case D.Accepted{}: {==}
        case D.Finished{}: {==}
        case D.Uncertain{}: {==}
        case D.Attach{}: {==}
        case D.Detach{}: {==}
        case D.Recover{}: {==}
        case D.UserCancel{}: {==}
    case D.Unknown{}:
      match event:
        case D.Prepare{}: {==}
        case D.Submit{}: {==}
        case D.Accepted{}: {==}
        case D.Finished{}: {==}
        case D.Uncertain{}: {==}
        case D.Attach{}: {==}
        case D.Detach{}: {==}
        case D.Recover{}: {==}
        case D.UserCancel{}: {==}
    case D.Completed{}:
      match event:
        case D.Prepare{}: {==}
        case D.Submit{}: {==}
        case D.Accepted{}: {==}
        case D.Finished{}: {==}
        case D.Uncertain{}: {==}
        case D.Attach{}: {==}
        case D.Detach{}: {==}
        case D.Recover{}: {==}
        case D.UserCancel{}: {==}
    case D.Cancelled{}:
      match event:
        case D.Prepare{}: {==}
        case D.Submit{}: {==}
        case D.Accepted{}: {==}
        case D.Finished{}: {==}
        case D.Uncertain{}: {==}
        case D.Attach{}: {==}
        case D.Detach{}: {==}
        case D.Recover{}: {==}
        case D.UserCancel{}: {==}

def payload_budget(p: D.Phase, n: Nat, c: String, r: List<&2, String>, event: D.Event) ->
  {Nat.is_le(Nat.add(B.cost(K.step(B.Batch{p, n, c, r}, event)), B.potential(B.state(K.step(B.Batch{p, n, c, r}, event)))), B.potential(B.Batch{p, n, c, r})) == True{} : Bool}:
  match p:
    case D.Fresh{}:
      match event:
        case D.Prepare{}: Order.reflexive(1n+List.length(&2, String, r))
        case D.Submit{}: Order.reflexive(1n+List.length(&2, String, r))
        case D.Accepted{}: Order.reflexive(1n+List.length(&2, String, r))
        case D.Finished{}: finished_budget(D.Fresh{}, n, c, r)
        case D.Uncertain{}: Order.reflexive(1n+List.length(&2, String, r))
        case D.Attach{}: Order.reflexive(1n+List.length(&2, String, r))
        case D.Detach{}: Order.reflexive(1n+List.length(&2, String, r))
        case D.Recover{}: Order.reflexive(1n+List.length(&2, String, r))
        case D.UserCancel{}: Order.successor(List.length(&2, String, r))
    case D.Prepared{}:
      match event:
        case D.Prepare{}: Order.reflexive(1n+List.length(&2, String, r))
        case D.Submit{}: Order.reflexive(1n+List.length(&2, String, r))
        case D.Accepted{}: Order.reflexive(1n+List.length(&2, String, r))
        case D.Finished{}: finished_budget(D.Prepared{}, n, c, r)
        case D.Uncertain{}: Order.reflexive(1n+List.length(&2, String, r))
        case D.Attach{}: Order.reflexive(1n+List.length(&2, String, r))
        case D.Detach{}: Order.reflexive(1n+List.length(&2, String, r))
        case D.Recover{}: Order.reflexive(1n+List.length(&2, String, r))
        case D.UserCancel{}: Order.successor(List.length(&2, String, r))
    case D.Attempted{}:
      match event:
        case D.Prepare{}: Order.reflexive(List.length(&2, String, r))
        case D.Submit{}: Order.reflexive(List.length(&2, String, r))
        case D.Accepted{}: Order.reflexive(List.length(&2, String, r))
        case D.Finished{}: finished_budget(D.Attempted{}, n, c, r)
        case D.Uncertain{}: Order.reflexive(List.length(&2, String, r))
        case D.Attach{}: Order.reflexive(List.length(&2, String, r))
        case D.Detach{}: Order.reflexive(List.length(&2, String, r))
        case D.Recover{}: Order.reflexive(List.length(&2, String, r))
        case D.UserCancel{}: Order.reflexive(List.length(&2, String, r))
    case D.Running{}:
      match event:
        case D.Prepare{}: Order.reflexive(List.length(&2, String, r))
        case D.Submit{}: Order.reflexive(List.length(&2, String, r))
        case D.Accepted{}: Order.reflexive(List.length(&2, String, r))
        case D.Finished{}: finished_budget(D.Running{}, n, c, r)
        case D.Uncertain{}: Order.reflexive(List.length(&2, String, r))
        case D.Attach{}: Order.reflexive(List.length(&2, String, r))
        case D.Detach{}: Order.reflexive(List.length(&2, String, r))
        case D.Recover{}: Order.reflexive(List.length(&2, String, r))
        case D.UserCancel{}: Order.reflexive(List.length(&2, String, r))
    case D.Unknown{}:
      match event:
        case D.Prepare{}: Order.reflexive(List.length(&2, String, r))
        case D.Submit{}: Order.reflexive(List.length(&2, String, r))
        case D.Accepted{}: Order.reflexive(List.length(&2, String, r))
        case D.Finished{}: finished_budget(D.Unknown{}, n, c, r)
        case D.Uncertain{}: Order.reflexive(List.length(&2, String, r))
        case D.Attach{}: Order.reflexive(List.length(&2, String, r))
        case D.Detach{}: Order.reflexive(List.length(&2, String, r))
        case D.Recover{}: Order.reflexive(List.length(&2, String, r))
        case D.UserCancel{}: Order.reflexive(List.length(&2, String, r))
    case D.Completed{}:
      match event:
        case D.Prepare{}: Order.reflexive(List.length(&2, String, r))
        case D.Submit{}: Order.reflexive(List.length(&2, String, r))
        case D.Accepted{}: Order.reflexive(List.length(&2, String, r))
        case D.Finished{}: finished_budget(D.Completed{}, n, c, r)
        case D.Uncertain{}: Order.reflexive(List.length(&2, String, r))
        case D.Attach{}: Order.reflexive(List.length(&2, String, r))
        case D.Detach{}: Order.reflexive(List.length(&2, String, r))
        case D.Recover{}: Order.reflexive(List.length(&2, String, r))
        case D.UserCancel{}: Order.reflexive(List.length(&2, String, r))
    case D.Cancelled{}:
      match event:
        case D.Prepare{}: Order.reflexive(List.length(&2, String, r))
        case D.Submit{}: Order.reflexive(List.length(&2, String, r))
        case D.Accepted{}: Order.reflexive(List.length(&2, String, r))
        case D.Finished{}: finished_budget(D.Cancelled{}, n, c, r)
        case D.Uncertain{}: Order.reflexive(List.length(&2, String, r))
        case D.Attach{}: Order.reflexive(List.length(&2, String, r))
        case D.Detach{}: Order.reflexive(List.length(&2, String, r))
        case D.Recover{}: Order.reflexive(List.length(&2, String, r))
        case D.UserCancel{}: Order.reflexive(List.length(&2, String, r))

def L.control_budget(state, event):
  match state:
    case B.Unclaimed{}:
      match event:
        case D.Prepare{}: {==}
        case D.Submit{}: {==}
        case D.Accepted{}: {==}
        case D.Finished{}: {==}
        case D.Uncertain{}: {==}
        case D.Attach{}: {==}
        case D.Detach{}: {==}
        case D.Recover{}: {==}
        case D.UserCancel{}: {==}
    case B.Unplanned{}:
      match event:
        case D.Prepare{}: {==}
        case D.Submit{}: {==}
        case D.Accepted{}: {==}
        case D.Finished{}: {==}
        case D.Uncertain{}: {==}
        case D.Attach{}: {==}
        case D.Detach{}: {==}
        case D.Recover{}: {==}
        case D.UserCancel{}: {==}
    case B.Closed{p}: closed_budget(p, event)
    case B.Batch{p, n, c, r}: payload_budget(p, n, c, r, event)

def advance_budget_Attempted(ok: Bool, n: Nat, c: String, h: String, +t: List<&2, String>) ->
  {Nat.is_le(Nat.add(B.cost(K.advance(ok, D.Attempted{}, n, c, h, t)), B.potential(B.state(K.advance(ok, D.Attempted{}, n, c, h, t)))), 1n+List.length(&2, String, t)) == True{} : Bool}:
  match ok:
    case False{}: Order.reflexive(1n+List.length(&2, String, t))
    case True{}: Order.reflexive(1n+List.length(&2, String, t))

def advance_budget_Running(ok: Bool, n: Nat, c: String, h: String, +t: List<&2, String>) ->
  {Nat.is_le(Nat.add(B.cost(K.advance(ok, D.Running{}, n, c, h, t)), B.potential(B.state(K.advance(ok, D.Running{}, n, c, h, t)))), 1n+List.length(&2, String, t)) == True{} : Bool}:
  match ok:
    case False{}: Order.reflexive(1n+List.length(&2, String, t))
    case True{}: Order.reflexive(1n+List.length(&2, String, t))

def advance_budget_Unknown(ok: Bool, n: Nat, c: String, h: String, +t: List<&2, String>) ->
  {Nat.is_le(Nat.add(B.cost(K.advance(ok, D.Unknown{}, n, c, h, t)), B.potential(B.state(K.advance(ok, D.Unknown{}, n, c, h, t)))), 1n+List.length(&2, String, t)) == True{} : Bool}:
  match ok:
    case False{}: Order.reflexive(1n+List.length(&2, String, t))
    case True{}: Order.reflexive(1n+List.length(&2, String, t))

def acknowledgement_payload_budget(p: D.Phase, +n: Nat, c: String, h: String, t: List<&2, String>, stage: Nat) ->
  {Nat.is_le(Nat.add(B.cost(K.acknowledge(B.Batch{p, n, c, Con{h, t}}, stage)), B.potential(B.state(K.acknowledge(B.Batch{p, n, c, Con{h, t}}, stage)))), B.potential(B.Batch{p, n, c, Con{h, t}})) == True{} : Bool}:
  match p:
    case D.Fresh{}: Order.reflexive(1n+1n+List.length(&2, String, t))
    case D.Prepared{}: Order.reflexive(1n+1n+List.length(&2, String, t))
    case D.Attempted{}: advance_budget_Attempted(Nat.is_eq(1n+n, stage), n, c, h, t)
    case D.Running{}: advance_budget_Running(Nat.is_eq(1n+n, stage), n, c, h, t)
    case D.Unknown{}: advance_budget_Unknown(Nat.is_eq(1n+n, stage), n, c, h, t)
    case D.Completed{}: Order.reflexive(1n+List.length(&2, String, t))
    case D.Cancelled{}: Order.reflexive(1n+List.length(&2, String, t))

def L.acknowledgement_budget(state, stage):
  match state:
    case B.Unclaimed{}: {==}
    case B.Unplanned{}: {==}
    case B.Closed{+p}: {==}
    case B.Batch{p, n, c, Nil{}}: Order.reflexive(Nat.add(D.allowance(p), 0n))
    case B.Batch{p, n, c, Con{h, t}}: acknowledgement_payload_budget(p, n, c, h, t, stage)

def L.transition_budget(state, input):
  match input:
    case B.Control{e}: L.control_budget(state, e)
    case B.StageAcknowledged{n}: L.acknowledgement_budget(state, n)

def L.every_finite_trace_refines(state, events):
  T.refinement(~B.State, ~B.Input, ~B.Decision, ~K.transition, ~S.transition, ~B.state, ~L.transition_refinement, events, state)

def L.every_finite_trace_within_budget(state, events):
  T.budget(~B.State, ~B.Input, ~B.Decision, ~K.transition, ~B.state, ~B.cost, ~B.potential, ~L.transition_budget, events, state)
