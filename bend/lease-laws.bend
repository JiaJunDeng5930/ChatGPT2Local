import Base
import ./lease-domain.bend as D
import ./lease.bend as K
import ./lease-specification.bend as S

law admission_refinement:
  for unknown: Bool
  for same_owner: Bool
  for owner_alive: Bool
  {K.attach(unknown, same_owner, owner_alive) == S.attach(unknown, same_owner, owner_alive) : D.Admission}

law unknown_owner_cannot_be_reassigned:
  for same_owner: Bool
  for owner_alive: Bool
  {K.attach(True{}, same_owner, owner_alive) == D.OwnerUnknown{} : D.Admission}

law refinement:
  for report: D.Report
  for surface_error: Bool
  for retain: Bool
  for conversation: Bool
  for connector: Bool
  for bound: Bool
  {K.finish(report, surface_error, retain, conversation, connector, bound) ==
   S.finish(report, surface_error, retain, conversation, connector, bound) : D.Decision}

law uncertainty_preserves_page:
  for surface_error: Bool
  for retain: Bool
  for conversation: Bool
  for connector: Bool
  for bound: Bool
  {K.finish(D.Uncertain{}, surface_error, retain, conversation, connector, bound) ==
   D.Decision{D.Unknown{}, False{}, True{}} : D.Decision}
