import Base
import ./transcript.bend as T
import ./transcript-specification.bend as S

law refinement:
  for kind: String
  for role: String
  {T.round_item(kind, role) == S.round_item(kind, role) : Bool}

law user_instructions_are_not_observed_output:
  {T.round_item("message", "user") == False{} : Bool}

law developer_instructions_are_not_observed_output:
  {T.round_item("message", "developer") == False{} : Bool}

law assistant_messages_are_observed_output:
  {T.round_item("message", "assistant") == True{} : Bool}
