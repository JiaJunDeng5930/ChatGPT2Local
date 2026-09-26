#!/usr/bin/env python3
"""Check the proof closure, then build the exact Bend functions used by the host.

No fallback implementation, proof cache, global installation or remote imports.
The JS linker is deliberately specific to the pinned 2.0.27 emitter: an emitter
change is an error, not permission to guess a new entrypoint.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
BEND = ROOT / "bend"
GENERATED = ROOT / "src/verified/generated"
CACHE = ROOT / ".cache/bend"


def run(args: list[str], timeout: int = 120) -> str:
    result = subprocess.run(args, cwd=ROOT, text=True, capture_output=True, timeout=timeout)
    if result.returncode != 0 or result.stderr:
        raise RuntimeError(f"{' '.join(args)}\n{result.stdout}{result.stderr}")
    return result.stdout


def closure(entry: Path, visiting: frozenset[Path] = frozenset()) -> set[Path]:
    entry = entry.resolve()
    if entry in visiting:
        raise RuntimeError(f"cyclic Bend dependency: {entry.relative_to(ROOT)}")
    text = entry.read_text()
    if re.search(r"@unsafe|\?TODO|\?name", text):
        raise RuntimeError(f"unchecked term in {entry}")
    result = {entry}
    for name in re.findall(r"^import\s+(\S+)", text, re.M):
        if name == "Base":
            continue
        if not name.startswith("./") or not name.endswith(".bend"):
            raise RuntimeError(f"unapproved external dependency in {entry}: {name}")
        target = (entry.parent / name).resolve()
        if not target.is_relative_to(BEND):
            raise RuntimeError(f"dependency escaped pure kernel: {target}")
        result |= closure(target, visiting | {entry})
    return result


def check_boundaries() -> None:
    proofs = closure(BEND / "PROOF.bend")
    runtime = closure(BEND / "api.bend") | closure(BEND / "native-protocol.bend")
    if runtime - proofs:
        raise RuntimeError(f"runtime outside proof closure: {runtime - proofs}")
    for spec, implementation in [("specification", "kernel"), ("history-specification", "history"),
                                 ("batch-specification", "batch"), ("observation-specification", "observation"),
                                 ("surface-specification", "surface"), ("broker-specification", "broker"),
                                 ("progress-specification", "progress"), ("outbox-specification", "outbox"),
                                 ("replay-specification", "replay"), ("lease-specification", "lease")]:
        if (BEND / f"{implementation}.bend").resolve() in closure(BEND / f"{spec}.bend"):
            raise RuntimeError(f"specification depends on its implementation: {spec}")


def enum(name: str) -> list[str]:
    source = (BEND / "domain.bend").read_text()
    body = re.search(rf"type {name} is Data:\n((?:  [A-Za-z]+\{{\}}\n)+)", source)
    if body is None:
        raise RuntimeError(f"cannot decode public enum {name}")
    return re.findall(r"  ([A-Za-z]+)\{\}", body[1])


def compiler_path() -> str:
    local = ROOT / ".cache/bend-toolchain/installed/bin/bend"
    return os.environ.get("BEND") or (str(local) if local.is_file() else shutil.which("bend")) or str(Path.home() / ".bend/bin/bend")


def build(check: bool = False, native: bool = False) -> None:
    compiler = compiler_path()
    pin = json.loads((BEND / "toolchain.json").read_text())
    if run([compiler, "version"]).strip() != pin["compiler_version"]:
        raise RuntimeError("Bend compiler version differs from bend/toolchain.json")
    # `bend base` is the actual Base selected by this compiler, not a guessed install path.
    base = run([compiler, "base"])
    if hashlib.sha256(base.encode()).hexdigest() != pin["base_sha256"]:
        raise RuntimeError("Bend Base differs from the reviewed toolchain")
    check_boundaries()
    if run([compiler, "bend/PROOF.bend", "--check-only"]).strip() != pin["pure_success"]:
        raise RuntimeError("proof root did not report exact pure success")
    CACHE.mkdir(parents=True, exist_ok=True)
    GENERATED.mkdir(parents=True, exist_ok=True)
    emitted = CACHE / "core-emitted.js"
    run([compiler, "bend/api.bend", "-o", str(emitted)])
    js = emitted.read_text()
    marker = "\ncli(process.argv.slice(2));\nio_exit("
    if js.count(marker) != 1:
        raise RuntimeError("unknown Bend JS launcher ABI")
    js = js.split(marker)[0]
    for symbol in ["turn_step", "history_plan", "history_select", "transcript_item", "surface_resume", "lease_finish", "lease_attach", "batch_initialize", "batch_claim", "batch_restore", "batch_plan", "batch_step", "batch_ack", "observation_initialize", "observation_step", "observation_eligible", "broker_initialize", "broker_step", "broker_run", "progress_initialize", "progress_step", "progress_run", "progress_valid", "outbox_initialize", "outbox_step", "outbox_contains", "outbox_run", "replay_initialize", "replay_step", "replay_closed", "replay_terminal", "replay_run"]:
        if f"function ${symbol}$(" not in js:
            raise RuntimeError(f"Bend did not emit the production export {symbol}")
    digest = hashlib.sha256()
    for path in sorted(BEND.rglob("*")):
        if path.is_file():
            digest.update(path.relative_to(BEND).as_posix().encode() + b"\0" + path.read_bytes())
    digest.update(Path(__file__).read_bytes())
    fingerprint = digest.hexdigest()
    enums = {"phases": enum("Phase"), "events": enum("Event"), "effects": enum("Effect")}
    header = f'// Generated from Bend; do not edit. Source/toolchain/glue SHA256: {fingerprint}\n"use strict";\n'
    exports = "\nmodule.exports = Object.freeze({\n"
    exports += '  turnStep: run_lib($turn_step$, 2),\n  historyPlan: run_lib($history_plan$, 4),\n'
    exports += '  historySelect: run_lib($history_select$, 3),\n'
    exports += '  transcriptItem: run_lib($transcript_item$, 2),\n'
    exports += '  surfaceResume: run_lib($surface_resume$, 1),\n'
    exports += '  leaseFinish: run_lib($lease_finish$, 6),\n'
    exports += '  leaseAttach: run_lib($lease_attach$, 3),\n'
    exports += '  batchInitialize: run_lib($batch_initialize$, 0),\n  batchRestore: run_lib($batch_restore$, 1),\n  batchPlan: run_lib($batch_plan$, 2),\n  batchStep: run_lib($batch_step$, 2),\n  batchAck: run_lib($batch_ack$, 2),\n'
    exports += '  batchClaim: run_lib($batch_claim$, 1),\n'
    exports += '  observationInitialize: run_lib($observation_initialize$, 0),\n  observationStep: run_lib($observation_step$, 2),\n  observationEligible: run_lib($observation_eligible$, 1),\n'
    exports += '  brokerInitialize: run_lib($broker_initialize$, 1),\n  brokerStep: run_lib($broker_step$, 2),\n  brokerRun: run_lib($broker_run$, 2),\n'
    exports += '  progressInitialize: run_lib($progress_initialize$, 1),\n  progressStep: run_lib($progress_step$, 2),\n  progressRun: run_lib($progress_run$, 2),\n  progressValid: run_lib($progress_valid$, 1),\n'
    exports += '  outboxInitialize: run_lib($outbox_initialize$, 0),\n  outboxStep: run_lib($outbox_step$, 2),\n  outboxContains: run_lib($outbox_contains$, 2),\n  outboxRun: run_lib($outbox_run$, 2),\n'
    exports += '  replayInitialize: run_lib($replay_initialize$, 0),\n  replayStep: run_lib($replay_step$, 2),\n  replayClosed: run_lib($replay_closed$, 1),\n  replayTerminal: run_lib($replay_terminal$, 1),\n  replayRun: run_lib($replay_run$, 2),\n'
    for name, values in enums.items():
        exports += f"  {name}: Object.freeze({json.dumps(values)}),\n"
    exports += f"  fingerprint: {json.dumps(fingerprint)},\n}});\n"
    output = header + js + exports
    declaration = "// Generated from bend/domain.bend.\n"
    for name, singular in [("phases", "Phase"), ("events", "Event"), ("effects", "Effect")]:
        declaration += f"export type {singular} = " + " | ".join(json.dumps(x) for x in enums[name]) + ";\n"
        declaration += f"export const {name}: readonly {singular}[];\n"
    declaration += '''export type List<T> = { $: "Nil" } | { $: "Con"; head: T; tail: List<T> };
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
'''
    for name, text in [("core.cjs", output), ("core.d.cts", declaration)]:
        path = GENERATED / name
        if check:
            if not path.exists() or path.read_text() != text:
                raise RuntimeError(f"stale generated Bend output: {path.relative_to(ROOT)}")
        else:
            path.write_text(text)
    if native:
        binary = CACHE / ("verified-core.exe" if os.name == "nt" else "verified-core")
        run([compiler, "bend/main.bend", "-o", str(binary)])
        actual = run([str(binary), "--gpu", "off", "--threads", "1", "1", "1"]).strip()
        if actual != "Attempted:SendPrompt":
            raise RuntimeError(f"native boundary smoke failed: {actual}")
    print(f"Bend proof, boundaries and {'reproduction' if check else 'generation'} passed: {fingerprint}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--native", action="store_true")
    options = parser.parse_args()
    try:
        build(options.check, options.native)
    except (RuntimeError, OSError, subprocess.TimeoutExpired) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
