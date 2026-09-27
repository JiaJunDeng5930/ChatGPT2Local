import Base
import ./routing-domain.bend as D
import ./routing.bend as R
import ./routing-specification.bend as S
import ./routing-laws.bend as L
import ./history-laws.bend as HistoryLaws
import ./history-proof.bend as HistoryProof
import ./history.bend as H
import ./history-specification.bend as HS

def L.refinement(state, event):
  match state:
    case D.Unchosen{}:
      match event:
        case D.Begin{lease}:
          match lease:
            case None{}: {==}
            case Some{effort}: {==}
        case D.Advice{effort}: {==}
        case D.Complete{receipt}: {==}
        case D.Recover{}: {==}
        case D.Lost{}: {==}
        case D.Poll{}: {==}
    case D.Choosing{}:
      match event:
        case D.Begin{lease}:
          match lease:
            case None{}: {==}
            case Some{effort}: {==}
        case D.Advice{effort}: {==}
        case D.Complete{receipt}: {==}
        case D.Recover{}: {==}
        case D.Lost{}: {==}
        case D.Poll{}: {==}
    case D.Sending{effort}:
      match event:
        case D.Begin{lease}:
          match lease:
            case None{}: {==}
            case Some{chosen}: {==}
        case D.Advice{chosen}: {==}
        case D.Complete{receipt}: {==}
        case D.Recover{}: {==}
        case D.Lost{}: {==}
        case D.Poll{}: {==}
    case D.Finished{receipt}:
      match event:
        case D.Begin{lease}:
          match lease:
            case None{}: {==}
            case Some{effort}: {==}
        case D.Advice{effort}: {==}
        case D.Complete{next}: {==}
        case D.Recover{}: {==}
        case D.Lost{}: {==}
        case D.Poll{}: {==}
    case D.Unknown{}:
      match event:
        case D.Begin{lease}:
          match lease:
            case None{}: {==}
            case Some{effort}: {==}
        case D.Advice{effort}: {==}
        case D.Complete{receipt}: {==}
        case D.Recover{}: {==}
        case D.Lost{}: {==}
        case D.Poll{}: {==}

def L.recovery_never_forwards(state):
  match state:
    case D.Unchosen{}: {==}
    case D.Choosing{}: {==}
    case D.Sending{effort}: {==}
    case D.Finished{receipt}: {==}
    case D.Unknown{}: {==}

def L.duplicates_never_forward(effort, lease): {==}

def L.effort_roundtrip(effort):
  match effort:
    case D.NoReasoning{}: {==}
    case D.Minimal{}: {==}
    case D.Low{}: {==}
    case D.Medium{}: {==}
    case D.High{}: {==}
    case D.ExtraHigh{}: {==}
    case D.Maximum{}: {==}
    case D.Ultra{}: {==}

def available_refinement(allowed: Bool, environment: String, history: List<&2, String>, effort: D.Effort, remaining: Nat) ->
  {R.available(allowed, environment, history, effort, remaining) ==
    S.allow(allowed, environment, history, effort, remaining) : D.Choice}:
  match allowed:
    case False{}: {==}
    case True{}: {==}

def prefix_refinement(offset: Maybe<&2, Nat>, length: Nat, environment: String,
                      history: List<&2, String>, effort: D.Effort, remaining: Nat) ->
  {R.prefix(offset, length, environment, history, effort, remaining) ==
    S.offer(offset, length, environment, history, effort, remaining) : D.Choice}:
  match offset:
    case None{}: {==}
    case Some{n}: available_refinement(Nat.is_lt(n, length), environment, history, effort, remaining)

def L.lease_refinement(cache, environment, history):
  match cache:
    case D.Empty{}: {==}
    case D.Lease{old_environment, old_history, effort, 0n}: {==}
    case D.Lease{+old_environment, +old_history, +effort, 1n+remaining}:
      +env = environment
      +messages = history
      +left = remaining
      %prefix_refinement(HS.plan(old_environment, env, old_history, messages), List.length(&2, String, messages), env, messages, effort, left) :
        {R.prefix(H.plan(old_environment, env, old_history, messages), List.length(&2, String, messages), env, messages, effort, left) == _ : D.Choice}
      %HistoryLaws.plan_refinement(old_environment, env, old_history, messages) :
        {R.prefix(H.plan(old_environment, env, old_history, messages), List.length(&2, String, messages), env, messages, effort, left) ==
          R.prefix(_, List.length(&2, String, messages), env, messages, effort, left) : D.Choice}
      {==}
