import Base
import ./request-domain.bend as D
import ./request.bend as K
import ./request-specification.bend as S

law admission_refinement:
  for key: D.Key
  for parent: D.Parent
  for input: D.Input
  {K.decide(key, parent, input) == S.decide(key, parent, input) : D.Admission}

law retry_replays:
  for parent: D.Parent
  for input: D.Input
  {K.decide(D.RepeatedKey{}, parent, input) == D.Replay{} : D.Admission}

law consumed_predecessor_rejects:
  for input: D.Input
  {K.decide(D.FreshKey{}, D.Claimed{}, input) == D.Denied{D.PreviousConsumed{}} : D.Admission}
