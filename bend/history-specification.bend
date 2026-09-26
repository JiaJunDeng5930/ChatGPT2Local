import Base

# Standard prefix relation on words, using exact equality of message symbols.
def prefix(known: List<&2, String>, incoming: List<&2, String>) -> Bool:
  match known incoming:
    case Nil{} _: True{}
    case Con{h, t} Nil{}: False{}
    case Con{h, t} Con{a, b}:
      Bool.and(String.eq(h, a), prefix(t, b))

def size(xs: List<&2, String>) -> Nat:
  match xs:
    case Nil{}: 0n
    case Con{h, t}: 1n+size(t)

def choose(ok: Bool, n: Nat) -> Maybe<&2, Nat>:
  match ok:
    case False{}: None{}
    case True{}: Some{n}

def reconcile(+known: List<&2, String>, incoming: List<&2, String>) -> Maybe<&2, Nat>:
  choose(prefix(known, incoming), size(known))
