"""Mechanical boundary tests; the real compiler/proofs run separately."""
from __future__ import annotations

import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import tarfile
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / "scripts" / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


evidence = load("tested_evidence", "bend-evidence.py")
setup = load("tested_setup", "setup-bend.py")
conformance = load("tested_conformance", "check-bend-conformance.py")
build = load("tested_boundaries", "build-bend-core.py")


class BoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        self.bend = self.root / "bend"
        shutil.copytree(ROOT / "bend", self.bend)
        self.root_patch = patch.object(build, "ROOT", self.root)
        self.bend_patch = patch.object(build, "BEND", self.bend)
        self.root_patch.start()
        self.bend_patch.start()

    def tearDown(self):
        self.bend_patch.stop()
        self.root_patch.stop()
        self.temporary.cleanup()

    def test_current_production_closure_is_covered(self):
        build.check_boundaries()

    def test_specification_cannot_import_its_implementation_indirectly(self):
        (self.bend / "indirect.bend").write_text("import ./history.bend as Hidden\n")
        spec = self.bend / "history-specification.bend"
        spec.write_text(spec.read_text() + "\nimport ./indirect.bend as Indirect\n")
        with self.assertRaisesRegex(RuntimeError, "specification.*implementation|depends on"):
            build.check_boundaries()

    def test_unsafe_and_holes_cannot_enter_the_pure_runtime_closure(self):
        source = self.bend / "transcript.bend"
        original = source.read_text()
        for body in ["@unsafe def escaped(n: Nat) -> Nat: escaped(n)\n",
                     "def unfinished(n: Nat) -> Nat: ?TODO\n"]:
            source.write_text(original + "\n" + body)
            with self.assertRaisesRegex(RuntimeError, "[Uu]nsafe|[Uu]nchecked|[Uu]nfilled|[Hh]ole"):
                build.check_boundaries()

    def test_cyclic_and_outside_imports_are_rejected(self):
        entry = self.bend / "cycle-a.bend"
        entry.write_text("import ./cycle-b.bend as B\n")
        (self.bend / "cycle-b.bend").write_text("import ./cycle-a.bend as A\n")
        with self.assertRaisesRegex(RuntimeError, "[Cc]ycl"):
            build.closure(entry)
        entry.write_text("import ../outside.bend as Outside\n")
        (self.root / "outside.bend").write_text("import Base\n")
        with self.assertRaisesRegex(RuntimeError, "[Oo]utside|[Ee]scap|[Ee]xternal|[Uu]nreviewed|[Uu]nexpected"):
            build.closure(entry)


class ProductionInputTests(unittest.TestCase):
    def test_evidence_manifest_matches_real_production_files(self):
        snapshot = evidence.inputs()
        for name in [*evidence.BINDINGS, *("scripts/" + name for name in evidence.SCRIPTS),
                     "src/adapters/chatgpt-web/markdown.ts", "scripts/tests/test_bend_gate.py",
                     "package.json", "launcher/package.json", ".gitattributes"]:
            self.assertIn(name, snapshot)


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.root_patch = patch.object(evidence, "ROOT", self.root)
        self.root_patch.start()
        self.environment = patch.dict(os.environ, {}, clear=True)
        self.environment.start()
        paths = ["bend/PROOF.bend", "bend/api.bend", "bend/domain.bend",
                 "src/verified/boundary.ts", "src/verified/generated/core.cjs",
                 "src/verified/generated/core.d.cts", *("scripts/" + name for name in evidence.SCRIPTS),
                 *evidence.BINDINGS]
        for name in paths:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("fixture: " + name + "\n")
        (self.root / "bend/toolchain.json").write_text('{"compiler_version":"fixture"}')
        self.path = self.root / "receipt.json"
        self.write_receipt()

    def tearDown(self):
        self.environment.stop()
        self.root_patch.stop()
        self.temporary.cleanup()

    def write_receipt(self):
        validation = {"native_checked": True, "mutations": [{
            "runtime": "pure/type-correct", "proof": "rejected equality/type mismatch"}],
            "proof_gate_probes": [{"probe": name, "gate": "rejected"} for name in
              ["missing-proof", "false-proof", "proof-hole", "unchecked-proof", "circular-proof"]]}
        checked = {"complete_decisions_equal": True, "cases": 1,
                   "javascript_sha256": evidence.inputs()["src/verified/generated/core.cjs"]}
        evidence.write(self.path, validation, checked)

    def mutate_receipt(self, change):
        value = json.loads(self.path.read_text())
        change(value)
        self.path.write_text(json.dumps(value))

    def test_exact_input_receipt_is_accepted(self):
        self.assertEqual(evidence.check(self.path)["schema"], 1)

    def test_changed_inputs_fail_closed(self):
        for name in ["bend/domain.bend", "bend/PROOF.bend", "src/verified/boundary.ts",
                     "src/verified/generated/core.cjs", "scripts/build-bend-core.py", *evidence.BINDINGS]:
            with self.subTest(name=name):
                path = self.root / name
                old = path.read_bytes()
                path.write_bytes(old + b"changed")
                with self.assertRaisesRegex(RuntimeError, "exact sources"):
                    evidence.check(self.path)
                path.write_bytes(old)

    def test_missing_build_input_is_not_silently_omitted(self):
        (self.root / "scripts/verify-bend-build.ts").unlink()
        with self.assertRaisesRegex(RuntimeError, "Missing required"):
            evidence.check(self.path)

    def test_new_runtime_module_invalidates_receipt(self):
        (self.root / "src/verified/new-policy.ts").write_text("new policy")
        with self.assertRaisesRegex(RuntimeError, "exact sources"):
            evidence.check(self.path)

    def test_new_host_policy_and_gate_test_invalidate_receipt(self):
        for name in ["src/adapters/new-host-policy.ts", "launcher/electron/new-owner.cjs",
                     "launcher/src/controls.tsx", "scripts/tests/new_gate_test.py"]:
            with self.subTest(name=name):
                path = self.root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("new policy or gate test")
                with self.assertRaisesRegex(RuntimeError, "exact sources"):
                    evidence.check(self.path)
                path.unlink()

    def test_missing_native_verification_is_not_a_full_build(self):
        self.mutate_receipt(lambda r: r["validation"].update(native_checked=False))
        with self.assertRaisesRegex(RuntimeError, "pure/native"):
            evidence.check(self.path)

    def test_parse_failures_do_not_count_as_semantic_mutations(self):
        self.mutate_receipt(lambda r: r["validation"]["mutations"][0].update(proof="parse error"))
        with self.assertRaisesRegex(RuntimeError, "mutation"):
            evidence.check(self.path)

    def test_missing_or_accepted_purity_probes_cannot_authorize_a_build(self):
        for mutate in [lambda r: r["validation"].pop("proof_gate_probes"),
                       lambda r: r["validation"]["proof_gate_probes"].pop(),
                       lambda r: r["validation"]["proof_gate_probes"][0].update(gate="accepted")]:
            self.write_receipt()
            self.mutate_receipt(mutate)
            with self.assertRaisesRegex(RuntimeError, "proof-gate rejection"):
                evidence.check(self.path)

    def test_conformance_must_cover_packaged_output(self):
        self.mutate_receipt(lambda r: r["conformance"].update(javascript_sha256="0" * 64))
        with self.assertRaisesRegex(RuntimeError, "being packaged"):
            evidence.check(self.path)

    def test_incomplete_conformance_is_rejected(self):
        self.mutate_receipt(lambda r: r["conformance"].update(complete_decisions_equal=False))
        with self.assertRaisesRegex(RuntimeError, "native/JS conformance"):
            evidence.check(self.path)

    def test_ci_requires_same_repository_commit_run_and_attempt(self):
        os.environ.update(GITHUB_ACTIONS="true", GITHUB_REPOSITORY="fixture/repo", GITHUB_SHA="abc",
                          GITHUB_RUN_ID="12", GITHUB_RUN_ATTEMPT="1")
        self.write_receipt()
        evidence.check(self.path)
        for key in evidence.CI_KEYS:
            with self.subTest(key=key):
                old = os.environ[key]
                os.environ[key] = "different"
                with self.assertRaisesRegex(RuntimeError, "exact repository"):
                    evidence.check(self.path)
                os.environ[key] = old

    def test_partial_receipt_is_never_success(self):
        self.path.write_text('{"schema":')
        with self.assertRaises(ValueError):
            evidence.check(self.path)


class ArchiveTests(unittest.TestCase):
    def test_links_and_traversal_are_rejected(self):
        for name, kind in [("../escape", tarfile.REGTYPE), ("/absolute", tarfile.REGTYPE),
                           ("bin/bend", tarfile.SYMTYPE), ("bin/bend", tarfile.LNKTYPE)]:
            with self.subTest(name=name, kind=kind), tempfile.TemporaryDirectory() as temporary:
                directory = Path(temporary)
                archive = directory / "test.tar.gz"
                with tarfile.open(archive, "w:gz") as package:
                    item = tarfile.TarInfo(name)
                    item.type = kind
                    item.linkname = "/outside"
                    package.addfile(item, io.BytesIO(b""))
                with self.assertRaises(RuntimeError):
                    setup.unpack(archive, directory / "unpack")

    def test_regular_payload_keeps_only_execution_permission(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            archive = directory / "test.tar.gz"
            with tarfile.open(archive, "w:gz") as package:
                item = tarfile.TarInfo("bin/bend")
                item.size = 4
                item.mode = 0o4755
                package.addfile(item, io.BytesIO(b"test"))
            setup.unpack(archive, directory / "unpack")
            target = directory / "unpack/bin/bend"
            self.assertEqual(target.read_bytes(), b"test")
            if os.name != "nt":
                self.assertEqual(target.stat().st_mode & 0o7777, 0o755)


class FixtureTests(unittest.TestCase):
    def test_large_nats_use_parser_representable_limbs(self):
        schema = conformance.Schema()
        self.assertEqual(schema.literal(2**32-1, "Nat"), "4294967295n")
        self.assertEqual(schema.literal(2**48-1, "Nat"), "Nat.add(Nat.mul(4294967295n, 65536n), 65535n)")
        for value in [-1, 2**48, True]:
            with self.assertRaises(AssertionError):
                schema.literal(value, "Nat")

    def test_every_real_production_export_has_native_fixtures(self):
        self.assertEqual(set(conformance.Schema().functions),
                         {case["function"] for case in conformance.cases()})


if __name__ == "__main__":
    unittest.main()
