#!/usr/bin/env python3
"""Install the locally pinned Bend compiler, checking bytes before execution."""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]

def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""): value.update(chunk)
    return value.hexdigest()

def unpack(archive: Path, target: Path) -> None:
    with tarfile.open(archive, "r:gz") as package:
        for member in package:
            name = PurePosixPath(member.name)
            if name.is_absolute() or ".." in name.parts or "\\" in member.name or not (member.isfile() or member.isdir()):
                raise RuntimeError(f"Unsafe toolchain member: {member.name}")
            destination = target.joinpath(*name.parts)
            if member.isdir(): destination.mkdir(parents=True, exist_ok=True); continue
            destination.parent.mkdir(parents=True, exist_ok=True)
            source = package.extractfile(member)
            if source is None: raise RuntimeError("Missing archive payload")
            with source, destination.open("xb") as output: shutil.copyfileobj(source, output)
            destination.chmod(0o755 if member.mode & 0o111 else 0o644)

def install() -> Path:
    pin = json.loads((ROOT / "bend/toolchain.json").read_text())
    system = {"Darwin": "darwin", "Linux": "linux"}.get(platform.system())
    arch = {"aarch64": "arm64", "arm64": "arm64", "x86_64": "x64", "AMD64": "x64"}.get(platform.machine())
    target = f"{system}-{arch}"
    if target not in pin["archives"]: raise RuntimeError("The pinned compiler runs on macOS/Linux. Verify in Linux/WSL, not an unchecked Windows substitute.")
    cache = ROOT / ".cache/bend-toolchain"
    cache.mkdir(parents=True, exist_ok=True)
    name = f"bend-{pin['release'].removeprefix('v')}-{target}.tar.gz"
    archive = cache / name
    expected = pin["archives"][target]
    if not archive.exists() or digest(archive) != expected:
        request = urllib.request.Request(f"https://github.com/bendlang/bend/releases/download/{pin['release']}/{name}", headers={"User-Agent": "codex-web-bend-bootstrap"})
        temporary = cache / (name + ".download")
        try:
            with urllib.request.urlopen(request, timeout=60) as source, temporary.open("wb") as output:
                shutil.copyfileobj(source, output); output.flush(); os.fsync(output.fileno())
            if digest(temporary) != expected: raise RuntimeError("The compiler archive does not match the pinned SHA256")
            temporary.replace(archive)
        finally: temporary.unlink(missing_ok=True)
    with tempfile.TemporaryDirectory(prefix="unpack-", dir=cache) as directory:
        staging = Path(directory)
        unpack(archive, staging)
        candidates = list(staging.glob("**/bin/bend"))
        if len(candidates) != 1: raise RuntimeError("The archive does not contain one compiler prefix")
        prefix = candidates[0].parent.parent
        binary = candidates[0]
        version = subprocess.run([str(binary), "version"], check=True, capture_output=True, text=True)
        base = subprocess.run([str(binary), "base"], check=True, capture_output=True)
        if version.stderr or version.stdout.strip() != pin["compiler_version"] or base.stderr or hashlib.sha256(base.stdout).hexdigest() != pin["base_sha256"]:
            raise RuntimeError("The extracted compiler/Base does not match the reviewed pin")
        installed = cache / "installed"
        previous = cache / "previous"
        if previous.exists(): shutil.rmtree(previous)
        if installed.exists(): installed.rename(previous)
        try: shutil.copytree(prefix, installed)
        except BaseException:
            if installed.exists(): shutil.rmtree(installed)
            if previous.exists(): previous.rename(installed)
            raise
        if previous.exists(): shutil.rmtree(previous)
    return cache / "installed/bin/bend"

if __name__ == "__main__": print(install())
