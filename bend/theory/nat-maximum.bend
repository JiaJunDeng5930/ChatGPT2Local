import Base

# The pinned backend optimizes Nat.cmp but not the recursive Base Nat.max.
# Real epoch-millisecond inputs therefore need the comparison implementation;
# its equality to the ordinary natural-number maximum is proved here.
def choose(order: Cmp, left: Nat, right: Nat) -> Nat:
  match order:
    case LT{}: right
    case EQ{}: left
    case GT{}: left

def maximum(+left: Nat, +right: Nat) -> Nat:
  choose(Nat.cmp(left, right), left, right)

def choose_successor(order: Cmp, left: Nat, right: Nat) ->
  {choose(order, 1n+left, 1n+right) == 1n+choose(order, left, right) : Nat}:
  match order:
    case LT{}: {==}
    case EQ{}: {==}
    case GT{}: {==}

def refinement(a: Nat, b: Nat) -> {maximum(a, b) == Nat.max(a, b) : Nat}:
  match a b:
    case 0n 0n: {==}
    case 0n 1n+bp: {==}
    case 1n+ap 0n: {==}
    case 1n+ap 1n+bp:
      +left = ap
      +right = bp
      %refinement(left, right) :
        {choose(Nat.cmp(left, right), 1n+left, 1n+right) == 1n+_ : Nat}
      choose_successor(Nat.cmp(left, right), left, right)
