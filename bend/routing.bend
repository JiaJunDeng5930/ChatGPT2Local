import Base
import ./routing-domain.bend as D
import ./history.bend as H

def begin(lease: Maybe<&2, D.Effort>) -> D.Decision:
  match lease:
    case None{}: D.Decision{D.Choosing{}, D.Classify{}}
    case Some{+effort}: D.Decision{D.Sending{effort}, D.Forward{effort}}

def step(s: D.Phase, e: D.Event) -> D.Decision:
  match s:
    case D.Unchosen{}:
      match e:
        case D.Begin{lease}: begin(lease)
        case D.Recover{}: D.Decision{D.Unknown{}, D.NeedsAttention{}}
        case D.Lost{}: D.Decision{D.Unknown{}, D.NeedsAttention{}}
        case _: D.Decision{D.Unchosen{}, D.Wait{}}
    case D.Choosing{}:
      match e:
        case D.Advice{+effort}: D.Decision{D.Sending{effort}, D.Forward{effort}}
        case D.Recover{}: D.Decision{D.Unknown{}, D.NeedsAttention{}}
        case D.Lost{}: D.Decision{D.Unknown{}, D.NeedsAttention{}}
        case _: D.Decision{D.Choosing{}, D.Wait{}}
    case D.Sending{effort}:
      match e:
        case D.Complete{+receipt}: D.Decision{D.Finished{receipt}, D.Receipt{receipt}}
        case D.Recover{}: D.Decision{D.Unknown{}, D.NeedsAttention{}}
        case D.Lost{}: D.Decision{D.Unknown{}, D.NeedsAttention{}}
        case _: D.Decision{D.Sending{effort}, D.Wait{}}
    case D.Finished{+receipt}: D.Decision{D.Finished{receipt}, D.Receipt{receipt}}
    case D.Unknown{}: D.Decision{D.Unknown{}, D.NeedsAttention{}}

def available(allowed: Bool, environment: String, history: List<&2, String>, +effort: D.Effort, remaining: Nat) -> D.Choice:
  match allowed:
    case True{}: D.Choice{D.Lease{environment, history, effort, remaining}, Some{effort}}
    case False{}: D.Choice{D.Empty{}, None{}}

def prefix(offset: Maybe<&2, Nat>, length: Nat, environment: String,
           history: List<&2, String>, effort: D.Effort, remaining: Nat) -> D.Choice:
  match offset:
    case None{}: D.Choice{D.Empty{}, None{}}
    case Some{n}: available(Nat.is_lt(n, length), environment, history, effort, remaining)

def choose(cache: D.Cache, +environment: String, +history: List<&2, String>) -> D.Choice:
  match cache:
    case D.Empty{}: D.Choice{D.Empty{}, None{}}
    case D.Lease{old_environment, old_history, effort, 0n}: D.Choice{D.Empty{}, None{}}
    case D.Lease{old_environment, old_history, effort, 1n+remaining}:
      prefix(H.plan(old_environment, environment, old_history, history), List.length(&2, String, history),
        environment, history, effort, remaining)
