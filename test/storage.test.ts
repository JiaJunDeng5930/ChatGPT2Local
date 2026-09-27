import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { OwnerLock } from "../runtime/owner";
import { Store } from "../runtime/store";
import { compiled, encode, decode } from "../runtime/kernel";
import { defaultConfig, readConfig, writeConfig } from "../runtime/config";
import { fixture, eventually, requestBody } from "./fixtures";
import { digest } from "../runtime/codec";

const cleanup: (() => void | Promise<void>)[] = [];
afterEach(async () => { while (cleanup.length) await cleanup.pop()!(); });
function directory() { const home = mkdtempSync(join(tmpdir(), "bend-storage-")); cleanup.push(() => rmSync(home, { recursive: true, force: true })); return home; }

describe("real process ownership, journal migration, and whole-decision transactions", () => {
  test("a second interpreter cannot acquire a live profile; OS death releases it", async () => {
    const home = directory();
    const child = Bun.spawn([process.execPath, "-e", `import {OwnerLock} from './runtime/owner.ts';const lock=new OwnerLock(${JSON.stringify(home)});console.log('locked');setInterval(()=>{},10000);`],
      { cwd: resolve(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe" });
    cleanup.push(async () => { child.kill("SIGKILL"); await child.exited; });
    const reader = child.stdout.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("locked"); reader.releaseLock();
    expect(() => new OwnerLock(home)).toThrow("Another process owns this profile");
    child.kill("SIGKILL"); await child.exited;
    const next = new OwnerLock(home); next.close();
  });

  test("unmapped legacy ownership blocks new sends and a reviewed mapping persists", async () => {
    const home = directory(); const journal = join(home, "submission-journal", "a".repeat(64));
    mkdirSync(journal, { recursive: true }); writeFileSync(join(journal, "owner.json"), "corrupted");
    const f = fixture(); cleanup.push(f.close);
    const context = f.parse().context;
    let store = new Store(home);
    expect(() => store.create("native:" + "b".repeat(64), context)).toThrow("unresolved legacy");
    store.db.query("UPDATE legacy SET id=? WHERE source=?").run("native:" + "b".repeat(64), journal);
    store.close(); store = new Store(home); cleanup.push(() => store.close());
    expect(store.db.query("SELECT id FROM legacy WHERE id LIKE 'unmapped:%'").all()).toHaveLength(0);
    expect(() => store.create("native:" + "b".repeat(64), context)).toThrow("old ownership receipt");
    expect(store.create("native:" + "c".repeat(64), context).created).toBe(true);
    expect(readFileSync(join(journal, "owner.json"), "utf8")).toBe("corrupted");
  });

  test("a failed local-result commit cannot publish its blob or complete its activity", async () => {
    const f = fixture(true); cleanup.push(f.close);
    const parsed = f.parse(); await f.app.submit(parsed);
    await eventually(() => f.browser.sends.length === 1);
    f.store.change(parsed.id, [{ $: "BeginTool", id: "local-test" }]);
    const before = encode(f.store.get(parsed.id).state);
    f.store.db.exec("CREATE TRIGGER fail_local BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT,'injected commit failure'); END");
    expect(() => f.store.completeLocal(parsed.id, "local-test", '{"ok":true}', "baseline")).toThrow("injected commit failure");
    expect(f.store.blob(parsed.id, "local:local-test")).toBeUndefined();
    expect(encode(f.store.get(parsed.id).state)).toBe(before);
    f.store.db.exec("DROP TRIGGER fail_local");
    f.store.completeLocal(parsed.id, "local-test", '{"ok":true}', "baseline");
    expect(f.store.blob(parsed.id, "local:local-test")).toBe('{"ok":true}');
  });

  test("generated boundaries reject forged constructors and preserve large natural counters", () => {
    expect(() => compiled.validate("domain.Phase", { $: "Running", authority: "send" })).toThrow();
    expect(() => compiled.validate("domain.Phase", { $: "Invented" })).toThrow();
    const state = { $: "Snapshot", revision: 2n ** 80n, batch: 0n, active: 0n, time: { $: "None" } };
    expect(decode<typeof state>(encode(state), "progress-domain.Snapshot")).toEqual(state);
    expect(() => decode(encode({ ...state, revision: -1n }), "progress-domain.Snapshot")).toThrow();
  });

  test("explicit v7 configuration migration removes obsolete settings and preserves its private backup", () => {
    const home = directory();
    const config = defaultConfig();
    const old = JSON.stringify({ ...config, native: { baseUrl: "https://old.invalid" },
      jev: { model: "old-advisor" }, limits: { ...config.limits, maxParts: 6, contextTokens: 90_000 },
      browser: { ...config.browser, connectorName: "Codex Native2" } });
    writeFileSync(join(home, "application.json"), old);
    expect(() => readConfig(home)).toThrow("migrate");
    const migrated = readConfig(home, false, true);
    expect(migrated.token).toBe(config.token);
    expect(migrated.browser.connectorName).toBe("ChatGPT Web Tools");
    expect("native" in migrated).toBe(false);
    expect("jev" in migrated).toBe(false);
    expect(migrated.limits).toEqual(config.limits);
    expect(readFileSync(join(home, "application.json.before-v7"), "utf8")).toBe(old);
    expect(readConfig(home, false, true)).toEqual(migrated);
    expect(readFileSync(join(home, "application.json.before-v7"), "utf8")).toBe(old);
  });

  test("configuration migration retains credentials only in the private local file", () => {
    const home = directory(); const token = digest("existing local control capability");
    writeFileSync(join(home, "config.json"), JSON.stringify({ mode: "full", port: 19876, controlToken: token }));
    const config = readConfig(home, true);
    expect(config.mode).toBe("full"); expect(config.port).toBe(19876); expect(config.token).toBe(token);
    expect(() => writeConfig(home, { ...config, browser: { endpoint: "http://external.invalid:9222", startUrl: "https://chatgpt.com/" } })).toThrow("loopback");
    expect(readConfig(home).browser.endpoint).toBe("http://127.0.0.1:9222");
  });
});
