import Base
import ./application-domain.bend as A
import ./domain.bend as T
import ./batch-domain.bend as B
import ./batch.bend as Batch
import ./broker-domain.bend as K
import ./broker.bend as Broker
import ./observation-domain.bend as O
import ./observation.bend as Observation

def initialize(full: Bool, tools: List<&2, String>, environment: String) -> A.State:
  A.Application{full, tools, B.state(Batch.claim(Batch.initialize())),
    Broker.initialize(environment), Observation.initialize(), "", None{}, None{}}

def batch_result(s: A.State, decision: B.Decision) -> A.Decision:
  match decision:
    case B.BatchDecision{+next, +command}:
      A.Decision{A.with_batch(s, next),
        A.browser_effect(command, B.slot(next), A.payload(next)), A.control_reply(command)}

def control(+s: A.State, event: T.Event) -> A.Decision:
  batch_result(s, Batch.step(A.batch(s), event))

def broker_result(s: A.State, decision: K.Decision) -> A.Decision:
  match decision:
    case K.Decision{next, receipt}:
      A.Decision{A.with_broker(s, next), A.Passive{}, A.ToolReceipt{receipt}}

def begin(allowed: Bool, +s: A.State, id: String) -> A.Decision:
  match allowed:
    case False{}: A.reject(s, "tool_owner_unavailable")
    case True{}: broker_result(s, Broker.step(A.broker(s), K.ClaimActivity{id}))

def call(allowed: Bool, +s: A.State, id: String, payload: String) -> A.Decision:
  match allowed:
    case False{}: A.reject(s, "tool_not_authorized")
    case True{}: broker_result(s, Broker.step(A.broker(s), K.Enqueue{id, payload}))

def result(+s: A.State, decision: K.Decision, baseline: String) -> A.Decision:
  match decision:
    case K.Decision{+next, K.ResultAccepted{}}:
      A.Decision{
        A.with_broker(A.with_candidate(A.with_observation(s,
          O.state(Observation.step(A.observation(s),
            O.CaptureBoundary{K.revision(next), baseline}))), None{}), next),
        A.Passive{}, A.ToolReceipt{K.ResultAccepted{}}}
    case K.Decision{next, receipt}: broker_result(s, K.Decision{next, receipt})

def poll_phase(p: T.Phase, +s: A.State) -> A.Decision:
  match p:
    case T.Cancelled{}: A.Decision{s, A.Passive{}, A.CancelledReceipt{}}
    case _: broker_result(s, Broker.step(A.broker(s), K.Poll{}))

# Locally answered MCP discovery still has a causal completion boundary. It
# cannot leave a pre-discovery answer eligible for publication.
def local_result(+s: A.State, decision: K.Decision, baseline: String) -> A.Decision:
  match decision:
    case K.Decision{+next, K.ActivityClosed{True{}}}:
      A.Decision{A.with_broker(A.with_candidate(A.with_observation(s,
        O.state(Observation.step(A.observation(s),
          O.CaptureBoundary{K.revision(next), baseline}))), None{}), next),
        A.Passive{}, A.ToolReceipt{K.ActivityClosed{True{}}}}
    case K.Decision{next, receipt}: broker_result(s, K.Decision{next, receipt})

def poll_output(output: Maybe<&2, String>, +s: A.State) -> A.Decision:
  match output:
    case Some{text}: A.Decision{s, A.Passive{}, A.FinalReceipt{text}}
    case None{}: poll_phase(B.phase(A.batch(s)), s)

# The application's broker, not a DOM detector, decides whether tools are busy.
def facts(facts: O.Facts, fence: K.Effect) -> O.Facts:
  match facts:
    case O.Facts{p, r, t, c, e, b, busy}:
      match fence:
        case K.FenceOffered{n}: O.Facts{p, r, t, c, e, b, busy}
        case _: O.Facts{p, r, t, c, e, b, True{}}

def same_candidate(candidate: Maybe<&2, A.Publication>, revision: Nat, signature: String) -> Bool:
  match candidate:
    case None{}: False{}
    case Some{A.Publication{old, previous, text}}:
      Bool.and(Nat.is_eq(old, revision), String.eq(previous, signature))

def offer(duplicate: Bool, s: A.State, +revision: Nat, +signature: String, +text: String) -> A.Decision:
  match duplicate:
    case True{}: A.passive(s)
    case False{}:
      A.Decision{A.with_candidate(s, Some{A.Publication{revision, signature, text}}),
        A.EncodeFinal{revision, signature, text}, A.Silent{}}

def stage_ack(matches: Bool, +s: A.State) -> A.Decision:
  match matches:
    case False{}: A.passive(A.with_candidate(s, None{}))
    case True{}:
      batch_result(A.with_candidate(A.with_observation(s, Observation.initialize()), None{}),
        Batch.acknowledge(A.batch(s), 1n+B.slot(A.batch(s))))

def ready(pending: List<&2, String>, +s: A.State, +signature: String, +text: String) -> A.Decision:
  match pending:
    case Con{h, t}: stage_ack(String.eq(text, A.acknowledgement(s)), s)
    case Nil{}:
      offer(same_candidate(A.candidate(s), K.revision(A.broker(s)), signature),
        s, K.revision(A.broker(s)), signature, text)

def observed(+s: A.State, decision: O.Decision, signature: String, +text: String) -> A.Decision:
  match decision:
    case O.Decision{next, O.CandidateReady{}}:
      ready(A.remaining(s), A.with_latest(A.with_observation(s, next), text), signature, text)
    case O.Decision{next, effect}:
      A.passive(A.with_candidate(A.with_latest(A.with_observation(s, next), text), None{}))

def observe(allowed: Bool, +s: A.State, input: O.Facts, +text: String,
            +signature: String, now: Nat, stable_ms: Nat) -> A.Decision:
  match allowed:
    case False{}: A.passive(s)
    case True{}:
      observed(s, Observation.step(A.observation(s),
        O.Sample{facts(input, K.effect(Broker.step(A.broker(s), K.BeginFence{}))),
          text, signature, now, stable_ms}), signature, text)

def committed(s: A.State, batch: B.State, decision: K.Decision, text: String, +output: String) -> A.Decision:
  match decision:
    case K.Decision{broker, K.FenceCommitted{}}:
      A.Decision{A.with_output(A.with_latest(A.with_candidate(A.with_broker(
        A.with_batch(s, batch), broker), None{}), text), Some{output}),
        A.Publish{output}, A.FinalReceipt{output}}
    case _: A.passive(A.with_candidate(s, None{}))

def finish(+s: A.State, decision: B.Decision, revision: Nat, text: String, output: String) -> A.Decision:
  match decision:
    case B.BatchDecision{next, T.PublishFinal{}}:
      committed(s, next, Broker.step(A.broker(s), K.CommitFence{revision}), text, output)
    case _: A.passive(A.with_candidate(s, None{}))

def encode_checked(allowed: Bool, +s: A.State, revision: Nat, text: String, output: String) -> A.Decision:
  match allowed:
    case False{}: A.passive(A.with_candidate(s, None{}))
    case True{}: finish(s, Batch.step(A.batch(s), T.Finished{}), revision, text, output)

def encoded(candidate: Maybe<&2, A.Publication>, +s: A.State,
            +revision: Nat, signature: String, output: String) -> A.Decision:
  match candidate:
    case None{}: A.passive(s)
    case Some{A.Publication{expected, previous, text}}:
      encode_checked(Bool.and(Nat.is_eq(expected, revision),
        Bool.and(Nat.is_eq(K.revision(A.broker(s)), revision), String.eq(previous, signature))),
        s, revision, text, output)

def recover_phase(p: T.Phase, b: B.State) -> B.State:
  match p:
    case T.Completed{}: b
    case T.Cancelled{}: b
    case _: Batch.restore(B.PendingIntent{})

def recovered_plan(p: T.Phase, slot: Nat, text: String, rest: List<&2, String>) -> B.State:
  match p:
    case T.Completed{}: B.Batch{T.Completed{}, slot, text, rest}
    case T.Cancelled{}: B.Batch{T.Cancelled{}, slot, text, rest}
    case _: B.Batch{T.Unknown{}, slot, text, rest}

def recover_batch(+b: B.State) -> B.State:
  match b:
    case B.Batch{p, slot, text, rest}: recovered_plan(p, slot, text, rest)
    case _: recover_phase(B.phase(b), b)

def submission(allowed: Bool, s: A.State) -> A.Decision:
  match allowed:
    case True{}: control(s, T.Accepted{})
    case False{}: A.passive(s)

def step(+s: A.State, input: A.Input) -> A.Decision:
  match input:
    case A.Install{payloads}: batch_result(s, Batch.plan(A.batch(s), payloads))
    case A.Ready{}: control(s, T.Submit{})
    case A.SubmissionSeen{slot}: submission(Nat.is_eq(slot, B.slot(A.batch(s))), s)
    case A.Uncertain{}:
      control(A.with_candidate(A.with_observation(s,
        O.state(Observation.step(A.observation(s), O.Uncertain{}))), None{}), T.Uncertain{})
    case A.Detached{}: control(s, T.Detach{})
    case A.Reattach{}: control(s, T.Attach{})
    case A.UserConfirm{}:
      control(A.with_candidate(A.with_observation(s, Observation.initialize()), None{}), T.Attach{})
    case A.Restore{}:
      A.passive(A.with_candidate(A.with_observation(A.with_batch(s, recover_batch(A.batch(s))),
        O.state(Observation.step(A.observation(s), O.Uncertain{}))), None{}))
    case A.UserCancel{}:
      control(A.with_candidate(A.with_broker(s,
        K.state(Broker.step(A.broker(s), K.Retire{}))), None{}), T.UserCancel{})
    case A.Observe{facts, text, signature, now, stable_ms, revision, slot}:
      observe(Bool.and(A.active(s), Bool.and(Nat.is_eq(slot, B.slot(A.batch(s))), Nat.is_eq(revision, K.revision(A.broker(s))))),
        s, facts, text, signature, now, stable_ms)
    case A.Encoded{revision, signature, output}: encoded(A.candidate(s), s, revision, signature, output)
    case A.BeginTool{id}: begin(A.tool_owner(s), s, id)
    case A.CallTool{id, wire, payload}: call(A.tool_allowed(s, wire), s, id, payload)
    case A.EndTool{id}: broker_result(s, Broker.step(A.broker(s), K.CompleteActivity{id}))
    case A.LocalResult{id, baseline}: local_result(s, Broker.step(A.broker(s), K.CompleteActivity{id}), baseline)
    case A.ToolResult{id, digest, baseline}: result(s, Broker.step(A.broker(s), K.CompleteCall{id, digest}), baseline)
    case A.Poll{}: poll_output(A.output(s), s)
