import Base
import ./transcript.bend as T
import ./transcript-specification.bend as S
import ./transcript-laws.bend as L

def admission(message: Bool, assistant: Bool, protocol: Bool) ->
  {Bool.or(Bool.and(message, assistant), protocol) == S.admit(message, assistant, protocol) : Bool}:
  match message assistant protocol:
    case True{} True{} True{}: {==}
    case True{} True{} False{}: {==}
    case True{} False{} True{}: {==}
    case True{} False{} False{}: {==}
    case False{} True{} True{}: {==}
    case False{} True{} False{}: {==}
    case False{} False{} True{}: {==}
    case False{} False{} False{}: {==}

def L.refinement(kind, role):
  +tag = kind
  admission(String.eq(tag, "message"), String.eq(role, "assistant"), T.protocol_item(tag))

def L.user_instructions_are_not_observed_output(): {==}
def L.developer_instructions_are_not_observed_output(): {==}
def L.assistant_messages_are_observed_output(): {==}
