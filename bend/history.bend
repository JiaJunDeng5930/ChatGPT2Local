import Base

# Histories are ordered words of canonical semantic messages, not API round
# counts and not the index of the last assistant message. Only a confirmed
# prefix may be omitted from the next browser prompt.
def bump(equal: Bool, next: Maybe<&2, Nat>) -> Maybe<&2, Nat>:
  match equal next:
    case False{} _: None{}
    case True{} None{}: None{}
    case True{} Some{n}: Some{1n+n}

def reconcile(known: List<&2, String>, incoming: List<&2, String>) -> Maybe<&2, Nat>:
  match known incoming:
    case Nil{} _: Some{0n}
    case Con{h, t} Nil{}: None{}
    case Con{h, t} Con{a, b}:
      bump(String.eq(h, a), reconcile(t, b))

# Context outside the message sequence (instructions, model, tools, effort,
# compaction epoch) has its own exact identity. It must agree as well.
def with_envelope(equal: Bool, prefix: Maybe<&2, Nat>) -> Maybe<&2, Nat>:
  match equal:
    case True{}: prefix
    case False{}: None{}

def plan(known_environment: String, environment: String,
         known: List<&2, String>, incoming: List<&2, String>) -> Maybe<&2, Nat>:
  with_envelope(String.eq(known_environment, environment), reconcile(known, incoming))

type Receipt is Data:
  Receipt{key: String, environment: String, messages: List<&2, String>}

type Selection is Data:
  NewConversation{}
  ReuseConversation{key: String, offset: Nat}

# Choosing a receipt is a pure application decision. An exact but empty suffix
# is NOT a new browser turn: the operation journal owns such replay requests.
def eligible(valid: Bool, key: String, offset: Nat) -> Selection:
  match valid:
    case False{}: NewConversation{}
    case True{}: ReuseConversation{key, offset}

def candidate(offset: Maybe<&2, Nat>, key: String, length: Nat) -> Selection:
  match offset:
    case None{}: NewConversation{}
    case Some{+n}:
      eligible(Bool.and(Nat.is_gt(n, 0n), Nat.is_lt(n, length)), key, n)

def prefer(left: Bool, a: Selection, b: Selection) -> Selection:
  match left:
    case True{}: a
    case False{}: b

def longer(a: Selection, b: Selection) -> Selection:
  match a b:
    case NewConversation{} _: b
    case ReuseConversation{k, n} NewConversation{}: ReuseConversation{k, n}
    case ReuseConversation{+ka, +na} ReuseConversation{+kb, +nb}:
      prefer(Bool.or(Nat.is_gt(na, nb), Bool.and(Nat.is_eq(na, nb), String.is_le(ka, kb))),
        ReuseConversation{ka, na}, ReuseConversation{kb, nb})

def select(receipts: List<Receipt>, +environment: String,
           +incoming: List<&2, String>, +length: Nat) -> Selection:
  match receipts:
    case Nil{}: NewConversation{}
    case Con{Receipt{key, old_environment, known}, rest}:
      longer(candidate(plan(old_environment, environment, known, incoming), key, length),
        select(rest, environment, incoming, length))
