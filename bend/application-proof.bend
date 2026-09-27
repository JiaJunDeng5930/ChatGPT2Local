import Base
import ./application-domain.bend as A
import ./application.bend as App
import ./application-specification.bend as S
import ./application-laws.bend as L
import ./domain.bend as T
import ./batch-domain.bend as B
import ./batch.bend as Batch
import ./batch-specification.bend as BatchSpec
import ./batch-laws.bend as BatchLaws
import ./batch-proof.bend as BatchProof
import ./broker-domain.bend as K
import ./broker.bend as Broker
import ./broker-specification.bend as BrokerSpec
import ./broker-table.bend as Table
import ./broker-laws.bend as BrokerLaws
import ./broker-proof.bend as BrokerProof
import ./observation-domain.bend as O
import ./observation-laws.bend as ObservationLaws
import ./observation-proof.bend as ObservationProof

def L.unknown_never_authorizes_send(slot, payload): {==}
def L.cancelled_never_authorizes_send(slot, payload): {==}

def batch_representation(s: A.State, d: B.Decision) ->
  {App.batch_result(s, d) == S.batch_receipt(s, d) : A.Decision}:
  match d:
    case B.BatchDecision{state, effect}: {==}

def control_refinement(+s: A.State, +e: T.Event) ->
  {App.control(s, e) == S.control(s, e) : A.Decision}:
  %batch_representation(s, BatchSpec.step(e, A.batch(s))) :
    {App.control(s, e) == _ : A.Decision}
  %BatchLaws.control_refinement(A.batch(s), e) :
    {App.batch_result(s, Batch.step(A.batch(s), e)) == App.batch_result(s, _) : A.Decision}
  {==}

def L.control_refinement(s, e): control_refinement(s, e)

def L.uncertainty_is_nonintervention(s):
  match s:
    case A.Application{f, t, b, k, o, l, c, r}:
      match b:
        case B.Unclaimed{}: {==}
        case B.Unplanned{}: {==}
        case B.Closed{p}:
          match p:
            case T.Fresh{}: {==}
            case T.Prepared{}: {==}
            case T.Attempted{}: {==}
            case T.Running{}: {==}
            case T.Unknown{}: {==}
            case T.Completed{}: {==}
            case T.Cancelled{}: {==}
        case B.Batch{p, n, text, rest}:
          match p:
            case T.Fresh{}: {==}
            case T.Prepared{}: {==}
            case T.Attempted{}: {==}
            case T.Running{}: {==}
            case T.Unknown{}: {==}
            case T.Completed{}: {==}
            case T.Cancelled{}: {==}

def L.disconnect_is_nonintervention(s):
  match s:
    case A.Application{f, t, b, k, o, l, c, r}:
      match b:
        case B.Unclaimed{}: {==}
        case B.Unplanned{}: {==}
        case B.Closed{p}:
          match p:
            case T.Fresh{}: {==}
            case T.Prepared{}: {==}
            case T.Attempted{}: {==}
            case T.Running{}: {==}
            case T.Unknown{}: {==}
            case T.Completed{}: {==}
            case T.Cancelled{}: {==}
        case B.Batch{p, n, text, rest}:
          match p:
            case T.Fresh{}: {==}
            case T.Prepared{}: {==}
            case T.Attempted{}: {==}
            case T.Running{}: {==}
            case T.Unknown{}: {==}
            case T.Completed{}: {==}
            case T.Cancelled{}: {==}

def L.attachment_is_nonintervention(s):
  match s:
    case A.Application{f, t, b, k, o, l, c, r}:
      match b:
        case B.Unclaimed{}: {==}
        case B.Unplanned{}: {==}
        case B.Closed{p}:
          match p:
            case T.Fresh{}: {==}
            case T.Prepared{}: {==}
            case T.Attempted{}: {==}
            case T.Running{}: {==}
            case T.Unknown{}: {==}
            case T.Completed{}: {==}
            case T.Cancelled{}: {==}
        case B.Batch{p, n, text, rest}:
          match p:
            case T.Fresh{}: {==}
            case T.Prepared{}: {==}
            case T.Attempted{}: {==}
            case T.Running{}: {==}
            case T.Unknown{}: {==}
            case T.Completed{}: {==}
            case T.Cancelled{}: {==}

def L.recovery_is_nonintervention(s): {==}

def L.disconnect_preserves_application(s):
  match s:
    case A.Application{f, t, b, k, o, l, c, r}:
      match b:
        case B.Unclaimed{}: {==}
        case B.Unplanned{}: {==}
        case B.Closed{p}:
          match p:
            case T.Fresh{}: {==}
            case T.Prepared{}: {==}
            case T.Attempted{}: {==}
            case T.Running{}: {==}
            case T.Unknown{}: {==}
            case T.Completed{}: {==}
            case T.Cancelled{}: {==}
        case B.Batch{p, n, text, rest}:
          match p:
            case T.Fresh{}: {==}
            case T.Prepared{}: {==}
            case T.Attempted{}: {==}
            case T.Running{}: {==}
            case T.Unknown{}: {==}
            case T.Completed{}: {==}
            case T.Cancelled{}: {==}

def L.recovery_cannot_regain_a_send(s):
  match s:
    case A.Application{f, t, b, k, o, l, c, r}:
      match b:
        case B.Unclaimed{}: {==}
        case B.Unplanned{}: {==}
        case B.Closed{p}:
          match p:
            case T.Fresh{}: {==}
            case T.Prepared{}: {==}
            case T.Attempted{}: {==}
            case T.Running{}: {==}
            case T.Unknown{}: {==}
            case T.Completed{}: {==}
            case T.Cancelled{}: {==}
        case B.Batch{p, n, text, rest}:
          match p:
            case T.Fresh{}: {==}
            case T.Prepared{}: {==}
            case T.Attempted{}: {==}
            case T.Running{}: {==}
            case T.Unknown{}: {==}
            case T.Completed{}: {==}
            case T.Cancelled{}: {==}

def committed_safety(s: A.State, b: B.State, d: K.Decision, text: String, output: String, busy: Bool,
  proof: {BrokerSpec.fence_is_safe(K.effect(d), busy) == True{} : Bool}) ->
  {S.publication_safe(A.effect(App.committed(s, b, d, text, output)), busy) == True{} : Bool}:
  match d:
    case K.Decision{next, effect}:
      match effect:
        case K.FenceCommitted{}: proof
        case K.ActivityClaimed{}: {==}
        case K.ActivityReplayed{}: {==}
        case K.ActivityClosed{active}: {==}
        case K.ActivityReceiptReplayed{}: {==}
        case K.InvocationQueued{}: {==}
        case K.CallsDelivered{ids}: {==}
        case K.CallsReplayed{ids}: {==}
        case K.WaitForCalls{}: {==}
        case K.ResultAccepted{}: {==}
        case K.ResultReplayed{}: {==}
        case K.FenceOffered{revision}: {==}
        case K.FenceUnavailable{}: {==}
        case K.FenceStale{}: {==}
        case K.EnvironmentAccepted{}: {==}
        case K.OwnerRetired{}: {==}
        case K.RetirementReplayed{}: {==}
        case K.LateActivityReceipt{}: {==}
        case K.Reject{reason}: {==}

def finish_safety(+s: A.State, d: B.Decision, +revision: Nat, text: String, output: String) ->
  {S.publication_safe(A.effect(App.finish(s, d, revision, text, output)), Table.busy(A.broker(s))) == True{} : Bool}:
  match d:
    case B.BatchDecision{next, effect}:
      match effect:
        case T.PublishFinal{}:
          committed_safety(s, next, Broker.step(A.broker(s), K.CommitFence{revision}), text, output,
            Table.busy(A.broker(s)), BrokerLaws.completion_never_crosses_an_outstanding_obligation(A.broker(s), revision))
        case T.PrepareSurface{}: {==}
        case T.SendPrompt{}: {==}
        case T.ObserveOnly{}: {==}
        case T.ReplayFinal{}: {==}
        case T.StopByUser{}: {==}
        case T.NoEffect{}: {==}
        case T.Reject{}: {==}

def checked_safety(allowed: Bool, +s: A.State, revision: Nat, text: String, output: String) ->
  {S.publication_safe(A.effect(App.encode_checked(allowed, s, revision, text, output)), Table.busy(A.broker(s))) == True{} : Bool}:
  match allowed:
    case False{}: {==}
    case True{}: finish_safety(s, Batch.step(A.batch(s), T.Finished{}), revision, text, output)

def encoded_safety(candidate: Maybe<&2, A.Publication>, +s: A.State,
                   +revision: Nat, +signature: String, +output: String) ->
  {S.publication_safe(A.effect(App.encoded(candidate, s, revision, signature, output)), Table.busy(A.broker(s))) == True{} : Bool}:
  match candidate:
    case None{}: {==}
    case Some{A.Publication{expected, previous, +text}}:
      checked_safety(Bool.and(Nat.is_eq(expected, revision),
        Bool.and(Nat.is_eq(K.revision(A.broker(s)), revision), String.eq(previous, signature))),
        s, revision, text, output)

def publication_safety(+s: A.State, revision: Nat, signature: String, output: String) ->
  {S.publication_safe(A.effect(App.step(s, A.Encoded{revision, signature, output})),
    Table.busy(A.broker(s))) == True{} : Bool}:
  encoded_safety(A.candidate(s), s, revision, signature, output)

def L.publication_never_crosses_tools(s, revision, signature, output):
  publication_safety(s, revision, signature, output)

def L.local_completion_refinement(state, next, baseline):
  match state:
    case A.Application{+full, +tools, +batch, broker, +observation, +latest, candidate, +output}:
      +following = next
      +text = baseline
      %ObservationLaws.transition_refinement(observation, O.CaptureBoundary{K.revision(following), text}) :
        {App.local_result(A.Application{full, tools, batch, broker, observation, latest, candidate, output},
          K.Decision{following, K.ActivityClosed{True{}}}, text) ==
          A.Decision{A.Application{full, tools, batch, following, O.state(_), latest, None{}, output},
            A.Passive{}, A.ToolReceipt{K.ActivityClosed{True{}}}} : A.Decision}
      {==}

def L.local_completion_invalidates_old_candidate(state, next, baseline):
  match state:
    case A.Application{full, tools, batch, broker, observation, latest, candidate, output}: {==}

def permitted_true(effect: A.Effect) ->
  {S.publication_authorized(effect, True{}) == True{} : Bool}:
  match effect:
    case A.Passive{}: {==}
    case A.BrowserCommand{command, slot, payload}: {==}
    case A.EncodeFinal{revision, signature, text}: {==}
    case A.Publish{output}: {==}

def encoding_gate_fenced(allowed: Bool, state: A.State, revision: Nat, text: String, output: String) ->
  {S.publication_authorized(A.effect(App.encode_checked(allowed, state, revision, text, output)), allowed) == True{} : Bool}:
  match allowed:
    case False{}: {==}
    case True{}: permitted_true(A.effect(App.encode_checked(True{}, state, revision, text, output)))

def L.encoded_publication_requires_current_evidence(state, candidate, revision, signature, output):
  match candidate:
    case None{}: {==}
    case Some{A.Publication{expected, observed, text}}:
      +s = state
      +version = revision
      encoding_gate_fenced(Bool.and(Nat.is_eq(expected, version),
        Bool.and(Nat.is_eq(K.revision(A.broker(s)), version), String.eq(observed, signature))),
        s, version, text, output)
