#!/usr/bin/env python3
"""Compare complete outputs of every production Bend export with native C.

The fixture compiler reads the actual Bend ADTs, not the handwritten TypeScript
declarations. It emits a separate IO driver importing the library, and a lossless
JSON serializer for all reachable output types. No host reimplementation of a
state machine computes expected answers. Node invokes the packaged JS exports
on the same typed inputs; all successor fields, replies and effects are compared.
"""
from __future__ import annotations

import hashlib
import itertools
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
BEND = ROOT / "bend"
CACHE = ROOT / ".cache/bend/conformance"


def split(text: str) -> list[str]:
    depth = 0
    start = 0
    parts = []
    for i, char in enumerate(text):
        if char in "<({[":
            depth += 1
        elif char in ">)}]":
            depth -= 1
        elif char == "," and depth == 0:
            parts.append(text[start:i].strip())
            start = i + 1
    if text[start:].strip():
        parts.append(text[start:].strip())
    return parts


class Schema:
    def __init__(self) -> None:
        self.types: dict[str, dict[str, list[tuple[str, str]]]] = {}
        self.modules: dict[str, str] = {}
        self.serializers: dict[str, str] = {}
        self.functions: dict[str, tuple[list[str], str]] = {}
        self.read("api")

    def resolve(self, text: str, module: str, imports: dict[str, str]) -> str:
        text = text.strip()
        if text in ("Bool", "Nat", "String"):
            return text
        if "<" in text:
            name, args = text.split("<", 1)
            values = split(args[:-1])
            if values[0].startswith("&"):
                values = values[1:]
            if name not in ("List", "Maybe") or len(values) != 1:
                raise RuntimeError(f"unsupported conformance type: {text}")
            return f"{name}<{self.resolve(values[0], module, imports)}>"
        if "." in text:
            alias, name = text.split(".", 1)
            target = imports[alias]
            self.read(target)
            return f"{target}.{name}"
        return f"{module}.{text}"

    def read(self, module: str) -> None:
        if module in self.modules:
            return
        source = (BEND / f"{module}.bend").read_text()
        self.modules[module] = "M" + str(len(self.modules))
        imports = dict((alias, str(Path(module).parent / path)) for path, alias in
                       re.findall(r"^import \./([^\s]+)\.bend as (\w+)$", source, re.M))
        for name, body in re.findall(r"^type (\w+) is Data:\n((?:[ \t]+[^\n]*\n|\n)+)", source, re.M):
            constructors = {}
            for constructor, fields in re.findall(r"(\w+)\{([^}]*?)\}", body, re.S):
                constructors[constructor] = [(key.strip(), self.resolve(kind, module, imports))
                    for key, kind in (field.split(":", 1) for field in split(fields))]
            if not constructors:
                raise RuntimeError(f"no constructors: {module}.{name}")
            self.types[f"{module}.{name}"] = constructors
        if module == "api":
            for name, parameters, result in re.findall(r"^def (\w+)\((.*?)\) -> ([^:\n]+):", source, re.M | re.S):
                if name == "main":
                    continue
                self.functions[name] = ([self.resolve(item.split(":", 1)[1], module, imports) for item in split(parameters)],
                                        self.resolve(result, module, imports))

    def bend_type(self, kind: str) -> str:
        if kind in ("Bool", "Nat", "String"):
            return kind
        if kind.startswith(("List<", "Maybe<")):
            name, inner = kind.split("<", 1)
            return f"{name}<&2, {self.bend_type(inner[:-1])}>"
        module, name = kind.rsplit(".", 1)
        return f"{self.modules[module]}.{name}"

    @staticmethod
    def string(value: str) -> str:
        # Character constructors also represent NUL and other controls without
        # relying on undocumented source-language escape syntax.
        result = "SNil{}"
        for point in reversed(value):
            result = f"SCon{{Char.from_u32({ord(point)}), {result}}}"
        return result

    def literal(self, value: object, kind: str) -> str:
        if kind == "Bool":
            assert type(value) is bool
            return "True{}" if value else "False{}"
        if kind == "Nat":
            assert type(value) is int and 0 <= value <= 2**48-1
            # The pinned parser accepts 32-bit Nat literals even though both
            # runtimes admit 48-bit Nats. Construct the same value from limbs;
            # do not silently drop precisely the boundary cases we must test.
            if value <= 2**32-1:
                return f"{value}n"
            return f"Nat.add(Nat.mul({value >> 16}n, 65536n), {value & 65535}n)"
        if kind == "String":
            assert isinstance(value, str)
            return self.string(value)
        assert isinstance(value, dict) and "$" in value, (value, kind)
        tag = value["$"]
        if kind.startswith("List<"):
            if tag == "Nil":
                return "Nil{}"
            assert tag == "Con"
            return f"Con{{{self.literal(value['head'], kind[5:-1])}, {self.literal(value['tail'], kind)}}}"
        if kind.startswith("Maybe<"):
            if tag == "None":
                return "None{}"
            assert tag == "Some"
            return f"Some{{{self.literal(value['value'], kind[6:-1])}}}"
        fields = self.types[kind][tag]
        assert set(value) == {"$", *(name for name, _ in fields)}, (kind, value)
        module = kind.rsplit(".", 1)[0]
        return self.modules[module] + "." + tag + "{" + ", ".join(self.literal(value[name], typ) for name, typ in fields) + "}"

    def serializer(self, kind: str) -> str:
        if kind in self.serializers:
            return "cx" + str(list(self.serializers).index(kind))
        name = "cx" + str(len(self.serializers))
        self.serializers[kind] = ""
        if kind == "Bool":
            body = '  match value:\n    case True{}: "true"\n    case False{}: "false"'
        elif kind == "Nat":
            body = '  "\\\"" ++ Nat.show(value) ++ "\\\""'
        elif kind == "String":
            body = '  "\\\"" ++ cx_escape(value) ++ "\\\""'
        else:
            module_prefix = ""
            if kind.startswith("List<"):
                constructors = {"Nil": [], "Con": [("head", kind[5:-1]), ("tail", kind)]}
            elif kind.startswith("Maybe<"):
                constructors = {"None": [], "Some": [("value", kind[6:-1])]}
            else:
                constructors = self.types[kind]
                module_prefix = self.modules[kind.rsplit(".", 1)[0]] + "."
            lines = ["  match value:"]
            for tag, fields in constructors.items():
                terms = [json.dumps('{"$":' + json.dumps(tag))]
                pattern = []
                for index, (field, typ) in enumerate(fields):
                    var = f"v{index}"
                    pattern.append(var)
                    terms.extend([json.dumps("," + json.dumps(field) + ":"), f"{self.serializer(typ)}({var})"])
                terms.append(json.dumps("}"))
                lines.append(f"    case {module_prefix}{tag}{{{', '.join(pattern)}}}: " + " ++ ".join(terms))
            body = "\n".join(lines)
        self.serializers[kind] = f"def {name}(value: {self.bend_type(kind)}) -> String:\n{body}\n"
        return name

    def ordered_serializers(self) -> list[str]:
        # Definitions are dependency ordered, with self-recursion permitted.
        output: list[str] = []
        done: set[str] = set()
        active: set[str] = set()
        by_name = {"cx" + str(i): kind for i, kind in enumerate(self.serializers)}
        def visit(kind: str) -> None:
            if kind in done or kind in active:
                return
            active.add(kind)
            for name in re.findall(r"\b(cx\d+)\(", self.serializers[kind]):
                visit(by_name[name])
            active.remove(kind)
            done.add(kind)
            output.append(self.serializers[kind])
        for kind in self.serializers:
            visit(kind)
        return output


def c(tag: str, **fields: object) -> dict:
    return {"$": tag, **fields}


def ls(values: list) -> dict:
    result = c("Nil")
    for value in reversed(values):
        result = c("Con", head=value, tail=result)
    return result


def cases() -> list[dict]:
    result = []
    def add(function: str, *args: object) -> None:
        result.append({"function": function, "arguments": args})
    phases = "Fresh Prepared Attempted Running Unknown Completed Cancelled".split()
    events = "Prepare Submit Accepted Finished Uncertain Attach Detach Recover UserCancel".split()
    for phase, event in itertools.product(phases, events):
        add("turn_step", c(phase), c(event))
    for report in ["Completed", "Uncertain", "UserCancelled"]:
        for facts in itertools.product([False, True], repeat=5):
            add("lease_finish", c(report), *facts)
    for facts in itertools.product([False, True], repeat=3):
        add("lease_attach", *facts)
    add("batch_initialize")
    for receipt in ["PendingIntent", "FinalReceipt", "CancellationReceipt"]:
        add("batch_restore", c(receipt))
    for phase in phases:
        for remaining in [[], ["next"]]:
            state = c("Batch", phase=c(phase), slot=0, current='中🙂"\\\n\x00', pending=ls(remaining))
            for event in events:
                add("batch_step", state, c(event))
            for stage in [0, 1, 2, 2**48-1]:
                add("batch_ack", state, stage)
    for state in [c("Unclaimed"), c("Unplanned"), c("Closed", phase=c("Unknown"))]:
        add("batch_claim", state)
        for plan in [[], ["one"], ["one", "two", "three"]]:
            add("batch_plan", state, ls(plan))
    histories = [[], ["a"], ["a", "b"], ["a", "b", "c"], ["other"]]
    for before, after in itertools.product(histories, repeat=2):
        add("history_plan", "env", "env", ls(before), ls(after))
        add("history_plan", "env", "different", ls(before), ls(after))
    receipt = lambda key, messages: c("Receipt", key=key, environment="env", messages=ls(messages))
    for incoming in histories:
        add("history_select", ls([receipt("short", ["a"]), receipt("long", ["a", "b"])]), "env", ls(incoming))
    for kind, role in itertools.product(["message", "reasoning", "function_call", "function_call_output", "compaction", "unknown"], ["assistant", "user", "developer", "tool"]):
        add("transcript_item", kind, role)
    for bits in itertools.product([False, True], repeat=8):
        add("surface_resume", c("Evidence", present=bits[0], untouched=bits[1], idle=bits[2], assistant_tail=bits[3],
            recorded_key="key", key="key" if bits[4] else "other", recorded_operation="op", operation="op" if bits[5] else "other",
            recorded_answer="answer", expected_answer="answer" if bits[6] else "other", answer="answer" if bits[7] else "other"))
    add("observation_initialize")
    now = 1_790_000_000_000
    watch = c("Watching", revision=0, baseline=c("None"))
    candidate = c("Candidate", revision=2, baseline=c("Some", value="before"), signature="signature", since=now)
    for bits in itertools.product([False, True], repeat=7):
        facts = c("Facts", **dict(zip(["present", "running", "has_text", "completion_control", "reply_error", "stopped_badge", "tools_in_flight"], bits)))
        add("observation_eligible", facts)
        for state in [watch, candidate]:
            add("observation_step", state, c("Sample", facts=facts, text="after", signature="signature", now=now+100, stable_ms=100))
    for state in [watch, candidate]:
        add("observation_step", state, c("Uncertain"))
        for revision in [0, 1, 2, 3, 2**48-1]:
            add("observation_step", state, c("CaptureBoundary", revision=revision, text="boundary"))
    activities = ls([c("Activity", id="active", completed=False), c("Activity", id="closed", completed=True)])
    invocations = ls([c("Invocation", id="queued", payload="p0", delivery=c("Queued")),
                      c("Invocation", id="delivered", payload="p1", delivery=c("Delivered")),
                      c("Invocation", id="result", payload="p2", delivery=c("Result", digest="result"))])
    broker_events = [c("Poll"), c("BeginFence"), c("Retire"), c("CheckEnvironment", environment="env"), c("CheckEnvironment", environment="other")]
    for identity in ["active", "closed", "new"]:
        broker_events += [c("ClaimActivity", id=identity), c("CompleteActivity", id=identity)]
    for identity in ["queued", "delivered", "result", "new"]:
        broker_events.append(c("Enqueue", id=identity, payload="request"))
        broker_events.extend(c("CompleteCall", id=identity, digest=value) for value in ["result", "conflict"])
    broker_events.extend(c("CommitFence", revision=value) for value in [6, 7, 8])
    for lifetime, occupied in itertools.product([c("Open"), c("Sealed", revision=7), c("Retired")], [False, True]):
        state = c("Broker", lifetime=lifetime, environment="env", revision=7, activities=activities if occupied else ls([]), invocations=invocations if occupied else ls([]))
        for event in broker_events:
            add("broker_step", state, event)
    add("broker_initialize", "env")
    broker_start = c("Broker", lifetime=c("Open"), environment="env", revision=0, activities=ls([]), invocations=ls([]))
    add("broker_run", ls([c("ClaimActivity", id="a"), c("Enqueue", id="b", payload="中🙂"), c("Poll"), c("Poll"),
        c("CompleteCall", id="b", digest="r"), c("CompleteActivity", id="a"), c("CommitFence", revision=4),
        c("Enqueue", id="too-late", payload="no"), c("Retire"), c("ClaimActivity", id="never")]), broker_start)
    snapshot = lambda revision, batch, active, time: c("Snapshot", revision=revision, batch=batch, active=active, time=c("None") if time is None else c("Some", value=time))
    frames = [snapshot(0, 0, 0, None), snapshot(1, 1, 1, now), snapshot(2, 1, 0, now-10),
              snapshot(2, 1, 0, now), snapshot(1, 1, 0, now), snapshot(3, 2, 2, now+20),
              snapshot(1, 2, 1, now), snapshot(0, 0, 1, None), snapshot(1, 1, 1, None)]
    progress_events = [c("RecordBatch", count=count, now=now+1) for count in [0, 1, 2]] + [c("RecordResult", now=now-10), c("Retire")]
    for revision in [0, 1, 2, 3]:
        progress_events.extend([c("CheckBatch", revision=revision), c("Acknowledge", revision=revision)])
    progress_events += [c("Import", snapshot=frame) for frame in frames]
    for role in ["Recorder", "Replica"]:
        add("progress_initialize", c(role))
        for frame, retired in itertools.product(frames[:2], [False, True]):
            state = c("Progress", role=c(role), snapshot=frame, observed=0, batches=ls([1]) if frame["revision"] else ls([]), retired=retired)
            for event in progress_events:
                add("progress_step", state, event)
    for frame in frames:
        add("progress_valid", frame)
    add("progress_run", ls([c("RecordBatch", count=2, now=now), c("RecordResult", now=now-100), c("Acknowledge", revision=1),
        c("RecordResult", now=now+10), c("Retire"), c("RecordBatch", count=1, now=now+20)]),
        c("Progress", role=c("Recorder"), snapshot=frames[0], observed=0, batches=ls([]), retired=False))
    add("outbox_initialize")
    call = lambda identity: c("Call", id=identity, payload=f'{{"callId":"{identity}"}}')
    for pending in [[], [call("a"), call("b")]]:
        state = c("Outbox", pending=ls(pending), spent=ls(["old", "a", "b"] if pending else ["old"]), prelude="prelude" if pending else "")
        for identity in ["a", "b", "missing"]:
            add("outbox_contains", state, identity)
            add("outbox_step", state, c("Receipt", id=identity))
        for batch in [[], [call("new")], [call("new"), call("new")], [call("new"), call("old")]]:
            add("outbox_step", state, c("Offer", calls=ls(batch), prelude="new prelude"))
    add("outbox_run", ls([c("Offer", calls=ls([call("a"), call("b")]), prelude="prelude"), c("Receipt", id="a"),
        c("Receipt", id="b"), c("Offer", calls=ls([call("new"), call("a")]), prelude="must-not-commit")]),
        c("Outbox", pending=ls([]), spent=ls([]), prelude=""))
    add("replay_initialize")
    frame = lambda kind: c("Frame", kind=kind, payload=f'{{"type":"{kind}","unicode":"中🙂"}}')
    replay_events = [c("Seal"), c("Fail", reason="error"), c("Fail", reason="other"), c("Reason", parts=ls(["reason"]))]
    for stream in [[], [frame("text_delta")], [frame("text_delta"), frame("done")], [frame("done"), frame("text_delta")], [frame("incomplete")]]:
        replay_events.append(c("Append", events=ls(stream)))
    for status, stream in itertools.product([c("Open"), c("Sealed"), c("Failed", reason="error")], [[], [frame("text_delta"), frame("done")]]):
        state = c("Journal", status=status, events=ls(stream), reasoning=ls(["reason"]))
        add("replay_closed", state)
        add("replay_terminal", state)
        for event in replay_events:
            add("replay_step", state, event)
    add("replay_run", ls([c("Append", events=ls([frame("text_delta")])), c("Reason", parts=ls(["reason"])),
        c("Append", events=ls([frame("done")])), c("Seal"), c("Append", events=ls([frame("text_delta")]))]),
        c("Journal", status=c("Open"), events=ls([]), reasoning=ls([])))
    return result


def run(command: list[str], *, cwd: Path = ROOT, timeout: int = 180) -> str:
    process = subprocess.run(command, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    if process.returncode or process.stderr:
        diagnostic = process.stdout + process.stderr
        log = CACHE / "command-failure.log"
        log.write_text(diagnostic)
        raise RuntimeError(f"Conformance command failed: {command}\n{diagnostic[:8000]}\nFull diagnostic: {log}")
    if re.search(r"(?m)^(Error:|Warning:|WARN|FAIL|Error in)", process.stdout):
        raise RuntimeError(f"Conformance compiler diagnostic: {process.stdout}")
    return process.stdout


def check() -> dict:
    CACHE.mkdir(parents=True, exist_ok=True)
    schema = Schema()
    fixtures = cases()
    covered = {case["function"] for case in fixtures}
    if covered != set(schema.functions):
        raise RuntimeError(f"Conformance must cover every production export: missing={set(schema.functions)-covered}, extra={covered-set(schema.functions)}")
    rendered = []
    for case in fixtures:
        inputs, output = schema.functions[case["function"]]
        if len(inputs) != len(case["arguments"]):
            raise RuntimeError(f"Wrong fixture arity: {case}")
        expression = f"{schema.modules['api']}.{case['function']}({', '.join(schema.literal(value, kind) for value, kind in zip(case['arguments'], inputs))})"
        rendered.append(f"{schema.serializer(output)}({expression})")
    imports = "\n".join(f"import ../../../bend/{module}.bend as {alias}" for module, alias in schema.modules.items())
    escaped = ['def cx_char(code: U32, value: Char) -> String:', '  match code:']
    for code in list(range(32)) + [34, 92]:
        value = f"\\u{code:04x}" if code < 32 else ('\\"' if code == 34 else '\\\\')
        escaped.append(f"    case {code}: {json.dumps(value)}")
    escaped += ['    case _: SCon{value, SNil{}}', '', 'def cx_escape(value: String) -> String:', '  match value:',
                '    case SNil{}: ""', '    case SCon{+head, tail}: cx_char(Char.to_u32(head), head) ++ cx_escape(tail)']
    # Balance concatenation rather than constructing a call stack proportional
    # to the number of independent fixtures in the native test harness.
    def join(parts: list[str]) -> str:
        if len(parts) == 1:
            return parts[0]
        midpoint = len(parts) // 2
        return f"({join(parts[:midpoint])} ++ {join(parts[midpoint:])})"
    pieces = ['"["']
    evaluations = []
    for i, expression in enumerate(rendered):
        if i:
            pieces.append('\",\"')
        # Keep individual fixtures addressable in compiler diagnostics instead
        # of emitting a single enormous source line containing every case.
        evaluations.append(f"def cx_case_{i}() -> String:\n  {expression}\n")
        pieces.append(f"cx_case_{i}()")
    pieces.append('\"]\"')
    source = "import Base\n" + imports + "\n\n" + "\n".join(escaped) + "\n\n" + "\n".join(schema.ordered_serializers())
    source += "\n" + "\n".join(evaluations)
    source += "\ndef main() -> IO(Unit):\n  IO.print(" + join(pieces) + ")\n"
    entry = CACHE / "conformance.bend"
    entry.write_text(source)
    installed = ROOT / ".cache/bend-toolchain/installed/bin/bend"
    compiler = os.environ.get("BEND") or (str(installed) if installed.is_file() else shutil.which("bend")) or str(Path.home() / ".bend/bin/bend")
    binary = CACHE / ("conformance.exe" if os.name == "nt" else "conformance")
    run([compiler, str(entry), "-o", str(binary)])
    native_raw = run([str(binary), "--gpu", "off", "--threads", "1"])
    (CACHE / "native.json").write_text(native_raw)
    native = json.loads(native_raw)
    # Encode input Nats by type, not by the size of a JSON number or an ad-hoc
    # property-name heuristic. The adapter under test is the production module.
    input_file = CACHE / "inputs.json"
    input_file.write_text(json.dumps({"cases": fixtures, "functions": schema.functions, "types": schema.types}, ensure_ascii=False))
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Node is required for native/production-JS conformance")
    js = r'''
const fs = require("node:fs");
const core = require(process.argv[1]);
const data = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
function decode(value, kind) {
  if (kind === "Nat") return BigInt(value);
  if (kind === "Bool" || kind === "String") return value;
  if (kind.startsWith("List<")) return value.$ === "Nil" ? {$:"Nil"} : {$:"Con", head:decode(value.head,kind.slice(5,-1)),tail:decode(value.tail,kind)};
  if (kind.startsWith("Maybe<")) return value.$ === "None" ? {$:"None"} : {$:"Some",value:decode(value.value,kind.slice(6,-1))};
  return Object.fromEntries([["$",value.$], ...data.types[kind][value.$].map(([name,type])=>[name,decode(value[name],type)])]);
}
const output = data.cases.map(({function: name, arguments: args}) => {
  const fn = name.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  if (typeof core[fn] !== "function") throw new Error(`missing production export ${fn}`);
  return core[fn](...args.map((value, i) => decode(value, data.functions[name][0][i])));
});
process.stdout.write(JSON.stringify(output, (_,value)=>typeof value === "bigint" ? value.toString() : value));
'''
    js_raw = run([node, "-e", js, str(ROOT / "src/verified/generated/core.cjs"), str(input_file)])
    (CACHE / "javascript.json").write_text(js_raw)
    javascript = json.loads(js_raw)
    if len(native) != len(fixtures) or len(javascript) != len(fixtures):
        raise RuntimeError("A backend omitted a conformance decision")
    for i, (left, right) in enumerate(zip(native, javascript)):
        if left != right:
            raise RuntimeError(f"Complete-value native/JS mismatch at case {i}: {fixtures[i]}\nnative={left}\nJS={right}")
    record = {"cases": len(fixtures), "exports": len(covered), "case_sha256": hashlib.sha256(input_file.read_bytes()).hexdigest(),
              "driver_sha256": hashlib.sha256(entry.read_bytes()).hexdigest(), "native_sha256": hashlib.sha256(binary.read_bytes()).hexdigest(),
              "javascript_sha256": hashlib.sha256((ROOT / "src/verified/generated/core.cjs").read_bytes()).hexdigest(),
              "complete_decisions_equal": True}
    (CACHE / "report.json").write_text(json.dumps(record, indent=2) + "\n")
    print(json.dumps(record, sort_keys=True))
    return record


if __name__ == "__main__":
    check()
