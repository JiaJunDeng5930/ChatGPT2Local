import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { AdaptiveRoute } from "../runtime/adaptive";
import { NativeUpstream } from "../runtime/upstream";
import { decode } from "../runtime/kernel";
import { eventually } from "./fixtures";
import type { ObjectValue } from "../runtime/contracts";
import type { Config } from "../runtime/config";

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => { while (cleanup.length) await cleanup.pop()!(); });
const advice = (effort = "high", lease_steps = 2) => Response.json({ choices: [{ message: { content: JSON.stringify({ effort, lease_steps }) } }] });
const body = (count = 1): ObjectValue => ({ model: "astra-jev", stream: false, instructions: "fixture instructions", input: Array.from({ length: count }, (_, i) => ({ type: "message", role: i % 2 ? "assistant" : "user", content: [{ type: "input_text", text: `item ${i}` }] })) });
const request = (key: string, signal?: AbortSignal) => new Request("http://127.0.0.1/v1/responses", { method: "POST", signal,
  headers: { "idempotency-key": key, "x-codex-turn-metadata": JSON.stringify({ thread_id: "test-thread", turn_id: "test-turn" }), authorization: "Bearer LOCAL-MUST-NOT-LEAVE" } });

function fixture(advisor?: (init: RequestInit | undefined) => Promise<Response>, native?: (init: RequestInit | undefined) => Promise<Response>) {
  const home = mkdtempSync(join(tmpdir(), "bend-adaptive-"));
  process.env.BEND_TEST_ADVISOR_KEY = "advisor-key"; process.env.BEND_TEST_NATIVE_KEY = "native-key";
  let adviceCount = 0, nativeCount = 0;
  const forwarded: ObjectValue[] = [];
  const upstream = new NativeUpstream({ baseUrl: "https://native.invalid/v1", keyEnv: "BEND_TEST_NATIVE_KEY" }, (async (_url, init) => {
    nativeCount++;
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer native-key");
    forwarded.push(JSON.parse(String(init?.body)));
    return native ? native(init) : Response.json({ id: `native_${nativeCount}`, output: [] });
  }) as typeof fetch);
  const config: NonNullable<Config["jev"]> = { baseUrl: "https://advisor.invalid/v1", keyEnv: "BEND_TEST_ADVISOR_KEY", model: "fixture-advisor", targetModel: "fixture-native" };
  const route = new AdaptiveRoute(home, config, upstream, (async (_url, init) => {
    adviceCount++;
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer advisor-key");
    return advisor ? advisor(init) : advice();
  }) as typeof fetch);
  cleanup.push(async () => { await route.close(); rmSync(home, { recursive: true, force: true }); });
  return { route, home, config, upstream, forwarded, counts: () => ({ advice: adviceCount, native: nativeCount }) };
}

describe("checked native adaptive route and physical forwarding receipts", () => {
  test("a two-generation lease is consumed exactly once per distinct generation", async () => {
    const f = fixture();
    const first = await f.route.request(request("first"), body());
    expect(await f.route.request(request("first"), body())).toEqual(first);
    await f.route.request(request("second"), body(2));
    expect(f.counts()).toEqual({ advice: 1, native: 2 });
    await f.route.request(request("third"), body(3));
    expect(f.counts()).toEqual({ advice: 2, native: 3 });
    expect(f.forwarded.every(value => value.model === "fixture-native" && (value.reasoning as any).effort === "high")).toBe(true);
  });

  test("reusing an identity with different instructions cannot buy another attempt", async () => {
    const f = fixture();
    await f.route.request(request("same"), body());
    expect(() => f.route.request(request("same"), { ...body(), instructions: "different" })).toThrow("different input");
    expect(f.counts()).toEqual({ advice: 1, native: 1 });
  });

  test("invalid advice does not fall back, retry, or start native generation", async () => {
    const f = fixture(async () => advice("invented", 2));
    await expect(f.route.request(request("invalid"), body())).rejects.toThrow("unsupported reasoning effort");
    expect(() => f.route.request(request("invalid"), body())).toThrow("will not be forwarded again");
    expect(f.counts()).toEqual({ advice: 1, native: 0 });
  });

  test("a slow earlier advisor cannot replace a newer conversation lease", async () => {
    let release!: (response: Response) => void;
    let n = 0;
    const f = fixture(async () => ++n === 1 ? new Promise<Response>(resolve => { release = resolve; }) : advice("low", 10));
    const older = f.route.request(request("older"), body());
    const newer = await f.route.request(request("newer"), body(2));
    expect(newer.status).toBe(200);
    release(advice("high", 2)); await older;
    const lease = f.route.db.query("SELECT body FROM leases WHERE thread=?").get("test-thread") as { body: string };
    expect(decode<any>(lease.body, "routing-domain.Cache").effort.$).toBe("Low");
    await f.route.request(request("after-newer"), body(3));
    expect(f.counts()).toEqual({ advice: 2, native: 3 });
    expect((f.forwarded.at(-1)!.reasoning as any).effort).toBe("low");
  });

  test("detaching the adaptive SSE observer leaves one native request in flight", async () => {
    let release!: (response: Response) => void;
    const f = fixture(undefined, async () => new Promise<Response>(resolve => { release = resolve; }));
    const input = { ...body(), stream: true };
    const response = await f.route.response(request("stream"), input);
    const reader = response.body!.getReader(); await reader.read(); await reader.cancel();
    await eventually(() => f.counts().native === 1);
    release(new Response('event: response.completed\ndata: {"type":"response.completed"}\n\n', { headers: { "content-type": "text/event-stream" } }));
    const retained = await f.route.request(request("stream"), input);
    expect(retained.body).toContain("response.completed");
    expect(f.counts()).toEqual({ advice: 1, native: 1 });
  });

  test("a killed native requester is recovered as unknown, not re-forwarded", async () => {
    const home = mkdtempSync(join(tmpdir(), "bend-native-crash-"));
    let adviceCount = 0, nativeCount = 0;
    let finishNative: (() => void) | undefined;
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 0, fetch: req => {
      if (new URL(req.url).pathname.startsWith("/advisor/")) { adviceCount++; return advice(); }
      nativeCount++; return new Promise<Response>(resolve => { finishNative = () => resolve(new Response("fixture closed", { status: 503 })); });
    } });
    let child: ReturnType<typeof Bun.spawn> | undefined;
    let recovered: AdaptiveRoute | undefined;
    cleanup.push(async () => {
      child?.kill("SIGKILL"); if (child) await child.exited;
      finishNative?.(); await recovered?.close(); await server.stop(true); rmSync(home, { recursive: true, force: true });
    });
    const origin = `http://127.0.0.1:${server.port}`;
    const config = { baseUrl: `${origin}/advisor`, keyEnv: "BEND_TEST_ADVISOR_KEY", model: "fixture-advisor", targetModel: "fixture-native" };
    const native = { baseUrl: `${origin}/native`, keyEnv: "BEND_TEST_NATIVE_KEY" };
    const headers = Object.fromEntries(request("crash").headers);
    const script = `import {AdaptiveRoute} from './runtime/adaptive.ts'; import {NativeUpstream} from './runtime/upstream.ts';
      const r=new AdaptiveRoute(${JSON.stringify(home)},${JSON.stringify(config)},new NativeUpstream(${JSON.stringify(native)}));
      await r.request(new Request('http://127.0.0.1/v1/responses',{method:'POST',headers:${JSON.stringify(headers)}}),${JSON.stringify(body())});`;
    child = Bun.spawn([process.execPath, "-e", script], { cwd: resolve(import.meta.dir, ".."), stdout: "pipe", stderr: "pipe",
      env: { ...process.env, BEND_TEST_ADVISOR_KEY: "advisor-key", BEND_TEST_NATIVE_KEY: "native-key" } });
    const errors = new Response(child.stderr as ReadableStream<Uint8Array>).text();
    await eventually(() => nativeCount === 1 || child!.exitCode !== null, "child native send", 8000);
    if (nativeCount !== 1) throw new Error(`Child exited before forwarding: ${await errors}`);
    child.kill("SIGKILL"); await child.exited;
    recovered = new AdaptiveRoute(home, config, new NativeUpstream(native));
    expect(() => recovered!.request(request("crash"), body())).toThrow("will not be forwarded again");
    expect(adviceCount).toBe(1); expect(nativeCount).toBe(1);
  }, 15000);
});
