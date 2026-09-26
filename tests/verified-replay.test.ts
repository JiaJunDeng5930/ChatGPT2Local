import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VerifiedOutbox, VerifiedReplayJournal } from "../src/verified/replay";
import { canonicalJson } from "../src/verified/encoding";
import { writeReceipt } from "../src/verified/submission-journal";
import { BEND_NAT_MAX, decodeNat, encodeNat } from "../src/verified/boundary";
import { VerifiedCompletionObserver } from "../src/verified/observation";
import type { BrokerToolRequest } from "../src/adapters/chatgpt-web/turn-broker";
import type { AdapterEvent } from "../src/types";

const roots: string[] = [];
afterEach(() => { for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true }); });
const call = (id: string): BrokerToolRequest => ({ callId: id, wireName: "example", freeform: false, arguments: { n: 1 } });
const text = (value: string): AdapterEvent => ({ type: "text_delta", text: value });
const done = (): AdapterEvent => ({ type: "done", stopReason: "stop" });

test("native batch admission is atomic even when the last call reuses a spent identity", () => {
  const outbox = new VerifiedOutbox();
  outbox.offer([call("old")], ["reason"], [text("before")]);
  outbox.receipt("old");
  expect(() => outbox.offer([call("new"), call("old")], ["new reason"], [text("new")])).toThrow("duplicate");
  expect(outbox.pending()).toEqual([]);
  expect(outbox.prelude()).toEqual({ reasoning: [], events: [] });
  outbox.offer([call("new")], [], []);
  expect(outbox.pending().map(item => item.callId)).toEqual(["new"]);
});

test("native batch identities are unique within one batch and are not restored by a receipt", () => {
  const outbox = new VerifiedOutbox();
  expect(() => outbox.offer([call("a"), call("a")], [], [])).toThrow("duplicate");
  expect(outbox.pending()).toEqual([]);
  outbox.offer([call("a"), call("b")], ["reason"], [text("before")]);
  expect(() => outbox.offer([call("c")], [], [])).toThrow("unresolved");
  outbox.receipt("a");
  expect(outbox.pending()).toEqual([call("b")]);
  expect(outbox.prelude().reasoning).toEqual(["reason"]);
  expect(() => outbox.receipt("a")).toThrow("does not match");
  outbox.receipt("b");
  expect(() => outbox.offer([call("a")], [], [])).toThrow("duplicate");
});

test("neither the input owner nor a replay observer can mutate an admitted native request", () => {
  const outbox = new VerifiedOutbox();
  const request = call("a");
  outbox.offer([request], ["original"], [text("original")]);
  request.arguments!.n = 2;
  outbox.pending()[0]!.arguments!.n = 3;
  outbox.prelude().events[0]!.type = "heartbeat";
  expect(outbox.pending()).toEqual([call("a")]);
  expect(outbox.prelude()).toEqual({ reasoning: ["original"], events: [text("original")] });
});

test("native replay journals commit complete batches before emission and reject post-terminal data atomically", () => {
  const journal = new VerifiedReplayJournal();
  journal.append([text("start")]);
  expect(() => journal.append([text("must not appear"), done(), text("late")])).toThrow("TerminalNotLast");
  expect(journal.events()).toEqual([text("start")]);
  expect(journal.terminal()).toBeFalse();
  journal.reason(["why"]);
  journal.append([text("end"), done()]);
  expect(journal.terminal()).toBeTrue();
  expect(() => journal.append([text("too late")])).toThrow("TerminalAlreadyPresent");
  journal.seal();
  journal.seal();
  expect(journal.closed()).toBeTrue();
  expect(() => journal.reason(["rewrite"])).toThrow("JournalClosed");
  expect(journal.events()).toEqual([text("start"), text("end"), done()]);
  expect(journal.reasoning()).toEqual(["why"]);
});

test("recorded failure preserves earlier stream data and keeps the first exception resource", () => {
  const journal = new VerifiedReplayJournal();
  journal.append([text("already visible")]);
  const original = new Error("original");
  journal.fail(original);
  journal.fail(new Error("original"));
  expect(journal.failure()).toBe(original);
  expect(() => journal.fail(new Error("different"))).toThrow("ConflictingFailure");
  expect(journal.events()).toEqual([text("already visible")]);
  expect(journal.closed()).toBeTrue();
});

test("canonical transport identity preserves order, ignores only absent object fields and never invokes getters", () => {
  expect(canonicalJson({ b: 2, a: 1, missing: undefined })).toBe(canonicalJson({ a: 1, b: 2 }));
  expect(canonicalJson(["a", "b"])).not.toBe(canonicalJson(["b", "a"]));
  const shared = { value: 1 };
  expect(canonicalJson([shared, shared])).toBe('[{"value":1},{"value":1}]');
  const cycle: { next?: unknown } = {};
  cycle.next = cycle;
  let getterCalls = 0;
  const getter = { get value() { getterCalls++; return "surprise"; } };
  for (const value of [cycle, getter, [undefined], new Array(2), NaN, Infinity, new Date(), 1n]) {
    expect(() => canonicalJson(value)).toThrow();
  }
  expect(getterCalls).toBe(0);
});

test("durable receipts never overwrite a winner and permit only identical replay", () => {
  const directory = mkdtempSync(join(tmpdir(), "bend-receipt-"));
  roots.push(directory);
  const path = join(directory, "final.json");
  writeReceipt(path, directory, { operation: "op", answer: "winner" });
  const original = readFileSync(path, "utf8");
  writeReceipt(path, directory, { answer: "winner", operation: "op" });
  expect(() => writeReceipt(path, directory, { operation: "op", answer: "different" })).toThrow("different contents");
  expect(readFileSync(path, "utf8")).toBe(original);
  expect(readdirSync(directory)).toEqual(["final.json"]);
  writeFileSync(path, "corrupt existing receipt");
  expect(() => writeReceipt(path, directory, { operation: "op", answer: "replace" })).toThrow();
  expect(readFileSync(path, "utf8")).toBe("corrupt existing receipt");
});

test("real timestamp observations use the proven comparison maximum and the pinned 48-bit ABI", () => {
  expect(decodeNat(encodeNat(Number(BEND_NAT_MAX)))).toBe(Number(BEND_NAT_MAX));
  expect(() => encodeNat(Number(BEND_NAT_MAX) + 1)).toThrow();
  expect(() => decodeNat(BEND_NAT_MAX + 1n)).toThrow();
  const observer = new VerifiedCompletionObserver(100);
  const evidence = { responsePresent: true, running: false, currentText: "final", completionActionVisible: true };
  const now = 1_790_000_000_000;
  expect(observer.update(evidence, now)).toBeFalse();
  expect(observer.update(evidence, now + 100)).toBeTrue();
  expect(() => observer.update(evidence, Number(BEND_NAT_MAX) + 1)).toThrow();
  expect(observer.update(evidence, now + 101)).toBeTrue();
});
