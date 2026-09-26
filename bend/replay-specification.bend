import Base
import ./replay-domain.bend as D
import ./theory/transition-system.bend as Trace

def append(terminal: Bool, valid: Bool, events: List<&2, D.Frame>, reasoning: List<&2, String>,
           next: List<&2, D.Frame>) -> D.Decision:
  match terminal valid:
    case False{} True{}:
      D.Decision{D.Journal{D.Open{}, List.append(&2, D.Frame, events, next), reasoning}, D.Appended{}}
    case False{} False{}: D.Decision{D.Journal{D.Open{}, events, reasoning}, D.Reject{D.TerminalNotLast{}}}
    case True{} _: D.Decision{D.Journal{D.Open{}, events, reasoning}, D.Reject{D.TerminalAlreadyPresent{}}}

def reason(terminal: Bool, events: List<&2, D.Frame>, reasoning: List<&2, String>, parts: List<&2, String>) -> D.Decision:
  match terminal:
    case False{}: D.Decision{D.Journal{D.Open{}, events, List.append(&2, String, reasoning, parts)}, D.ReasonRecorded{}}
    case True{}: D.Decision{D.Journal{D.Open{}, events, reasoning}, D.Reject{D.TerminalAlreadyPresent{}}}

def append_command(state: D.State, +next: List<&2, D.Frame>) -> D.Decision:
  match state:
    case D.Journal{D.Open{}, +events, reasoning}: append(D.has_terminal(events), D.well_formed(next), events, reasoning, next)
    case D.Journal{status, events, reasoning}: D.Decision{D.Journal{status, events, reasoning}, D.Reject{D.JournalClosed{}}}

def reason_command(state: D.State, parts: List<&2, String>) -> D.Decision:
  match state:
    case D.Journal{D.Open{}, +events, reasoning}: reason(D.has_terminal(events), events, reasoning, parts)
    case D.Journal{status, events, reasoning}: D.Decision{D.Journal{status, events, reasoning}, D.Reject{D.JournalClosed{}}}

def seal_command(state: D.State) -> D.Decision:
  match state:
    case D.Journal{D.Open{}, events, reasoning}: D.Decision{D.Journal{D.Sealed{}, events, reasoning}, D.Closed{}}
    case D.Journal{status, events, reasoning}: D.Decision{D.Journal{status, events, reasoning}, D.CloseReplayed{}}

def failure(equal: Bool, state: D.State) -> D.Decision:
  match equal:
    case False{}: D.Decision{state, D.Reject{D.ConflictingFailure{}}}
    case True{}: D.Decision{state, D.FailureReplayed{}}

def fail_command(state: D.State, next: String) -> D.Decision:
  match state:
    case D.Journal{D.Open{}, events, reasoning}: D.Decision{D.Journal{D.Failed{next}, events, reasoning}, D.FailureRecorded{}}
    case D.Journal{D.Sealed{}, events, reasoning}: D.Decision{D.Journal{D.Sealed{}, events, reasoning}, D.Reject{D.JournalClosed{}}}
    case D.Journal{D.Failed{+previous}, events, reasoning}: failure(String.eq(previous, next), D.Journal{D.Failed{previous}, events, reasoning})

def step(state: D.State, event: D.Event) -> D.Decision:
  match event:
    case D.Append{events}: append_command(state, events)
    case D.Reason{parts}: reason_command(state, parts)
    case D.Seal{}: seal_command(state)
    case D.Fail{reason}: fail_command(state, reason)

def run(events: List<&2, D.Event>, state: D.State) -> List<&2, D.Decision>:
  Trace.run(~D.State, ~D.Event, ~D.Decision, ~step, ~D.state, events, state)
