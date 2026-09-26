import Base
import ./observation-domain.bend as O
import ./observation.bend as K
import ./observation-specification.bend as S
import ./observation-laws.bend as L

def L.evidence_refinement(facts):
  match facts:
    case O.Facts{False{}, _, _, _, _, _, _}: {==}
    case O.Facts{True{}, True{}, _, _, _, _, _}: {==}
    case O.Facts{True{}, False{}, False{}, _, _, _, _}: {==}
    case O.Facts{True{}, False{}, True{}, False{}, _, _, _}: {==}
    case O.Facts{True{}, False{}, True{}, True{}, True{}, _, _}: {==}
    case O.Facts{True{}, False{}, True{}, True{}, False{}, True{}, _}: {==}
    case O.Facts{True{}, False{}, True{}, True{}, False{}, False{}, True{}}: {==}
    case O.Facts{True{}, False{}, True{}, True{}, False{}, False{}, False{}}: {==}

def captured_refinement(order: Cmp, state: O.State, revision: Nat, text: String) ->
  {K.captured(order, state, revision, text) == S.captured(order, state, revision, text) : O.Decision}:
  match order:
    case LT{}: {==}
    case EQ{}: {==}
    case GT{}: {==}

def stable_refinement(same: Bool, clock_ordered: Bool, elapsed: Bool, revision: Nat,
                      baseline: Maybe<&2, String>, signature: String, since: Nat, now: Nat) ->
  {K.stable(same, clock_ordered, elapsed, revision, baseline, signature, since, now) ==
   S.stable(same, clock_ordered, elapsed, revision, baseline, signature, since, now) : O.Decision}:
  match same clock_ordered elapsed:
    case False{} False{} False{}: {==}
    case False{} False{} True{}: {==}
    case False{} True{} False{}: {==}
    case False{} True{} True{}: {==}
    case True{} False{} False{}: {==}
    case True{} False{} True{}: {==}
    case True{} True{} False{}: {==}
    case True{} True{} True{}: {==}

def candidate_refinement(state: O.State, +signature: String, +now: Nat, stable_ms: Nat) ->
  {K.candidate(state, signature, now, stable_ms) == S.candidate(state, signature, now, stable_ms) : O.Decision}:
  match state:
    case O.Watching{revision, baseline}: {==}
    case O.Candidate{revision, baseline, previous, +since}:
      stable_refinement(String.eq(previous, signature), Nat.is_le(since, now),
        Nat.is_ge(Nat.sub(now, since), stable_ms), revision, baseline, signature, since, now)

def guarded_refinement(tools: Bool, same_baseline: Bool, clear: Bool, state: O.State,
                       signature: String, now: Nat, stable_ms: Nat) ->
  {K.guarded(tools, same_baseline, clear, state, signature, now, stable_ms) ==
   S.guarded(tools, same_baseline, clear, state, signature, now, stable_ms) : O.Decision}:
  match tools same_baseline clear:
    case True{} _ _: {==}
    case False{} True{} _: {==}
    case False{} False{} False{}: {==}
    case False{} False{} True{}: candidate_refinement(state, signature, now, stable_ms)

def sample_refinement(+state: O.State, +facts: O.Facts, text: String, signature: String, now: Nat, stable_ms: Nat) ->
  {K.guarded(O.has_tools(facts), O.baseline_matches(O.baseline(state), text), K.eligible(facts), state, signature, now, stable_ms) ==
   S.sample(state, facts, text, signature, now, stable_ms) : O.Decision}:
  %L.evidence_refinement(facts) :
    {K.guarded(O.has_tools(facts), O.baseline_matches(O.baseline(state), text), K.eligible(facts), state, signature, now, stable_ms) ==
     S.guarded(O.has_tools(facts), O.baseline_matches(O.baseline(state), text), _, state, signature, now, stable_ms) : O.Decision}
  guarded_refinement(O.has_tools(facts), O.baseline_matches(O.baseline(state), text), K.eligible(facts), state, signature, now, stable_ms)

def L.transition_refinement(state, event):
  match state:
    case O.Watching{+revision, baseline}:
      match event:
        case O.Uncertain{}: {==}
        case O.CaptureBoundary{+next, text}: captured_refinement(Nat.cmp(revision, next), O.Watching{revision, baseline}, next, text)
        case O.Sample{facts, text, signature, now, stable_ms}: sample_refinement(O.Watching{revision, baseline}, facts, text, signature, now, stable_ms)
    case O.Candidate{+revision, baseline, previous, since}:
      match event:
        case O.Uncertain{}: {==}
        case O.CaptureBoundary{+next, text}: captured_refinement(Nat.cmp(revision, next), O.Candidate{revision, baseline, previous, since}, next, text)
        case O.Sample{facts, text, signature, now, stable_ms}: sample_refinement(O.Candidate{revision, baseline, previous, since}, facts, text, signature, now, stable_ms)

def L.uncertainty_only_observes(state):
  match state:
    case O.Watching{r, b}: {==}
    case O.Candidate{r, b, s, n}: {==}

def L.uncertainty_keeps_tool_boundary(state):
  match state:
    case O.Watching{r, b}: {==}
    case O.Candidate{r, b, s, n}: {==}
