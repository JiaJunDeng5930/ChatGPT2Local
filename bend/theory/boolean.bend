import Base

# Ordinary Boolean case elimination, shared as mathematics rather than an
# application policy. It has no knowledge of turns, effects, history or tools.
def choose(~T: Data, condition: Bool, when_true: T, when_false: T) -> T:
  match condition:
    case True{}: when_true
    case False{}: when_false
