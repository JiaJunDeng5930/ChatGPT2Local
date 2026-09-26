import Base
import ./lease-domain.bend as D

def attach(unknown: Bool, same_owner: Bool, owner_alive: Bool) -> D.Admission:
  match unknown:
    case True{}: D.OwnerUnknown{}
    case False{}:
      match same_owner:
        case True{}: D.Reattach{}
        case False{}:
          match owner_alive:
            case True{}: D.OwnerBusy{}
            case False{}: D.OwnerUnknown{}

# Positive completion evidence permits releasing the running-page protection.
# Only explicit cancellation has cancellation semantics. Every other report
# preserves the page, denies reuse, and keeps it awake for manual reconciliation.
def completed(retain: Bool, conversation: Bool, connector: Bool, bound: Bool) -> D.Decision:
  D.Decision{D.Ready{}, Bool.and(retain, Bool.and(conversation, Bool.or(Bool.not(connector), bound))), False{}}

def finish(report: D.Report, surface_error: Bool, retain: Bool,
           conversation: Bool, connector: Bool, bound: Bool) -> D.Decision:
  match report:
    case D.UserCancelled{}: D.Decision{D.Cancelled{}, False{}, False{}}
    case D.Uncertain{}: D.Decision{D.Unknown{}, False{}, True{}}
    case D.Completed{}:
      match surface_error:
        case True{}: D.Decision{D.Unknown{}, False{}, True{}}
        case False{}: completed(retain, conversation, connector, bound)
