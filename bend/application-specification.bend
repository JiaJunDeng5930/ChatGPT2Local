import Base
import ./application-domain.bend as A
import ./domain.bend as T
import ./batch-domain.bend as B
import ./batch-specification.bend as Batch
import ./broker-domain.bend as K
import ./observation-domain.bend as O
import ./observation-specification.bend as Observation

# The browser is an external participant. Lack of knowledge is not a command
# capability. These predicates deliberately inspect the externally observable
# effect, not merely the resulting lifecycle state.
def nonintervening(effect: A.Effect) -> Bool:
  match effect:
    case A.Passive{}: True{}
    case A.EncodeFinal{r, s, t}: True{}
    case A.Publish{output}: True{}
    case A.BrowserCommand{+command, slot, payload}:
      Bool.and(Nat.is_eq(T.sends(command), 0n), Bool.not(T.stops(command)))

def publication_safe(effect: A.Effect, obligations: Bool) -> Bool:
  match effect:
    case A.Publish{output}: Bool.not(obligations)
    case _: True{}

def batch_receipt(s: A.State, decision: B.Decision) -> A.Decision:
  match decision:
    case B.BatchDecision{+next, +command}:
      A.Decision{A.with_batch(s, next),
        A.browser_effect(command, B.slot(next), A.payload(next)), A.control_reply(command)}

# The complete state, browser command, and reply refine the independent
# event-oriented batch specification, including rejected commands.
def control(+s: A.State, event: T.Event) -> A.Decision:
  batch_receipt(s, Batch.step(event, A.batch(s)))

# Local and forwarded tool results have the same causal status. The text
# boundary, broker receipt, and invalidation of an old final commit together.
def local_completion(+s: A.State, +broker: K.State, baseline: String) -> A.Decision:
  A.Decision{A.with_candidate(A.with_broker(A.with_observation(s,
      O.state(Observation.step(O.CaptureBoundary{K.revision(broker), baseline},
        A.observation(s)))), broker), None{}),
    A.Passive{}, A.ToolReceipt{K.ActivityClosed{True{}}}}

# A candidate belongs to one observed document signature and one tool
# revision. Publication requires both observations still to describe it.
def publication_fence(candidate: Maybe<&2, A.Publication>, actual: Nat,
                      +revision: Nat, signature: String) -> Bool:
  match candidate:
    case None{}: False{}
    case Some{A.Publication{expected, observed, text}}:
      Bool.and(Nat.is_eq(expected, revision),
        Bool.and(Nat.is_eq(actual, revision), String.eq(observed, signature)))

def publication_authorized(effect: A.Effect, permission: Bool) -> Bool:
  match effect:
    case A.Publish{output}: permission
    case _: True{}
