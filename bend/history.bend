import Base
import ./history-domain.bend as D

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

# Choosing a receipt is a pure application decision. An exact but empty suffix
# is NOT a new browser turn: the operation journal owns such replay requests.
def eligible(valid: Bool, key: String, offset: Nat) -> D.Selection:
  match valid:
    case False{}: D.NewConversation{}
    case True{}: D.ReuseConversation{key, offset}

def candidate(offset: Maybe<&2, Nat>, key: String, length: Nat) -> D.Selection:
  match offset:
    case None{}: D.NewConversation{}
    case Some{+n}:
      eligible(Bool.and(Nat.is_gt(n, 0n), Nat.is_lt(n, length)), key, n)

def prefer(left: Bool, a: D.Selection, b: D.Selection) -> D.Selection:
  match left:
    case True{}: a
    case False{}: b

def longer(a: D.Selection, b: D.Selection) -> D.Selection:
  match a b:
    case D.NewConversation{} _: b
    case D.ReuseConversation{k, n} D.NewConversation{}: D.ReuseConversation{k, n}
    case D.ReuseConversation{+ka, +na} D.ReuseConversation{+kb, +nb}:
      prefer(Bool.or(Nat.is_gt(na, nb), Bool.and(Nat.is_eq(na, nb), String.is_le(ka, kb))),
        D.ReuseConversation{ka, na}, D.ReuseConversation{kb, nb})

def select(receipts: List<&2, D.Receipt>, +environment: String,
           +incoming: List<&2, String>, +length: Nat) -> D.Selection:
  match receipts:
    case Nil{}: D.NewConversation{}
    case Con{D.Receipt{key, old_environment, known}, rest}:
      longer(candidate(plan(old_environment, environment, known, incoming), key, length),
        select(rest, environment, incoming, length))
