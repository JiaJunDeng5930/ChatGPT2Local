import Base

# Observations carry no send, retry, navigation or cancellation capability.
# A CandidateReady output is only a request to recheck the external completion
# fence; it is not itself permission to retire a browser turn or a tool broker.
type Facts is Data:
  Facts{present: Bool, running: Bool, has_text: Bool, completion_control: Bool,
        reply_error: Bool, stopped_badge: Bool, tools_in_flight: Bool}

type State is Data:
  Watching{revision: Nat, baseline: Maybe<&2, String>}
  Candidate{revision: Nat, baseline: Maybe<&2, String>, signature: String, since: Nat}

type Event is Data:
  Sample{facts: Facts, text: String, signature: String, now: Nat, stable_ms: Nat}
  CaptureBoundary{revision: Nat, text: String}
  Uncertain{}

type Effect is Data:
  ObserveOnly{}
  WaitForTools{}
  WaitForPostToolAnswer{}
  CandidateReady{}
  BoundaryCaptured{}
  DuplicateBoundary{}
  RejectBoundary{}

type Decision is Data:
  Decision{state: State, effect: Effect}

def state(d: Decision) -> State:
  match d:
    case Decision{s, e}: s

def effect(d: Decision) -> Effect:
  match d:
    case Decision{s, e}: e

def baseline_matches(baseline: Maybe<&2, String>, text: String) -> Bool:
  match baseline:
    case None{}: False{}
    case Some{previous}: String.eq(previous, text)

def revision(s: State) -> Nat:
  match s:
    case Watching{revision, baseline}: revision
    case Candidate{revision, baseline, signature, since}: revision

def baseline(s: State) -> Maybe<&2, String>:
  match s:
    case Watching{revision, baseline}: baseline
    case Candidate{revision, baseline, signature, since}: baseline

def waiting(s: State) -> State:
  match s:
    case Watching{revision, baseline}: Watching{revision, baseline}
    case Candidate{revision, baseline, signature, since}: Watching{revision, baseline}

def has_tools(f: Facts) -> Bool:
  match f:
    case Facts{present, running, text, control, error, stopped, tools}: tools
