import Base
import ./routing-domain.bend as D
import ./routing.bend as R
import ./routing-specification.bend as S

law refinement:
  for state: D.Phase
  for event: D.Event
  {R.step(state, event) == S.step(event, state) : D.Decision}

law recovery_never_forwards:
  for state: D.Phase
  {D.calls(D.effect(R.step(state, D.Recover{}))) == 0n : Nat}

law duplicates_never_forward:
  for effort: D.Effort
  for lease: Maybe<&2, D.Effort>
  {D.calls(D.effect(R.step(D.Sending{effort}, D.Begin{lease}))) == 0n : Nat}

law effort_roundtrip:
  for effort: D.Effort
  {D.decode(D.name(effort)) == Some{effort} : Maybe<&2, D.Effort>}

law lease_refinement:
  for cache: D.Cache
  for environment: String
  for history: List<&2, String>
  {R.choose(cache, environment, history) == S.choose(cache, environment, history) : D.Choice}
