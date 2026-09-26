import Base
import ./replay-domain.bend as D
import ./replay.bend as K
import ./replay-specification.bend as S

law transition_refinement:
  for state: D.State
  for event: D.Event
  {K.step(state, event) == S.step(state, event) : D.Decision}

law trace_refinement:
  for events: List<&2, D.Event>
  for state: D.State
  {K.run(events, state) == S.run(events, state) : List<&2, D.Decision>}

law sealed_payload_cannot_be_changed:
  for events: List<&2, D.Frame>
  for reasoning: List<&2, String>
  for event: D.Event
  {D.state(K.step(D.Journal{D.Sealed{}, events, reasoning}, event)) == D.Journal{D.Sealed{}, events, reasoning} : D.State}

law rejected_append_is_atomic:
  for events: List<&2, D.Frame>
  for reasoning: List<&2, String>
  for next: List<&2, D.Frame>
  {D.state(K.append(False{}, False{}, events, reasoning, next)) == D.Journal{D.Open{}, events, reasoning} : D.State}

law append_preserves_event_order:
  for events: List<&2, D.Frame>
  for reasoning: List<&2, String>
  for next: List<&2, D.Frame>
  {D.events(D.state(K.append(False{}, True{}, events, reasoning, next))) == List.append(&2, D.Frame, events, next) : List<&2, D.Frame>}

law failure_does_not_erase_observed_events:
  for events: List<&2, D.Frame>
  for reasoning: List<&2, String>
  for reason: String
  {D.events(D.state(K.step(D.Journal{D.Open{}, events, reasoning}, D.Fail{reason}))) == events : List<&2, D.Frame>}
