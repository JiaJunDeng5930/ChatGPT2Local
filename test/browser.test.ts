import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { _electron, chromium, type ElectronApplication, type Browser as Connection } from "playwright-core";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { defaultConfig, writeConfig } from "../runtime/config";
import { WebBrowser } from "../runtime/browser";
import { Store } from "../runtime/store";
import { parseRequest } from "../runtime/protocol";
import { eventually, requestBody, requestHeaders, continuationBody } from "./fixtures";
import { browserFixture } from "./browser-fixture";
import { randomBytes } from "node:crypto";

const home = mkdtempSync(join(tmpdir(), "bend-desktop-test-"));
let electron: ElectronApplication;
let connection: Connection;
let pageServer: ReturnType<typeof Bun.serve>;
let endpoint: string;
let origin: string;
let store: Store;
let hostUrl: string;
const hostToken = randomBytes(32).toString("base64url");
const root = resolve(import.meta.dir, "..");
const executable = process.env.ELECTRON_EXECUTABLE ?? [
  join(root, "desktop/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"),
  join(root, "desktop/node_modules/electron/dist/electron"),
  join(root, "desktop/node_modules/electron/dist/electron.exe"),
].find(existsSync);

beforeAll(async () => {
  if (!executable) throw new Error("Install the pinned desktop Electron dependency before running browser boundary tests");
  pageServer = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: request => {
    const free = new URL(request.url).pathname === "/free";
    return new Response(browserFixture + (free ? `<script>document.getElementById('effort').hidden=true;const b=document.createElement('button');b.type='button';b.dataset.testid='think-button';b.setAttribute('aria-pressed','false');b.textContent='Think';b.onclick=()=>b.setAttribute('aria-pressed',String(b.getAttribute('aria-pressed')!=='true'));document.querySelector('form').prepend(b);</script>` : ""), { headers: { "content-type": "text/html" } });
  } });
  origin = `http://127.0.0.1:${pageServer.port}`;
  const config = defaultConfig(); config.port = 0; config.browser.startUrl = origin; writeConfig(home, config);
  electron = await _electron.launch({ executablePath: executable, args: [join(root, "desktop")],
    env: { ...process.env, CODEX_CHATGPT_WEB_HOME: home, CODEX_WEB_BUN: process.execPath, CODEX_WEB_HOST_TOKEN: hostToken }, timeout: 30_000 });
  await eventually(() => existsSync(join(home, "service.json")), "desktop runtime readiness", 20_000);
  const port = Number(readFileSync(join(home, "desktop", "DevToolsActivePort"), "utf8").split("\n")[0]);
  endpoint = `http://127.0.0.1:${port}`;
  hostUrl = JSON.parse(readFileSync(join(home, "service.json"), "utf8")).browserHost;
  connection = await chromium.connectOverCDP(endpoint, { noDefaults: true });
  store = new Store(join(home, "boundary-test-storage"));
}, 40_000);

afterAll(async () => {
  if (existsSync(join(home, "service.json"))) {
    const service = JSON.parse(readFileSync(join(home, "service.json"), "utf8"));
    try { process.kill(service.pid, "SIGTERM"); } catch { /* Already exited. */ }
  }
  electron?.process().kill("SIGKILL");
  await pageServer?.stop(true);
  store?.close();
  await Bun.sleep(150);
  rmSync(home, { recursive: true, force: true });
});

describe("real Electron DOM, input, identity, and at-most-once activation", () => {
  test("desktop boots the new runtime with the retained launcher information architecture", async () => {
    const service = JSON.parse(readFileSync(join(home, "service.json"), "utf8"));
    const response = await fetch(`http://127.0.0.1:${service.port}/health`);
    expect(response.ok).toBe(true);
    expect((await response.json() as any).version).toBe("7.0.0");
    const windows = electron.windows();
    const shell = windows.find(page => page.url().endsWith("shell.html"));
    expect(shell).toBeTruthy();
    expect(await shell!.getByRole("button", { name: "Browser", exact: true }).count()).toBe(1);
    expect(await shell!.getByRole("button", { name: "Setup", exact: true }).count()).toBe(1);
    expect(await shell!.getByRole("button", { name: "MCP", exact: true }).count()).toBe(1);
    expect(await shell!.getByRole("button", { name: "Activity", exact: true }).count()).toBe(1);
    expect(await shell!.getByRole("button", { name: "Settings", exact: true }).count()).toBe(1);
  });

  test("prepared text survives the real editor and one click is never activated twice", async () => {
    const browser = new WebBrowser({ endpoint, startUrl: origin, hostUrl, hostToken }, 4000);
    const context = parseRequest(requestBody("dom-one"), new Headers({ "idempotency-key": "dom-fixture" }), "browser-only", store).context;
    const prepared = await browser.prepare("dom-one", 0, "Exact multiline\nsecond line 😀", context, {});
    expect((await browser.send("dom-one", 0)).clicked).toBe(true);
    await expect(browser.send("dom-one", 0)).rejects.toThrow("consumed send");
    const pages = connection.contexts().flatMap(c => c.pages());
    const page = pages.filter(page => page.url().startsWith(origin)).at(-1)!;
    await page.evaluate(() => (window as any).fixture.finish("Final *literal* text"));
    const snapshot = await browser.snapshot("dom-one");
    expect(snapshot.page).toBe(prepared.page); expect(snapshot.document).toBe(prepared.document);
    expect(snapshot.accepted).toBe(true); expect(snapshot.facts.completion_control).toBe(true);
    expect(snapshot.text).toBe("Final \\*literal\\* text");
    expect(await page.evaluate(() => (window as any).fixture.sends)).toBe(1);
    expect(await page.evaluate(() => (window as any).fixture.stops)).toBe(0);
  });

  test("selects the exact caller-tool connector before typing without erasing its pill", async () => {
    const browser = new WebBrowser({ endpoint, startUrl: origin, hostUrl, hostToken }, 4000);
    const context = parseRequest(requestBody("dom-full", undefined, true), new Headers({ "idempotency-key": "dom-fixture" }), "full", store).context;
    await browser.prepare("dom-full", 0, "Use the actual native tools", context, {});
    await browser.send("dom-full", 0);
    const snapshot = await browser.snapshot("dom-full");
    expect(snapshot.accepted).toBe(true);
  });

  test("a document navigation invalidates reattachment instead of reconstructing a task", async () => {
    const browser = new WebBrowser({ endpoint, startUrl: origin, hostUrl, hostToken }, 4000);
    const context = parseRequest(requestBody("dom-lost"), new Headers({ "idempotency-key": "dom-fixture" }), "browser-only", store).context;
    const prepared = await browser.prepare("dom-lost", 0, "Do not resend", context, {});
    await browser.send("dom-lost", 0);
    const page = connection.contexts().flatMap(c => c.pages()).filter(page => page.url().startsWith(origin)).at(-1)!;
    await page.goto(origin); // External/user navigation, not an application action.
    await expect(browser.attach("dom-lost", prepared.page, prepared.document)).rejects.toThrow("original owned document");
    expect(await page.evaluate(() => (window as any).fixture.sends)).toBe(0);
  });

  test("a manual new turn cannot be mistaken for the owned answer or cancelled", async () => {
    const browser = new WebBrowser({ endpoint, startUrl: origin, hostUrl, hostToken }, 4000);
    const context = parseRequest(requestBody("manual-fork"), new Headers({ "idempotency-key": "dom-fixture" }), "browser-only", store).context;
    await browser.prepare("manual-fork", 0, "Owned task", context, {});
    await browser.send("manual-fork", 0);
    const page = connection.contexts().flatMap(c => c.pages()).filter(p => p.url().startsWith(origin)).at(-1)!;
    await page.evaluate(() => {
      (window as any).fixture.finish("Owned answer");
      document.getElementById("prompt-textarea")!.textContent = "User's unrelated new task";
      document.querySelector<HTMLButtonElement>("#send")!.click();
    });
    expect((await browser.snapshot("manual-fork")).accepted).toBe(false);
    await expect(browser.cancel("manual-fork")).rejects.toThrow("Cancel ownership changed");
    expect(await page.evaluate(() => (window as any).fixture.stops)).toBe(0);
  });

  test("a free Think control supports medium without substituting a paid effort", async () => {
    const browser = new WebBrowser({ endpoint, startUrl: origin + "/free", hostUrl, hostToken }, 4000);
    const context = parseRequest(requestBody("free-think"), new Headers({ "idempotency-key": "dom-fixture" }), "browser-only", store).context;
    await browser.prepare("free-think", 0, "Free account task", context, {});
    await browser.send("free-think", 0);
    expect((await browser.snapshot("free-think")).accepted).toBe(true);
    await browser.cancel("free-think");
    await browser.cancel("free-think");
    const page = connection.contexts().flatMap(c => c.pages()).filter(p => p.url().endsWith("/free")).at(-1)!;
    expect(await page.evaluate(() => (window as any).fixture.stops)).toBe(1);
    await expect(browser.prepare("paid-unavailable", 0, "Must not send", { ...context, effort: "pro" }, {})).rejects.toThrow("cannot verify");
  });

  test("the desktop HTTP service continues the explicit predecessor on its retained page", async () => {
    const service = JSON.parse(readFileSync(join(home, "service.json"), "utf8"));
    const config = JSON.parse(readFileSync(join(home, "application.json"), "utf8"));
    const send = (body: import("../runtime/contracts").ObjectValue) => fetch(`http://127.0.0.1:${service.port}/v1/responses`, {
      method: "POST", headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json", ...Object.fromEntries(requestHeaders(body)) }, body: JSON.stringify(body),
    });
    const body = requestBody("real-http-one"); body.stream = false;
    const first = send(body);
    void first.catch(() => {});
    let owned: import("playwright-core").Page | undefined;
    const deadline = Date.now() + 10000;
    while (!owned && Date.now() < deadline) {
      for (const candidate of connection.contexts().flatMap(c => c.pages()).filter(p => p.url() === origin + "/")) {
        const marker = await candidate.evaluate(() => (globalThis as any).__bend_web_ownership_v1__);
        if (marker?.operation.startsWith("web:") && marker.activated) { owned = candidate; break; }
      }
      if (!owned) await Bun.sleep(30);
    }
    if (!owned) {
      console.error("fixture service status", await (await fetch(`http://127.0.0.1:${service.port}/control/status`, { headers: { authorization: `Bearer ${config.token}` } })).text());
      for (const candidate of connection.contexts().flatMap(c => c.pages()).filter(p => p.url().startsWith(origin)))
        console.error("fixture document", await candidate.evaluate(() => {
          const marker = (globalThis as any).__bend_web_ownership_v1__;
          return { url: location.pathname, operation: marker?.operation, activated: marker?.activated,
            preparedCharacters: marker?.preparedText?.length, payloadCharacters: marker?.payload?.length };
        }));
    }
    expect(owned).toBeDefined();
    const original = await owned!.evaluate(() => (globalThis as any).__bend_web_ownership_v1__);
    await owned!.evaluate(() => (window as any).fixture.finish("First owned answer"));
    const firstResponse = await first;
    expect(firstResponse.status).toBe(200);
    const result = await firstResponse.json() as any;
    expect(result.output[0].content[0].text).toBe("First owned answer");
    const second = send(continuationBody(result.id, "Only the next turn"));
    void second.catch(() => {});
    await owned!.waitForFunction(() => (window as any).fixture.sends === 2, undefined, { timeout: 10000 });
    const next = await owned!.evaluate(() => (globalThis as any).__bend_web_ownership_v1__);
    expect(next.page).toBe(original.page); expect(next.document).toBe(original.document);
    expect(next.payload).toContain("Only the next turn");
    expect(next.payload).not.toContain("Return a result.");
    expect(next.payload).not.toContain("First owned answer");
    expect(next.payload).toContain("Continue this exact conversation");
    await owned!.evaluate(() => (window as any).fixture.finish("Second owned answer"));
    expect((await (await second).json() as any).output[0].content[0].text).toBe("Second owned answer");
    const shell = electron.windows().find(page => page.url().endsWith("shell.html"))!;
    await shell.getByRole("button", { name: "Activity", exact: true }).click();
    await shell.getByRole("button", { name: "Refresh", exact: true }).click();
    await shell.waitForFunction(() => document.querySelectorAll("#activity-table .activity-row").length === 2);
    await Bun.sleep(100);
    mkdirSync(join(root, ".build/evidence"), { recursive: true });
    const image = await electron.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.capturePage()).toPNG().toString("base64"));
    await Bun.write(join(root, ".build/evidence/desktop.png"), Buffer.from(image, "base64"));
  }, 30000);
});
