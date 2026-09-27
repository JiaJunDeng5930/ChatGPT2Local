"use strict";
/** Desktop presentation and OS/browser boundaries. Bend remains the only task state machine. */
const { app, BrowserWindow, WebContentsView, ipcMain, dialog, session, powerSaveBlocker } = require("electron");
const { spawn, spawnSync } = require("node:child_process");
const { createServer } = require("node:http");
const { randomBytes, timingSafeEqual, randomUUID } = require("node:crypto");
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
  if (existsSync(activePort)) unlinkSync(activePort);
  let window, runtime, server, config, hostPort, cdpPort, readyPort, tunnel;
  let selectedTab = null, browserRectangle = null;
  let quitting = false, starting = false, runtimeFault = "", tunnelFault = "", wakeLock;
  const hostToken = process.env.CODEX_WEB_HOST_TOKEN || randomBytes(32).toString("base64url");
  if (hostToken.length < 32) throw new Error("The browser host capability must contain at least 32 characters");
  const views = new Map();
  const profile = "persist:chatgpt-bend";
  const bundle = join(process.resourcesPath, "runtime");
  const development = !app.isPackaged;
  const bun = process.env.CODEX_WEB_BUN || (development ? "bun" : join(bundle, process.platform === "win32" ? "bun.exe" : "bun"));
  const entry = development ? join(__dirname, "..", "runtime", "cli.ts") : join(bundle, "cli.js");
  const packageInfo = require("./package.json");
  const runtimeEnv = () => ({ ...process.env, CODEX_WEB_HOST_TOKEN: hostToken });
  const command = (args, options = {}) => spawn(bun, [entry, ...args, "--home", home], { ...options, env: { ...runtimeEnv(), ...options.env } });
  const secure = { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false };

  function safeConfig() {
    return { mode: config?.mode ?? "browser-only", efforts: [...(config?.efforts ?? [])],
      connectorName: config?.browser?.connectorName || "Codex Native2", tunnelConfigured: !!config?.tunnel,
      jev: config?.jev ? { baseUrl: config.jev.baseUrl, model: config.jev.model, keyEnv: config.jev.keyEnv, targetModel: config.jev.targetModel } : null };
  }
  function state() {
    return { selectedTab, fault: runtimeFault, running: !!runtime && runtime.exitCode === null,
      tunnelRunning: !!tunnel && tunnel.exitCode === null, tunnelFault, platform: process.platform,
      packaged: app.isPackaged, version: packageInfo.version, config: safeConfig(),
      tabs: [...views].map(([id, item]) => ({ id, title: item.title, crashed: item.crashed, loading: item.loading,
        url: item.url, active: id === selectedTab })) };
  }
  async function snapshot() {
    let status = null;
    if (readyPort) { try { status = await control("status"); } catch (error) { runtimeFault ||= error.message; } }
    return { ...state(), status };
  }
  function publish() {
    if (window && !window.isDestroyed()) window.webContents.send("desktop-state", state());
  }
  function showBrowserSurface() {
    if (window && !window.isDestroyed()) window.webContents.send("show-browser");
  }
  function applyBounds() {
    if (!window || window.isDestroyed()) return;
    const [width, height] = window.getContentSize();
    // Every document retains a normal viewport. Presentation visibility is a
    // separate concern; collapsing or moving the viewport changes Playwright's
    // DOM/actionability semantics and therefore changes task behavior.
    const retained = browserRectangle ?? { x: 0, y: 84, width: Math.max(800, width), height: Math.max(480, height - 84) };
    for (const [id, item] of views) {
      item.view.setBounds(retained);
      item.view.setVisible(id === selectedTab && !!browserRectangle);
    }
    if (selectedTab && browserRectangle) {
      const item = views.get(selectedTab);
      if (item) window.contentView.addChildView(item.view);
    }
  }
  function selectTab(id) {
    if (!views.has(id)) throw new Error("Unknown browser tab");
    selectedTab = id;
    applyBounds();
    publish();
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
    const item = { view, title: "ChatGPT", crashed: false, loading: false, url };
    views.set(key, item);
    window.contentView.addChildView(view);
    applyBounds();
    view.webContents.on("page-title-updated", (_event, title) => { item.title = title || "ChatGPT"; publish(); });
    view.webContents.on("did-start-loading", () => { item.loading = true; publish(); });
    view.webContents.on("did-stop-loading", () => { item.loading = false; item.url = view.webContents.getURL(); publish(); });
    view.webContents.on("did-navigate", (_event, next) => { item.url = next; publish(); });
    view.webContents.on("did-navigate-in-page", (_event, next) => { item.url = next; publish(); });
    view.webContents.on("render-process-gone", () => { item.crashed = true; publish(); });
    view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    view.webContents.on("will-navigate", (event, next) => { if (!isPageUrl(next)) event.preventDefault(); });
    void view.webContents.loadURL(url).catch(error => { item.crashed = true; item.title = error.message; publish(); });
    publish();
    return key;
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
    if (!item) throw new Error("Unknown browser tab");
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
    if (selectedTab === id) selectedTab = views.keys().next().value ?? null;
    applyBounds(); publish();
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
        const key = randomUUID(); page(key, config.browser.startUrl); selectTab(key); showBrowserSurface(); window.show();
      } else if (request.url === "/show") {
        const matches = [];
        for (const [id, item] of views) if ((await ownership(item))?.page === body.page) matches.push(id);
        if (matches.length !== 1) throw new Error("The original page is not uniquely available");
        selectTab(matches[0]); showBrowserSurface(); window.show();
      } else { response.writeHead(404).end(); return; }
      response.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}');
    } catch { response.writeHead(409, { "content-type": "application/json" }).end('{"error":"The browser host could not perform the requested action. No automatic retry occurred."}'); }
  }
  async function readDebugPort() {
    for (let i = 0; i < 100; i++) {
      if (existsSync(activePort)) {
        const port = Number(readFileSync(activePort, "utf8").split("\n")[0]);
        if (Number.isInteger(port) && port > 0 && port <= 65535) return port;
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error("The desktop's private Chromium endpoint did not become available");
  }
  async function stopRuntime() {
    if (!runtime || runtime.exitCode !== null) return;
    runtime.kill("SIGTERM");
    await Promise.race([new Promise(resolveDone => runtime.once("exit", resolveDone)), new Promise(resolveDone => setTimeout(resolveDone, 5000))]);
  }
  async function startRuntime() {
    if (starting || (runtime && runtime.exitCode === null)) throw new Error("The runtime is already starting or running");
    starting = true;
    runtimeFault = "";
    readyPort = undefined;
    config = JSON.parse(readFileSync(join(home, "application.json"), "utf8"));
    try {
      const next = command(["serve", "--port", "0", "--cdp", `http://127.0.0.1:${cdpPort}`, "--host-url", `http://127.0.0.1:${hostPort}`], { stdio: ["ignore", "pipe", "pipe"] });
      runtime = next;
      next.stderr.on("data", data => { runtimeFault = String(data).trim().split("\n").at(-1) || runtimeFault; publish(); });
      next.once("exit", code => { if (runtime === next) { readyPort = undefined; if (!quitting && code) runtimeFault ||= `Runtime exited with status ${code}`; publish(); } });
      await new Promise((resolveReady, rejectReady) => {
        let buffer = "";
        const timeout = setTimeout(() => rejectReady(new Error("The runtime did not announce readiness")), 15000);
        next.once("error", error => { clearTimeout(timeout); rejectReady(error); });
        next.stdout.on("data", data => {
          buffer += String(data);
          for (;;) {
            const newline = buffer.indexOf("\n"); if (newline < 0) break;
            const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
            try {
              const message = JSON.parse(line);
              if (message.event === "ready" && Number.isInteger(message.port) && message.port > 0 && message.port <= 65535) {
                readyPort = message.port; clearTimeout(timeout); resolveReady();
              }
            } catch { /* Runtime diagnostics do not authorize a restart or page action. */ }
          }
        });
      });
      publish();
    } finally { starting = false; }
  }
  async function restartRuntime() { await stopRuntime(); await startRuntime(); }
  function runCli(args, options = {}) {
    const result = spawnSync(bun, [entry, ...args, "--home", home], { encoding: "utf8", env: runtimeEnv(), ...options });
    if (result.status !== 0) throw new Error((result.stderr || result.stdout || `Command failed: ${args[0]}`).trim());
    return (result.stdout || "").trim();
  }
  function writeConfiguration(next) {
    runCli(["configure"], { input: JSON.stringify(next) });
    config = JSON.parse(readFileSync(join(home, "application.json"), "utf8"));
  }
  function trusted(event) { return window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame; }
  ipcMain.handle("desktop", async (event, input) => {
    if (!trusted(event) || !input || typeof input.action !== "string") throw new Error("Untrusted desktop command");
    switch (input.action) {
      case "snapshot": return await snapshot();
      case "state": return state();
      case "browser-bounds": {
        if (input.bounds === null) browserRectangle = null;
        else {
          const raw = input.bounds;
          const rectangle = { x: Math.max(0, Math.round(Number(raw.x))), y: Math.max(0, Math.round(Number(raw.y))),
            width: Math.max(0, Math.round(Number(raw.width))), height: Math.max(0, Math.round(Number(raw.height))) };
          if (Object.values(rectangle).some(value => !Number.isFinite(value))) throw new Error("Invalid browser bounds");
          browserRectangle = rectangle;
        }
        applyBounds(); return state();
      }
      case "select-tab": selectTab(String(input.id)); return state();
      case "new-chat": { const key = randomUUID(); page(key, config.browser.startUrl); selectTab(key); return state(); }
      case "close-tab": await closeTab(String(input.id)); return state();
      case "navigate": {
        const item = selectedTab ? views.get(selectedTab) : null;
        if (!item) throw new Error("No selected browser tab");
        if (input.direction === "back") { if (item.view.webContents.canGoBack()) item.view.webContents.goBack(); }
        else if (input.direction === "forward") { if (item.view.webContents.canGoForward()) item.view.webContents.goForward(); }
        else if (input.direction === "reload") item.view.webContents.reload();
        else throw new Error("Unknown navigation action");
        return state();
      }
      case "zoom": {
        const item = selectedTab ? views.get(selectedTab) : null;
        if (!item) throw new Error("No selected browser tab");
        const current = item.view.webContents.getZoomFactor();
        item.view.webContents.setZoomFactor(input.direction === "in" ? Math.min(2, current + 0.1) : input.direction === "out" ? Math.max(0.5, current - 0.1) : 1);
        return state();
      }
      case "show-operation": await control("show", { id: String(input.id) }); return await snapshot();
      case "resume-operation": await control("resume", { id: String(input.id), ...(input.confirm === true ? { confirm: true } : {}) }); return await snapshot();
      case "cancel-operation": await control("cancel", { id: String(input.id) }); return await snapshot();
      case "install-models": { const message = runCli(["install-models"]); return { message, snapshot: await snapshot() }; }
      case "save-settings": {
        const mode = input.mode;
        const efforts = Array.isArray(input.efforts) ? input.efforts : [];
        if (!["browser-only", "full"].includes(mode)) throw new Error("Invalid mode");
        if (!efforts.length || efforts.some(e => !["light", "medium", "high", "xhigh", "pro"].includes(e))) throw new Error("Select at least one valid effort");
        writeConfiguration({ ...config, mode, efforts });
        return await snapshot();
      }
      case "doctor": {
        const text = runCli(["doctor", "--port", String(readyPort || 1), "--cdp", `http://127.0.0.1:${cdpPort}`]);
        return JSON.parse(text);
      }
      case "restart-runtime": await restartRuntime(); return await snapshot();
      case "connect-tunnel": {
        if (typeof input.tunnelId !== "string" || !input.tunnelId.trim()) throw new Error("Tunnel ID is required");
        const picked = await dialog.showOpenDialog(window, { title: "Choose the tunnel runtime key file", properties: ["openFile"] });
        if (picked.canceled || picked.filePaths.length !== 1) return { cancelled: true, snapshot: await snapshot() };
        const message = runCli(["tunnel-connect", "--key-file", picked.filePaths[0], "--tunnel-id", input.tunnelId.trim(), "--connector-name", "Codex Native2"]);
        config = JSON.parse(readFileSync(join(home, "application.json"), "utf8"));
        return { cancelled: false, message, snapshot: await snapshot() };
      }
      case "start-tunnel": {
        if (tunnel && tunnel.exitCode === null) return state();
        tunnelFault = "";
        const next = command(["tunnel-run"], { stdio: ["ignore", "ignore", "pipe"] }); tunnel = next;
        next.stderr.on("data", data => { tunnelFault = String(data).trim().split("\n").at(-1) || tunnelFault; publish(); });
        next.once("exit", code => { if (tunnel === next && code && !quitting) tunnelFault ||= `Tunnel exited with status ${code}`; publish(); });
        publish(); return state();
      }
      case "stop-tunnel": if (tunnel && tunnel.exitCode === null) tunnel.kill("SIGTERM"); return state();
      case "quit": await quit(); return state();
      default: throw new Error("Unknown desktop command");
    }
  });
  async function quit() {
    if (quitting) return;
    const result = await dialog.showMessageBox(window, { type: "warning", buttons: ["Keep running", "Quit and close all pages"], defaultId: 0, cancelId: 0,
      message: "Quit Codex Web?", detail: "This closes the browser. In-flight operations will be retained as unknown on next startup and will not be resent." });
    if (result.response !== 1) return;
    quitting = true;
    if (tunnel && tunnel.exitCode === null) tunnel.kill("SIGTERM");
    await stopRuntime();
    server?.close();
    if (wakeLock !== undefined && powerSaveBlocker.isStarted(wakeLock)) powerSaveBlocker.stop(wakeLock);
    app.quit();
  }
  app.on("second-instance", () => { window?.show(); window?.focus(); });
  app.on("activate", () => { window?.show(); window?.focus(); });
  app.on("before-quit", event => { if (!quitting && window) { event.preventDefault(); void quit(); } });
  app.whenReady().then(async () => {
    const setup = spawnSync(bun, [entry, "setup", "--home", home], { encoding: "utf8", env: runtimeEnv() });
    if (setup.status !== 0) throw new Error(setup.stderr || "The Bend runtime could not initialize this profile");
    config = JSON.parse(readFileSync(join(home, "application.json"), "utf8"));
    cdpPort = await readDebugPort();
    session.fromPartition(profile).setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.fromPartition(profile).setPermissionCheckHandler(() => false);
    window = new BrowserWindow({ width: 1240, height: 840, minWidth: 680, minHeight: 480,
      title: "Codex Web GPT", backgroundColor: "#181818", titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
      webPreferences: { ...secure, preload: join(__dirname, "preload.cjs") } });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", event => event.preventDefault());
    window.on("resize", applyBounds);
    window.on("close", event => { if (!quitting) { event.preventDefault(); window.hide(); } });
    await window.loadFile(join(__dirname, "shell.html"));
    server = createServer((request, response) => { void host(request, response); });
    await new Promise((resolveListen, rejectListen) => { server.once("error", rejectListen); server.listen(0, "127.0.0.1", resolveListen); });
    hostPort = server.address().port;
    wakeLock = powerSaveBlocker.start("prevent-app-suspension");
    await startRuntime();
  }).catch(error => {
    runtimeFault = error.message; publish(); console.error(error.message);
    if (!window) { quitting = true; app.exit(1); }
  });
}
