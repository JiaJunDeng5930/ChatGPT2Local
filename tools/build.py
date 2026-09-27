#!/usr/bin/env python3
"""Check the actual Bend proof closure, then emit the only production kernel.

The small linker is pinned to Bend 2.0.27. Declarations and foreign-value
validators are derived from Bend Data declarations, not a second state model.
No previously generated file can substitute for running the proof checker.
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
SOURCE = ROOT / "bend"
OUT = ROOT / ".build"


def execute(args: list[str], timeout: int = 180) -> str:
    result = subprocess.run(args, cwd=ROOT, text=True, capture_output=True, timeout=timeout)
    if result.returncode or result.stderr:
        raise RuntimeError(f"command failed: {args!r}\n{result.stdout}{result.stderr}")
    return result.stdout


def compiler() -> str:
    local = ROOT / ".cache/bend-toolchain/installed/bin/bend"
    return os.environ.get("BEND") or (str(local) if local.is_file() else shutil.which("bend")) or str(Path.home() / ".bend/bin/bend")


def imports(path: Path) -> dict[str, Path]:
    result: dict[str, Path] = {}
    for name, alias in re.findall(r"^import\s+(\S+)(?:\s+as\s+(\w+))?", path.read_text(), re.M):
        if name == "Base":
            continue
        target = (path.parent / name).resolve()
        if not name.startswith("./") or not name.endswith(".bend") or not target.is_relative_to(SOURCE):
            raise RuntimeError(f"unapproved import in {path}: {name}")
        result[alias or target.stem] = target
    return result


def closure(path: Path, stack: tuple[Path, ...] = ()) -> set[Path]:
    path = path.resolve()
    if path in stack:
        raise RuntimeError(f"cyclic proof/runtime import: {path}")
    text = path.read_text()
    if re.search(r"@unsafe|\?[A-Za-z_]", text):
        raise RuntimeError(f"unchecked source: {path}")
    found = {path}
    for target in imports(path).values():
        found |= closure(target, stack + (path,))
    return found


def audit() -> None:
    proof = closure(SOURCE / "PROOF.bend")
    runtime = closure(SOURCE / "api.bend") | closure(SOURCE / "native-protocol.bend")
    if runtime - proof:
        raise RuntimeError(f"production outside proof closure: {runtime - proof}")
    for spec in SOURCE.glob("*specification.bend"):
        name = "kernel" if spec.stem == "specification" else spec.stem.removesuffix("-specification")
        implementation = SOURCE / f"{name}.bend"
        if implementation.resolve() in closure(spec):
            raise RuntimeError(f"specification imports its implementation: {spec}")


def split(text: str) -> list[str]:
    """Split fields/types at commas, preserving nested type applications."""
    result, start, depth = [], 0, 0
    for i, char in enumerate(text):
        if char in "<({[":
            depth += 1
        elif char in ">)}]":
            depth -= 1
        elif char == "," and depth == 0:
            result.append(text[start:i].strip())
            start = i + 1
    if text[start:].strip():
        result.append(text[start:].strip())
    return result


def namespace(path: Path) -> str:
    return "M_" + re.sub(r"\W", "_", path.stem)


def describe(text: str, path: Path) -> tuple[str, object]:
    text = text.strip()
    primitives = {"String": ("string", "string"), "Bool": ("boolean", "bool"), "Nat": ("bigint", "nat")}
    if text in primitives:
        return primitives[text]
    application = re.fullmatch(r"(List|Maybe)<(.*)>", text, re.S)
    if application:
        args = [x for x in split(application[2]) if not x.startswith("&")]
        if len(args) != 1:
            raise RuntimeError(f"unsupported foreign type {text}")
        ts, schema = describe(args[0], path)
        return f"{application[1]}<{ts}>", {application[1].lower(): schema}
    if re.fullmatch(r"\w+(?:\.\w+)?", text):
        if "." in text:
            alias, name = text.split(".")
            target = imports(path).get(alias)
            if target is None:
                raise RuntimeError(f"unresolved type {text} in {path}")
        else:
            target, name = path, text
        return f"{namespace(target)}.{name}", {"ref": f"{target.stem}.{name}"}
    raise RuntimeError(f"unsupported foreign type {text!r} in {path}")


def bindings() -> tuple[str, dict[str, object], list[tuple[str, int]]]:
    declarations = [
        "// Generated from Bend declarations; do not edit.",
        'export type List<T> = { $: "Nil" } | { $: "Con"; head: T; tail: List<T> };',
        'export type Maybe<T> = { $: "None" } | { $: "Some"; value: T };',
    ]
    schema: dict[str, object] = {}
    for path in sorted(closure(SOURCE / "api.bend")):
        source = path.read_text()
        types = list(re.finditer(r"^type (\w+) is Data:\n((?:[ \t].*\n|\n|#[^\n]*\n)+)", source, re.M))
        if not types:
            continue
        declarations.append(f"export namespace {namespace(path)} {{")
        for type_match in types:
            constructors: dict[str, object] = {}
            variants = []
            for tag, fields in re.findall(r"(\w+)\{([^{}]*)\}", type_match[2]):
                encoded_fields: dict[str, object] = {}
                properties = [f'$: "{tag}"']
                for field in split(fields):
                    name, annotation = field.split(":", 1)
                    name = name.strip().lstrip("+-~")
                    ts, desc = describe(annotation, path)
                    properties.append(f"{name}: {ts}")
                    encoded_fields[name] = desc
                if tag in constructors:
                    raise RuntimeError(f"duplicate constructor in {path}: {tag}")
                constructors[tag] = encoded_fields
                variants.append("{ " + "; ".join(properties) + " }")
            if not constructors:
                raise RuntimeError(f"empty foreign type in {path}: {type_match[1]}")
            schema[f"{path.stem}.{type_match[1]}"] = constructors
            declarations.append(f"  export type {type_match[1]} = " + " | ".join(variants) + ";")
        declarations.append("}")
    exported = []
    api = SOURCE / "api.bend"
    for name, params, result in re.findall(r"^def (\w+)\((.*?)\)\s*->\s*([^:]+):\n", api.read_text(), re.M | re.S):
        if name == "main":
            continue
        arguments = []
        for field in split(params):
            parameter, annotation = field.split(":", 1)
            ts, _ = describe(annotation, api)
            arguments.append(f"{parameter.strip().lstrip('+-~')}: {ts}")
        ts, _ = describe(result, api)
        declarations.append(f"export function {name}({', '.join(arguments)}): {ts};")
        exported.append((name, len(arguments)))
    declarations += ["export const fingerprint: string;", "export function validate(type: string, value: unknown): void;"]
    return "\n".join(declarations) + "\n", schema, exported


VALIDATOR = r'''
// Iterative validation avoids exhausting the JS stack on long Bend lists.
function validate(type, value) {
  const work = [[{ref: type}, value]];
  let count = 0;
  while (work.length) {
    if (++count > 2000000) throw new Error("Bend value exceeds boundary capacity");
    const [shape, item] = work.pop();
    if (typeof shape === "string") {
      const ok = shape === "nat" ? typeof item === "bigint" && item >= 0n
        : shape === "bool" ? typeof item === "boolean" : typeof item === "string";
      if (!ok) throw new Error("Invalid primitive at Bend boundary: " + shape);
      continue;
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid Bend constructor");
    let fields;
    if (shape.list) fields = item.$ === "Nil" ? {} : item.$ === "Con" ? {head: shape.list, tail: shape} : null;
    else if (shape.maybe) fields = item.$ === "None" ? {} : item.$ === "Some" ? {value: shape.maybe} : null;
    else fields = Object.hasOwn(__schema, shape.ref) && Object.hasOwn(__schema[shape.ref], item.$)
      ? __schema[shape.ref][item.$] : null;
    if (!fields || Object.keys(item).length !== Object.keys(fields).length + 1 || !Object.hasOwn(item, "$"))
      throw new Error("Invalid Bend constructor fields: " + String(item.$));
    for (const [key, child] of Object.entries(fields)) {
      if (!Object.hasOwn(item, key)) throw new Error("Missing Bend field: " + key);
      work.push([child, item[key]]);
    }
  }
}
'''


def build(native: bool = False, check: bool = False) -> None:
    bend = compiler()
    pin = json.loads((SOURCE / "toolchain.json").read_text())
    if execute([bend, "version"]).strip() != pin["compiler_version"]:
        raise RuntimeError("compiler version differs from the checked pin")
    if hashlib.sha256(execute([bend, "base"]).encode()).hexdigest() != pin["base_sha256"]:
        raise RuntimeError("Base differs from the checked pin")
    audit()
    if execute([bend, "bend/PROOF.bend", "--check-only"]).strip() != pin["pure_success"]:
        raise RuntimeError("proof check did not return the exact pure-success diagnostic")
    declaration, schema, exports = bindings()
    OUT.mkdir(exist_ok=True)
    emitted = OUT / "emitted.js"
    execute([bend, "bend/api.bend", "-o", str(emitted)])
    text = emitted.read_text()
    marker = "\ncli(process.argv.slice(2));\nio_exit("
    if text.count(marker) != 1:
        raise RuntimeError("unrecognized pinned compiler launcher ABI")
    text = text.split(marker)[0]
    digest = hashlib.sha256()
    for path in sorted(SOURCE.rglob("*.bend")) + [SOURCE / "toolchain.json", Path(__file__)]:
        digest.update(str(path.relative_to(ROOT)).encode() + b"\0" + path.read_bytes())
    fingerprint = digest.hexdigest()
    text = f'// Checked Bend application: {fingerprint}\n"use strict";\n' + text
    text += "\nconst __schema = " + json.dumps(schema, separators=(",", ":")) + ";\n" + VALIDATOR
    members = []
    for name, arity in exports:
        if f"function ${name}$(" not in text:
            raise RuntimeError(f"missing production function: {name}")
        members.append(f"{name}: run_lib(${name}$, {arity})")
    text += "\nmodule.exports = Object.freeze({" + ",".join(members) + f",validate,fingerprint:{json.dumps(fingerprint)}" + "});\n"
    artifacts = {"core.cjs": text, "core.d.cts": declaration, "schema.json": json.dumps(schema, indent=2) + "\n"}
    for name, content in artifacts.items():
        path = OUT / name
        if check:
            if not path.is_file() or path.read_text() != content:
                raise RuntimeError(f"stale artifact: {path}")
        else:
            temporary = path.with_suffix(path.suffix + ".tmp")
            temporary.write_text(content)
            temporary.replace(path)
    if native:
        binary = OUT / ("bend-core.exe" if os.name == "nt" else "bend-core")
        execute([bend, "bend/main.bend", "-o", str(binary)])
        if execute([str(binary), "--gpu", "off", "--threads", "1", "1", "1"]).strip() != "Attempted:SendPrompt":
            raise RuntimeError("native compiler/protocol probe failed")
    manifest = {"fingerprint": fingerprint, "compiler": pin["compiler_version"], "artifacts": {
        name: hashlib.sha256((OUT / name).read_bytes()).hexdigest() for name in artifacts}}
    if not check:
        (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Checked and linked Bend application: {fingerprint}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--native", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        build(args.native, args.check)
    except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
