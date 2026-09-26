import Base

# API rounds inside one browser response may only extend the acknowledged
# transcript with model observations and tool protocol records. A new human or
# developer instruction was not sent to that browser and cannot be credited as
# retained history merely because it arrived under the same outer turn id.
def round_item(+kind: String, role: String) -> Bool:
  Bool.or(
    Bool.and(String.eq(kind, "message"), String.eq(role, "assistant")),
    Bool.or(String.eq(kind, "reasoning"),
      Bool.or(String.eq(kind, "function_call"),
        Bool.or(String.eq(kind, "custom_tool_call"),
          Bool.or(String.eq(kind, "tool_search_call"),
            Bool.or(String.eq(kind, "function_call_output"),
              Bool.or(String.eq(kind, "custom_tool_call_output"), String.eq(kind, "tool_search_output"))))))))
