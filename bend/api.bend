import Base
import ./application.bend as Application
import ./application-domain.bend as AD
import ./domain.bend as D
import ./kernel.bend as K
import ./surface.bend as Surface
import ./surface-domain.bend as SD
import ./batch.bend as Batch
import ./batch-domain.bend as BD
import ./observation.bend as Observation
import ./observation-domain.bend as OD
import ./broker.bend as Broker
import ./broker-domain.bend as BR
import ./progress.bend as Progress
import ./progress-domain.bend as PD
import ./outbox.bend as Outbox
import ./outbox-domain.bend as OB
import ./replay.bend as Replay
import ./replay-domain.bend as RP
import ./lease.bend as Lease
import ./lease-domain.bend as LD

import ./request.bend as Request
import ./request-domain.bend as RQD

def request_admit(key: RQD.Key, parent: RQD.Parent, input: RQD.Input) -> RQD.Admission:
  Request.decide(key, parent, input)

def app_initialize(full: Bool, tools: List<&2, String>, environment: String) -> AD.State:
  Application.initialize(full, tools, environment)

def app_step(state: AD.State, input: AD.Input) -> AD.Decision:
  Application.step(state, input)

def app_authorized(state: AD.State, effect: AD.Effect) -> Bool:
  AD.authorized(state, effect)

def turn_step(s: D.Phase, e: D.Event) -> D.Decision:
  K.step(s, e)

def surface_resume(evidence: SD.Evidence) -> Bool:
  Surface.resume(evidence)

def lease_finish(report: LD.Report, surface_error: Bool, retain: Bool,
                 conversation: Bool, connector: Bool, bound: Bool) -> LD.Decision:
  Lease.finish(report, surface_error, retain, conversation, connector, bound)

def lease_attach(unknown: Bool, same_owner: Bool, owner_alive: Bool) -> LD.Admission:
  Lease.attach(unknown, same_owner, owner_alive)

def batch_initialize() -> BD.State:
  Batch.initialize()

def batch_claim(state: BD.State) -> BD.Decision:
  Batch.claim(state)

def batch_restore(receipt: BD.Restoration) -> BD.State:
  Batch.restore(receipt)

def batch_plan(state: BD.State, payloads: List<&2, String>) -> BD.Decision:
  Batch.plan(state, payloads)

def batch_step(state: BD.State, event: D.Event) -> BD.Decision:
  Batch.transition(state, BD.Control{event})

def batch_ack(state: BD.State, stage: Nat) -> BD.Decision:
  Batch.transition(state, BD.StageAcknowledged{stage})

def observation_initialize() -> OD.State:
  Observation.initialize()

def observation_step(state: OD.State, event: OD.Event) -> OD.Decision:
  Observation.step(state, event)

def observation_eligible(facts: OD.Facts) -> Bool:
  Observation.eligible(facts)

def broker_initialize(environment: String) -> BR.State:
  Broker.initialize(environment)

def broker_step(state: BR.State, event: BR.Event) -> BR.Decision:
  Broker.step(state, event)

def broker_run(events: List<&2, BR.Event>, state: BR.State) -> List<&2, BR.Decision>:
  Broker.run(events, state)

def progress_initialize(role: PD.Role) -> PD.State:
  Progress.initialize(role)

def progress_step(state: PD.State, event: PD.Event) -> PD.Decision:
  Progress.step(state, event)

def progress_run(events: List<&2, PD.Event>, state: PD.State) -> List<&2, PD.Decision>:
  Progress.run(events, state)

def progress_valid(snapshot: PD.Snapshot) -> Bool:
  Progress.valid(snapshot)

def outbox_initialize() -> OB.State:
  Outbox.initialize()

def outbox_step(state: OB.State, event: OB.Event) -> OB.Decision:
  Outbox.step(state, event)

def outbox_contains(state: OB.State, id: String) -> Bool:
  OB.member(id, OB.names(OB.pending(state)))

def outbox_run(events: List<&2, OB.Event>, state: OB.State) -> List<&2, OB.Decision>:
  Outbox.run(events, state)

def replay_initialize() -> RP.State:
  Replay.initialize()

def replay_step(state: RP.State, event: RP.Event) -> RP.Decision:
  Replay.step(state, event)

def replay_closed(state: RP.State) -> Bool:
  RP.closed(RP.status(state))

def replay_terminal(state: RP.State) -> Bool:
  RP.has_terminal(RP.events(state))

def replay_run(events: List<&2, RP.Event>, state: RP.State) -> List<&2, RP.Decision>:
  Replay.run(events, state)

# The compiler requires a printable entry. This only establishes export roots;
# the host invokes the real public functions above, never this smoke value.
type Exports is Data:
  Exports{turn: D.Decision, request: RQD.Admission, surface: Bool, lease: LD.Decision, admission: LD.Admission, batch: BD.Decision, restored: BD.State,
          batch_decision: BD.Decision, batch_acknowledgement: BD.Decision,
          observation: OD.Decision, eligible_observation: Bool,
          broker: BR.Decision, broker_trace: List<&2, BR.Decision>,
          progress: PD.Decision, progress_trace: List<&2, PD.Decision>, valid_progress: Bool,
          outbox: OB.Decision, contains: Bool, outbox_trace: List<&2, OB.Decision>,
          replay: RP.Decision, closed_replay: Bool, terminal_replay: Bool, replay_trace: List<&2, RP.Decision>,
          application: AD.Decision, authorization: Bool}

def main() -> Exports:
  Exports{
    turn_step(D.Prepared{}, D.Submit{}),
    request_admit(RQD.FreshKey{}, RQD.Root{}, RQD.Messages{}),
    surface_resume(SD.Evidence{False{}, False{}, False{}, False{}, "", "", "", "", "", "", ""}),
    lease_finish(LD.Uncertain{}, False{}, False{}, False{}, False{}, False{}),
    lease_attach(False{}, False{}, False{}),
    batch_plan(BD.state(batch_claim(batch_initialize())), Con{"prompt", Nil{}}),
    batch_restore(BD.PendingIntent{}),
    batch_step(BD.Batch{D.Prepared{}, 0n, "prompt", Nil{}}, D.Submit{}),
    batch_ack(BD.Batch{D.Attempted{}, 0n, "prompt", Nil{}}, 1n),
    observation_step(observation_initialize(), OD.Uncertain{}),
    observation_eligible(OD.Facts{True{}, False{}, True{}, True{}, False{}, False{}, False{}}),
    broker_step(broker_initialize("environment"), BR.BeginFence{}),
    broker_run(Con{BR.BeginFence{}, Nil{}}, broker_initialize("environment")),
    progress_step(progress_initialize(PD.Recorder{}), PD.RecordBatch{1n, 0n}),
    progress_run(Con{PD.Retire{}, Nil{}}, progress_initialize(PD.Replica{})),
    progress_valid(PD.Snapshot{0n, 0n, 0n, None{}}),
    outbox_step(outbox_initialize(), OB.Receipt{"example"}),
    outbox_contains(outbox_initialize(), "example"),
    outbox_run(Con{OB.Receipt{"example"}, Nil{}}, outbox_initialize()),
    replay_step(replay_initialize(), RP.Seal{}),
    replay_closed(replay_initialize()), replay_terminal(replay_initialize()),
    replay_run(Con{RP.Seal{}, Nil{}}, replay_initialize()),
    app_step(app_initialize(False{}, Nil{}, "environment"), AD.Detached{}),
    app_authorized(app_initialize(False{}, Nil{}, "environment"), AD.Passive{})
  }
