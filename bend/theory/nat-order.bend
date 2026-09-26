import Base

# Elementary natural-order theory. The application supplies a potential; it
# does not reproach every finite execution by enumerating a chosen trace bound.
def truth(b: Bool) -> Data:
  match b:
    case False{}: Empty
    case True{}: Unit

def contradiction(e: {False{} == True{} : Bool}) -> Empty:
  %Equal.sym(Bool, False{}, True{}, e) : truth(_)
  Unit{}

def zero_le(n: Nat) -> {Nat.is_le(0n, n) == True{} : Bool}:
  match n:
    case 0n: {==}
    case 1n+p: {==}

def reflexive(n: Nat) -> {Nat.is_le(n, n) == True{} : Bool}:
  match n:
    case 0n: {==}
    case 1n+p: reflexive(p)

def successor(n: Nat) -> {Nat.is_le(n, 1n+n) == True{} : Bool}:
  match n:
    case 0n: {==}
    case 1n+p: successor(p)

def transitive(a: Nat, b: Nat, c: Nat,
               ab: {Nat.is_le(a, b) == True{} : Bool},
               bc: {Nat.is_le(b, c) == True{} : Bool}) ->
  {Nat.is_le(a, c) == True{} : Bool}:
  match a b c:
    case 0n _ _: zero_le(c)
    case 1n+ap 0n _:
      Empty.absurd({Nat.is_le(1n+ap, c) == True{} : Bool}, contradiction(ab))
    case 1n+ap 1n+bp 0n:
      Empty.absurd({Nat.is_le(1n+ap, 0n) == True{} : Bool}, contradiction(bc))
    case 1n+ap 1n+bp 1n+cp: transitive(ap, bp, cp, ab, bc)

def add_monotone_left(k: Nat, a: Nat, b: Nat,
                      ab: {Nat.is_le(a, b) == True{} : Bool}) ->
  {Nat.is_le(Nat.add(k, a), Nat.add(k, b)) == True{} : Bool}:
  match k:
    case 0n: ab
    case 1n+p: add_monotone_left(p, a, b, ab)

def equality_symmetric(a: Nat, b: Nat) -> {Nat.is_eq(a, b) == Nat.is_eq(b, a) : Bool}:
  match a b:
    case 0n 0n: {==}
    case 0n 1n+bp: {==}
    case 1n+ap 0n: {==}
    case 1n+ap 1n+bp: equality_symmetric(ap, bp)
