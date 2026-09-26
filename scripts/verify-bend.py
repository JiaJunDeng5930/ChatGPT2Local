#!/usr/bin/env python3
"""Reproduce the Bend build and challenge actual semantics, never just syntax.

Each mutant first passes the unchanged PURE runtime entrypoint. The same proof
root must then reject it with a type/equality mismatch. A parse error, missing
dependency, timeout or tool failure is not credited as a detected regression.
No mutable compiler installation and no mutation of the working tree are used.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("bend_build", ROOT / "scripts/build-bend-core.py")
assert spec and spec.loader
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)

MUTATIONS = [
    ("resend-an-unknown-operation", "kernel.bend",
     "case D.Submit{}: D.Decision{D.Unknown{}, D.Reject{}}",
     "case D.Submit{}: D.Decision{D.Attempted{}, D.SendPrompt{}}"),
    ("cancel-on-uncertainty", "kernel.bend",
     "case D.Uncertain{}: D.Decision{D.Unknown{}, D.ObserveOnly{}}",
     "case D.Uncertain{}: D.Decision{D.Cancelled{}, D.StopByUser{}}"),
    ("cancel-on-disconnect", "kernel.bend",
     "case D.Detach{}: D.Decision{D.Running{}, D.NoEffect{}}",
     "case D.Detach{}: D.Decision{D.Cancelled{}, D.StopByUser{}}"),
    ("accept-a-divergent-history", "history.bend",
     "case False{} _: None{}", "case False{} _: Some{0n}"),
    ("reuse-history-from-a-different-environment", "history.bend",
     "case False{}: None{}", "case False{}: prefix"),
    ("select-an-empty-history-prefix", "history.bend",
     "Bool.and(Nat.is_gt(n, 0n), Nat.is_lt(n, length))",
     "Nat.is_lt(n, length)"),
    ("select-a-shorter-history-receipt", "history.bend",
     "Bool.or(Nat.is_gt(na, nb), Bool.and(Nat.is_eq(na, nb), String.is_le(ka, kb)))",
     "Bool.or(Nat.is_lt(na, nb), Bool.and(Nat.is_eq(na, nb), String.is_le(ka, kb)))"),
    ("credit-an-unsent-developer-message", "transcript.bend",
     'String.eq(role, "assistant")', 'String.eq(role, "developer")'),
    ("finish-before-the-final-payload", "batch.bend",
     "B.BatchDecision{B.Batch{phase, slot, current, Con{h, t}}, D.Reject{}}",
     "B.BatchDecision{B.Batch{D.Completed{}, slot, current, Con{h, t}}, D.PublishFinal{}}"),
    ("accept-an-out-of-order-stage-receipt", "batch.bend",
     "Bool.and(active(phase), Nat.is_eq(1n+slot, stage))",
     "Bool.and(active(phase), True{})"),
    ("reuse-a-spent-owner-reservation", "batch.bend",
     "case B.Unplanned{}: B.BatchDecision{B.Unplanned{}, D.Reject{}}",
     "case B.Unplanned{}: B.BatchDecision{B.Unplanned{}, D.NoEffect{}}"),
    ("complete-while-a-tool-is-in-flight", "observation.bend",
     "case O.Facts{True{}, False{}, True{}, True{}, False{}, False{}, False{}}: True{}",
     "case O.Facts{True{}, False{}, True{}, True{}, False{}, False{}, _}: True{}"),
    ("forget-the-post-tool-boundary-on-uncertainty", "observation.bend",
     "case O.Uncertain{}: O.Decision{O.Watching{revision, baseline}, O.ObserveOnly{}}",
     "case O.Uncertain{}: O.Decision{O.Watching{0n, None{}}, O.ObserveOnly{}}"),
    ("reuse-a-page-with-another-live-answer", "surface.bend",
     "case True{} True{} True{} True{} True{} True{} True{} True{}: True{}",
     "case True{} True{} True{} True{} True{} True{} True{} _: True{}"),
    ("commit-a-stale-terminal-fence", "broker.bend",
     "case False{}: D.Decision{state, D.FenceStale{}}",
     "case False{}: D.Decision{D.replace_lifetime(state, D.Sealed{revision}), D.FenceCommitted{}}"),
    ("regress-the-progress-clock", "progress.bend",
     "case Some{old}: Some{Maximum.maximum(old, now)}",
     "case Some{old}: Some{now}"),
    ("forget-spent-tool-call-identities", "outbox.bend",
     "List.append(&2, String, D.names(calls), spent)",
     "D.names(calls)"),
    ("discard-output-when-sealing-a-replay", "replay.bend",
     "case D.Seal{}: D.Decision{D.Journal{D.Sealed{}, events, reasoning}, D.Closed{}}",
     "case D.Seal{}: D.Decision{D.Journal{D.Sealed{}, Nil{}, reasoning}, D.Closed{}}"),
    ("unprotect-an-unknown-webpage", "lease.bend",
     "case D.Uncertain{} _: D.Decision{D.Unknown{}, False{}, True{}}",
     "case D.Uncertain{} _: D.Decision{D.Unknown{}, False{}, False{}}"),
    ("automatically-reassign-an-orphaned-webpage", "lease.bend",
     "case False{} False{} False{}: D.OwnerUnknown{}",
     "case False{} False{} False{}: D.Reattach{}"),
]


def compiler() -> str:
    return build.compiler_path()


def invoke(entry: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run([compiler(), str(entry), "--check-only"], cwd=ROOT,
                          text=True, capture_output=True, timeout=120)


def proof_gate_probes() -> list[dict[str, str]]:
    """Challenge the compiler's purity protocol separately from semantic mutants."""
    probes = [
        ("missing-proof", "law witness:\n  for n: Nat\n  {n == n : Nat}\n", "TODO found"),
        ("false-proof", "def witness(n: Nat) -> {0n == 1n : Nat}: {==}\n", "expected"),
        ("proof-hole", "def witness(n: Nat) -> {n == n : Nat}: ?TODO\n", "TODO found"),
        ("unchecked-proof", "@unsafe def witness(n: Nat) -> {0n == 1n : Nat}: witness(n)\n", "unsafe or foreign"),
        ("circular-proof", "def witness(n: Nat) -> {0n == 1n : Nat}: witness(n)\n", "decreasing self-call"),
    ]
    records = []
    with tempfile.TemporaryDirectory(prefix="proof-gate-", dir=ROOT / ".cache/bend") as temporary:
        entry = Path(temporary) / "probe.bend"
        entry.write_text("import Base\ndef witness(n: Nat) -> {n == n : Nat}: {==}\n")
        positive = invoke(entry)
        if positive.returncode != 0 or positive.stderr or positive.stdout.strip() != "All terms check.":
            raise RuntimeError("The positive proof-gate control did not pass")
        for name, source, diagnostic in probes:
            entry.write_text("import Base\n" + source)
            result = invoke(entry)
            text = result.stdout + result.stderr
            accepted = result.returncode == 0 and not result.stderr and result.stdout.strip() == "All terms check."
            if accepted or diagnostic not in text:
                raise RuntimeError(f"Proof-gate probe did not fail for the intended reason: {name}\n{text}")
            # Unchecked recursion returns exit 0 in the pinned compiler. A
            # successful exit alone must never count as proof evidence.
            records.append({"probe": name, "gate": "rejected"})
            print(f"PASS proof-gate probe: {name}")
    return records


def mutants() -> list[dict[str, str]]:
    records = []
    cache = ROOT / ".cache/bend"
    cache.mkdir(parents=True, exist_ok=True)
    for name, filename, before, after in MUTATIONS:
        with tempfile.TemporaryDirectory(prefix="mutant-", dir=cache) as temporary:
            copied = Path(temporary) / "bend"
            shutil.copytree(ROOT / "bend", copied)
            path = copied / filename
            source = path.read_text()
            if before not in source:
                raise RuntimeError(f"mutant no longer applies to reviewed source: {name}")
            path.write_text(source.replace(before, after, 1))
            positive = invoke(copied / "api.bend")
            if positive.returncode != 0 or positive.stderr or positive.stdout.strip() != "All terms check.":
                raise RuntimeError(f"mutant was not well typed at runtime: {name}\n{positive.stdout}{positive.stderr}")
            negative = invoke(copied / "PROOF.bend")
            diagnostic = negative.stdout + negative.stderr
            if negative.returncode == 0 or "expected" not in diagnostic or "observed" not in diagnostic:
                raise RuntimeError(f"proof did not reject the semantic mutant: {name}\n{diagnostic}")
            if any(word in diagnostic.lower() for word in ("unfilled", "not found", "parse error", "unexpected token")):
                raise RuntimeError(f"non-semantic rejection cannot count as a killed mutant: {name}\n{diagnostic}")
            records.append({"mutation": name, "runtime": "pure/type-correct", "proof": "rejected equality/type mismatch"})
            print(f"PASS semantic mutant: {name}")
    return records


def native_differential() -> int:
    node = os.environ.get("NODE") or shutil.which("node")
    if not node:
        raise RuntimeError("Node is required to compare the native and JavaScript effect boundaries")
    table = json.loads(build.run([node, "-e", """
const c = require('./src/verified/generated/core.cjs');
console.log(JSON.stringify(c.phases.flatMap((s, i) => c.events.map((e, j) => {
 const d = c.turnStep({$:s}, {$:e});
 return [i, j, `${d.phase.$}:${d.effect.$}`];
}))));
"""]))
    binary = ROOT / ".cache/bend" / ("verified-core.exe" if os.name == "nt" else "verified-core")
    for phase, event, expected in table:
        actual = build.run([str(binary), "--gpu", "off", "--threads", "1", str(phase), str(event)]).strip()
        if actual != expected:
            raise RuntimeError(f"native/JS disagreement for phase={phase}, event={event}: {actual} != {expected}")
    for phase, event in [("99", "0"), ("0", "99"), ("-1", "0"), ("x", "1")]:
        actual = build.run([str(binary), "--gpu", "off", "--threads", "1", phase, event]).strip()
        if actual != "invalid":
            raise RuntimeError(f"native boundary accepted invalid input: {phase}, {event}")
    print(f"PASS native/JS differential: {len(table)} complete decisions and 4 malformed inputs")
    return len(table)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--no-native", action="store_true", help="Only for hosts without a native C compiler; not the release gate")
    parser.add_argument("--receipt", type=Path, help="Explicitly reuse trusted, exact-input proof evidence (same CI workflow only)")
    parser.add_argument("--write-receipt", type=Path, default=ROOT / ".cache/bend/proof-receipt.json")
    options = parser.parse_args()
    def module(name: str, filename: str):
        specification = importlib.util.spec_from_file_location(name, ROOT / "scripts" / filename)
        assert specification and specification.loader
        loaded = importlib.util.module_from_spec(specification)
        specification.loader.exec_module(loaded)
        return loaded
    evidence = module("bend_evidence", "bend-evidence.py")
    if options.receipt:
        if options.no_native:
            raise RuntimeError("Partial verification cannot authorize a receipt-based build")
        checked = evidence.check(options.receipt)
        print(f"Reused trusted Bend proof/native evidence for exact inputs: {checked['fingerprint']}")
        return
    # Fail missing inputs before compilation, and never bind evidence to source
    # bytes that changed while the checks were running.
    checked_inputs = evidence.inputs()
    subprocess.run([sys.executable, "-m", "unittest", "discover", "-s", "scripts/tests", "-v"], cwd=ROOT, check=True)
    build.build(check=True, native=not options.no_native)
    probes = proof_gate_probes()
    mutations = mutants()
    cases = 0 if options.no_native else native_differential()
    receipt = {"source_fingerprint": (ROOT / "src/verified/generated/core.cjs").read_text().splitlines()[0],
               "mutations": mutations, "proof_gate_probes": probes, "native_complete_decisions": cases,
               "native_checked": not options.no_native}
    (ROOT / ".cache/bend/validation.json").write_text(json.dumps(receipt, indent=2) + "\n")
    if not options.no_native:
        # Checking only the small turn-state CLI does not establish the ABI of
        # history, broker, progress, output replay or launcher lease decisions.
        conformance = module("bend_conformance", "check-bend-conformance.py").check()
        if evidence.inputs() != checked_inputs:
            raise RuntimeError("Bend proof/build inputs changed while verification was running")
        evidence.write(options.write_receipt, receipt, conformance)
        evidence.check(options.write_receipt)
        print(f"Wrote complete Bend verification evidence: {options.write_receipt}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
