import Base
import ./lease-domain.bend as D

def attach(unknown: Bool, same_owner: Bool, owner_alive: Bool) -> D.Admission:
  match unknown same_owner owner_alive:
    case True{} _ _: D.OwnerUnknown{}
    case False{} True{} _: D.Reattach{}
    case False{} False{} True{}: D.OwnerBusy{}
    case False{} False{} False{}: D.OwnerUnknown{}

def completed(retain: Bool, conversation: Bool, connector: Bool, bound: Bool) -> D.Decision:
  match retain conversation connector bound:
    case True{} True{} False{} _: D.Decision{D.Ready{}, True{}, False{}}
    case True{} True{} True{} True{}: D.Decision{D.Ready{}, True{}, False{}}
    case _ _ _ _: D.Decision{D.Ready{}, False{}, False{}}

def finish(report: D.Report, surface_error: Bool, retain: Bool,
           conversation: Bool, connector: Bool, bound: Bool) -> D.Decision:
  match report surface_error:
    case D.UserCancelled{} _: D.Decision{D.Cancelled{}, False{}, False{}}
    case D.Uncertain{} _: D.Decision{D.Unknown{}, False{}, True{}}
    case D.Completed{} True{}: D.Decision{D.Unknown{}, False{}, True{}}
    case D.Completed{} False{}: completed(retain, conversation, connector, bound)
