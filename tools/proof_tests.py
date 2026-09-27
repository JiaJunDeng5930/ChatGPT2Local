#!/usr/bin/env python3
"""Challenge the real checker and emitted program, never a handwritten model."""
from __future__ import annotations
import hashlib
import os
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import build

ROOT = build.ROOT
PIN = json.loads((build.SOURCE / "toolchain.json").read_text())

def check(path: Path, cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run([build.compiler(), str(path), "--check-only"], cwd=cwd, capture_output=True, text=True, timeout=90, env={**os.environ, "BEND_NO_TELEMETRY": "1"})

def pure(result: subprocess.CompletedProcess[str]) -> bool:
    return result.returncode == 0 and result.stderr == "" and result.stdout.strip() == PIN["pure_success"]

def gate_probes(cache: Path) -> list[dict[str, str]]:
    cases = {
        "missing-proof": ("law witness:\n  for n: Nat\n  {n == n : Nat}\n", "TODO found"),
        "false-proof": ("def witness(n: Nat) -> {0n == 1n : Nat}: {==}\n", "expected"),
        "unfilled-proof": ("def witness(n: Nat) -> {n == n : Nat}: ?TODO\n", "TODO found"),
        "unchecked-recursion": ("@unsafe def witness(n: Nat) -> {0n == 1n : Nat}: witness(n)\n", "unsafe or foreign"),
        "circular-proof": ("def witness(n: Nat) -> {0n == 1n : Nat}: witness(n)\n", "decreasing self-call"),
    }
    records = []
    with tempfile.TemporaryDirectory(prefix="gate-", dir=cache) as temporary:
        home = Path(temporary)
        path = home / "probe.bend"
        path.write_text("import Base\ndef witness(n: Nat) -> {n == n : Nat}: {==}\n")
        if not pure(check(path, home)): raise RuntimeError("The positive proof gate probe failed")
        for name, (source, expected) in cases.items():
            path.write_text("import Base\n" + source)
            result = check(path, home)
            diagnostic = result.stdout + result.stderr
            if pure(result) or expected not in diagnostic:
                raise RuntimeError(f"{name} did not fail for its intended semantic reason:\n{diagnostic}")
            records.append({"probe": name, "result": "rejected", "diagnostic_sha256": hashlib.sha256(diagnostic.encode()).hexdigest()})
            print(f"PASS checker challenge: {name}", flush=True)
    return records

MUTATIONS = [
    ("uncertainty-is-not-send-permission", "kernel.bend",
     "case D.Uncertain{}: D.Decision{D.Fresh{}, D.NoEffect{}}",
     "case D.Uncertain{}: D.Decision{D.Fresh{}, D.SendPrompt{}}"),
    ("local-tools-participate-in-the-final-fence", "broker-table.bend",
     "Bool.or(has_activity(activities), has_invocation(invocations))", "has_invocation(invocations)"),
    ("transport-detachment-is-not-user-cancellation", "application.bend",
     "case A.Detached{}: control(s, T.Detach{})", "case A.Detached{}: control(s, T.UserCancel{})"),
    ("consumed-predecessor-cannot-append", "request.bend",
     "case D.Claimed{}: D.Denied{D.PreviousConsumed{}}", "case D.Claimed{}: D.Append{}"),
    ("request-retry-cannot-create-a-page", "request.bend",
     "case D.RepeatedKey{}: D.Replay{}", "case D.RepeatedKey{}: D.NewPage{}"),
    ("encoded-output-cannot-ignore-current-evidence", "application.bend",
     "encode_checked(Bool.and(Nat.is_eq(expected, revision),\n        Bool.and(Nat.is_eq(K.revision(A.broker(s)), revision), String.eq(previous, signature))),",
     "encode_checked(True{},"),
]

def semantic_mutations(cache: Path) -> list[dict[str, str]]:
    records = []
    for name, file, before, after in MUTATIONS:
        with tempfile.TemporaryDirectory(prefix="mutation-", dir=cache) as temporary:
            home = Path(temporary)
            source = home / "bend"
            shutil.copytree(build.SOURCE, source)
            path = source / file
            text = path.read_text()
            if before not in text: raise RuntimeError(f"The reviewed mutation no longer applies: {name}")
            path.write_text(text.replace(before, after, 1))
            # A syntax/import/type error in production is not a successful
            # semantic counterexample. Check the actual mutated API first.
            positive = check(source / "api.bend", home)
            if not pure(positive): raise RuntimeError(f"Mutation was not type-correct in production: {name}\n{positive.stdout}{positive.stderr}")
            negative = check(source / "PROOF.bend", home)
            diagnostic = negative.stdout + negative.stderr
            if negative.returncode == 0 or "expected" not in diagnostic or "observed" not in diagnostic:
                raise RuntimeError(f"The actual proof root did not refute {name}:\n{diagnostic}")
            if any(fragment in diagnostic.lower() for fragment in ("not found", "parse error", "unexpected token", "unfilled", "consumed more than once")):
                raise RuntimeError(f"Non-semantic failure cannot count as a killed mutation: {name}\n{diagnostic}")
            records.append({"mutation": name, "production": "pure/type-correct", "proof": "refuted", "diagnostic_sha256": hashlib.sha256(diagnostic.encode()).hexdigest()})
            print(f"PASS semantic mutation: {name}", flush=True)
    return records

def graph_guards(cache: Path) -> list[str]:
    original = build.SOURCE
    records = []
    try:
        for name in ("cycle", "unchecked-source", "specification-alias", "uncovered-production"):
            with tempfile.TemporaryDirectory(prefix="graph-", dir=cache) as temporary:
                source = Path(temporary) / "bend"
                shutil.copytree(original, source)
                build.SOURCE = source
                if name == "cycle":
                    (source / "cycle.bend").write_text("import ./PROOF.bend as Parent\n")
                    path = source / "PROOF.bend"; path.write_text(path.read_text() + "import ./cycle.bend as Cycle\n")
                elif name == "unchecked-source":
                    path = source / "kernel.bend"; path.write_text(path.read_text() + "\n@unsafe def escaped(n: Nat) -> Nat: escaped(n)\n")
                elif name == "specification-alias":
                    path = source / "request-specification.bend"; path.write_text(path.read_text() + "\nimport ./request.bend as Alias\n")
                else:
                    path = source / "PROOF.bend"; path.write_text("\n".join(line for line in path.read_text().splitlines() if "./api.bend" not in line and "./native-protocol.bend" not in line) + "\n")
                try: build.audit()
                except RuntimeError: records.append(name)
                else: raise RuntimeError(f"The proof/source graph guard accepted {name}")
                print(f"PASS source guard: {name}", flush=True)
    finally: build.SOURCE = original
    return records

def native_differential() -> int:
    javascript = """
const c = require('./.build/core.cjs');
const states=['Fresh','Prepared','Attempted','Running','Unknown','Completed','Cancelled'];
const events=['Prepare','Submit','Accepted','Finished','Uncertain','Attach','Detach','Recover','UserCancel'];
console.log(JSON.stringify(states.flatMap((s,i)=>events.map((e,j)=>{
 const d=c.turn_step({$:s},{$:e}); return [i,j,d.phase.$+':'+d.effect.$];
}))));
"""
    result = build.execute([shutil.which("node") or "node", "-e", javascript])
    table = json.loads(result)
    binary = str(build.OUT / "bend-core")
    for phase, event, expected in table:
        actual = build.execute([binary, "--gpu", "off", "--threads", "1", str(phase), str(event)]).strip()
        if actual != expected: raise RuntimeError(f"Native/emitted-JS decision mismatch: {(phase, event, actual, expected)}")
    for phase, event in ((7, 0), (0, 9), (999, 999)):
        if build.execute([binary, "--gpu", "off", "--threads", "1", str(phase), str(event)]).strip() != "invalid":
            raise RuntimeError("The native argument boundary admitted an invalid domain value")
    print(f"PASS native/emitted-JS complete decisions: {len(table)}", flush=True)
    return len(table)

def main() -> None:
    build.build(native=True)
    cache = ROOT / ".cache" / "verification"
    cache.mkdir(parents=True, exist_ok=True)
    report = {"kernel": json.loads((build.OUT / "manifest.json").read_text()), "checker": gate_probes(cache),
              "semantic_mutations": semantic_mutations(cache), "source_guards": graph_guards(cache),
              "native_decisions": native_differential()}
    (build.OUT / "verification.json").write_text(json.dumps(report, indent=2) + "\n")
    print("Proof closure, semantic counterexamples, native execution, and boundary guards passed.", flush=True)

if __name__ == "__main__": main()
