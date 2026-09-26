import Base
import ./history.bend as H
import ./history-specification.bend as S
import ./LAWS.bend as L

def bump_choose(a: Bool, b: Bool, n: Nat) ->
  {H.bump(a, S.choose(b, n)) == S.choose(Bool.and(a, b), 1n+n) : Maybe<&2, Nat>}:
  match a b:
    case False{} False{}: {==}
    case False{} True{}: {==}
    case True{} False{}: {==}
    case True{} True{}: {==}

def L.history_refinement(known, incoming):
  match known incoming:
    case Nil{} _: {==}
    case Con{h, t} Nil{}: {==}
    case Con{+h, +t} Con{+a, +b}:
      %bump_choose(String.eq(h, a), S.prefix(t, b), S.size(t)) :
        {H.bump(String.eq(h, a), H.reconcile(t, b)) == _ : Maybe<&2, Nat>}
      %L.history_refinement(t, b) :
        {H.bump(String.eq(h, a), H.reconcile(t, b)) == H.bump(String.eq(h, a), _) : Maybe<&2, Nat>}
      {==}
