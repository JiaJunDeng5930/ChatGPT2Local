/** Installation settings and filesystem IO, not a second execution model. */
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import type { Effort, Mode } from "./contracts";
import { BridgeError } from "./contracts";
import { DEFAULT_LIMITS, validateLimits, type Limits } from "./prompts";

export const VERSION = "7.0.0";
export interface Config {
  version: 1;
  port: number;
  mode: Mode;
  token: string;
  browser: { endpoint: string; startUrl: string; hostUrl?: string; hostToken?: string; connectorName?: string };
  efforts: Effort[];
  limits: Limits;
  tunnel?: { command: string[] };
}

export function homeDirectory(value = process.env.CODEX_CHATGPT_WEB_HOME): string {
  return resolve(value?.replace(/^~(?=\/|$)/, homedir()) || join(homedir(), ".codex-chatgpt-web"));
}

export function atomicFile(path: string, contents: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error("Refusing to replace a symbolic link");
  const temporary = `${path}.${randomBytes(10).toString("hex")}.tmp`;
  const fd = openSync(temporary, "wx", 0o600);
  try { writeFileSync(fd, contents); fsyncSync(fd); }
  finally { closeSync(fd); }
  try {
    renameSync(temporary, path);
    if (process.platform !== "win32") {
      const directory = openSync(dirname(path), "r");
      try { fsyncSync(directory); } finally { closeSync(directory); }
    }
  } finally { if (existsSync(temporary)) unlinkSync(temporary); }
}

export function defaultConfig(): Config {
  return { version: 1, port: 8787, mode: "browser-only", token: randomBytes(32).toString("base64url"),
    browser: { endpoint: "http://127.0.0.1:9222", startUrl: "https://chatgpt.com/" },
    efforts: ["light", "medium", "high", "xhigh", "pro"], limits: { ...DEFAULT_LIMITS } };
}

export function localUrl(value: string): URL {
  const url = new URL(value);
  if (!["http:", "ws:"].includes(url.protocol) || !["127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password)
    throw new BridgeError("unsafe_local_endpoint", "Browser and host endpoints must use literal loopback addresses without URL credentials");
  return url;
}

export function remoteUrl(value: string): URL {
  const url = new URL(value);
  if (url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(url.hostname))))
    throw new BridgeError("unsafe_upstream", "An upstream must use HTTPS or an explicit loopback HTTP endpoint");
  return url;
}

export function validateConfig(value: unknown): Config {
  const c = value as Config;
  if (!c || c.version !== 1 || !Number.isSafeInteger(c.port) || c.port < 0 || c.port > 65535 ||
      !["browser-only", "full"].includes(c.mode) || typeof c.token !== "string" || c.token.length < 32 ||
      !c.browser || !Array.isArray(c.efforts) || !c.efforts.length ||
      c.efforts.some(e => !["light", "medium", "high", "xhigh", "pro"].includes(e)))
    throw new BridgeError("invalid_configuration", "Invalid application configuration");
  localUrl(c.browser.endpoint);
  if (c.browser.connectorName !== undefined && (!c.browser.connectorName || c.browser.connectorName.length > 128)) throw new Error("Invalid connector identity");
  const start = remoteUrl(c.browser.startUrl);
  if (start.hostname !== "chatgpt.com" && !["127.0.0.1", "[::1]"].includes(start.hostname))
    throw new BridgeError("unsafe_browser_origin", "Task pages must be ChatGPT or a loopback test fixture");
  if (c.browser.hostUrl) {
    localUrl(c.browser.hostUrl);
    if (!c.browser.hostToken || c.browser.hostToken.length < 32) throw new Error("A desktop host requires a private capability");
  }
  validateLimits(c.limits);
  if ("native" in c || "jev" in c || "contextTokens" in c.limits || "maxParts" in c.limits)
    throw new BridgeError("configuration_migration_required", "This profile contains removed forwarding or history settings. Run migrate before serving", 409);
  if (c.tunnel && (!Array.isArray(c.tunnel.command) || !c.tunnel.command.length || c.tunnel.command.some(x => typeof x !== "string" || !x)))
    throw new Error("Tunnel command must be a nonempty argument vector");
  return structuredClone(c);
}

export function readConfig(home: string, create = false, migrate = false): Config {
  const path = join(home, "application.json");
  if (!existsSync(path)) {
    if (!create) throw new BridgeError("setup_required", "Run `codex-chatgpt-web setup` or start the desktop application first", 409);
    const config = defaultConfig();
    // Preserve only unambiguous installation settings. Old journals remain in
    // place and are imported by Store; changing config never erases ownership.
    const previous = join(home, "config.json");
    if (existsSync(previous)) {
      const legacy = JSON.parse(readFileSync(previous, "utf8"));
      if (legacy.mode === "full" || legacy.mode === "browser-only") config.mode = legacy.mode;
      if (Number.isInteger(legacy.port) && legacy.port > 0 && legacy.port < 65536) config.port = legacy.port;
      if (typeof legacy.serverControlToken === "string" && typeof legacy.controlToken === "string" && legacy.serverControlToken !== legacy.controlToken)
        throw new Error("Legacy control credentials disagree; resolve the two recorded values before migration");
      const token = legacy.serverControlToken ?? legacy.controlToken;
      if (typeof token === "string" && token.length >= 32) config.token = token;
    }
    atomicFile(path, JSON.stringify(config, null, 2) + "\n");
  }
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (migrate) {
    const previous = JSON.stringify(raw);
    delete raw.native;
    delete raw.jev;
    if (raw.limits) { delete raw.limits.contextTokens; delete raw.limits.maxParts; }
    if (raw.browser?.connectorName === "Codex Native2") raw.browser.connectorName = "ChatGPT Web Tools";
    const migrated = validateConfig(raw);
    if (previous !== JSON.stringify(raw)) {
      const backup = `${path}.before-v7`;
      if (!existsSync(backup)) atomicFile(backup, readFileSync(path));
      atomicFile(path, JSON.stringify(migrated, null, 2) + "\n");
    }
    return migrated;
  }
  return validateConfig(raw);
}

export function writeConfig(home: string, config: Config): void {
  atomicFile(join(home, "application.json"), JSON.stringify(validateConfig(config), null, 2) + "\n");
}
