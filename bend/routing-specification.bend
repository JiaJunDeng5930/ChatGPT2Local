import Base
import ./routing-domain.bend as D
import ./history-specification.bend as H

# Event-oriented meaning, independent of the phase-oriented interpreter. A
# duplicate Begin/Advice cannot create a second native network effect.
def observe(s: D.Phase) -> D.Decision:
  match s:
    case D.Finished{+receipt}: D.Decision{D.Finished{receipt}, D.Receipt{receipt}}
    case D.Unknown{}: D.Decision{D.Unknown{}, D.NeedsAttention{}}
    case D.Unchosen{}: D.Decision{D.Unchosen{}, D.Wait{}}
    case D.Choosing{}: D.Decision{D.Choosing{}, D.Wait{}}
    case D.Sending{effort}: D.Decision{D.Sending{effort}, D.Wait{}}

def uncertain(s: D.Phase) -> D.Decision:
  match s:
    case D.Finished{+receipt}: D.Decision{D.Finished{receipt}, D.Receipt{receipt}}
    case _: D.Decision{D.Unknown{}, D.NeedsAttention{}}

def initial(lease: Maybe<&2, D.Effort>) -> D.Decision:
  match lease:
    case None{}: D.Decision{D.Choosing{}, D.Classify{}}
    case Some{+effort}: D.Decision{D.Sending{effort}, D.Forward{effort}}

def start(s: D.Phase, lease: Maybe<&2, D.Effort>) -> D.Decision:
  match s:
    case D.Unchosen{}: initial(lease)
    case D.Choosing{}: D.Decision{D.Choosing{}, D.Wait{}}
    case D.Sending{effort}: D.Decision{D.Sending{effort}, D.Wait{}}
    case D.Finished{+receipt}: D.Decision{D.Finished{receipt}, D.Receipt{receipt}}
    case D.Unknown{}: D.Decision{D.Unknown{}, D.NeedsAttention{}}

def advice(s: D.Phase, +effort: D.Effort) -> D.Decision:
  match s:
    case D.Unchosen{}: D.Decision{D.Unchosen{}, D.Wait{}}
    case D.Choosing{}: D.Decision{D.Sending{effort}, D.Forward{effort}}
    case D.Sending{previous}: D.Decision{D.Sending{previous}, D.Wait{}}
    case D.Finished{+receipt}: D.Decision{D.Finished{receipt}, D.Receipt{receipt}}
    case D.Unknown{}: D.Decision{D.Unknown{}, D.NeedsAttention{}}

def complete(s: D.Phase, +receipt: String) -> D.Decision:
  match s:
    case D.Unchosen{}: D.Decision{D.Unchosen{}, D.Wait{}}
    case D.Choosing{}: D.Decision{D.Choosing{}, D.Wait{}}
    case D.Sending{effort}: D.Decision{D.Finished{receipt}, D.Receipt{receipt}}
    case D.Finished{+previous}: D.Decision{D.Finished{previous}, D.Receipt{previous}}
    case D.Unknown{}: D.Decision{D.Unknown{}, D.NeedsAttention{}}

def step(e: D.Event, s: D.Phase) -> D.Decision:
  match e:
    case D.Begin{lease}: start(s, lease)
    case D.Advice{effort}: advice(s, effort)
    case D.Complete{receipt}: complete(s, receipt)
    case D.Recover{}: uncertain(s)
    case D.Lost{}: uncertain(s)
    case D.Poll{}: observe(s)

def allow(allowed: Bool, environment: String, history: List<&2, String>, +effort: D.Effort, remaining: Nat) -> D.Choice:
  match allowed:
    case False{}: D.Choice{D.Empty{}, None{}}
    case True{}: D.Choice{D.Lease{environment, history, effort, remaining}, Some{effort}}

def offer(offset: Maybe<&2, Nat>, length: Nat, environment: String,
          history: List<&2, String>, effort: D.Effort, remaining: Nat) -> D.Choice:
  match offset:
    case None{}: D.Choice{D.Empty{}, None{}}
    case Some{n}: allow(Nat.is_lt(n, length), environment, history, effort, remaining)

def choose(cache: D.Cache, +environment: String, +history: List<&2, String>) -> D.Choice:
  match cache:
    case D.Empty{}: D.Choice{D.Empty{}, None{}}
    case D.Lease{old_environment, old_history, effort, 0n}: D.Choice{D.Empty{}, None{}}
    case D.Lease{old_environment, old_history, effort, 1n+remaining}:
      offer(H.plan(old_environment, environment, old_history, history), List.length(&2, String, history),
        environment, history, effort, remaining)
