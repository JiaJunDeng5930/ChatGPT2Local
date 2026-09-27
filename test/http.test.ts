import { afterEach, describe, expect, test } from "bun:test";
import { defaultConfig } from "../runtime/config";
import { handler } from "../runtime/server";
import { fixture, eventually, requestBody } from "./fixtures";
import { object, canonical } from "../runtime/codec";
import { array } from "../runtime/kernel";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });

function service(full = false) {
  const f = fixture(full);
  const config = defaultConfig(); config.mode = full ? "full" : "browser-only";
  const closing = new AbortController();
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 0, fetch: handler({ app: f.app, config, closing: closing.signal }) });
  const url = `http://127.0.0.1:${server.port}`;
  const headers = { authorization: `Bearer ${config.token}`, "content-type": "application/json" };
  const response = (body: unknown, extra: RequestInit = {}) => fetch(`${url}/v1/responses`, { method: "POST", headers, body: JSON.stringify(body), ...extra });
  cleanups.push(async () => { closing.abort(); await server.stop(true); await f.close(); });
  return { ...f, config, url, headers, response };
}

describe("real HTTP/SSE and durable native MCP transport", () => {
  test("HTTP admission rejects a missing identity before any browser preparation", async () => {
    const s = service();
    const response = await s.response({ model: "chatgpt-web/medium", input: "hello" });
    expect(response.status).toBe(400);
    expect((await response.json() as any).error.code).toBe("operation_identity_required");
    expect(s.browser.prepares).toHaveLength(0);
  });

  test("an aborted SSE connection detaches while the original webpage completes", async () => {
    const s = service();
    const body = requestBody(); const id = s.parse(body).id;
    const abort = new AbortController();
    const first = await s.response(body, { signal: abort.signal });
    expect(first.headers.get("content-type")).toBe("text/event-stream");
    const reader = first.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("observing durable");
    abort.abort(); await reader.cancel().catch(() => {});
    await eventually(() => s.browser.sends.length === 1);
    s.browser.finish(id, "One final receipt 😀");
    await eventually(() => s.store.get(id).state.output.$ === "Some");
    const second = await s.response(body);
    const events = await second.text();
    expect(events).toContain("response.completed"); expect(events).toContain("One final receipt 😀");
    expect(s.browser.sends).toHaveLength(1); expect(s.browser.cancellations).toHaveLength(0);
  });

  test("MCP commands traverse Responses and receive native results on the same page", async () => {
    const s = service(true); const body = requestBody("mcp-round", undefined, true); body.stream = false;
    const parsed = s.parse(body);
    await s.app.submit(parsed);
    await eventually(() => s.browser.sends.length === 1);
    const rpc = async (method: string, id: number, params: unknown, session?: string) => fetch(`${s.url}/mcp`, {
      method: "POST", headers: { "content-type": "application/json", ...(session ? { "mcp-session-id": session } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    const initialized = await rpc("initialize", 0, { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    const session = initialized.headers.get("mcp-session-id")!;
    expect(session.length).toBeGreaterThan(30);
    const discovered = await (await rpc("tools/list", 1, {}, session)).json() as any;
    expect(discovered.result.tools.map((tool: any) => tool.name)).toContain("codex_exec");
    const token = s.store.get(parsed.id).capability;
    const call = rpc("tools/call", 2, { name: "codex_exec", arguments: { turn_token: token, cmd: "printf native" } }, session);
    const outgoing = await (await s.response(body)).json() as any;
    expect(outgoing.output[0].name).toBe("exec_command");
    expect(JSON.parse(outgoing.output[0].arguments)).toEqual({ cmd: "printf native" });
    const continued = requestBody("mcp-round", [...parsed.context.input, outgoing.output[0], {
      type: "function_call_output", call_id: outgoing.output[0].call_id, output: "native-result",
    }], true);
    continued.stream = false;
    const pending = s.response(continued);
    const receipt = await (await call).json() as any;
    expect(receipt.result.content[0].text).toBe("native-result");
    const replay = await (await rpc("tools/call", 2, { name: "codex_exec", arguments: { turn_token: token, cmd: "printf native" } }, session)).json() as any;
    expect(replay.result).toEqual(receipt.result);
    s.browser.finish(parsed.id, "Native tools finished");
    expect((await (await pending).json() as any).output.at(-1).content[0].text).toBe("Native tools finished");
    expect(array(s.store.get(parsed.id).state.broker.invocations)).toHaveLength(1);
    expect(s.browser.sends).toHaveLength(1);
  });

  test("wrong capabilities, wrong origins, and missing bearer tokens have no effects", async () => {
    const s = service(true);
    expect((await fetch(`${s.url}/control/status`)).status).toBe(401);
    expect((await fetch(`${s.url}/control/status`, { headers: { ...s.headers, origin: "https://attacker.invalid" } })).status).toBe(403);
    const init = await fetch(`${s.url}/mcp`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }) });
    const result = await fetch(`${s.url}/mcp`, { method: "POST", headers: { "content-type": "application/json", "mcp-session-id": init.headers.get("mcp-session-id")! },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "codex_exec", arguments: { turn_token: "x".repeat(40), cmd: "do-not-execute" } } }) });
    expect((await result.json() as any).result.isError).toBe(true);
    expect(s.browser.prepares).toHaveLength(0);
  });

  test("status and static UI never disclose task text or capabilities", async () => {
    const s = service(); const parsed = s.parse();
    await s.app.submit(parsed);
    const status = await (await fetch(`${s.url}/control/status`, { headers: s.headers })).text();
    expect(status).not.toContain(s.store.get(parsed.id).capability);
    expect(status).not.toContain("Perform the supplied task");
    const ui = await fetch(s.url);
    expect(ui.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(await ui.text()).not.toContain(s.config.token);
  });

  test("a missing MCP session never aliases another client's numeric request IDs", async () => {
    const s = service(true);
    const response = await fetch(`${s.url}/mcp`, { method: "POST", headers: { "content-type": "application/json" },
      body: canonical({ jsonrpc: "2.0", id: 2, method: "tools/list" }) });
    expect(response.status).toBe(404);
  });
});
