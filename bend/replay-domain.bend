import Base

type Frame is Data:
  Frame{kind: String, payload: String}

type Status is Data:
  Open{}
  Sealed{}
  Failed{reason: String}

type State is Data:
  Journal{status: Status, events: List<&2, Frame>, reasoning: List<&2, String>}

type Event is Data:
  Append{events: List<&2, Frame>}
  Reason{parts: List<&2, String>}
  Seal{}
  Fail{reason: String}

type Rejection is Data:
  JournalClosed{}
  TerminalAlreadyPresent{}
  TerminalNotLast{}
  ConflictingFailure{}

type Effect is Data:
  Appended{}
  ReasonRecorded{}
  Closed{}
  CloseReplayed{}
  FailureRecorded{}
  FailureReplayed{}
  Reject{reason: Rejection}

type Decision is Data:
  Decision{state: State, effect: Effect}

def state(decision: Decision) -> State:
  match decision:
    case Decision{state, effect}: state

def terminal(+kind: String) -> Bool:
  Bool.or(String.eq(kind, "done"), Bool.or(String.eq(kind, "error"), String.eq(kind, "incomplete")))

def has_terminal(events: List<&2, Frame>) -> Bool:
  match events:
    case Nil{}: False{}
    case Con{Frame{kind, payload}, rest}: Bool.or(terminal(kind), has_terminal(rest))

def is_empty(events: List<&2, Frame>) -> Bool:
  match events:
    case Nil{}: True{}
    case Con{head, tail}: False{}

# A terminal frame may occur once, at the end. Validate the entire batch before
# committing it, including batches that arrive in one synchronous HTTP emission.
def well_formed(events: List<&2, Frame>) -> Bool:
  match events:
    case Nil{}: True{}
    case Con{Frame{kind, payload}, +rest}:
      Bool.and(Bool.or(Bool.not(terminal(kind)), is_empty(rest)), well_formed(rest))

def events(state: State) -> List<&2, Frame>:
  match state:
    case Journal{status, events, reasoning}: events

def reasoning(state: State) -> List<&2, String>:
  match state:
    case Journal{status, events, reasoning}: reasoning

def status(state: State) -> Status:
  match state:
    case Journal{status, events, reasoning}: status

def closed(status: Status) -> Bool:
  match status:
    case Open{}: False{}
    case Sealed{}: True{}
    case Failed{reason}: True{}
