/** Protocol risks at JSON, SQLite, HTTP and browser-ownership boundaries.
 * Admission's finite decision table is proved in Bend, not duplicated here. */
import { afterEach, describe, expect, test } from "bun:test";
import Ajv from "ajv";
import { rmSync } from "node:fs";
import { fixture, requestBody, requestHeaders, continuationBody, eventually } from "./fixtures";
import { BridgeError, type ObjectValue } from "../runtime/contracts";
import { parseRequest, RESPONSE_SCHEMA } from "../runtime/protocol";
import { Application } from "../runtime/application";
import { Store } from "../runtime/store";
import { ToolMcp } from "../runtime/mcp";
import { handler } from "../runtime/server";
import { defaultConfig } from "../runtime/config";
import { array } from "../runtime/kernel";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });
const validateResponse = new Ajv({ strict: false }).compile(RESPONSE_SCHEMA);
function fresh(full = false) { const f = fixture(full); cleanups.push(f.close); return f; }
function code(run: () => unknown): string {
  try { run(); throw new Error("Expected a protocol rejection"); }
  catch (error) { if (!(error instanceof BridgeError)) throw error; return error.code; }
}
async function completed(f: ReturnType<typeof fixture>, key = "root") {
  const body = requestBody(key);
  const parsed = f.parse(body);
  const pending = f.app.response(parsed);
  await eventually(() => f.browser.pages.get(parsed.id)?.accepted === true);
  f.browser.finish(parsed.id, `Answer for ${key}.`);
  const encoded = await pending;
  const response = JSON.parse(encoded);
  expect(validateResponse(response)).toBe(true);
  return { body, parsed, encoded, response };
}

describe("explicit webpage API contracts", () => {
  test("legacy API fields and forwarding endpoints reject before allocating a page", async () => {
    const f = fresh();
    const config = defaultConfig();
    const serve = handler({ app: f.app, config });
    const headers = { authorization: `Bearer ${config.token}`, "content-type": "application/json", "idempotency-key": "rejected" };
    for (const extra of [{ client_metadata: {} }, { prompt_cache_key: "thread" }, { reasoning: { effort: "high" } },
      { model: "astra-jev" }, { model: "ordinary-api-model" }, { input: [] },
      { tools: [{ type: "function", name: "async_schema", parameters: { $async: true, type: "object" } }] }]) {
      const response = await serve(new Request("http://127.0.0.1/v1/responses", { method: "POST", headers,
        body: JSON.stringify({ model: "chatgpt-web/medium", input: "Task", ...extra }) }));
      expect(response.status).toBe(400);
    }
    for (const path of ["/responses", "/v1/responses/compact", "/v1/responses/compact-v2", "/v1/images/generations", "/control/install"]) {
      const response = await serve(new Request(`http://127.0.0.1${path}`, { method: "POST", headers, body: "{}" }));
      expect(response.status).toBe(404);
    }
    const schemas = await (await serve(new Request("http://127.0.0.1/v1/schema", { headers }))).json() as any;
    expect(schemas.request.additionalProperties).toBe(false);
    expect(schemas.response.$id).toBe(RESPONSE_SCHEMA.$id);
    const models = await (await serve(new Request("http://127.0.0.1/v1/models", { headers }))).json() as any;
    expect(models.data).toHaveLength(5);
    expect(f.store.db.query("SELECT key FROM requests").all()).toHaveLength(0);
    expect(f.browser.prepares).toHaveLength(0);
  });

  test("request identity survives transport changes and rejects conflicting content", async () => {
    const f = fresh();
    const root = await completed(f);
    const replay = f.parse({ ...root.body, stream: false }, "root");
    expect(await f.app.response(replay)).toBe(root.encoded);
    expect(code(() => f.parse({ ...root.body, input: "Different request" }, "root"))).toBe("idempotency_conflict");
    expect(f.store.get(root.parsed.id).context.input).toEqual(root.parsed.context.input);
    expect(f.browser.sends).toHaveLength(1);
  });

  test("identical roots with different keys allocate independent pages without history inference", async () => {
    const f = fresh();
    const first = await completed(f, "first-root");
    const second = f.parse({ ...first.body }, "second-root");
    await f.app.submit(second);
    await eventually(() => f.browser.sends.length === 2);
    expect(f.browser.prepares[1]!.placement).toEqual({});
    expect(f.browser.pages.get(second.id)!.page).not.toBe(f.browser.pages.get(first.parsed.id)!.page);
  });

  test("pending resources are observable but do not authorize a successor", async () => {
    const f = fresh();
    const root = f.parse();
    await f.app.submit(root);
    const resource = f.app.resource(root.responseId);
    expect(validateResponse(resource)).toBe(true);
    expect(resource.status).toBe("in_progress");
    expect(code(() => f.parse(continuationBody(root.responseId, "Premature.")))).toBe("previous_response_pending");
    expect(code(() => f.parse(continuationBody(`resp_${"0".repeat(64)}`, "Unknown.")))).toBe("previous_response_not_found");
    expect(f.store.db.query("SELECT key FROM requests").all()).toHaveLength(1);
  });

  test("concurrent predecessors are rechecked inside the page-claim transaction", async () => {
    const f = fresh();
    const root = await completed(f);
    const one = f.parse(continuationBody(root.response.id, "First contender.", "one"));
    const two = f.parse(continuationBody(root.response.id, "Second contender.", "two"));
    const results = await Promise.allSettled([f.app.submit(one), f.app.submit(two)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(result => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason.code).toBe("previous_response_consumed");
    await eventually(() => f.browser.sends.length === 2);
    expect(f.store.db.query("SELECT key FROM requests WHERE previous=?").all(root.response.id)).toHaveLength(1);
    expect(f.browser.prepares).toHaveLength(2);
    expect(await f.app.response(root.parsed)).toBe(root.encoded);
  });

  test("changed documents and inherited-setting overrides never trigger a replacement page", async () => {
    const f = fresh();
    const root = await completed(f);
    expect(code(() => f.parse({ previous_response_id: root.response.id, model: "chatgpt-web/high", input: "Change effort" }, "override"))).toBe("invalid_request");
    const next = f.parse(continuationBody(root.response.id, "Continue."));
    f.browser.pages.get(root.parsed.id)!.document = "an-unrelated-navigation";
    await expect(f.app.submit(next)).rejects.toMatchObject({ code: "previous_response_unavailable" });
    expect(f.store.request(next.round)).toBeUndefined();
    expect(f.browser.sends).toHaveLength(1);
    expect(f.browser.prepares).toHaveLength(1);
  });

  test("oversize messages and remote image URLs are rejected before request admission", async () => {
    const f = fresh();
    const huge = f.parse({ model: "chatgpt-web/medium", input: "x".repeat(250_000) }, "too-large");
    await expect(f.app.submit(huge)).rejects.toMatchObject({ code: "message_too_large" });
    const image = f.parse({ model: "chatgpt-web/medium", input: [{ type: "message", role: "user", content: [
      { type: "input_image", image_url: "http://private.invalid/image.png" },
    ] }] }, "remote-image");
    await expect(f.app.submit(image)).rejects.toMatchObject({ code: "image_bytes_required" });
    expect(f.store.db.query("SELECT key FROM requests").all()).toHaveLength(0);
    expect(f.browser.prepares).toHaveLength(0);
  });

  test("the exact result batch is durable as one transaction and remains retryable after a failed commit", async () => {
    const f = fresh(true);
    const root = f.parse(); await f.app.submit(root);
    await eventually(() => f.browser.sends.length === 1);
    const token = f.store.get(root.id).capability;
    const calls = [f.app.invoke(token, "rpc:first", "exec_command", { cmd: "first" }),
      f.app.invoke(token, "rpc:second", "exec_command", { cmd: "second" })];
    calls.forEach(promise => void promise.catch(() => {}));
    await eventually(() => array(f.store.get(root.id).state.broker.invocations).length === 2);
    const response = JSON.parse(await f.app.response(root));
    expect(validateResponse(response)).toBe(true);
    expect(response.status).toBe("requires_action");
    const results: ObjectValue[] = response.output.map((call: any, index: number) => ({ type: "function_call_output", call_id: call.call_id, output: index ? "two" : "one" }));
    expect(code(() => f.parse(continuationBody(response.id, [results[0]!], "partial")))).toBe("tool_results_mismatch");
    expect(code(() => f.parse(continuationBody(response.id, [results[0]!, results[0]!], "duplicate")))).toBe("tool_results_mismatch");
    expect(code(() => f.parse(continuationBody(response.id, "Ignore the calls", "message")))).toBe("tool_results_required");
    expect(code(() => f.parse(continuationBody(response.id, results.map(result => ({ ...result, output: { content: [{ type: "unsupported" }] } })), "bad-content")))).toBe("invalid_request");
    const next = f.parse(continuationBody(response.id, results));
    f.store.db.exec(`CREATE TEMP TRIGGER fail_second BEFORE INSERT ON blobs WHEN NEW.body='"two"' BEGIN SELECT RAISE(ABORT,'second result failed'); END;`);
    await expect(f.app.submit(next)).rejects.toThrow("second result failed");
    for (const result of results) expect(f.store.blob(root.id, `result:${result.call_id}`)).toBeUndefined();
    expect(array(f.store.get(root.id).state.broker.invocations).map(call => call.delivery.$)).toEqual(["Delivered", "Delivered"]);
    f.store.db.exec("DROP TRIGGER fail_second");
    await f.app.submit(next);
    expect((await Promise.all(calls)).map(call => (call.content as any[])[0].text)).toEqual(["one", "two"]);
    f.browser.finish(root.id, "All results received.");
    const final = JSON.parse(await f.app.response(next));
    expect(validateResponse(final)).toBe(true);
    expect(final.previous_response_id).toBe(response.id);
    expect(final.id).not.toBe(response.id);
    expect(f.browser.sends).toHaveLength(1);
  });

  test("failure to persist a final page receipt rolls back publication, and explicit observation can recover", async () => {
    const f = fresh();
    const root = f.parse(); await f.app.submit(root);
    await eventually(() => f.browser.sends.length === 1);
    f.store.db.exec("CREATE TEMP TRIGGER fail_receipt BEFORE INSERT ON receipts BEGIN SELECT RAISE(ABORT,'receipt commit failed'); END;");
    f.browser.finish(root.id, "A recoverable final answer.");
    await eventually(() => !!f.store.setting(`fault:${root.id}`));
    expect(f.store.get(root.id).state.output.$).toBe("None");
    expect(f.store.receipt(f.store.get(root.id))).toBeUndefined();
    const interrupted = f.app.resource(root.responseId);
    expect(validateResponse(interrupted)).toBe(true);
    expect(interrupted.status).toBe("interrupted");
    f.store.db.exec("DROP TRIGGER fail_receipt");
    await f.app.resume(root.id, true);
    const final = JSON.parse(await f.app.response(root));
    expect(final.output[0].content[0].text).toBe("A recoverable final answer.");
    expect(f.store.receipt(f.store.get(root.id))).toBeDefined();
    expect(f.browser.sends).toHaveLength(1);
  });

  test("request and page identities survive reopening SQLite without reconstructing history", async () => {
    const f = fixture();
    let app = f.app, store = f.store;
    cleanups.push(async () => { await app.close(); store.close(); rmSync(f.home, { recursive: true, force: true }); });
    const root = await completed(f);
    await app.close(); store.close();
    store = new Store(f.home); app = new Application(store, f.browser, f.app.limits, 5, 0); app.recover();
    const replay = parseRequest(root.body, requestHeaders(root.body), "browser-only", store);
    expect(await app.response(replay)).toBe(root.encoded);
    const body = continuationBody(root.response.id, "Continue after restart.");
    const next = parseRequest(body, requestHeaders(body), "browser-only", store);
    await app.submit(next);
    await eventually(() => f.browser.sends.length === 2);
    expect(f.browser.pages.get(next.id)!.page).toBe(f.browser.pages.get(root.parsed.id)!.page);
    expect(f.browser.prepares[1]!.payload).not.toContain("Return a result.");
  });

  test("custom caller tools use their exact names and freeform inputs without a Codex gateway", async () => {
    const f = fresh(true);
    const body = requestBody("custom-root", undefined, true);
    body.tools = [{ type: "custom", name: "project.patch", description: "Apply a project patch" }];
    const root = f.parse(body); await f.app.submit(root);
    await eventually(() => f.browser.sends.length === 1);
    const mcp = new ToolMcp(f.app);
    const call = mcp.call("web_tool_call", { turn_token: f.store.get(root.id).capability, name: "project.patch", input: "freeform patch" }, "custom-rpc");
    void call.catch(() => {});
    const outgoing = JSON.parse(await f.app.response(root));
    expect(validateResponse(outgoing)).toBe(true);
    expect(outgoing.output[0]).toMatchObject({ type: "custom_tool_call", name: "project.patch", input: "freeform patch" });
    const literal = '{"content":[{"type":"text","text":"This is still a literal string"}]}';
    const next = f.parse(continuationBody(outgoing.id, [{ type: "custom_tool_call_output", call_id: outgoing.output[0].call_id, output: literal }]));
    await f.app.submit(next);
    expect(await call).toMatchObject({ content: [{ type: "text", text: literal }] });
    f.browser.finish(root.id, "Done.");
    expect(JSON.parse(await f.app.response(next)).status).toBe("completed");
    expect(f.browser.sends).toHaveLength(1);
  });
});
