import Base
import ./application-domain.bend as A
import ./application.bend as App
import ./application-specification.bend as S
import ./domain.bend as T
import ./broker-table.bend as Table
import ./broker-domain.bend as K
import ./batch-domain.bend as B

law unknown_never_authorizes_send:
  for slot: Nat
  for payload: String
  {A.command_authority(B.Closed{T.Unknown{}}, T.SendPrompt{}, slot, payload) == False{} : Bool}

law cancelled_never_authorizes_send:
  for slot: Nat
  for payload: String
  {A.command_authority(B.Closed{T.Cancelled{}}, T.SendPrompt{}, slot, payload) == False{} : Bool}

law control_refinement:
  for s: A.State
  for e: T.Event
  {App.control(s, e) == S.control(s, e) : A.Decision}

law uncertainty_is_nonintervention:
  for s: A.State
  {S.nonintervening(A.effect(App.step(s, A.Uncertain{}))) == True{} : Bool}

law disconnect_is_nonintervention:
  for s: A.State
  {S.nonintervening(A.effect(App.step(s, A.Detached{}))) == True{} : Bool}

law attachment_is_nonintervention:
  for s: A.State
  {S.nonintervening(A.effect(App.step(s, A.Reattach{}))) == True{} : Bool}

law recovery_is_nonintervention:
  for s: A.State
  {S.nonintervening(A.effect(App.step(s, A.Restore{}))) == True{} : Bool}

law disconnect_preserves_application:
  for s: A.State
  {A.state(App.step(s, A.Detached{})) == s : A.State}

law recovery_cannot_regain_a_send:
  for s: A.State
  {A.sends(A.effect(App.step(A.state(App.step(s, A.Restore{})), A.Ready{}))) == 0n : Nat}

law publication_never_crosses_tools:
  for s: A.State
  for revision: Nat
  for signature: String
  for output: String
  {S.publication_safe(A.effect(App.step(s, A.Encoded{revision, signature, output})),
    Table.busy(A.broker(s))) == True{} : Bool}

law local_completion_refinement:
  for state: A.State
  for next: K.State
  for baseline: String
  {App.local_result(state, K.Decision{next, K.ActivityClosed{True{}}}, baseline) ==
    S.local_completion(state, next, baseline) : A.Decision}

law local_completion_invalidates_old_candidate:
  for state: A.State
  for next: K.State
  for baseline: String
  {A.candidate(A.state(App.local_result(state,
    K.Decision{next, K.ActivityClosed{True{}}}, baseline))) == None{} : Maybe<&2, A.Publication>}

law encoded_publication_requires_current_evidence:
  for state: A.State
  for candidate: Maybe<&2, A.Publication>
  for revision: Nat
  for signature: String
  for output: String
  {S.publication_authorized(A.effect(App.encoded(candidate, state, revision, signature, output)),
    S.publication_fence(candidate, K.revision(A.broker(state)), revision, signature)) == True{} : Bool}
