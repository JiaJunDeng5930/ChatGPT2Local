"use strict";
/** The desktop owns windows and OS handles, not task state or retries. */
const { app, BrowserWindow, WebContentsView, ipcMain, dialog, session, powerSaveBlocker } = require("electron");
const { spawn, spawnSync } = require("node:child_process");
const { createServer } = require("node:http");
const { randomBytes, timingSafeEqual } = require("node:crypto");
const { mkdirSync, readFileSync, existsSync, unlinkSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { homedir } = require("node:os");

const home = resolve(process.env.CODEX_CHATGPT_WEB_HOME || join(homedir(), ".codex-chatgpt-web"));
const userData = join(home, "desktop");
mkdirSync(userData, { recursive: true, mode: 0o700 });
app.setPath("userData", userData);
app.commandLine.appendSwitch("remote-debugging-address", "127.0.0.1");
app.commandLine.appendSwitch("remote-debugging-port", "0");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
const single = app.requestSingleInstanceLock();
if (!single) app.quit();
else {
  const activePort = join(userData, "DevToolsActivePort");
  if (existsSync(activePort)) unlinkSync(activePort); // This process holds the profile lock.
  let window, dashboard, runtime, server, config, hostPort, cdpPort, selected = "home", readyPort;
  let quitting = false, starting = false, runtimeFault = "", wakeLock;
  const hostToken = process.env.CODEX_WEB_HOST_TOKEN || randomBytes(32).toString("base64url");
  if (hostToken.length < 32) throw new Error("The browser host capability must contain at least 32 characters");
  const views = new Map();
  const profile = "persist:chatgpt-bend";
  const bundle = join(process.resourcesPath, "runtime");
  const development = !app.isPackaged;
  const bun = process.env.CODEX_WEB_BUN || (development ? "bun" : join(bundle, process.platform === "win32" ? "bun.exe" : "bun"));
  const entry = development ? join(__dirname, "..", "runtime", "cli.ts") : join(bundle, "cli.js");
  const command = (args, options = {}) => spawn(bun, [entry, ...args, "--home", home], { ...options, env: { ...process.env, CODEX_WEB_HOST_TOKEN: hostToken, ...options.env } });
  const secure = { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false };

  function publish() {
    if (window && !window.isDestroyed()) window.webContents.send("tabs", state());
  }
  function state() {
    return { selected, fault: runtimeFault, running: !!runtime && runtime.exitCode === null,
      tabs: [...views].map(([id, item]) => ({ id, title: item.title, crashed: item.crashed })) };
  }
  function bounds() {
    if (!window || window.isDestroyed()) return;
    const [width, height] = window.getContentSize();
    const rectangle = { x: 0, y: 64, width, height: Math.max(0, height - 64) };
    dashboard?.setBounds(rectangle);
    for (const item of views.values()) item.view.setBounds(rectangle);
  }
  function select(id) {
    if (id !== "home" && !views.has(id)) throw new Error("Unknown tab");
    selected = id;
    // A hidden WebContentsView can lose its viewport/input target. Keep owned
    // documents laid out and bring only the selected view to the front. A tab
    // change is presentation, never a renderer lifecycle command.
    const front = id === "home" ? dashboard : views.get(id).view;
    if (front) window.contentView.addChildView(front);
    bounds(); publish();
  }
  function isPageUrl(value) {
    try {
      const url = new URL(value), allowed = new URL(config.browser.startUrl);
      return (url.protocol === "https:" && (url.hostname === "chatgpt.com" || url.hostname.endsWith(".openai.com") ||
        ["auth0.openai.com", "accounts.google.com", "appleid.apple.com", "login.microsoftonline.com", "login.live.com"].includes(url.hostname))) ||
        (allowed.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(allowed.hostname) && url.origin === allowed.origin) || value.startsWith("about:blank");
    } catch { return false; }
  }
  function page(key, url = `about:blank#bend-${key}`) {
    if (views.has(key)) throw new Error("A physical allocation key cannot be reused");
    const view = new WebContentsView({ webPreferences: { ...secure, partition: profile } });
    const item = { view, title: "ChatGPT", crashed: false };
    views.set(key, item);
    window.contentView.addChildView(view);
    bounds();
    select(selected);
    view.webContents.on("page-title-updated", (_event, title) => { item.title = title.slice(0, 100); publish(); });
    view.webContents.on("render-process-gone", () => { item.crashed = true; runtimeFault = "A webpage renderer exited. Its operation is retained; no reload or resend was attempted."; publish(); });
    view.webContents.on("will-navigate", (event, url) => { if (!isPageUrl(url)) event.preventDefault(); });
    view.webContents.setWindowOpenHandler(({ url }) => isPageUrl(url)
      ? { action: "allow", overrideBrowserWindowOptions: { webPreferences: { ...secure, partition: profile } } }
      : { action: "deny" });
    view.webContents.on("did-create-window", child => {
      child.webContents.on("will-navigate", (event, url) => { if (!isPageUrl(url)) event.preventDefault(); });
      child.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    });
    void view.webContents.loadURL(url).catch(() => { item.crashed = true; runtimeFault = "Page navigation failed. The document was not recreated or retried."; publish(); });
    publish();
    return view;
  }
  async function ownership(item) {
    if (item.view.webContents.isDestroyed() || item.crashed) return null;
    return item.view.webContents.executeJavaScript("globalThis.__bend_web_ownership_v1__ ? ({operation:globalThis.__bend_web_ownership_v1__.operation,page:globalThis.__bend_web_ownership_v1__.page}) : null", false);
  }
  async function control(route, body) {
    if (!readyPort) throw new Error("The application service is unavailable");
    const response = await fetch(`http://127.0.0.1:${readyPort}/control/${route}`, { method: body ? "POST" : "GET", redirect: "error",
      headers: { authorization: `Bearer ${config.token}`, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message || "The control request failed");
    return result;
  }
  async function closeTab(id) {
    const item = views.get(id);
    if (!item) throw new Error("Unknown tab");
    const owner = await ownership(item);
    if (owner) {
      const result = await dialog.showMessageBox(window, { type: "warning", buttons: ["Keep page", "Cancel task and close page"], defaultId: 0, cancelId: 0,
        message: "Closing this page may interrupt an active response.", detail: "The task will not be resent. Completed history on this page will no longer be reusable." });
      if (result.response !== 1) return;
      await control("cancel", { id: owner.operation });
    }
    views.delete(id);
    window.contentView.removeChildView(item.view);
    item.view.webContents.close();
    if (selected === id) select("home"); else publish();
  }
  async function host(request, response) {
    try {
      const expected = Buffer.from(`Bearer ${hostToken}`), actual = Buffer.from(request.headers.authorization || "");
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) { response.writeHead(401).end(); return; }
      if (request.method !== "POST" || request.headers.origin) { response.writeHead(403).end(); return; }
      let text = "";
      for await (const part of request) { text += part; if (Buffer.byteLength(text) > 65536) throw new Error("Host frame too large"); }
      const body = JSON.parse(text || "{}");
      if (request.url === "/pages") {
        if (typeof body.key !== "string" || !/^[a-f0-9-]{36}$/.test(body.key)) throw new Error("Invalid allocation identity");
        page(body.key);
      } else if (request.url === "/login") {
        const key = crypto.randomUUID(); page(key, config.browser.startUrl); select(key);
      } else if (request.url === "/show") {
        const matches = [];
        for (const [id, item] of views) if ((await ownership(item))?.page === body.page) matches.push(id);
        if (matches.length !== 1) throw new Error("The original page is not uniquely available");
        select(matches[0]); window.show();
      } else { response.writeHead(404).end(); return; }
      response.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
    } catch { response.writeHead(409, { "content-type": "application/json" }).end('{"error":"The browser host could not perform the requested action. No automatic retry occurred."}'); }
  }
  async function readDebugPort() {
    // Startup readiness reads are not task retries and cannot send messages.
    for (let i = 0; i < 100; i++) {
      if (existsSync(activePort)) {
        const port = Number(readFileSync(activePort, "utf8").split("\n")[0]);
        if (Number.isInteger(port) && port > 0 && port <= 65535) return port;
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error("The desktop's private Chromium endpoint did not become available");
  }
  async function startRuntime() {
    if (starting || (runtime && runtime.exitCode === null)) throw new Error("The runtime is already starting or running");
    starting = true;
    try {
      const next = command(["serve", "--cdp", `http://127.0.0.1:${cdpPort}`, "--host-url", `http://127.0.0.1:${hostPort}`], { stdio: ["ignore", "pipe", "pipe"] });
      runtime = next;
      readyPort = undefined;
      runtimeFault = "";
      let buffer = "", diagnostics = "";
      next.stderr.on("data", part => { diagnostics = (diagnostics + String(part)).slice(-4096); });
      await new Promise((resolveReady, reject) => {
        const timeout = setTimeout(() => reject(new Error("The service did not report readiness. It has not been restarted.")), 15000);
        next.once("error", error => { clearTimeout(timeout); reject(error); });
        next.once("exit", code => {
          clearTimeout(timeout);
          readyPort = undefined;
          if (!quitting) { runtimeFault = `The runtime exited (${code}). Pages remain open. Use Restart observation service explicitly. ${diagnostics}`; publish(); }
          reject(new Error(runtimeFault || "Runtime exited"));
        });
        next.stdout.on("data", part => {
          buffer += part;
          if (buffer.length > 65536) { clearTimeout(timeout); reject(new Error("Invalid runtime readiness stream")); return; }
          for (;;) {
            const newline = buffer.indexOf("\n"); if (newline < 0) break;
            const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
            try {
              const message = JSON.parse(line);
              if (message.event === "ready" && Number.isInteger(message.port) && message.port > 0 && message.port <= 65535) {
                readyPort = message.port; clearTimeout(timeout); resolveReady();
              }
            } catch { /* Non-readiness diagnostics never authorize a restart. */ }
          }
        });
      });
      const homeUrl = `http://127.0.0.1:${readyPort}/#${encodeURIComponent(config.token)}`;
      await dashboard.webContents.loadURL(homeUrl);
      publish();
    } finally { starting = false; }
  }
  function trusted(event) { return window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame; }
  ipcMain.handle("desktop", async (event, input) => {
    if (!trusted(event) || !input || typeof input.action !== "string") throw new Error("Untrusted desktop command");
    switch (input.action) {
      case "state": return state();
      case "select": select(String(input.id)); break;
      case "login": { const key = crypto.randomUUID(); page(key, config.browser.startUrl); select(key); break; }
      case "close": await closeTab(String(input.id)); break;
      case "restart": await startRuntime(); break;
      case "quit": await quit(); break;
      default: throw new Error("Unknown desktop command");
    }
    return state();
  });
  async function quit() {
    if (quitting) return;
    const result = await dialog.showMessageBox(window, { type: "warning", buttons: ["Keep running", "Quit and close all pages"], defaultId: 0, cancelId: 0,
      message: "Quit Codex Web?", detail: "This closes the browser. In-flight operations will be retained as unknown on next startup and will not be resent." });
    if (result.response !== 1) return;
    quitting = true;
    if (runtime && runtime.exitCode === null) {
      runtime.kill("SIGTERM");
      await Promise.race([new Promise(resolve => runtime.once("exit", resolve)), new Promise(resolve => setTimeout(resolve, 5000))]);
    }
    server?.close();
    if (wakeLock !== undefined && powerSaveBlocker.isStarted(wakeLock)) powerSaveBlocker.stop(wakeLock);
    app.quit();
  }
  app.on("second-instance", () => { window?.show(); window?.focus(); });
  app.on("activate", () => { window?.show(); window?.focus(); });
  app.on("before-quit", event => { if (!quitting && window) { event.preventDefault(); void quit(); } });
  app.whenReady().then(async () => {
    const setup = spawnSync(bun, [entry, "setup", "--home", home], { encoding: "utf8", env: process.env });
    if (setup.status !== 0) throw new Error(setup.stderr || "The Bend runtime could not initialize this profile");
    config = JSON.parse(readFileSync(join(home, "application.json"), "utf8"));
    cdpPort = await readDebugPort();
    session.fromPartition(profile).setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.fromPartition(profile).setPermissionCheckHandler(() => false);
    window = new BrowserWindow({ width: 1240, height: 840, minWidth: 680, minHeight: 480,
      title: "Codex Web · Bend", backgroundColor: "#101519", webPreferences: { ...secure, preload: join(__dirname, "preload.cjs") } });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", event => event.preventDefault());
    window.on("resize", bounds);
    window.on("close", event => { if (!quitting) { event.preventDefault(); window.hide(); } });
    await window.loadFile(join(__dirname, "shell.html"));
    dashboard = new WebContentsView({ webPreferences: secure });
    dashboard.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    dashboard.webContents.on("will-navigate", (event, url) => {
      if (!readyPort || new URL(url).origin !== `http://127.0.0.1:${readyPort}`) event.preventDefault();
    });
    window.contentView.addChildView(dashboard);
    bounds();
    server = createServer((request, response) => { void host(request, response); });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    hostPort = server.address().port;
    wakeLock = powerSaveBlocker.start("prevent-app-suspension");
    await startRuntime();
  }).catch(error => {
    runtimeFault = error.message;
    publish();
    console.error(error.message);
    if (!window) { quitting = true; app.exit(1); }
  });
}
