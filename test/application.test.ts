import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fixture, eventually, requestBody } from "./fixtures";
import { array, list } from "../runtime/kernel";
import { parseRequest } from "../runtime/protocol";
import type { ObjectValue } from "../runtime/contracts";

describe("compiled Bend / SQLite / browser / native Responses boundaries", () => {
  test("an explicit Stop cannot overtake an already claimed physical Send", async () => {
    const f = fixture();
    const order: string[] = [];
    let release!: () => void;
    let entered = false;
    const originalSend = f.browser.send.bind(f.browser);
    f.browser.send = async (id, slot) => { entered = true; await new Promise<void>(resolve => { release = resolve; }); order.push("send"); return originalSend(id, slot); };
    const originalCancel = f.browser.cancel.bind(f.browser);
    f.browser.cancel = async id => { order.push("stop"); return originalCancel(id); };
    try {
      const parsed = f.parse(); await f.app.submit(parsed);
      await eventually(() => entered);
      const cancelled = f.app.cancel(parsed.id);
      await Bun.sleep(0);
      expect(order).toEqual([]);
      release();
      await cancelled;
      await eventually(() => order.length === 2);
      expect(order).toEqual(["send", "stop"]);
      expect(f.browser.sends).toHaveLength(1);
    } finally { release?.(); await f.close(); }
  });
  test("transport abort detaches only the subscriber; a later request reads the same final receipt", async () => {
    const f = fixture();
    try {
      const request = f.parse();
      const controller = new AbortController();
      const pending = f.app.response(request, controller.signal);
      const rejection = pending.catch(error => error);
      await eventually(() => f.browser.sends.length === 1, "one committed physical send");
      controller.abort(new DOMException("fixture disconnect", "AbortError"));
      expect((await rejection).name).toBe("AbortError");
      expect(f.browser.cancellations).toHaveLength(0);
      f.browser.finish(request.id, "The final answer.");
      await eventually(() => f.store.get(request.id).state.output.$ === "Some", "final publication after detach");
      const replay = JSON.parse(await f.app.response(request));
      expect(replay.output[0].content[0].text).toBe("The final answer.");
      expect(f.browser.sends).toHaveLength(1);
      expect(f.browser.prepares).toHaveLength(1);
    } finally { await f.close(); }
  });

  test("tool round trips keep one webpage and cannot publish a pre-tool answer", async () => {
    const f = fixture(true);
    try {
      const initial = f.parse();
      const first = f.app.response(initial);
      await eventually(() => f.browser.sends.length === 1);
      f.browser.finish(initial.id, "Before the native tool result.");
      const operation = f.store.get(initial.id);
      const tool = f.app.invoke(operation.capability, "session:rpc-1", "exec_command", { cmd: "fixture-only" });
      const firstBody = JSON.parse(await first) as ObjectValue;
      const output = firstBody.output as ObjectValue[];
      expect(output).toHaveLength(1);
      expect(output[0]!.type).toBe("function_call");
      const callId = output[0]!.call_id as string;
      expect(f.store.get(initial.id).state.output.$).toBe("None");
      const nextInput = [...initial.context.input, ...output, { type: "function_call_output", call_id: callId, output: "native receipt" }];
      const next = f.parse(requestBody("turn-one", nextInput, true));
      const final = f.app.response(next);
      expect((await tool).content).toEqual([{ type: "text", text: "native receipt" }]);
      await Bun.sleep(40);
      expect(f.store.get(initial.id).state.output.$).toBe("None");
      f.browser.finish(initial.id, "After the native tool result.");
      const answer = JSON.parse(await final);
      expect(answer.output[0].content[0].text).toBe("After the native tool result.");
      expect(f.browser.sends).toHaveLength(1);
      expect(f.browser.prepares).toHaveLength(1);
      expect(array(f.store.get(initial.id).state.broker.invocations)).toHaveLength(1);
      const repeated = await f.app.invoke(operation.capability, "session:rpc-1", "exec_command", { cmd: "fixture-only" });
      expect(repeated.content).toEqual([{ type: "text", text: "native receipt" }]);
      expect(array(f.store.get(initial.id).state.broker.invocations)).toHaveLength(1);
    } finally { await f.close(); }
  });

  test("a failed DOM read pauses that subscription without repeating reads or stopping the page", async () => {
    const f = fixture();
    try {
      const request = f.parse();
      f.browser.failObservation = true;
      const controller = new AbortController();
      const pending = f.app.response(request, controller.signal);
      void pending.catch(() => {});
      await eventually(() => !!f.store.setting(`fault:${request.id}`));
      const reads = f.browser.reads.length;
      await Bun.sleep(30);
      expect(f.browser.reads.length).toBe(reads);
      expect(f.browser.sends).toHaveLength(1);
      expect(f.browser.cancellations).toHaveLength(0);
      expect(f.browser.pages.get(request.id)!.facts.running).toBe(true);
      f.browser.failObservation = false;
      await f.app.resume(request.id);
      f.browser.finish(request.id, "Still the original execution.");
      expect(JSON.parse(await pending).output[0].content[0].text).toBe("Still the original execution.");
      expect(f.browser.sends).toHaveLength(1);
    } finally { await f.close(); }
  });

  test("an encoding failure before native delivery rolls back state and its events", async () => {
    const f = fixture(true);
    try {
      const request = f.parse();
      await f.app.submit(request);
      await eventually(() => f.browser.sends.length === 1);
      const operation = f.store.get(request.id);
      const pending = f.app.invoke(operation.capability, "session:encoding-failure", "exec_command", { cmd: "not-executed" });
      void pending.catch(() => {});
      await eventually(() => array(f.store.get(request.id).state.broker.invocations).length === 1);
      const before = f.store.get(request.id).revision;
      expect(() => f.store.pollRound(request.id, "failed-encoding", [], () => { throw new Error("fixture encoding failure"); })).toThrow("fixture encoding failure");
      expect(f.store.get(request.id).revision).toBe(before);
      expect(array(f.store.get(request.id).state.broker.invocations)[0]!.delivery.$).toBe("Queued");
      expect(f.store.round(request.id, "failed-encoding")).toBeUndefined();
      await f.app.cancel(request.id);
      await pending.catch(() => {});
    } finally { await f.close(); }
  });

  test("a database commit failure does not consume or dispatch a speculative send", async () => {
    const f = fixture();
    try {
      const request = f.parse();
      f.store.create(request.id, request.context);
      f.store.change(request.id, [{ $: "Install", payloads: list(["fixture prompt"]) }]);
      const before = f.store.get(request.id);
      f.store.db.exec("CREATE TEMP TRIGGER fail_state BEFORE UPDATE ON operations BEGIN SELECT RAISE(ABORT,'fixture commit failure'); END;");
      expect(() => f.store.change(request.id, [{ $: "Ready" }])).toThrow();
      expect(f.store.get(request.id).state).toEqual(before.state);
      expect(f.store.get(request.id).revision).toBe(before.revision);
      expect(f.browser.sends).toHaveLength(0);
      f.store.db.exec("DROP TRIGGER fail_state");
      const ready = f.store.change(request.id, [{ $: "Ready" }]);
      expect(ready.effects).toHaveLength(1);
      expect(f.store.claim(ready.effects[0]!)?.effect.$).toBe("BrowserCommand");
      expect(f.store.claim(ready.effects[0]!)).toBeUndefined();
    } finally { await f.close(); }
  });

  test("recovery preserves the physical slot and pending plan without replaying a claimed send", async () => {
    const f = fixture();
    try {
      const request = f.parse();
      f.store.create(request.id, request.context);
      f.store.change(request.id, [{ $: "Install", payloads: list(["first", "second"]) }]);
      const ready = f.store.change(request.id, [{ $: "Ready" }]);
      expect(f.store.claim(ready.effects[0]!)).toBeDefined();
      const changes = f.store.recover();
      expect(changes.flatMap(change => change.effects)).toHaveLength(0);
      expect(f.store.claim(ready.effects[0]!)).toBeUndefined();
      const restored = f.store.get(request.id).state.batch;
      expect(restored.$).toBe("Batch");
      if (restored.$ === "Batch") {
        expect(restored.slot).toBe(0n);
        expect(array(restored.pending)).toEqual(["second"]);
      }
      expect(f.store.change(request.id, [{ $: "Ready" }]).effects).toHaveLength(0);
      expect(f.browser.sends).toHaveLength(0);
    } finally { await f.close(); }
  });

  test("retained history reuses only the confirmed prefix on the same owned page", async () => {
    const f = fixture();
    try {
      const initial = f.parse();
      const first = f.app.response(initial);
      await eventually(() => f.browser.sends.length === 1);
      f.browser.finish(initial.id, "First reply.");
      const firstReply = JSON.parse(await first) as { output: ObjectValue[] };
      await eventually(() => f.store.receipts().length === 1);
      const input = [...initial.context.input, ...firstReply.output, { type: "message", role: "user", content: [{ type: "input_text", text: "Continue." }] }];
      const next = f.parse(requestBody("turn-two", input));
      const second = f.app.response(next);
      await eventually(() => f.browser.sends.length === 2);
      const preparation = f.browser.prepares.at(-1)!;
      expect(preparation.placement.page).toBe(f.browser.pages.get(initial.id)!.page);
      expect(preparation.placement.offset).toBe(2);
      expect(preparation.payload).toContain("Continue.");
      expect(preparation.payload).not.toContain("Return a result.");
      f.browser.finish(next.id, "Second reply.");
      expect(JSON.parse(await second).output[0].content[0].text).toBe("Second reply.");
    } finally { await f.close(); }
  });

  test("replaying an older API round cannot shorten the retained transcript", async () => {
    const f = fixture();
    try {
      const request = f.parse();
      f.store.create(request.id, request.context);
      const longer = [...request.context.symbols, "a".repeat(64), "b".repeat(64)];
      f.store.transcript(request.id, longer);
      f.store.transcript(request.id, request.context.symbols);
      expect(f.store.get(request.id).transcript).toEqual(longer);
      expect(() => f.store.transcript(request.id, [...request.context.symbols, "c".repeat(64)])).toThrow();
    } finally { await f.close(); }
  });
});
