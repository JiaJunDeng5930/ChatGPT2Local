import Base
import ./observation-domain.bend as O
import ./theory/boolean.bend as BoolCase

# Positive evidence is a conjunction, never the absence of a timeout. These
# propositions describe what the DOM adapter reports, not truth of the website.
def eligible(f: O.Facts) -> Bool:
  match f:
    case O.Facts{present, running, text, control, error, stopped, tools}:
      Bool.and(present, Bool.and(Bool.not(running), Bool.and(text, Bool.and(control,
        Bool.and(Bool.not(error), Bool.and(Bool.not(stopped), Bool.not(tools)))))))

def captured(+order: Cmp, +state: O.State, revision: Nat, text: String) -> O.Decision:
  BoolCase.choose(~O.Decision, Cmp.is_lt(order),
    O.Decision{O.Watching{revision, Some{text}}, O.BoundaryCaptured{}},
    BoolCase.choose(~O.Decision, Cmp.is_eq(order),
      O.Decision{state, O.DuplicateBoundary{}}, O.Decision{state, O.RejectBoundary{}}))

def stable(+same: Bool, +clock_ordered: Bool, elapsed: Bool, +revision: Nat,
           +baseline: Maybe<&2, String>, +signature: String, +since: Nat, now: Nat) -> O.Decision:
  BoolCase.choose(~O.Decision, Bool.and(same, Bool.and(clock_ordered, elapsed)),
    O.Decision{O.Candidate{revision, baseline, signature, since}, O.CandidateReady{}},
    BoolCase.choose(~O.Decision, Bool.and(same, clock_ordered),
      O.Decision{O.Candidate{revision, baseline, signature, since}, O.ObserveOnly{}},
      O.Decision{O.Candidate{revision, baseline, signature, now}, O.ObserveOnly{}}))

def candidate(s: O.State, +signature: String, +now: Nat, stable_ms: Nat) -> O.Decision:
  match s:
    case O.Watching{revision, baseline}:
      O.Decision{O.Candidate{revision, baseline, signature, now}, O.ObserveOnly{}}
    case O.Candidate{revision, baseline, previous, +since}:
      stable(String.eq(previous, signature), Nat.is_le(since, now),
        Nat.is_ge(Nat.sub(now, since), stable_ms), revision, baseline, signature, since, now)

def guarded(tools: Bool, same_baseline: Bool, clear: Bool, +state: O.State,
            signature: String, now: Nat, stable_ms: Nat) -> O.Decision:
  BoolCase.choose(~O.Decision, tools,
    O.Decision{O.waiting(state), O.WaitForTools{}},
    BoolCase.choose(~O.Decision, same_baseline,
      O.Decision{O.waiting(state), O.WaitForPostToolAnswer{}},
      BoolCase.choose(~O.Decision, clear,
        candidate(state, signature, now, stable_ms), O.Decision{O.waiting(state), O.ObserveOnly{}})))

def sample(+state: O.State, +facts: O.Facts, text: String, signature: String, now: Nat, stable_ms: Nat) -> O.Decision:
  guarded(O.has_tools(facts), O.baseline_matches(O.baseline(state), text), eligible(facts), state, signature, now, stable_ms)

def step(event: O.Event, +state: O.State) -> O.Decision:
  match event:
    case O.Uncertain{}: O.Decision{O.waiting(state), O.ObserveOnly{}}
    case O.CaptureBoundary{+revision, text}:
      captured(Nat.cmp(O.revision(state), revision), state, revision, text)
    case O.Sample{facts, text, signature, now, stable_ms}: sample(state, facts, text, signature, now, stable_ms)
