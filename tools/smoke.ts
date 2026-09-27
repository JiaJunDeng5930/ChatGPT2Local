import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { treeDigest } from "./integrity";

const directory = resolve(process.argv[2] ?? "dist/runtime");
const manifest = JSON.parse(readFileSync(join(directory, "runtime-manifest.json"), "utf8"));
assert.equal(existsSync(join(directory, "node_modules")), false, "The runtime must be self-contained; node_modules cannot be a delivery dependency");
assert.equal(treeDigest(join(directory, "LICENSES")), manifest.legalTreeSha256, "Packaged legal notices changed");
for (const [name, expected] of Object.entries(manifest.artifacts))
  assert.equal(createHash("sha256").update(readFileSync(join(directory, name))).digest("hex"), expected, `Artifact changed: ${name}`);
// Exercise a relocated copy outside the repository. This prevents an
// accidentally externalized import from resolving against the developer's
// root node_modules and falsely passing the release smoke test.
const isolatedRoot = mkdtempSync(join(tmpdir(), "bend-relocated-runtime-"));
const isolated = join(isolatedRoot, "runtime");
cpSync(directory, isolated, { recursive: true });
const executable = join(isolated, process.platform === "win32" ? "bun.exe" : "bun");
const entry = join(isolated, "cli.js");
const home = join(isolatedRoot, "home");
const command = async (args: string[]) => {
  const child = Bun.spawn([executable, entry, ...args, "--home", home], { stdout: "pipe", stderr: "pipe" });
  const [text, errors, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  assert.equal(code, 0, errors); return text;
};
let service: ReturnType<typeof Bun.spawn> | undefined;
let timeout: ReturnType<typeof setTimeout> | undefined;
try {
  assert.equal((await command(["--version"])).trim(), manifest.version);
  await command(["setup"]);
  const diagnostics = JSON.parse(await command(["doctor", "--port", "1", "--cdp", "http://127.0.0.1:1"]));
  assert.equal(diagnostics.version, manifest.version);
  service = Bun.spawn([executable, entry, "serve", "--home", home, "--port", "0", "--cdp", "http://127.0.0.1:1"], { stdout: "pipe", stderr: "pipe" });
  const reader = (service.stdout as ReadableStream<Uint8Array>).getReader();
  const ready = await Promise.race([reader.read(), new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Packaged service did not become ready")), 10000); })]);
  clearTimeout(timeout); timeout = undefined;
  const message = JSON.parse(new TextDecoder().decode(ready.value).trim());
  assert.equal(message.event, "ready");
  const response = await fetch(`http://127.0.0.1:${message.port}/health`);
  assert.equal((await response.json() as { version: string }).version, manifest.version);
  reader.releaseLock();
  console.log(JSON.stringify({ packaged_version: manifest.version, artifact_hashes: "verified", standalone_service: "passed", account_requests: 0 }));
} finally {
  if (timeout) clearTimeout(timeout);
  service?.kill("SIGTERM");
  if (service) await service.exited;
  rmSync(isolatedRoot, { recursive: true, force: true });
}
