import Base
import ./surface-domain.bend as D
import ./surface.bend as K
import ./surface-specification.bend as S
import ./surface-laws.bend as L

def conjunction(present: Bool, untouched: Bool, idle: Bool, tail: Bool,
                key: Bool, operation: Bool, receipt: Bool, live: Bool) ->
  {K.authorized(present, untouched, idle, tail, key, operation, receipt, live) ==
   Bool.and(present, Bool.and(untouched, Bool.and(idle, Bool.and(tail,
     Bool.and(key, Bool.and(operation, Bool.and(receipt, live))))))) : Bool}:
  match present untouched idle tail key operation receipt live:
    case False{} _ _ _ _ _ _ _: {==}
    case True{} False{} _ _ _ _ _ _: {==}
    case True{} True{} False{} _ _ _ _ _: {==}
    case True{} True{} True{} False{} _ _ _ _: {==}
    case True{} True{} True{} True{} False{} _ _ _: {==}
    case True{} True{} True{} True{} True{} False{} _ _: {==}
    case True{} True{} True{} True{} True{} True{} False{} _: {==}
    case True{} True{} True{} True{} True{} True{} True{} False{}: {==}
    case True{} True{} True{} True{} True{} True{} True{} True{}: {==}

def L.evidence_refinement(evidence):
  match evidence:
    case D.Evidence{present, untouched, idle, tail, old_key, key, old_operation, operation, +old_answer, expected, answer}:
      conjunction(present, untouched, idle, tail,
        String.eq(old_key, key), String.eq(old_operation, operation),
        String.eq(old_answer, expected), String.eq(old_answer, answer))
