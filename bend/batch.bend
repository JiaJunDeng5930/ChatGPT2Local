import Base
import ./domain.bend as D
import ./kernel.bend as K
import ./batch-domain.bend as B

def initialize() -> B.State:
  B.Unclaimed{}

# An exclusive, durable filesystem reservation is the foreign receipt for this
# transition. It must be obtained before any page preparation, not merely Send.
def claim(s: B.State) -> B.Decision:
  match s:
    case B.Unclaimed{}: B.BatchDecision{B.Unplanned{}, D.NoEffect{}}
    case B.Unplanned{}: B.BatchDecision{B.Unplanned{}, D.Reject{}}
    case B.Closed{p}: B.BatchDecision{B.Closed{p}, D.Reject{}}
    case B.Batch{p, n, c, r}: B.BatchDecision{B.Batch{p, n, c, r}, D.Reject{}}

def restore(receipt: B.Restoration) -> B.State:
  match receipt:
    case B.PendingIntent{}: B.Closed{D.Unknown{}}
    case B.FinalReceipt{}: B.Closed{D.Completed{}}
    case B.CancellationReceipt{}: B.Closed{D.Cancelled{}}

def plan(s: B.State, payloads: List<&2, String>) -> B.Decision:
  match s:
    case B.Unclaimed{}: B.BatchDecision{B.Unclaimed{}, D.Reject{}}
    case B.Unplanned{}:
      match payloads:
        case Nil{}: B.BatchDecision{B.Unplanned{}, D.Reject{}}
        case Con{current, pending}:
          B.BatchDecision{B.Batch{D.phase(K.step(D.Fresh{}, D.Prepare{})), 0n, current, pending}, D.PrepareSurface{}}
    case B.Closed{p}: B.BatchDecision{B.Closed{p}, D.Reject{}}
    case B.Batch{p, s, c, r}: B.BatchDecision{B.Batch{p, s, c, r}, D.Reject{}}

def with_phase(d: D.Decision, slot: Nat, current: String, pending: List<&2, String>) -> B.Decision:
  match d:
    case D.Decision{phase, effect}: B.BatchDecision{B.Batch{phase, slot, current, pending}, effect}

def with_closed(decision: D.Decision) -> B.Decision:
  match decision:
    case D.Decision{phase, effect}: B.BatchDecision{B.Closed{phase}, effect}

def finish(s: B.State) -> B.Decision:
  match s:
    case B.Unclaimed{}: B.BatchDecision{B.Unclaimed{}, D.Reject{}}
    case B.Unplanned{}: B.BatchDecision{B.Unplanned{}, D.Reject{}}
    case B.Closed{phase}: with_closed(K.step(phase, D.Finished{}))
    case B.Batch{phase, slot, current, Nil{}}:
      with_phase(K.step(phase, D.Finished{}), slot, current, Nil{})
    case B.Batch{phase, slot, current, Con{h, t}}:
      B.BatchDecision{B.Batch{phase, slot, current, Con{h, t}}, D.Reject{}}

def unplanned(event: D.Event) -> B.Decision:
  match event:
    case D.Prepare{}: B.BatchDecision{B.Unplanned{}, D.Reject{}}
    case D.Submit{}: B.BatchDecision{B.Unplanned{}, D.Reject{}}
    case D.Accepted{}: B.BatchDecision{B.Unplanned{}, D.Reject{}}
    case D.Finished{}: B.BatchDecision{B.Unplanned{}, D.Reject{}}
    case D.Uncertain{}: B.BatchDecision{B.Unplanned{}, D.NoEffect{}}
    case D.Attach{}: B.BatchDecision{B.Unplanned{}, D.NoEffect{}}
    case D.Detach{}: B.BatchDecision{B.Unplanned{}, D.NoEffect{}}
    case D.Recover{}: B.BatchDecision{B.Unplanned{}, D.NoEffect{}}
    case D.UserCancel{}: B.BatchDecision{B.Closed{D.Cancelled{}}, D.NoEffect{}}

def unclaimed(event: D.Event) -> B.Decision:
  match event:
    case D.Prepare{}: B.BatchDecision{B.Unclaimed{}, D.Reject{}}
    case D.Submit{}: B.BatchDecision{B.Unclaimed{}, D.Reject{}}
    case D.Accepted{}: B.BatchDecision{B.Unclaimed{}, D.Reject{}}
    case D.Finished{}: B.BatchDecision{B.Unclaimed{}, D.Reject{}}
    case D.Uncertain{}: B.BatchDecision{B.Unclaimed{}, D.NoEffect{}}
    case D.Attach{}: B.BatchDecision{B.Unclaimed{}, D.NoEffect{}}
    case D.Detach{}: B.BatchDecision{B.Unclaimed{}, D.NoEffect{}}
    case D.Recover{}: B.BatchDecision{B.Unclaimed{}, D.NoEffect{}}
    case D.UserCancel{}: B.BatchDecision{B.Closed{D.Cancelled{}}, D.NoEffect{}}

def closed(phase: D.Phase, +event: D.Event) -> B.Decision:
  match event:
    case D.Prepare{}: B.BatchDecision{B.Closed{phase}, D.Reject{}}
    case D.Submit{}: B.BatchDecision{B.Closed{phase}, D.Reject{}}
    case _: with_closed(K.step(phase, event))

def planned(phase: D.Phase, slot: Nat, current: String, pending: List<&2, String>, +event: D.Event) -> B.Decision:
  match event:
    case D.Finished{}: finish(B.Batch{phase, slot, current, pending})
    case _: with_phase(K.step(phase, event), slot, current, pending)

def step(s: B.State, event: D.Event) -> B.Decision:
  match s:
    case B.Unclaimed{}: unclaimed(event)
    case B.Unplanned{}: unplanned(event)
    case B.Closed{phase}: closed(phase, event)
    case B.Batch{phase, slot, current, pending}: planned(phase, slot, current, pending, event)

def advance(ok: Bool, phase: D.Phase, slot: Nat, current: String, next: String, rest: List<&2, String>) -> B.Decision:
  match ok:
    case False{}: B.BatchDecision{B.Batch{phase, slot, current, Con{next, rest}}, D.Reject{}}
    case True{}: B.BatchDecision{B.Batch{D.Prepared{}, 1n+slot, next, rest}, D.PrepareSurface{}}

def active(phase: D.Phase) -> Bool:
  match phase:
    case D.Fresh{}: False{}
    case D.Prepared{}: False{}
    case D.Attempted{}: True{}
    case D.Running{}: True{}
    case D.Unknown{}: True{}
    case D.Completed{}: False{}
    case D.Cancelled{}: False{}

def acknowledge(s: B.State, stage: Nat) -> B.Decision:
  match s:
    case B.Unclaimed{}: B.BatchDecision{B.Unclaimed{}, D.Reject{}}
    case B.Unplanned{}: B.BatchDecision{B.Unplanned{}, D.Reject{}}
    case B.Closed{phase}: B.BatchDecision{B.Closed{phase}, D.Reject{}}
    case B.Batch{phase, slot, current, Nil{}}:
      B.BatchDecision{B.Batch{phase, slot, current, Nil{}}, D.Reject{}}
    case B.Batch{+phase, +slot, current, Con{next, rest}}:
      advance(Bool.and(active(phase), Nat.is_eq(1n+slot, stage)), phase, slot, current, next, rest)


def transition(s: B.State, input: B.Input) -> B.Decision:
  match input:
    case B.Control{e}: step(s, e)
    case B.StageAcknowledged{n}: acknowledge(s, n)
