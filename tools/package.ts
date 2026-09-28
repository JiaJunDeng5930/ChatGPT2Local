/** A source release always executes the proof checker before packaging. */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, chmodSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { createHash } from "node:crypto";
import { treeDigest } from "./integrity";

const root = resolve(import.meta.dir, "..");
const metadata = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (process.versions.bun !== metadata.engines.bun) throw new Error(`Packaging requires Bun ${metadata.engines.bun}`);

async function run(cmd: string[], cwd = root) {
  const child = Bun.spawn(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
  if (await child.exited) throw new Error(`Package command failed: ${cmd.join(" ")}`);
}
function hash(path: string) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function sourceFingerprint(): string {
  const digest = createHash("sha256");
  const walk = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (["node_modules", "release", "assets", "__pycache__"].includes(entry.name)) continue;
      const file = join(path, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) digest.update(relative(root, file)).update("\0").update(readFileSync(file));
    }
  };
  for (const directory of ["bend", "runtime", "tools", "desktop"]) walk(join(root, directory));
  for (const file of ["package.json", "bun.lock"]) digest.update(file).update("\0").update(readFileSync(join(root, file)));
  return digest.digest("hex");
}

await run([process.env.PYTHON ?? "python3", "tools/build.py", "--native"]);
const destination = join(root, "dist", "runtime");
const staging = join(root, "dist", `.runtime-build-${process.pid}`);
rmSync(staging, { recursive: true, force: true }); mkdirSync(staging, { recursive: true });
try {
  const built = await Bun.build({ entrypoints: [join(root, "runtime/cli.ts")], outdir: staging, target: "bun", format: "esm",
    minify: false, sourcemap: "external" });
  if (!built.success) throw new AggregateError(built.logs, "The checked runtime did not bundle");
  const packaged = { ...metadata, bin: { "codex-chatgpt-web": "./cli.js" }, scripts: {} };
  writeFileSync(join(staging, "package.json"), JSON.stringify(packaged, null, 2) + "\n");
  cpSync(join(root, "bun.lock"), join(staging, "bun.lock"));
  const executable = process.platform === "win32" ? "bun.exe" : "bun";
  cpSync(process.execPath, join(staging, executable)); chmodSync(join(staging, executable), 0o755);
  cpSync(join(root, ".build/manifest.json"), join(staging, "proof-manifest.json"));
  cpSync(join(root, ".build/bend-core"), join(staging, "bend-core"));
  cpSync(join(root, "LICENSE"), join(staging, "LICENSE"));
  cpSync(join(root, "LICENSES"), join(staging, "LICENSES"), { recursive: true });
  let notices = "ChatGPT Web · Bend — third-party runtime notices\n\n";
  // Runtime dependencies are bundled into cli.js. Read their installed source
  // trees only to produce provenance and license evidence; no node_modules
  // directory is part of the release artifact. This matters for Electron,
  // whose extraResources copier intentionally filters nested node_modules.
  const modules = join(root, "node_modules");
  if (!existsSync(modules)) throw new Error("Install the pinned dependencies before packaging");
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".")) continue;
      const path = join(directory, entry.name);
      if (entry.name.startsWith("@")) { visit(path); continue; }
      if (!existsSync(join(path, "package.json"))) continue;
      const pkg = JSON.parse(readFileSync(join(path, "package.json"), "utf8"));
      notices += `\n${"=".repeat(72)}\n${pkg.name} ${pkg.version}\nLicense: ${typeof pkg.license === "string" ? pkg.license : JSON.stringify(pkg.license ?? "See package files")}\n`;
      for (const file of readdirSync(path).filter(name => /^(license|copying|notice)(\.|$|-)/i.test(name))) {
        if (statSync(join(path, file)).isFile()) notices += `\n${file}\n${readFileSync(join(path, file), "utf8")}\n`;
      }
      if (existsSync(join(path, "node_modules"))) visit(join(path, "node_modules"));
    }
  };
  visit(modules);
  writeFileSync(join(staging, "THIRD-PARTY-NOTICES.txt"), notices);
  const manifest = { version: metadata.version, platform: process.platform, arch: process.arch,
    bundledDependencies: Object.keys(metadata.dependencies).sort(), installedDependencyTreeSha256: treeDigest(modules),
    legalTreeSha256: treeDigest(join(staging, "LICENSES")),
    sourceFingerprint: sourceFingerprint(), kernel: JSON.parse(readFileSync(join(root, ".build/manifest.json"), "utf8")),
    artifacts: Object.fromEntries(["cli.js", executable, "bend-core", "proof-manifest.json", "package.json", "bun.lock", "THIRD-PARTY-NOTICES.txt"].map(file => [file, hash(join(staging, file))])) };
  writeFileSync(join(staging, "runtime-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  const previous = join(root, "dist", ".runtime-previous");
  rmSync(previous, { recursive: true, force: true });
  if (existsSync(destination)) renameSync(destination, previous);
  try { renameSync(staging, destination); }
  catch (error) { if (existsSync(previous)) renameSync(previous, destination); throw error; }
  rmSync(previous, { recursive: true, force: true });
  console.log(`Built ${destination} (${manifest.sourceFingerprint})`);
} finally { rmSync(staging, { recursive: true, force: true }); }
