import Base

# A physical submission has one lifetime. A new user turn gets a NEW identity;
# there is deliberately no reset transition on an existing identity.
type Phase is Data:
  Fresh{}
  Prepared{}
  Attempted{}
  Running{}
  Unknown{}
  Completed{}
  Cancelled{}

type Event is Data:
  Prepare{}
  Submit{}
  Accepted{}
  Finished{}
  Uncertain{}
  Attach{}
  Detach{}
  Recover{}
  UserCancel{}

# These are permissions, not observations that the physical effects happened.
# SendPrompt must be committed before it is interpreted. No replay dispatches it.
type Effect is Data:
  PrepareSurface{}
  SendPrompt{}
  ObserveOnly{}
  PublishFinal{}
  ReplayFinal{}
  StopByUser{}
  NoEffect{}
  Reject{}

type Decision is Data:
  Decision{phase: Phase, effect: Effect}

def phase(d: Decision) -> Phase:
  match d:
    case Decision{s, e}:
      s

def effect(d: Decision) -> Effect:
  match d:
    case Decision{s, e}:
      e

# The unspent send allowance is the ranking function for the at-most-once law.
def allowance(s: Phase) -> Nat:
  match s:
    case Fresh{}: 1n
    case Prepared{}: 1n
    case Attempted{}: 0n
    case Running{}: 0n
    case Unknown{}: 0n
    case Completed{}: 0n
    case Cancelled{}: 0n

def sends(e: Effect) -> Nat:
  match e:
    case SendPrompt{}: 1n
    case PrepareSurface{}: 0n
    case ObserveOnly{}: 0n
    case PublishFinal{}: 0n
    case ReplayFinal{}: 0n
    case StopByUser{}: 0n
    case NoEffect{}: 0n
    case Reject{}: 0n

def stops(e: Effect) -> Bool:
  match e:
    case StopByUser{}: True{}
    case PrepareSurface{}: False{}
    case SendPrompt{}: False{}
    case ObserveOnly{}: False{}
    case PublishFinal{}: False{}
    case ReplayFinal{}: False{}
    case NoEffect{}: False{}
    case Reject{}: False{}
