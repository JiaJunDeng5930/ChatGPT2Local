import Base
import ./history-domain.bend as D
import ./history.bend as H
import ./history-specification.bend as S

law plan_refinement:
  for old_environment: String
  for environment: String
  for known: List<&2, String>
  for incoming: List<&2, String>
  {H.plan(old_environment, environment, known, incoming) ==
   S.plan(old_environment, environment, known, incoming) : Maybe<&2, Nat>}

law selection_refinement:
  for receipts: List<&2, D.Receipt>
  for environment: String
  for incoming: List<&2, String>
  for length: Nat
  {H.select(receipts, environment, incoming, length) ==
   S.select(receipts, environment, incoming, length) : D.Selection}

law wrong_environment_cannot_supply_an_offset:
  for known: List<&2, String>
  for incoming: List<&2, String>
  {H.with_envelope(False{}, H.reconcile(known, incoming)) == None{} : Maybe<&2, Nat>}

law empty_prefix_cannot_select_a_page:
  for key: String
  for length: Nat
  {H.candidate(Some{0n}, key, length) == D.NewConversation{} : D.Selection}
