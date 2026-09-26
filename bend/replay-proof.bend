import Base
import ./replay-domain.bend as D
import ./replay.bend as K
import ./replay-specification.bend as S
import ./replay-laws.bend as L
import ./theory/transition-system.bend as Trace

def append_refinement(terminal: Bool, valid: Bool, events: List<&2, D.Frame>, reasoning: List<&2, String>, next: List<&2, D.Frame>) ->
  {K.append(terminal, valid, events, reasoning, next) == S.append(terminal, valid, events, reasoning, next) : D.Decision}:
  match terminal valid:
    case True{} True{}: {==}
    case True{} False{}: {==}
    case False{} True{}: {==}
    case False{} False{}: {==}

def reason_refinement(terminal: Bool, events: List<&2, D.Frame>, reasoning: List<&2, String>, parts: List<&2, String>) ->
  {K.reason(terminal, events, reasoning, parts) == S.reason(terminal, events, reasoning, parts) : D.Decision}:
  match terminal:
    case True{}: {==}
    case False{}: {==}

def failure_refinement(equal: Bool, state: D.State) ->
  {K.failure(equal, state) == S.failure(equal, state) : D.Decision}:
  match equal:
    case True{}: {==}
    case False{}: {==}

def L.transition_refinement(state, event):
  match state:
    case D.Journal{D.Open{}, +events, reasoning}:
      match event:
        case D.Append{+next}: append_refinement(D.has_terminal(events), D.well_formed(next), events, reasoning, next)
        case D.Reason{parts}: reason_refinement(D.has_terminal(events), events, reasoning, parts)
        case D.Seal{}: {==}
        case D.Fail{reason}: {==}
    case D.Journal{D.Sealed{}, events, reasoning}:
      match event:
        case D.Append{next}: {==}
        case D.Reason{parts}: {==}
        case D.Seal{}: {==}
        case D.Fail{reason}: {==}
    case D.Journal{D.Failed{+error}, events, reasoning}:
      match event:
        case D.Append{next}: {==}
        case D.Reason{parts}: {==}
        case D.Seal{}: {==}
        case D.Fail{next}: failure_refinement(String.eq(error, next), D.Journal{D.Failed{error}, events, reasoning})

def L.trace_refinement(events, state):
  Trace.refinement(~D.State, ~D.Event, ~D.Decision, ~K.step, ~S.step, ~D.state, ~L.transition_refinement, events, state)

def L.sealed_payload_cannot_be_changed(events, reasoning, event):
  match event:
    case D.Append{next}: {==}
    case D.Reason{parts}: {==}
    case D.Seal{}: {==}
    case D.Fail{reason}: {==}

def L.rejected_append_is_atomic(events, reasoning, next):
  {==}

def L.append_preserves_event_order(events, reasoning, next):
  {==}

def L.failure_does_not_erase_observed_events(events, reasoning, reason):
  {==}
