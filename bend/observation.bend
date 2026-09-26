import Base
import ./observation-domain.bend as O

def initialize() -> O.State:
  O.Watching{0n, None{}}

def eligible(facts: O.Facts) -> Bool:
  match facts:
    case O.Facts{True{}, False{}, True{}, True{}, False{}, False{}, False{}}: True{}
    case _: False{}

def captured(order: Cmp, state: O.State, revision: Nat, text: String) -> O.Decision:
  match order:
    case LT{}: O.Decision{O.Watching{revision, Some{text}}, O.BoundaryCaptured{}}
    case EQ{}: O.Decision{state, O.DuplicateBoundary{}}
    case GT{}: O.Decision{state, O.RejectBoundary{}}

def capture(+state: O.State, +revision: Nat, text: String) -> O.Decision:
  captured(Nat.cmp(O.revision(state), revision), state, revision, text)

def promote(ready: Bool, state: O.State) -> O.Decision:
  match ready:
    case False{}: O.Decision{state, O.ObserveOnly{}}
    case True{}: O.Decision{state, O.CandidateReady{}}

def stable(same: Bool, clock_ordered: Bool, elapsed: Bool, revision: Nat,
           baseline: Maybe<&2, String>, signature: String, since: Nat, now: Nat) -> O.Decision:
  match same clock_ordered:
    case True{} True{}: promote(elapsed, O.Candidate{revision, baseline, signature, since})
    case _ _: O.Decision{O.Candidate{revision, baseline, signature, now}, O.ObserveOnly{}}

def candidate(s: O.State, +signature: String, +now: Nat, stable_ms: Nat) -> O.Decision:
  match s:
    case O.Watching{revision, baseline}:
      O.Decision{O.Candidate{revision, baseline, signature, now}, O.ObserveOnly{}}
    case O.Candidate{revision, baseline, previous, +since}:
      stable(String.eq(previous, signature), Nat.is_le(since, now),
        Nat.is_ge(Nat.sub(now, since), stable_ms), revision, baseline, signature, since, now)

def guarded(tools: Bool, same_baseline: Bool, clear: Bool, state: O.State,
            signature: String, now: Nat, stable_ms: Nat) -> O.Decision:
  match tools same_baseline clear:
    case True{} _ _: O.Decision{O.waiting(state), O.WaitForTools{}}
    case False{} True{} _: O.Decision{O.waiting(state), O.WaitForPostToolAnswer{}}
    case False{} False{} False{}: O.Decision{O.waiting(state), O.ObserveOnly{}}
    case False{} False{} True{}: candidate(state, signature, now, stable_ms)

def sample_waiting(revision: Nat, +baseline: Maybe<&2, String>, +facts: O.Facts,
                   text: String, signature: String, now: Nat, stable_ms: Nat) -> O.Decision:
  guarded(O.has_tools(facts), O.baseline_matches(baseline, text), eligible(facts),
    O.Watching{revision, baseline}, signature, now, stable_ms)

def sample_candidate(revision: Nat, +baseline: Maybe<&2, String>, previous: String, since: Nat,
                     +facts: O.Facts, text: String, signature: String, now: Nat, stable_ms: Nat) -> O.Decision:
  guarded(O.has_tools(facts), O.baseline_matches(baseline, text), eligible(facts),
    O.Candidate{revision, baseline, previous, since}, signature, now, stable_ms)

def step(state: O.State, event: O.Event) -> O.Decision:
  match state:
    case O.Watching{revision, baseline}:
      match event:
        case O.Uncertain{}: O.Decision{O.Watching{revision, baseline}, O.ObserveOnly{}}
        case O.CaptureBoundary{next, text}: capture(O.Watching{revision, baseline}, next, text)
        case O.Sample{facts, text, signature, now, stable_ms}:
          sample_waiting(revision, baseline, facts, text, signature, now, stable_ms)
    case O.Candidate{revision, baseline, previous, since}:
      match event:
        case O.Uncertain{}: O.Decision{O.Watching{revision, baseline}, O.ObserveOnly{}}
        case O.CaptureBoundary{next, text}: capture(O.Candidate{revision, baseline, previous, since}, next, text)
        case O.Sample{facts, text, signature, now, stable_ms}:
          sample_candidate(revision, baseline, previous, since, facts, text, signature, now, stable_ms)
