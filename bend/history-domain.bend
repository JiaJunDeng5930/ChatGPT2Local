import Base

# A selection key identifies one immutable completion receipt, not a webpage.
# Several receipts may refer to the same page at different points in its history.
type Receipt is Data:
  Receipt{key: String, environment: String, messages: List<&2, String>}

type Selection is Data:
  NewConversation{}
  ReuseConversation{key: String, offset: Nat}
