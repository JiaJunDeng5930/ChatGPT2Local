import Base
import ./history-domain.bend as D

# Standard prefix relation on words, using exact equality of message symbols.
def prefix(known: List<&2, String>, incoming: List<&2, String>) -> Bool:
  match known incoming:
    case Nil{} _: True{}
    case Con{h, t} Nil{}: False{}
    case Con{h, t} Con{a, b}:
      Bool.and(String.eq(h, a), prefix(t, b))

def choose(ok: Bool, n: Nat) -> Maybe<&2, Nat>:
  match ok:
    case False{}: None{}
    case True{}: Some{n}

def reconcile(+known: List<&2, String>, incoming: List<&2, String>) -> Maybe<&2, Nat>:
  choose(prefix(known, incoming), List.length(&2, String, known))

def plan(old_environment: String, environment: String,
         +known: List<&2, String>, incoming: List<&2, String>) -> Maybe<&2, Nat>:
  choose(Bool.and(String.eq(old_environment, environment), prefix(known, incoming)),
    List.length(&2, String, known))

# Eligibility is the conjunction of environment identity, the prefix relation,
# and a nonempty proper prefix. It is independent of the implementation's
# optional-offset traversal and does not consult any implementation cache.
def admit(valid: Bool, key: String, offset: Nat) -> D.Selection:
  match valid:
    case False{}: D.NewConversation{}
    case True{}: D.ReuseConversation{key, offset}

def allowed(environment_matches: Bool, is_prefix: Bool, key: String,
            +offset: Nat, length: Nat) -> D.Selection:
  admit(Bool.and(environment_matches, Bool.and(is_prefix,
    Bool.and(Nat.is_gt(offset, 0n), Nat.is_lt(offset, length)))), key, offset)

def rank(longer: Bool, equal_length: Bool, earlier_key: Bool,
         left: D.Selection, right: D.Selection) -> D.Selection:
  match longer equal_length earlier_key:
    case True{} _ _: left
    case False{} True{} True{}: left
    case _ _ _: right

def best(left: D.Selection, right: D.Selection) -> D.Selection:
  match left right:
    case D.NewConversation{} _: right
    case D.ReuseConversation{k, n} D.NewConversation{}: D.ReuseConversation{k, n}
    case D.ReuseConversation{+a, +n} D.ReuseConversation{+b, +m}:
      rank(Nat.is_gt(n, m), Nat.is_eq(n, m), String.is_le(a, b),
        D.ReuseConversation{a, n}, D.ReuseConversation{b, m})

def accumulate(environment: String, +incoming: List<&2, String>, length: Nat,
               receipt: D.Receipt, rest: D.Selection) -> D.Selection:
  match receipt:
    case D.Receipt{key, old_environment, +known}:
      best(allowed(String.eq(old_environment, environment), prefix(known, incoming),
        key, List.length(&2, String, known), length), rest)

# Base's finite right fold selects the longest eligible receipt, with stable
# identity ordering for ties. The project adds no parallel list/fold theory.
def empty(environment: String, incoming: List<&2, String>, length: Nat) -> D.Selection:
  D.NewConversation{}

def fold_receipt(receipt: D.Receipt,
                 next: String -> List<&2, String> -> Nat -> D.Selection,
                 environment: String, incoming: List<&2, String>, length: Nat) -> D.Selection:
  +env = environment
  +messages = incoming
  +count = length
  accumulate(env, messages, count, receipt, next(env, messages, count))

def select(receipts: List<&2, D.Receipt>, +environment: String,
           +incoming: List<&2, String>, +length: Nat) -> D.Selection:
  List.foldr(~&2, ~D.Receipt, ~(String -> List<&2, String> -> Nat -> D.Selection),
    ~fold_receipt, receipts, empty)(environment, incoming, length)
