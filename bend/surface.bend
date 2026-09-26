import Base

# A receipt is not a live page. Reuse requires a same-document lineage witness,
# no off-lease interaction, an idle assistant tail, and the exact observed final
# answer. Missing evidence denies reuse; it never authorizes a replacement send.
import ./surface-domain.bend as D

def authorized(present: Bool, untouched: Bool, idle: Bool, tail: Bool,
               key_matches: Bool, operation_matches: Bool, receipt_matches: Bool, live_matches: Bool) -> Bool:
  match present untouched idle tail key_matches operation_matches receipt_matches live_matches:
    case True{} True{} True{} True{} True{} True{} True{} True{}: True{}
    case _ _ _ _ _ _ _ _: False{}

def resume(evidence: D.Evidence) -> Bool:
  match evidence:
    case D.Evidence{present, untouched, idle, tail, old_key, key, old_operation, operation, +old_answer, expected, answer}:
      authorized(present, untouched, idle, tail,
        String.eq(old_key, key), String.eq(old_operation, operation),
        String.eq(old_answer, expected), String.eq(old_answer, answer))
