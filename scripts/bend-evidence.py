#!/usr/bin/env python3
"""Bind successful verification to exact sources and portable generated output.

This is a checked build receipt, NOT a cryptographic proof certificate. Import
only from a trusted invocation of verify-bend.py (CI uses an artifact from the
same workflow run). Changing any covered byte invalidates the receipt. Native
verification is performed on the producer, not fictitiously on Windows.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ["build-bend-core.py", "verify-bend.py", "check-bend-conformance.py",
           "bend-evidence.py", "setup-bend.py", "verify-bend-build.ts"]
CI_KEYS = ["GITHUB_REPOSITORY", "GITHUB_SHA", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"]


def inputs() -> dict[str, str]:
    required = [ROOT / "bend/PROOF.bend", ROOT / "bend/api.bend", ROOT / "bend/toolchain.json",
                ROOT / "src/verified/generated/core.cjs", ROOT / "src/verified/generated/core.d.cts",
                *(ROOT / "scripts" / name for name in SCRIPTS)]
    if any(not path.is_file() for path in required):
        raise RuntimeError("Missing required Bend proof/build inputs")
    files = set((ROOT / "bend").rglob("*.bend"))
    files.add(ROOT / "bend/toolchain.json")
    files.update((ROOT / "src/verified").rglob("*.ts"))
    files.update(ROOT / "src/verified/generated" / name for name in ["core.cjs", "core.d.cts"])
    files.update(ROOT / "scripts" / name for name in SCRIPTS)
    if not files or not (ROOT / "bend/PROOF.bend").is_file():
        raise RuntimeError("Missing Bend proof inputs")
    return {path.relative_to(ROOT).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in sorted(files) if path.is_file()}


def fingerprint(snapshot: dict[str, str]) -> str:
    return hashlib.sha256(json.dumps(snapshot, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def write(path: Path, validation: dict, conformance: dict) -> None:
    snapshot = inputs()
    receipt = {"schema": 1, "inputs": snapshot, "fingerprint": fingerprint(snapshot),
               "toolchain": json.loads((ROOT / "bend/toolchain.json").read_text()),
               "proof": "All terms check.", "validation": validation, "conformance": conformance,
               "producer": {key: os.environ.get(key, "") for key in CI_KEYS}}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n")


def check(path: Path) -> dict:
    receipt = json.loads(path.read_text())
    snapshot = inputs()
    if receipt.get("schema") != 1 or receipt.get("inputs") != snapshot or receipt.get("fingerprint") != fingerprint(snapshot):
        raise RuntimeError("Bend proof receipt does not cover these exact sources and generated artifacts")
    if receipt.get("toolchain") != json.loads((ROOT / "bend/toolchain.json").read_text()):
        raise RuntimeError("Bend proof receipt uses a different toolchain")
    validation = receipt.get("validation", {})
    conformance = receipt.get("conformance", {})
    if receipt.get("proof") != "All terms check." or validation.get("native_checked") is not True:
        raise RuntimeError("Bend receipt is missing pure/native verification")
    mutations = validation.get("mutations", [])
    if not mutations or any(item.get("runtime") != "pure/type-correct" or item.get("proof") != "rejected equality/type mismatch" for item in mutations):
        raise RuntimeError("Bend receipt is missing semantic mutation evidence")
    if conformance.get("complete_decisions_equal") is not True or conformance.get("cases", 0) < 1:
        raise RuntimeError("Bend receipt is missing complete native/JS conformance")
    if conformance.get("javascript_sha256") != snapshot.get("src/verified/generated/core.cjs"):
        raise RuntimeError("Bend conformance did not check the generated code being packaged")
    if os.environ.get("GITHUB_ACTIONS") == "true":
        expected = {key: os.environ.get(key, "") for key in CI_KEYS}
        if any(not value for value in expected.values()) or receipt.get("producer") != expected:
            raise RuntimeError("Bend evidence must come from this exact repository, commit and workflow attempt")
    return receipt
