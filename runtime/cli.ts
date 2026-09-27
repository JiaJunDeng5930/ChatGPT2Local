#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { atomicFile, homeDirectory, readConfig, writeConfig, VERSION, type Config } from "./config";
import { BridgeError } from "./contracts";
import { digest, object } from "./codec";
import { compiled } from "./kernel";
import { startServer } from "./server";
import { OwnerLock } from "./owner";
import { Store } from "./store";
import { installProfile } from "./integration";
import { stdio } from "./stdio";

function options(argv: string[]): { args: string[]; flags: Map<string, string | true> } {
  const args: string[] = [], flags = new Map<string, string | true>();
  const booleans = new Set(["version", "help", "json", "confirm"]);
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i]!;
    if (!value.startsWith("--")) { args.push(value); continue; }
    const name = value.slice(2);
    if (booleans.has(name)) flags.set(name, true);
    else if (["home", "port", "cdp", "host-url", "codex-home", "key-file", "tunnel-id", "tunnel-binary", "connector-name"].includes(name)) {
      const next = argv[++i];
      if (!next || next.startsWith("--")) throw new Error(`--${name} requires a value`);
      flags.set(name, next);
    } else throw new Error(`Unknown option --${name}`);
  }
  return { args, flags };
}

const HELP = `codex-chatgpt-web ${VERSION}
setup                     Create application.json, preserving legacy journals
serve                     Run the Bend application and loopback HTTP/MCP service
doctor                    Inspect configuration, service, and browser (no sends)
status                    Read durable operation status from the active runtime
install-models            Add an isolated Codex --profile web configuration
migrate [OLD-ID NEW-ID]    Check/migrate storage; optionally map a legacy identity
resume ID [--confirm]      Observe the original page; never resend or reload it
cancel ID                 Explicitly request Stop on the original page
configure                 Validate JSON read from stdin and save for next startup
mcp                       MCP stdio transport for the running application
tunnel-connect            Connect installed tunnel-client using a key file
tunnel-run                Run the configured tunnel; no automatic process restart
dev serve|chat|desktop     Isolated development profile for this worktree
chat                      Interactive browser-only client using this service

--home PATH selects all application storage. --port overrides the listener.
--cdp URL selects an already running Chromium/Electron loopback debug endpoint.
--codex-home PATH selects where install-models writes its isolated profile.
Web operations require a stable native turn ID or an Idempotency-Key.
Configuration and account-dependent UI are never repaired by resubmitting tasks.`;

async function control(config: Config, route: string, body?: Record<string, unknown>): Promise<unknown> {
  const result = await fetch(`http://127.0.0.1:${config.port}/control/${route}`, { method: body ? "POST" : "GET", redirect: "error",
    headers: { authorization: `Bearer ${config.token}`, ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const value = await result.json() as { error?: { message?: string } };
  if (!result.ok) throw new Error(value.error?.message || "The application rejected the control request");
  return value;
}

function runtimeCommand(): string[] { return [process.execPath, resolve(process.argv[1]!)]; }

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const { args, flags } = options(argv);
  let command = args.shift() ?? "help";
  if (command === "version" || flags.has("version")) { console.log(VERSION); return; }
  if (command === "help" || flags.has("help")) { console.log(HELP); return; }
  let home = homeDirectory(typeof flags.get("home") === "string" ? String(flags.get("home")) : undefined);
  if (command === "dev") {
    home = homeDirectory(typeof flags.get("home") === "string" ? String(flags.get("home")) : join(process.cwd(), ".state", `dev-${digest(process.cwd()).slice(0, 12)}`));
    command = args.shift() ?? "serve";
    if (!existsSync(join(home, "application.json"))) {
      const initial = readConfig(home, true);
      initial.port = 18787; initial.browser.endpoint = "http://127.0.0.1:19222";
      initial.browser.connectorName = "Codex Native2 DEV";
      writeConfig(home, initial);
    }
  }
  const config = readConfig(home, command === "setup" || command === "desktop");
  if (flags.has("port")) config.port = Number(flags.get("port"));
  if (flags.has("cdp")) config.browser.endpoint = String(flags.get("cdp"));
  if (flags.has("host-url")) {
    config.browser.hostUrl = String(flags.get("host-url"));
    config.browser.hostToken = process.env.CODEX_WEB_HOST_TOKEN;
  }
  if (command === "setup") { console.log(`Configuration: ${join(home, "application.json")}\nControl token is stored only in that private file. Start the desktop or attach a browser with --cdp, then run serve.`); return; }
  if (command === "configure") {
    writeConfig(home, JSON.parse(await Bun.stdin.text()));
    console.log("Configuration saved. Active operations retain their frozen environment until the next explicit restart."); return;
  }
  if (command === "install-models") { console.log(installProfile(home, config, flags.has("codex-home") ? String(flags.get("codex-home")) : undefined)); return; }
  if (command === "status") { console.log(JSON.stringify(await control(config, "status"), null, 2)); return; }
  if (command === "resume" || command === "cancel") {
    if (!args[0]) throw new Error("A durable operation ID is required");
    console.log(JSON.stringify(await control(config, command, { id: args[0], ...(flags.has("confirm") ? { confirm: true } : {}) }))); return;
  }
  if (command === "migrate") {
    const lock = new OwnerLock(home);
    try {
      const store = new Store(home, { migrate: true });
      try {
        if (args.length) {
          if (args.length !== 2 || !args[0]!.startsWith("unmapped:") || !/^native:[a-f0-9]{64}$/.test(args[1]!)) throw new Error("Migration mapping requires the exact unmapped ID and native:<64 hex> ID");
          const changed = store.db.query("UPDATE legacy SET id=? WHERE id=?").run(args[1]!, args[0]!);
          if (changed.changes !== 1) throw new Error("No unique legacy identity matched");
        }
        store.recover();
        console.log(JSON.stringify({ kernel: compiled.fingerprint, legacy: store.db.query("SELECT id,status FROM legacy").all(), effects_replayed: 0 }, null, 2));
      } finally { store.close(); }
    } finally { lock.close(); }
    return;
  }
  if (command === "mcp") { await stdio(config); return; }
  if (command === "doctor") {
    const report: Record<string, unknown> = { version: VERSION, home, kernel: compiled.fingerprint, mode: config.mode,
      configuredEfforts: config.efforts, journalPresent: existsSync(join(home, "submission-journal")),
      guarantee: "No sends, reloads, stops, credential changes, or task retries are performed by doctor." };
    for (const [name, url] of [["runtime", `http://127.0.0.1:${config.port}/health`], ["browser", `${config.browser.endpoint.replace(/\/$/, "")}/json/version`]]) {
      try { const response = await fetch(url!, { signal: AbortSignal.timeout(3000), redirect: "error" }); report[name!] = response.ok ? "reachable" : `HTTP ${response.status}`; }
      catch { report[name!] = "unavailable"; }
    }
    console.log(JSON.stringify(report, null, 2)); return;
  }
  if (command === "tunnel-connect") {
    const binary = String(flags.get("tunnel-binary") ?? "tunnel-client");
    const keyFile = flags.get("key-file"), tunnelId = flags.get("tunnel-id");
    if (typeof keyFile !== "string" || typeof tunnelId !== "string") throw new Error("tunnel-connect requires --key-file and --tunnel-id");
    if (!existsSync(keyFile) || !readFileSync(keyFile, "utf8").trim()) throw new Error("The tunnel key file is missing or empty");
    const profile = join(home, "tunnel-profiles");
    // This is the tunnel client's documented quoted argument format, not a shell
    // pipeline. Only a file reference, never key contents, enters argv.
    const mcp = [...runtimeCommand(), "mcp", "--home", home].map(part => JSON.stringify(part)).join(" ");
    const child = Bun.spawn([binary, "runtimes", "connect", "--alias", "codex-web-bend", "--profile", "bend-web", "--profile-dir", profile,
      "--tunnel-client-bin", binary, "--tunnel-id", tunnelId, "--runtime-api-key", `file:${resolve(keyFile)}`, "--mcp-command", mcp, "--json"], { stdout: "inherit", stderr: "inherit" });
    if (await child.exited) throw new Error("Tunnel connection did not complete; no automatic retry was made");
    config.mode = "full";
    config.tunnel = { command: [binary, "run", "--profile", "bend-web", "--profile-dir", profile] };
    if (flags.has("connector-name")) config.browser.connectorName = String(flags.get("connector-name"));
    writeConfig(home, config);
    console.log("Tunnel profile saved. Explicitly restart the runtime in full mode; enable the matching connector in ChatGPT."); return;
  }
  if (command === "tunnel-run") {
    if (!config.tunnel) throw new Error("No tunnel command is configured");
    const child = Bun.spawn(config.tunnel.command, { stdout: "inherit", stderr: "inherit", stdin: "inherit" });
    process.on("SIGINT", () => child.kill("SIGINT")); process.on("SIGTERM", () => child.kill("SIGTERM"));
    process.exitCode = await child.exited; return;
  }
  if (command === "desktop") {
    const desktop = resolve(import.meta.dir, "../desktop");
    const binary = process.env.ELECTRON ?? join(desktop, "node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron");
    const child = spawn(binary, [desktop], { stdio: "inherit", env: { ...process.env, CODEX_CHATGPT_WEB_HOME: home, CODEX_WEB_BUN: process.execPath } });
    process.exitCode = await new Promise<number>((resolveExit, reject) => { child.once("error", reject); child.once("exit", code => resolveExit(code ?? 1)); }); return;
  }
  if (command === "chat") {
    if (config.mode !== "browser-only") throw new Error("The standalone chat client has no outer Codex tool executor. Use browser-only mode or run Codex --profile web");
    const input: unknown[] = [];
    const consoleInput = createInterface({ input: process.stdin, output: process.stdout });
    try {
      for (;;) {
        const text = await consoleInput.question("You> ");
        if (text === "/quit") break;
        if (!text.trim()) continue;
        input.push({ type: "message", role: "user", content: [{ type: "input_text", text }] });
        const request = { model: `chatgpt-web/${config.efforts[0]}`, input, stream: false };
        const response = await fetch(`http://127.0.0.1:${config.port}/v1/responses`, { method: "POST", redirect: "error",
          headers: { "content-type": "application/json", authorization: `Bearer ${config.token}`, "idempotency-key": crypto.randomUUID() }, body: JSON.stringify(request) });
        const body = object(await response.json());
        if (!response.ok) throw new Error(JSON.stringify(body.error));
        const messages = Array.isArray(body.output) ? body.output : [];
        input.push(...messages);
        console.log(messages.map(raw => { const item = object(raw); return Array.isArray(item.content) ? item.content.map(part => object(part).text ?? "").join("\n") : ""; }).join("\n"));
      }
    } finally { consoleInput.close(); }
    return;
  }
  if (command !== "serve") throw new Error(`Unknown command ${command}`);
  const runtime = startServer(home, config);
  console.log(JSON.stringify({ event: "ready", version: VERSION, port: runtime.server.port, home, kernel: compiled.fingerprint }));
  // Desktop consumes this private rendezvous file; it contains no credentials.
  atomicFile(join(home, "service.json"), JSON.stringify({ pid: process.pid, port: runtime.server.port, kernel: compiled.fingerprint,
    ...(config.browser.hostUrl ? { browserHost: config.browser.hostUrl } : {}) }));
  let stopping = false;
  const stop = () => { if (stopping) return; stopping = true; void runtime.close().then(() => process.exit(0), () => process.exit(1)); };
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
}

if (import.meta.main) main().catch(error => {
  console.error(error instanceof BridgeError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : "Command failed");
  process.exitCode = 1;
});
