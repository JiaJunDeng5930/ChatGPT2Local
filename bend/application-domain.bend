import Base
import ./domain.bend as Turn
import ./batch-domain.bend as Batch
import ./broker-domain.bend as Broker
import ./observation-domain.bend as Observation

# This is the production application state. The host persists this value, not
# parallel lifecycle flags, retry counters, completion flags, or tool queues.
type Publication is Data:
  Publication{revision: Nat, signature: String, text: String}

type State is Data:
  Application{full: Bool, tools: List<&2, String>, batch: Batch.State,
              broker: Broker.State, observation: Observation.State,
              latest: String, candidate: Maybe<&2, Publication>, output: Maybe<&2, String>}

type Input is Data:
  Install{payloads: List<&2, String>}
  Ready{}
  SubmissionSeen{slot: Nat}
  Uncertain{}
  Detached{}
  Reattach{}
  UserConfirm{}
  Restore{}
  UserCancel{}
  Observe{facts: Observation.Facts, text: String, signature: String,
          now: Nat, stable_ms: Nat, revision: Nat, slot: Nat}
  Encoded{revision: Nat, signature: String, output: String}
  BeginTool{id: String}
  CallTool{id: String, wire: String, payload: String}
  EndTool{id: String}
  LocalResult{id: String, baseline: String}
  ToolResult{id: String, digest: String, baseline: String}
  Poll{}

type Effect is Data:
  Passive{}
  BrowserCommand{command: Turn.Effect, slot: Nat, payload: String}
  EncodeFinal{revision: Nat, signature: String, text: String}
  Publish{output: String}

type Reply is Data:
  Silent{}
  Rejected{reason: String}
  ToolReceipt{receipt: Broker.Effect}
  FinalReceipt{output: String}
  CancelledReceipt{}

type Decision is Data:
  Decision{state: State, effect: Effect, reply: Reply}

def state(d: Decision) -> State:
  match d:
    case Decision{s, e, r}: s

def effect(d: Decision) -> Effect:
  match d:
    case Decision{s, e, r}: e

def batch(s: State) -> Batch.State:
  match s:
    case Application{f, t, b, k, o, l, c, r}: b

def broker(s: State) -> Broker.State:
  match s:
    case Application{f, t, b, k, o, l, c, r}: k

def observation(s: State) -> Observation.State:
  match s:
    case Application{f, t, b, k, o, l, c, r}: o

def latest(s: State) -> String:
  match s:
    case Application{f, t, b, k, o, l, c, r}: l

def candidate(s: State) -> Maybe<&2, Publication>:
  match s:
    case Application{f, t, b, k, o, l, c, r}: c

def output(s: State) -> Maybe<&2, String>:
  match s:
    case Application{f, t, b, k, o, l, c, r}: r

def with_batch(s: State, b: Batch.State) -> State:
  match s:
    case Application{f, t, old, k, o, l, c, r}: Application{f, t, b, k, o, l, c, r}

def with_broker(s: State, k: Broker.State) -> State:
  match s:
    case Application{f, t, b, old, o, l, c, r}: Application{f, t, b, k, o, l, c, r}

def with_observation(s: State, o: Observation.State) -> State:
  match s:
    case Application{f, t, b, k, old, l, c, r}: Application{f, t, b, k, o, l, c, r}

def with_latest(s: State, l: String) -> State:
  match s:
    case Application{f, t, b, k, o, old, c, r}: Application{f, t, b, k, o, l, c, r}

def with_candidate(s: State, c: Maybe<&2, Publication>) -> State:
  match s:
    case Application{f, t, b, k, o, l, old, r}: Application{f, t, b, k, o, l, c, r}

def with_output(s: State, r: Maybe<&2, String>) -> State:
  match s:
    case Application{f, t, b, k, o, l, c, old}: Application{f, t, b, k, o, l, c, r}

def active_phase(p: Turn.Phase) -> Bool:
  match p:
    case Turn.Attempted{}: True{}
    case Turn.Running{}: True{}
    case Turn.Unknown{}: True{}
    case _: False{}

def active(s: State) -> Bool:
  active_phase(Batch.phase(batch(s)))

def final_stage(b: Batch.State) -> Bool:
  match b:
    case Batch.Batch{p, n, text, Nil{}}: active_phase(p)
    case Batch.Closed{p}: active_phase(p)
    case _: False{}

def tool_owner(s: State) -> Bool:
  match s:
    case Application{full, tools, b, k, o, l, c, r}:
      Bool.and(full, final_stage(b))

def member(+wire: String, tools: List<&2, String>) -> Bool:
  match tools:
    case Nil{}: False{}
    case Con{h, t}: Bool.or(String.eq(wire, h), member(wire, t))

def tool_allowed(s: State, +wire: String) -> Bool:
  match s:
    case Application{full, tools, b, k, o, l, c, r}:
      Bool.and(full, Bool.and(final_stage(b), member(wire, tools)))

def payload(b: Batch.State) -> String:
  match b:
    case Batch.Batch{p, n, text, rest}: text
    case _: ""

def environment(k: Broker.State) -> String:
  match k:
    case Broker.Broker{life, env, n, a, i}: env

def acknowledgement(+s: State) -> String:
  "CONTEXT_ACK " ++ environment(broker(s)) ++ ":" ++ Nat.show(1n+Batch.slot(batch(s)))

def remaining_batch(b: Batch.State) -> List<&2, String>:
  match b:
    case Batch.Batch{p, n, text, rest}: rest
    case _: Nil{}

def remaining(s: State) -> List<&2, String>:
  remaining_batch(batch(s))

def passive(s: State) -> Decision:
  Decision{s, Passive{}, Silent{}}

def reject(s: State, reason: String) -> Decision:
  Decision{s, Passive{}, Rejected{reason}}

def sends(e: Effect) -> Nat:
  match e:
    case BrowserCommand{command, slot, payload}: Turn.sends(command)
    case _: 0n

def stops(e: Effect) -> Bool:
  match e:
    case BrowserCommand{command, slot, payload}: Turn.stops(command)
    case _: False{}

# Read-only observation is a standing subscription, not a physical outbox
# command. Only the three commands below can mutate the external webpage.
def browser_effect(command: Turn.Effect, slot: Nat, payload: String) -> Effect:
  match command:
    case Turn.PrepareSurface{}: BrowserCommand{Turn.PrepareSurface{}, slot, payload}
    case Turn.SendPrompt{}: BrowserCommand{Turn.SendPrompt{}, slot, payload}
    case Turn.StopByUser{}: BrowserCommand{Turn.StopByUser{}, slot, payload}
    case _: Passive{}

def control_reply(command: Turn.Effect) -> Reply:
  match command:
    case Turn.Reject{}: Rejected{"command_not_admitted"}
    case _: Silent{}

def command_phase(command: Turn.Effect, phase: Turn.Phase) -> Bool:
  match command phase:
    case Turn.PrepareSurface{} Turn.Prepared{}: True{}
    case Turn.SendPrompt{} Turn.Attempted{}: True{}
    case Turn.StopByUser{} Turn.Cancelled{}: True{}
    case _ _: False{}

def closed_command(command: Turn.Effect, phase: Turn.Phase) -> Bool:
  match command phase:
    case Turn.StopByUser{} Turn.Cancelled{}: True{}
    case _ _: False{}

def command_authority(b: Batch.State, command: Turn.Effect, slot: Nat, payload: String) -> Bool:
  match b:
    case Batch.Batch{phase, current, text, pending}:
      Bool.and(command_phase(command, phase), Bool.and(Nat.is_eq(current, slot), String.eq(text, payload)))
    case Batch.Closed{phase}: closed_command(command, phase)
    case _: False{}

def encoding_authority(candidate: Maybe<&2, Publication>, revision: Nat, signature: String, text: String) -> Bool:
  match candidate:
    case None{}: False{}
    case Some{Publication{expected, original, answer}}:
      Bool.and(Nat.is_eq(expected, revision), Bool.and(String.eq(original, signature), String.eq(answer, text)))

def publication_authority(output: Maybe<&2, String>, text: String) -> Bool:
  match output:
    case None{}: False{}
    case Some{receipt}: String.eq(receipt, text)

# Checked when an effect is claimed, against the final committed application
# state, not the temporary state that originally produced the intent.
def authorized(+s: State, effect: Effect) -> Bool:
  match effect:
    case Passive{}: True{}
    case BrowserCommand{command, slot, payload}: command_authority(batch(s), command, slot, payload)
    case EncodeFinal{revision, signature, text}: encoding_authority(candidate(s), revision, signature, text)
    case Publish{text}: publication_authority(output(s), text)
