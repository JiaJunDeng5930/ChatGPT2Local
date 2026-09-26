// Generated from bend/domain.bend.
export type Phase = "Fresh" | "Prepared" | "Attempted" | "Running" | "Unknown" | "Completed" | "Cancelled";
export const phases: readonly Phase[];
export type Event = "Prepare" | "Submit" | "Accepted" | "Finished" | "Uncertain" | "Attach" | "Detach" | "Recover" | "UserCancel";
export const events: readonly Event[];
export type Effect = "PrepareSurface" | "SendPrompt" | "ObserveOnly" | "PublishFinal" | "ReplayFinal" | "StopByUser" | "NoEffect" | "Reject";
export const effects: readonly Effect[];
export type List<T> = { $: "Nil" } | { $: "Con"; head: T; tail: List<T> };
export function turnStep(state: { $: Phase }, event: { $: Event }): { $: "Decision"; phase: { $: Phase }; effect: { $: Effect } };
export function historyPlan(oldEnvironment: string, environment: string, known: List<string>, incoming: List<string>): { $: "None" } | { $: "Some"; value: bigint };
export interface HistoryReceipt { $: "Receipt"; key: string; environment: string; messages: List<string> }
export function historySelect(receipts: List<HistoryReceipt>, environment: string, incoming: List<string>): { $: "NewConversation" } | { $: "ReuseConversation"; key: string; offset: bigint };
export function transcriptItem(kind: string, role: string): boolean;
export function surfaceResume(evidence: { $: "Evidence"; present: boolean; untouched: boolean; idle: boolean; assistant_tail: boolean; recorded_key: string; key: string; recorded_operation: string; operation: string; recorded_answer: string; expected_answer: string; answer: string }): boolean;
export type Batch = { $: "Unclaimed" } | { $: "Unplanned" } | { $: "Closed"; phase: { $: Phase } } | { $: "Batch"; phase: { $: Phase }; slot: bigint; current: string; pending: List<string> };
export interface BatchDecision { $: "BatchDecision"; state: Batch; effect: { $: Effect } }
export function batchInitialize(): Batch;
export function batchClaim(state: Batch): BatchDecision;
export function batchRestore(receipt: { $: "PendingIntent" | "FinalReceipt" | "CancellationReceipt" }): Batch;
export function batchPlan(state: Batch, payloads: List<string>): BatchDecision;
export function batchStep(state: Batch, event: { $: Event }): BatchDecision;
export function batchAck(state: Batch, stage: bigint): BatchDecision;
export type Maybe<T> = { $: "None" } | { $: "Some"; value: T };
export type ObservationState = { $: "Watching"; revision: bigint; baseline: Maybe<string> } | { $: "Candidate"; revision: bigint; baseline: Maybe<string>; signature: string; since: bigint };
export interface ObservationFacts { $: "Facts"; present: boolean; running: boolean; has_text: boolean; completion_control: boolean; reply_error: boolean; stopped_badge: boolean; tools_in_flight: boolean }
export type ObservationEvent = { $: "Uncertain" } | { $: "CaptureBoundary"; revision: bigint; text: string } | { $: "Sample"; facts: ObservationFacts; text: string; signature: string; now: bigint; stable_ms: bigint };
export type ObservationEffect = "ObserveOnly" | "WaitForTools" | "WaitForPostToolAnswer" | "CandidateReady" | "BoundaryCaptured" | "DuplicateBoundary" | "RejectBoundary";
export interface ObservationDecision { $: "Decision"; state: ObservationState; effect: { $: ObservationEffect } }
export function observationInitialize(): ObservationState;
export function observationStep(state: ObservationState, event: ObservationEvent): ObservationDecision;
export function observationEligible(facts: ObservationFacts): boolean;
export type BrokerLifetime = { $: "Open" | "Retired" } | { $: "Sealed"; revision: bigint };
export interface BrokerActivity { $: "Activity"; id: string; completed: boolean }
export type BrokerDelivery = { $: "Queued" | "Delivered" } | { $: "Result"; digest: string };
export interface BrokerInvocation { $: "Invocation"; id: string; payload: string; delivery: BrokerDelivery }
export interface BrokerState { $: "Broker"; lifetime: BrokerLifetime; environment: string; revision: bigint; activities: List<BrokerActivity>; invocations: List<BrokerInvocation> }
export type BrokerEvent = { $: "ClaimActivity" | "CompleteActivity"; id: string }
  | { $: "Enqueue"; id: string; payload: string } | { $: "Poll" | "BeginFence" | "Retire" }
  | { $: "CompleteCall"; id: string; digest: string } | { $: "CommitFence"; revision: bigint }
  | { $: "CheckEnvironment"; environment: string };
export type BrokerRejection = "OwnerClosed" | "ActivityAlreadyCompleted" | "DuplicateInvocation"
  | "CallNotPending" | "CallNotDelivered" | "ConflictingResult" | "EnvironmentChanged";
export type BrokerEffect = { $: "ActivityClaimed" | "ActivityReplayed" | "ActivityReceiptReplayed" | "InvocationQueued"
  | "WaitForCalls" | "ResultAccepted" | "ResultReplayed" | "FenceUnavailable" | "FenceCommitted" | "FenceStale"
  | "EnvironmentAccepted" | "OwnerRetired" | "RetirementReplayed" | "LateActivityReceipt" }
  | { $: "ActivityClosed"; was_active: boolean } | { $: "CallsDelivered" | "CallsReplayed"; ids: List<string> }
  | { $: "FenceOffered"; revision: bigint } | { $: "Reject"; reason: { $: BrokerRejection } };
export interface BrokerDecision { $: "Decision"; state: BrokerState; effect: BrokerEffect }
export function brokerInitialize(environment: string): BrokerState;
export function brokerStep(state: BrokerState, event: BrokerEvent): BrokerDecision;
export function brokerRun(events: List<BrokerEvent>, state: BrokerState): List<BrokerDecision>;
export interface ProgressSnapshot { $: "Snapshot"; revision: bigint; batch: bigint; active: bigint; time: Maybe<bigint> }
export type ProgressRole = "Recorder" | "Replica";
export interface ProgressState { $: "Progress"; role: { $: ProgressRole }; snapshot: ProgressSnapshot; observed: bigint; batches: List<bigint>; retired: boolean }
export type ProgressEvent = { $: "RecordBatch"; count: bigint; now: bigint } | { $: "RecordResult"; now: bigint }
  | { $: "CheckBatch" | "Acknowledge"; revision: bigint } | { $: "Import"; snapshot: ProgressSnapshot } | { $: "Retire" };
export type ProgressRejection = "WrongRole" | "EmptyBatch" | "NoPendingCall" | "InvalidBatch" | "InvalidSnapshot"
  | "RegressedSnapshot" | "ConflictingSnapshot" | "OwnerRetired";
export type ProgressEffect = { $: "ProgressChanged" | "ObservationNeeded" | "ObservationKnown" | "ObservationCommitted"
  | "ObservationReplayed" | "FrameIgnored" | "OwnerClosed" | "RetirementReplayed" }
  | { $: "Reject"; reason: { $: ProgressRejection } };
export interface ProgressDecision { $: "Decision"; state: ProgressState; effect: ProgressEffect }
export function progressInitialize(role: { $: ProgressRole }): ProgressState;
export function progressStep(state: ProgressState, event: ProgressEvent): ProgressDecision;
export function progressRun(events: List<ProgressEvent>, state: ProgressState): List<ProgressDecision>;
export function progressValid(snapshot: ProgressSnapshot): boolean;
export interface OutboxCall { $: "Call"; id: string; payload: string }
export interface OutboxState { $: "Outbox"; pending: List<OutboxCall>; spent: List<string>; prelude: string }
export type OutboxEvent = { $: "Offer"; calls: List<OutboxCall>; prelude: string } | { $: "Receipt"; id: string };
export interface OutboxDecision { $: "Decision"; state: OutboxState; effect: { $: "BatchPublished" | "ReceiptRecorded" }
  | { $: "Reject"; reason: { $: "PendingBatch" | "EmptyBatch" | "DuplicateCall" | "UnknownCall" } } }
export function outboxInitialize(): OutboxState;
export function outboxStep(state: OutboxState, event: OutboxEvent): OutboxDecision;
export function outboxContains(state: OutboxState, id: string): boolean;
export function outboxRun(events: List<OutboxEvent>, state: OutboxState): List<OutboxDecision>;
export interface ReplayFrame { $: "Frame"; kind: string; payload: string }
export type ReplayStatus = { $: "Open" | "Sealed" } | { $: "Failed"; reason: string };
export interface ReplayState { $: "Journal"; status: ReplayStatus; events: List<ReplayFrame>; reasoning: List<string> }
export type ReplayEvent = { $: "Append"; events: List<ReplayFrame> } | { $: "Reason"; parts: List<string> } | { $: "Seal" } | { $: "Fail"; reason: string };
export interface ReplayDecision { $: "Decision"; state: ReplayState; effect: { $: "Appended" | "ReasonRecorded" | "Closed" | "CloseReplayed" | "FailureRecorded" | "FailureReplayed" }
  | { $: "Reject"; reason: { $: "JournalClosed" | "TerminalAlreadyPresent" | "TerminalNotLast" | "ConflictingFailure" } } }
export function replayInitialize(): ReplayState;
export function replayStep(state: ReplayState, event: ReplayEvent): ReplayDecision;
export function replayClosed(state: ReplayState): boolean;
export function replayTerminal(state: ReplayState): boolean;
export function replayRun(events: List<ReplayEvent>, state: ReplayState): List<ReplayDecision>;
export interface LeaseDecision { $: "Decision"; status: { $: "Ready" | "Unknown" | "Cancelled" }; reusable: boolean; protect: boolean }
export function leaseFinish(report: { $: "Completed" | "Uncertain" | "UserCancelled" }, surfaceError: boolean, retain: boolean, conversation: boolean, connector: boolean, bound: boolean): LeaseDecision;
export function leaseAttach(unknown: boolean, sameOwner: boolean, ownerAlive: boolean): { $: "Reattach" | "OwnerBusy" | "OwnerUnknown" };
export const fingerprint: string;
