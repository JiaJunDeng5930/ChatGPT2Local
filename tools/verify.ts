/** One fresh verification command used by developers and release CI. */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const packageInfo = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const desktop = JSON.parse(readFileSync(join(root, "desktop/package.json"), "utf8"));
if (process.versions.bun !== packageInfo.engines.bun || desktop.version !== packageInfo.version) throw new Error("Runtime, desktop, and pinned build versions disagree");
for (const old of ["src", "tests", "scripts", "launcher"])
  if (existsSync(join(root, old))) throw new Error(`The old implementation directory still exists: ${old}`);

const checks: { command: string[]; result: "passed" }[] = [];
async function run(command: string[]) {
  console.log(`\nVERIFY ${command.join(" ")}`);
  const child = Bun.spawn(command, { cwd: root, stdout: "inherit", stderr: "inherit", stdin: "inherit" });
  if (await child.exited) throw new Error(`Verification failed: ${command.join(" ")}`);
  checks.push({ command, result: "passed" });
}

await run([process.env.PYTHON ?? "python3", "tools/proof_tests.py"]);
await run([process.execPath, "node_modules/typescript/bin/tsc", "--noEmit"]);
await run([process.execPath, "test", "./test"]);
for (const file of ["main.cjs", "preload.cjs", "shell.js"]) await run(["node", "--check", `desktop/${file}`]);
await run([process.execPath, "tools/package.ts"]);
await run([process.execPath, "tools/smoke.ts", "dist/runtime"]);
await run([process.env.PYTHON ?? "python3", "tools/build.py", "--check"]);
writeFileSync(join(root, ".build", "release-verification.json"), JSON.stringify({ version: packageInfo.version,
  kernel: JSON.parse(readFileSync(join(root, ".build/manifest.json"), "utf8")), checks,
  live_account_requests: 0, note: "External account-specific UI and other operating systems require their own evidence; this report does not assert them." }, null, 2) + "\n");
console.log("\nFresh verification complete. Evidence: .build/release-verification.json");
