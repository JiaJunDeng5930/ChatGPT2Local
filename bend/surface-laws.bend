import Base
import ./surface-domain.bend as D
import ./surface.bend as K
import ./surface-specification.bend as S

law evidence_refinement:
  for evidence: D.Evidence
  {K.resume(evidence) == S.resume(evidence) : Bool}
