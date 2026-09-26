import Base
import ./replay-domain.bend as D
import ./theory/transition-system.bend as Trace

def initialize() -> D.State:
  D.Journal{D.Open{}, Nil{}, Nil{}}

def append(terminal: Bool, valid: Bool, +events: List<&2, D.Frame>, +reasoning: List<&2, String>,
           next: List<&2, D.Frame>) -> D.Decision:
  match terminal valid:
    case True{} _: D.Decision{D.Journal{D.Open{}, events, reasoning}, D.Reject{D.TerminalAlreadyPresent{}}}
    case False{} False{}: D.Decision{D.Journal{D.Open{}, events, reasoning}, D.Reject{D.TerminalNotLast{}}}
    case False{} True{}:
      D.Decision{D.Journal{D.Open{}, List.append(&2, D.Frame, events, next), reasoning}, D.Appended{}}

def reason(terminal: Bool, events: List<&2, D.Frame>, +reasoning: List<&2, String>, parts: List<&2, String>) -> D.Decision:
  match terminal:
    case True{}: D.Decision{D.Journal{D.Open{}, events, reasoning}, D.Reject{D.TerminalAlreadyPresent{}}}
    case False{}: D.Decision{D.Journal{D.Open{}, events, List.append(&2, String, reasoning, parts)}, D.ReasonRecorded{}}

def open_step(+events: List<&2, D.Frame>, reasoning: List<&2, String>, event: D.Event) -> D.Decision:
  match event:
    case D.Append{+next}: append(D.has_terminal(events), D.well_formed(next), events, reasoning, next)
    case D.Reason{parts}: reason(D.has_terminal(events), events, reasoning, parts)
    case D.Seal{}: D.Decision{D.Journal{D.Sealed{}, events, reasoning}, D.Closed{}}
    case D.Fail{error}: D.Decision{D.Journal{D.Failed{error}, events, reasoning}, D.FailureRecorded{}}

def failure(equal: Bool, state: D.State) -> D.Decision:
  match equal:
    case True{}: D.Decision{state, D.FailureReplayed{}}
    case False{}: D.Decision{state, D.Reject{D.ConflictingFailure{}}}

def closed_step(status: D.Status, events: List<&2, D.Frame>, reasoning: List<&2, String>, event: D.Event) -> D.Decision:
  match status:
    case D.Sealed{}:
      match event:
        case D.Seal{}: D.Decision{D.Journal{D.Sealed{}, events, reasoning}, D.CloseReplayed{}}
        case _: D.Decision{D.Journal{D.Sealed{}, events, reasoning}, D.Reject{D.JournalClosed{}}}
    case D.Failed{+error}:
      match event:
        case D.Seal{}: D.Decision{D.Journal{D.Failed{error}, events, reasoning}, D.CloseReplayed{}}
        case D.Fail{next}: failure(String.eq(error, next), D.Journal{D.Failed{error}, events, reasoning})
        case _: D.Decision{D.Journal{D.Failed{error}, events, reasoning}, D.Reject{D.JournalClosed{}}}
    case D.Open{}: open_step(events, reasoning, event)

def step(state: D.State, event: D.Event) -> D.Decision:
  match state:
    case D.Journal{status, events, reasoning}: closed_step(status, events, reasoning, event)

def run(events: List<&2, D.Event>, state: D.State) -> List<&2, D.Decision>:
  Trace.run(~D.State, ~D.Event, ~D.Decision, ~step, ~D.state, events, state)
