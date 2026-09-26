import Base

# Progress is evidence about native calls, never authority to stop a web page.
type Role is Data:
  Recorder{}
  Replica{}

type Snapshot is Data:
  Snapshot{revision: Nat, batch: Nat, active: Nat, time: Maybe<&2, Nat>}

type State is Data:
  Progress{role: Role, snapshot: Snapshot, observed: Nat, batches: List<&2, Nat>, retired: Bool}

type Event is Data:
  RecordBatch{count: Nat, now: Nat}
  RecordResult{now: Nat}
  CheckBatch{revision: Nat}
  Acknowledge{revision: Nat}
  Import{snapshot: Snapshot}
  Retire{}

type Rejection is Data:
  WrongRole{}
  EmptyBatch{}
  NoPendingCall{}
  InvalidBatch{}
  InvalidSnapshot{}
  RegressedSnapshot{}
  ConflictingSnapshot{}
  OwnerRetired{}

type Effect is Data:
  ProgressChanged{}
  ObservationNeeded{}
  ObservationKnown{}
  ObservationCommitted{}
  ObservationReplayed{}
  FrameIgnored{}
  OwnerClosed{}
  RetirementReplayed{}
  Reject{reason: Rejection}

type Decision is Data:
  Decision{state: State, effect: Effect}

def state(decision: Decision) -> State:
  match decision:
    case Decision{state, effect}: state

def effect(decision: Decision) -> Effect:
  match decision:
    case Decision{state, effect}: effect

def snapshot(state: State) -> Snapshot:
  match state:
    case Progress{role, snapshot, observed, batches, retired}: snapshot

def observed(state: State) -> Nat:
  match state:
    case Progress{role, snapshot, observed, batches, retired}: observed

def time(snapshot: Snapshot) -> Maybe<&2, Nat>:
  match snapshot:
    case Snapshot{revision, batch, active, time}: time

def revision(snapshot: Snapshot) -> Nat:
  match snapshot:
    case Snapshot{revision, batch, active, time}: revision

# Membership is only a finite-list query; it does not decide who may acknowledge.
def member(+revision: Nat, batches: List<&2, Nat>) -> Bool:
  match batches:
    case Nil{}: False{}
    case Con{head, rest}: Bool.or(Nat.is_eq(revision, head), member(revision, rest))
