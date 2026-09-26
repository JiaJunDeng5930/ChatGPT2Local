import Base
import ./domain.bend as D

# A finite physical-message plan, fixed before the first send. The current slot
# owns one allowance; the suffix is inaccessible until an exact stage receipt.
type State is Data:
  Unclaimed{}
  Unplanned{}
  Closed{phase: D.Phase}
  Batch{phase: D.Phase, slot: Nat, current: String, pending: List<&2, String>}

type Decision is Data:
  BatchDecision{state: State, effect: D.Effect}

type Restoration is Data:
  PendingIntent{}
  FinalReceipt{}
  CancellationReceipt{}

def state(d: Decision) -> State:
  match d:
    case BatchDecision{s, e}: s

def effect(d: Decision) -> D.Effect:
  match d:
    case BatchDecision{s, e}: e

def slot(s: State) -> Nat:
  match s:
    case Unclaimed{}: 0n
    case Unplanned{}: 0n
    case Closed{p}: 0n
    case Batch{p, n, c, r}: n

def remaining(s: State) -> Nat:
  match s:
    case Unclaimed{}: 0n
    case Unplanned{}: 0n
    case Closed{p}: 0n
    case Batch{p, n, c, r}: 1n+List.length(&2, String, r)

def phase(s: State) -> D.Phase:
  match s:
    case Unclaimed{}: D.Fresh{}
    case Unplanned{}: D.Fresh{}
    case Closed{p}: p
    case Batch{p, n, c, r}: p

def potential(s: State) -> Nat:
  match s:
    case Unclaimed{}: 0n
    case Unplanned{}: 0n
    case Closed{p}: 0n
    case Batch{p, n, c, r}: Nat.add(D.allowance(p), List.length(&2, String, r))

def cost(d: Decision) -> Nat:
  D.sends(effect(d))

type Input is Data:
  Control{event: D.Event}
  StageAcknowledged{stage: Nat}
