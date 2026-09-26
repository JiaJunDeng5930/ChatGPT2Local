import Base

# Independent positive-evidence requirements: all page, lineage and answer facts
# must agree before history can be omitted from a later browser prompt.
import ./surface-domain.bend as D

def resume(evidence: D.Evidence) -> Bool:
  match evidence:
    case D.Evidence{present, untouched, idle, tail, old_key, key, old_operation, operation, +old_answer, expected, answer}:
      Bool.and(present, Bool.and(untouched, Bool.and(idle, Bool.and(tail,
        Bool.and(String.eq(old_key, key),
          Bool.and(String.eq(old_operation, operation),
            Bool.and(String.eq(old_answer, expected), String.eq(old_answer, answer))))))))
