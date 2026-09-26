import Base
import ./nat-order.bend as Order

# Deterministic Mealy transition systems over finite input words. Outputs may
# include the entire next state, all effects, replies, and error decisions.
def run(~S: Data, ~E: Data, ~O: Data,
        ~step: S -> E -> O, ~next: O -> S,
        events: List<&2, E>, +state: S) -> List<&2, O>:
  match events:
    case Nil{}: Nil{}
    case Con{event, rest}:
      +decision = step(state, event)
      Con{decision, run(~S, ~E, ~O, ~step, ~next, rest, next(decision))}

def cons_run(~S: Data, ~E: Data, ~O: Data,
             ~step: S -> E -> O, ~next: O -> S,
             rest: List<&2, E>, +decision: O) -> List<&2, O>:
  Con{decision, run(~S, ~E, ~O, ~step, ~next, rest, next(decision))}

# Pointwise FULL-output refinement lifts to equality of arbitrary finite traces.
def refinement(~S: Data, ~E: Data, ~O: Data,
               ~implementation: S -> E -> O, ~specification: S -> E -> O,
               ~next: O -> S,
               ~same: @s: S -> @e: E -> {implementation(s, e) == specification(s, e) : O},
               events: List<&2, E>, +state: S) ->
  {run(~S, ~E, ~O, ~implementation, ~next, events, state) == run(~S, ~E, ~O, ~specification, ~next, events, state) : List<&2, O>}:
  match events:
    case Nil{}: {==}
    case Con{+event, +rest}:
      %Equal.sym(O, implementation(state, event), specification(state, event), same(state, event)) :
        {cons_run(~S, ~E, ~O, ~implementation, ~next, rest, _) == cons_run(~S, ~E, ~O, ~specification, ~next, rest, specification(state, event)) : List<&2, O>}
      %refinement(~S, ~E, ~O, ~implementation, ~specification, ~next, ~same, rest, next(specification(state, event))) :
        {Con{specification(state, event), run(~S, ~E, ~O, ~implementation, ~next, rest, next(specification(state, event)))} == Con{specification(state, event), _} : List<&2, O>}
      {==}

def total(~O: Data, ~cost: O -> Nat, outputs: List<&2, O>) -> Nat:
  match outputs:
    case Nil{}: 0n
    case Con{decision, rest}: Nat.add(cost(decision), total(~O, ~cost, rest))

# The potential argument: each step pays its effect cost from a non-negative
# allowance. Telescoping bounds every finite execution, not just tested traces.
def budget(~S: Data, ~E: Data, ~O: Data,
           ~step: S -> E -> O, ~next: O -> S, ~cost: O -> Nat, ~potential: S -> Nat,
           ~pays: @s: S -> @e: E ->
             {Nat.is_le(Nat.add(cost(step(s, e)), potential(next(step(s, e)))), potential(s)) == True{} : Bool},
           events: List<&2, E>, +state: S) ->
  {Nat.is_le(total(~O, ~cost, run(~S, ~E, ~O, ~step, ~next, events, state)), potential(state)) == True{} : Bool}:
  match events:
    case Nil{}: Order.zero_le(potential(state))
    case Con{+event, +rest}:
      +decision = step(state, event)
      Order.transitive(
        Nat.add(cost(decision), total(~O, ~cost, run(~S, ~E, ~O, ~step, ~next, rest, next(decision)))),
        Nat.add(cost(decision), potential(next(decision))),
        potential(state),
        Order.add_monotone_left(cost(decision),
          total(~O, ~cost, run(~S, ~E, ~O, ~step, ~next, rest, next(decision))), potential(next(decision)),
          budget(~S, ~E, ~O, ~step, ~next, ~cost, ~potential, ~pays, rest, next(decision))),
        pays(state, event))
