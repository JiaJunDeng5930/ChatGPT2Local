/** Launch the packaged application, not the source entry or global Bun. */
import { _electron, chromium, type ElectronApplication } from "playwright-core";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";
import { defaultConfig, writeConfig } from "../runtime/config";
import { browserFixture } from "../test/browser-fixture";
import { requestBody } from "../test/fixtures";

const root = resolve(import.meta.dir, "..");
const releases = join(root, "desktop/release");
function locate(directory: string, depth = 0): string | undefined {
  if (!existsSync(directory) || depth > 4) return undefined;
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (process.platform === "darwin" && entry.isDirectory() && entry.name.endsWith(".app")) {
      const mac = join(path, "Contents/MacOS/ChatGPT Web");
      if (existsSync(mac)) return mac;
    }
    if (entry.isFile() && process.platform === "linux" && ["codex-web-bend-desktop", "ChatGPT Web"].includes(entry.name)) return path;
    if (entry.isFile() && process.platform === "win32" && ["ChatGPT Web.exe", "codex-web-bend-desktop.exe"].includes(entry.name)) return path;
    if (entry.isDirectory()) { const found = locate(path, depth + 1); if (found) return found; }
  }
  return undefined;
}
const executable = process.argv[2] ? resolve(process.argv[2]) : locate(releases);
if (!executable) throw new Error("Pass the actual packaged Electron executable or build the platform directory package first");
const home = mkdtempSync(join(tmpdir(), "bend-packaged-desktop-"));
let application: ElectronApplication | undefined;
const fixture = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(browserFixture, { headers: { "content-type": "text/html" } }) });
const configuration = defaultConfig(); configuration.port = 0;
configuration.browser.startUrl = `http://127.0.0.1:${fixture.port}/`;
writeConfig(home, configuration);
let pid: number | undefined;
try {
  const env: Record<string, string> = Object.fromEntries(Object.entries(process.env)
    .filter((entry): entry is [string, string] => entry[1] !== undefined));
  env.CODEX_CHATGPT_WEB_HOME = home;
  delete env.CODEX_WEB_BUN; delete env.ELECTRON_RUN_AS_NODE;
  application = await _electron.launch({ executablePath: executable, env, timeout: 30000 });
  const deadline = Date.now() + 20000;
  while (!existsSync(join(home, "service.json")) && Date.now() < deadline) await Bun.sleep(50);
  assert.ok(existsSync(join(home, "service.json")), "Packaged runtime did not announce readiness");
  const service = JSON.parse(readFileSync(join(home, "service.json"), "utf8"));
  pid = service.pid;
  assert.equal(await application.evaluate<boolean, void>(({ app }) => app.isPackaged, undefined), true);
  const cdp = Number(readFileSync(join(home, "desktop/DevToolsActivePort"), "utf8").split("\n")[0]);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdp}`, { noDefaults: true });
  const result = fetch(`http://127.0.0.1:${service.port}/v1/responses`, { method: "POST", headers: { authorization: `Bearer ${configuration.token}`, "content-type": "application/json", "idempotency-key": "packaged-local-turn" },
    body: JSON.stringify({ ...requestBody("packaged-local-turn"), stream: false }), signal: AbortSignal.timeout(15000) });
  void result.catch(() => {});
  let page: import("playwright-core").Page | undefined;
  const sentDeadline = Date.now() + 10000;
  while (!page && Date.now() < sentDeadline) {
    for (const candidate of browser.contexts().flatMap(c => c.pages()).filter(p => p.url() === configuration.browser.startUrl)) {
      if (await candidate.evaluate(() => (window as any).fixture?.sends === 1)) { page = candidate; break; }
    }
    if (!page) await Bun.sleep(40);
  }
  assert.ok(page, "Packaged HTTP-to-browser path did not send exactly once");
  await page.evaluate(() => (window as any).fixture.finish("Packaged runtime completed"));
  const response = await result;
  assert.equal(response.status, 200);
  assert.equal((await response.json() as any).output[0].content[0].text, "Packaged runtime completed");
  const shell = application.windows().find(p => p.url().endsWith("shell.html"))!;
  await shell.getByRole("button", { name: "Activity", exact: true }).click();
  await shell.getByRole("button", { name: "Refresh", exact: true }).click();
  await shell.waitForFunction(() => document.querySelectorAll("#activity-table .activity-row").length === 1);
  mkdirSync(join(root, ".build/evidence"), { recursive: true });
  const screenshot = await application.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.capturePage()).toPNG().toString("base64"));
  await Bun.write(join(root, ".build/evidence/packaged-desktop.png"), Buffer.from(screenshot, "base64"));
  const report = { executable, isPackaged: true, version: (await (await fetch(`http://127.0.0.1:${service.port}/health`)).json() as any).version,
    completed: true, browserActivations: await page.evaluate(() => (window as any).fixture.sends), accountRequests: 0 };
  await Bun.write(join(root, ".build/desktop-verification.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
} finally {
  if (pid) { try { process.kill(pid, "SIGTERM"); } catch { /* This owned process already exited. */ } }
  application?.process().kill("SIGKILL");
  await fixture.stop(true); await Bun.sleep(200);
  rmSync(home, { recursive: true, force: true });
}
