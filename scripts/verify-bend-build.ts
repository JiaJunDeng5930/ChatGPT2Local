import { resolve } from "node:path";

/** Execute a real proof check, or explicitly import same-input trusted CI evidence. */
export function verifyBendBuild(full = false): void {
  const root = resolve(import.meta.dir, "..");
  const receipt = process.env.BEND_PROOF_RECEIPT;
  const python = process.env.PYTHON ?? (process.platform === "win32" ? "python" : "python3");
  const args = receipt
    ? ["scripts/verify-bend.py", "--receipt", resolve(receipt)]
    : full ? ["scripts/verify-bend.py"] : ["scripts/build-bend-core.py", "--check"];
  const result = Bun.spawnSync([python, ...args], { cwd: root, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) throw new Error(`Bend build verification failed (${result.exitCode}); no runtime was packaged`);
}

if (import.meta.main) verifyBendBuild(process.argv.includes("--full"));
