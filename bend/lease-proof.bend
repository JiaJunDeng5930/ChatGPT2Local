import Base
import ./lease-domain.bend as D
import ./lease.bend as K
import ./lease-specification.bend as S
import ./lease-laws.bend as L

def L.admission_refinement(unknown, same_owner, owner_alive):
  match unknown same_owner owner_alive:
    case True{} _ _: {==}
    case False{} True{} _: {==}
    case False{} False{} True{}: {==}
    case False{} False{} False{}: {==}

def L.unknown_owner_cannot_be_reassigned(same_owner, owner_alive):
  {==}

def completed(retain: Bool, conversation: Bool, connector: Bool, bound: Bool) ->
  {K.completed(retain, conversation, connector, bound) == S.completed(retain, conversation, connector, bound) : D.Decision}:
  match retain conversation connector bound:
    case False{} _ _ _: {==}
    case True{} False{} _ _: {==}
    case True{} True{} False{} _: {==}
    case True{} True{} True{} False{}: {==}
    case True{} True{} True{} True{}: {==}

def L.refinement(report, surface_error, retain, conversation, connector, bound):
  match report surface_error:
    case D.UserCancelled{} _: {==}
    case D.Uncertain{} _: {==}
    case D.Completed{} True{}: {==}
    case D.Completed{} False{}: completed(retain, conversation, connector, bound)

def L.uncertainty_preserves_page(surface_error, retain, conversation, connector, bound):
  match surface_error:
    case False{}: {==}
    case True{}: {==}
