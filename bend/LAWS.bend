import Base
import ./domain.bend as D
import ./kernel.bend as K
import ./specification.bend as S

law turn_refinement:
  for s: D.Phase
  for e: D.Event
  {K.step(s, e) == S.step(e, s) : D.Decision}

law uncertainty_never_sends:
  for s: D.Phase
  {D.sends(D.effect(K.step(s, D.Uncertain{}))) == 0n : Nat}

law uncertainty_never_stops:
  for s: D.Phase
  {D.stops(D.effect(K.step(s, D.Uncertain{}))) == False{} : Bool}

law detach_is_not_cancel:
  for s: D.Phase
  {K.step(s, D.Detach{}) == D.Decision{s, D.NoEffect{}} : D.Decision}

law recovery_is_observation:
  for s: D.Phase
  {D.sends(D.effect(K.step(s, D.Recover{}))) == 0n : Nat}

law recovery_is_idempotent:
  for s: D.Phase
  {D.phase(K.step(D.phase(K.step(s, D.Recover{})), D.Recover{})) == D.phase(K.step(s, D.Recover{})) : D.Phase}

# A transition cannot mint a send allowance. Cancellation may discard it.
law send_allowance:
  for s: D.Phase
  for e: D.Event
  {Nat.is_le(Nat.add(D.sends(D.effect(K.step(s, e))), D.allowance(D.phase(K.step(s, e)))), D.allowance(s)) == True{} : Bool}
