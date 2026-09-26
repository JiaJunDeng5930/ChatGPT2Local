#!/usr/bin/env python3
"""Install the reviewed Bend release into this checkout, never a global prefix.

Archive hashes are pinned from the release API, not the release tag's flake:
v2.0.27's flake still describes v2.0.26. Windows consumes same-workflow proof
evidence produced on Linux; it does not pretend to run an unsupported compiler.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def unpack(archive: Path, directory: Path) -> None:
    # No links, devices, path traversal, or archive-controlled ownership/modes.
    # Explicit extraction also works on Python 3.10, before tarfile's data filter.
    with tarfile.open(archive, "r:gz") as package:
        for member in package.getmembers():
            name = PurePosixPath(member.name)
            if name.is_absolute() or ".." in name.parts or "\\" in member.name:
                raise RuntimeError(f"Unsafe toolchain archive member: {member.name}")
            target = directory.joinpath(*name.parts)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            elif member.isfile():
                target.parent.mkdir(parents=True, exist_ok=True)
                source = package.extractfile(member)
                if source is None:
                    raise RuntimeError(f"Missing archive payload: {member.name}")
                with source, target.open("xb") as output:
                    shutil.copyfileobj(source, output)
                target.chmod(0o755 if member.mode & 0o111 else 0o644)
            else:
                raise RuntimeError(f"Unsupported toolchain archive member: {member.name}")


def install() -> Path:
    pin = json.loads((ROOT / "bend/toolchain.json").read_text())
    system = {"Darwin": "darwin", "Linux": "linux"}.get(platform.system())
    arch = {"arm64": "arm64", "aarch64": "arm64", "x86_64": "x64", "AMD64": "x64"}.get(platform.machine())
    target = f"{system}-{arch}"
    if target not in pin["archives"]:
        raise RuntimeError("Bend 2.0.27 supports macOS/Linux. Use Linux/WSL for verification; Windows CI imports checked evidence from its Linux job.")
    cache = ROOT / ".cache/bend-toolchain"
    cache.mkdir(parents=True, exist_ok=True)
    version = pin["release"].removeprefix("v")
    name = f"bend-{version}-{target}.tar.gz"
    archive = cache / name
    expected = pin["archives"][target]
    if not archive.exists() or file_hash(archive) != expected:
        url = f"https://github.com/bendlang/bend/releases/download/{pin['release']}/{name}"
        request = urllib.request.Request(url, headers={"User-Agent": "codex-chatgpt-web-build"})
        with tempfile.NamedTemporaryFile(dir=cache, suffix=".download", delete=False) as output:
            temporary = Path(output.name)
            try:
                with urllib.request.urlopen(request, timeout=60) as source:
                    shutil.copyfileobj(source, output)
                output.flush()
                if file_hash(temporary) != expected:
                    raise RuntimeError("Downloaded Bend archive does not match its pinned SHA256")
                temporary.replace(archive)
            finally:
                temporary.unlink(missing_ok=True)
    # Re-extract from the verified archive instead of trusting an installation
    # merely because an executable or a version string exists in the cache.
    with tempfile.TemporaryDirectory(dir=cache, prefix="extract-") as temporary:
        staging = Path(temporary)
        unpack(archive, staging)
        candidates = list(staging.glob("bin/bend")) + list(staging.glob("*/bin/bend"))
        if len(candidates) != 1:
            raise RuntimeError("Bend release has an unexpected installation layout")
        home = candidates[0].parent.parent
        destination = cache / "installed"
        if destination.exists():
            shutil.rmtree(destination)
        shutil.copytree(home, destination)
    compiler = destination / "bin/bend"
    for command, expected_output in [([str(compiler), "version"], pin["compiler_version"])]:
        result = subprocess.run(command, capture_output=True, text=True, check=True)
        if result.stderr or result.stdout.strip() != expected_output:
            raise RuntimeError("Installed compiler version does not match the toolchain pin")
    base = subprocess.run([str(compiler), "base"], capture_output=True, check=True)
    if base.stderr or hashlib.sha256(base.stdout).hexdigest() != pin["base_sha256"]:
        raise RuntimeError("Installed Base does not match the reviewed proof environment")
    return compiler


if __name__ == "__main__":
    try:
        compiler = install()
        print(compiler)
        if os.environ.get("GITHUB_ENV"):
            with open(os.environ["GITHUB_ENV"], "a") as environment:
                environment.write(f"BEND={compiler}\n")
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
