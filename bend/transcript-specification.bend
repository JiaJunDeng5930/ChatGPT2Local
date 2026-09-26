import Base

# An ordinary transcript message can extend an already-running web response
# only as an assistant observation. Protocol records are a separate finite
# language. Neither a user nor a developer message is part of that language.
def admit(message: Bool, assistant: Bool, protocol: Bool) -> Bool:
  match message assistant protocol:
    case True{} True{} _: True{}
    case _ _ True{}: True{}
    case _ _ _: False{}

def matches(candidate: String, kind: String) -> Bool:
  String.eq(kind, candidate)

def protocol(kind: String) -> Bool:
  List.contains(~String, ~matches,
    Con{"reasoning", Con{"function_call", Con{"custom_tool_call", Con{"tool_search_call",
      Con{"function_call_output", Con{"custom_tool_call_output", Con{"tool_search_output", Nil{}}}}}}}}, kind)

def round_item(+kind: String, role: String) -> Bool:
  admit(String.eq(kind, "message"), String.eq(role, "assistant"), protocol(kind))
