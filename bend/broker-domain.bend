import Base

# One durable logical owner. An activity is a lease covering a complete incoming
# MCP request; an invocation is the independently acknowledged native tool call.
# Completion is a compare-and-seal operation over BOTH sets of obligations.
type Lifetime is Data:
  Open{}
  Sealed{revision: Nat}
  Retired{}

type Activity is Data:
  Activity{id: String, completed: Bool}

type Delivery is Data:
  Queued{}
  Delivered{}
  Result{digest: String}

type Invocation is Data:
  Invocation{id: String, payload: String, delivery: Delivery}

type State is Data:
  Broker{lifetime: Lifetime, environment: String, revision: Nat,
         activities: List<&2, Activity>, invocations: List<&2, Invocation>}

type Event is Data:
  ClaimActivity{id: String}
  CompleteActivity{id: String}
  Enqueue{id: String, payload: String}
  Poll{}
  CompleteCall{id: String, digest: String}
  BeginFence{}
  CommitFence{revision: Nat}
  CheckEnvironment{environment: String}
  Retire{}

type Rejection is Data:
  OwnerClosed{}
  ActivityAlreadyCompleted{}
  DuplicateInvocation{}
  CallNotPending{}
  CallNotDelivered{}
  ConflictingResult{}
  EnvironmentChanged{}

type Effect is Data:
  ActivityClaimed{}
  ActivityReplayed{}
  ActivityClosed{was_active: Bool}
  ActivityReceiptReplayed{}
  InvocationQueued{}
  CallsDelivered{ids: List<&2, String>}
  CallsReplayed{ids: List<&2, String>}
  WaitForCalls{}
  ResultAccepted{}
  ResultReplayed{}
  FenceOffered{revision: Nat}
  FenceUnavailable{}
  FenceCommitted{}
  FenceStale{}
  EnvironmentAccepted{}
  OwnerRetired{}
  RetirementReplayed{}
  LateActivityReceipt{}
  Reject{reason: Rejection}

type Decision is Data:
  Decision{state: State, effect: Effect}

def state(d: Decision) -> State:
  match d:
    case Decision{s, e}: s

def effect(d: Decision) -> Effect:
  match d:
    case Decision{s, e}: e

def lifetime(s: State) -> Lifetime:
  match s:
    case Broker{lifetime, environment, revision, activities, invocations}: lifetime

def revision(s: State) -> Nat:
  match s:
    case Broker{lifetime, environment, revision, activities, invocations}: revision

def replace_lifetime(s: State, lifetime: Lifetime) -> State:
  match s:
    case Broker{old, environment, revision, activities, invocations}:
      Broker{lifetime, environment, revision, activities, invocations}

def invocation_id(invocation: Invocation) -> String:
  match invocation:
    case Invocation{id, payload, delivery}: id

def invocation_delivery(invocation: Invocation) -> Delivery:
  match invocation:
    case Invocation{id, payload, delivery}: delivery
