import Base
import ./domain.bend as D
import ./batch-domain.bend as B
import ./specification.bend as Turn

def claim(s: B.State) -> B.Decision:
  match s:
    case B.Unclaimed{}: B.BatchDecision{B.Unplanned{}, D.NoEffect{}}
    case B.Unplanned{}: B.BatchDecision{B.Unplanned{}, D.Reject{}}
    case B.Closed{p}: B.BatchDecision{B.Closed{p}, D.Reject{}}
    case B.Batch{p, n, c, r}: B.BatchDecision{B.Batch{p, n, c, r}, D.Reject{}}

# Requirements for a finite, immutable upload transaction. This module imports
# the turn SPECIFICATION, never either executable transition implementation.
def initial_plan(payloads: List<&2, String>) -> B.Decision:
  match payloads:
    case Nil{}: B.BatchDecision{B.Unplanned{}, D.Reject{}}
    case Con{head, tail}: B.BatchDecision{B.Batch{D.Prepared{}, 0n, head, tail}, D.PrepareSurface{}}

def plan(s: B.State, payloads: List<&2, String>) -> B.Decision:
  match s:
    case B.Unclaimed{}: B.BatchDecision{B.Unclaimed{}, D.Reject{}}
    case B.Unplanned{}: initial_plan(payloads)
    case B.Closed{p}: B.BatchDecision{B.Closed{p}, D.Reject{}}
    case B.Batch{p, n, c, r}: B.BatchDecision{B.Batch{p, n, c, r}, D.Reject{}}

def closed(decision: D.Decision) -> B.Decision:
  match decision:
    case D.Decision{p, effect}: B.BatchDecision{B.Closed{p}, effect}

def payload(decision: D.Decision, n: Nat, c: String, r: List<&2, String>) -> B.Decision:
  match decision:
    case D.Decision{p, effect}: B.BatchDecision{B.Batch{p, n, c, r}, effect}

def step(e: D.Event, s: B.State) -> B.Decision:
  match e:
    case D.Prepare{}:
      match s:
        case B.Unclaimed{}: B.BatchDecision{B.Unclaimed{}, D.Reject{}}
        case B.Unplanned{}: B.BatchDecision{B.Unplanned{}, D.Reject{}}
        case B.Closed{p}: B.BatchDecision{B.Closed{p}, D.Reject{}}
        case B.Batch{p, n, c, r}: payload(Turn.prepare(p), n, c, r)
    case D.Submit{}:
      match s:
        case B.Unclaimed{}: B.BatchDecision{B.Unclaimed{}, D.Reject{}}
        case B.Unplanned{}: B.BatchDecision{B.Unplanned{}, D.Reject{}}
        case B.Closed{p}: B.BatchDecision{B.Closed{p}, D.Reject{}}
        case B.Batch{p, n, c, r}: payload(Turn.submit(p), n, c, r)
    case D.Accepted{}:
      match s:
        case B.Unclaimed{}: B.BatchDecision{B.Unclaimed{}, D.Reject{}}
        case B.Unplanned{}: B.BatchDecision{B.Unplanned{}, D.Reject{}}
        case B.Closed{p}: closed(Turn.accepted(p))
        case B.Batch{p, n, c, r}: payload(Turn.accepted(p), n, c, r)
    case D.Finished{}:
      match s:
        case B.Unclaimed{}: B.BatchDecision{B.Unclaimed{}, D.Reject{}}
        case B.Unplanned{}: B.BatchDecision{B.Unplanned{}, D.Reject{}}
        case B.Closed{p}: closed(Turn.finished(p))
        case B.Batch{p, n, c, Nil{}}: payload(Turn.finished(p), n, c, Nil{})
        case B.Batch{p, n, c, Con{h, t}}: B.BatchDecision{B.Batch{p, n, c, Con{h, t}}, D.Reject{}}
    case D.Uncertain{}:
      match s:
        case B.Unclaimed{}: B.BatchDecision{B.Unclaimed{}, D.NoEffect{}}
        case B.Unplanned{}: B.BatchDecision{B.Unplanned{}, D.NoEffect{}}
        case B.Closed{p}: closed(Turn.uncertain(p))
        case B.Batch{p, n, c, r}: payload(Turn.uncertain(p), n, c, r)
    case D.Attach{}:
      match s:
        case B.Unclaimed{}: B.BatchDecision{B.Unclaimed{}, D.NoEffect{}}
        case B.Unplanned{}: B.BatchDecision{B.Unplanned{}, D.NoEffect{}}
        case B.Closed{p}: closed(Turn.attach(p))
        case B.Batch{p, n, c, r}: payload(Turn.attach(p), n, c, r)
    case D.Detach{}: B.BatchDecision{s, D.NoEffect{}}
    case D.Recover{}:
      match s:
        case B.Unclaimed{}: B.BatchDecision{B.Unclaimed{}, D.NoEffect{}}
        case B.Unplanned{}: B.BatchDecision{B.Unplanned{}, D.NoEffect{}}
        case B.Closed{p}: closed(Turn.uncertain(p))
        case B.Batch{p, n, c, r}: payload(Turn.uncertain(p), n, c, r)
    case D.UserCancel{}:
      match s:
        case B.Unclaimed{}: B.BatchDecision{B.Closed{D.Cancelled{}}, D.NoEffect{}}
        case B.Unplanned{}: B.BatchDecision{B.Closed{D.Cancelled{}}, D.NoEffect{}}
        case B.Closed{p}: closed(Turn.cancel(p))
        case B.Batch{p, n, c, r}: payload(Turn.cancel(p), n, c, r)

def advance(matches: Bool, p: D.Phase, n: Nat, c: String, h: String, t: List<&2, String>) -> B.Decision:
  match matches:
    case False{}: B.BatchDecision{B.Batch{p, n, c, Con{h, t}}, D.Reject{}}
    case True{}: B.BatchDecision{B.Batch{D.Prepared{}, 1n+n, h, t}, D.PrepareSurface{}}

def acknowledged(matches: Bool, p: D.Phase, n: Nat, c: String, h: String, t: List<&2, String>) -> B.Decision:
  match p:
    case D.Fresh{}: B.BatchDecision{B.Batch{D.Fresh{}, n, c, Con{h, t}}, D.Reject{}}
    case D.Prepared{}: B.BatchDecision{B.Batch{D.Prepared{}, n, c, Con{h, t}}, D.Reject{}}
    case D.Attempted{}: advance(matches, D.Attempted{}, n, c, h, t)
    case D.Running{}: advance(matches, D.Running{}, n, c, h, t)
    case D.Unknown{}: advance(matches, D.Unknown{}, n, c, h, t)
    case D.Completed{}: B.BatchDecision{B.Batch{D.Completed{}, n, c, Con{h, t}}, D.Reject{}}
    case D.Cancelled{}: B.BatchDecision{B.Batch{D.Cancelled{}, n, c, Con{h, t}}, D.Reject{}}

def acknowledge(stage: Nat, s: B.State) -> B.Decision:
  match s:
    case B.Unclaimed{}: B.BatchDecision{B.Unclaimed{}, D.Reject{}}
    case B.Unplanned{}: B.BatchDecision{B.Unplanned{}, D.Reject{}}
    case B.Closed{p}: B.BatchDecision{B.Closed{p}, D.Reject{}}
    case B.Batch{p, n, c, Nil{}}: B.BatchDecision{B.Batch{p, n, c, Nil{}}, D.Reject{}}
    case B.Batch{p, +n, c, Con{h, t}}: acknowledged(Nat.is_eq(stage, 1n+n), p, n, c, h, t)

def transition(s: B.State, input: B.Input) -> B.Decision:
  match input:
    case B.Control{e}: step(e, s)
    case B.StageAcknowledged{n}: acknowledge(n, s)
