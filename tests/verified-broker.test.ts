import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultBrokerEndpoint } from "../src/config";
import { TurnBroker, callTurnBroker } from "../src/adapters/chatgpt-web/turn-broker";
import { VerifiedBroker, brokerIds } from "../src/verified/broker";
import { encodeList } from "../src/verified/core";
import * as bend from "../src/verified/generated/core.cjs";

const roots: string[] = [];
const brokers: TurnBroker[] = [];
afterEach(async () => {
  for (const broker of brokers.splice(0)) await broker.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "bend-broker-"));
  roots.push(root);
  const socket = defaultBrokerEndpoint(root);
  const broker = TurnBroker.forSocket(socket);
  brokers.push(broker);
  const token = await broker.register({
    cwd: root, roots: [root], writableRoots: [root],
    sandboxPolicy: { type: "workspaceWrite", writableRoots: [root], networkAccess: false }, tools: [],
  }, "verified-broker");
  const activityId = "activity_0123456789abcdef";
  const { bindingId } = await callTurnBroker<{ bindingId: string }>(socket, { method: "claim", token, activityId });
  return { socket, broker, token, activityId, bindingId };
}

test("Bend fences both request leases and invocations, not only their revision", () => {
  const owner = new VerifiedBroker("environment");
  expect(owner.dispatch({ $: "BeginFence" })).toEqual({ $: "FenceOffered", revision: 0n });
  expect(owner.dispatch({ $: "ClaimActivity", id: "a" }).$).toBe("ActivityClaimed");
  expect(owner.dispatch({ $: "Enqueue", id: "c", payload: "payload" }).$).toBe("InvocationQueued");
  expect(owner.dispatch({ $: "CompleteActivity", id: "a" })).toEqual({ $: "ActivityClosed", was_active: true });
  // Even an exactly guessed current revision cannot seal an outstanding call.
  expect(owner.dispatch({ $: "CommitFence", revision: 3n }).$).toBe("FenceStale");
  expect(owner.dispatch({ $: "CompleteCall", id: "c", digest: "result" })).toEqual({ $: "Reject", reason: { $: "CallNotDelivered" } });
  const delivery = owner.dispatch({ $: "Poll" });
  expect(delivery.$).toBe("CallsDelivered");
  expect(owner.dispatch({ $: "CompleteCall", id: "c", digest: "result" }).$).toBe("ResultAccepted");
  expect(owner.dispatch({ $: "BeginFence" })).toEqual({ $: "FenceOffered", revision: 4n });
  expect(owner.dispatch({ $: "CommitFence", revision: 3n }).$).toBe("FenceStale");
  expect(owner.dispatch({ $: "CommitFence", revision: 4n }).$).toBe("FenceCommitted");
  expect(owner.dispatch({ $: "Enqueue", id: "late", payload: "payload" })).toEqual({ $: "Reject", reason: { $: "OwnerClosed" } });
  expect(owner.dispatch({ $: "ClaimActivity", id: "late" })).toEqual({ $: "Reject", reason: { $: "OwnerClosed" } });
});

test("Bend closes only the named obligation and never overwrites other results", () => {
  const owner = new VerifiedBroker("environment");
  for (const id of ["a", "b"]) owner.dispatch({ $: "ClaimActivity", id });
  for (const id of ["x", "y"]) owner.dispatch({ $: "Enqueue", id, payload: id });
  const delivery = owner.dispatch({ $: "Poll" });
  if (delivery.$ !== "CallsDelivered") throw new Error("Expected a delivery");
  expect(brokerIds(delivery.ids)).toEqual(["x", "y"]);
  owner.dispatch({ $: "CompleteCall", id: "x", digest: "result-x" });
  owner.dispatch({ $: "CompleteActivity", id: "a" });
  expect(owner.dispatch({ $: "BeginFence" }).$).toBe("FenceUnavailable");
  const replay = owner.dispatch({ $: "Poll" });
  if (replay.$ !== "CallsReplayed") throw new Error("Expected an exact outstanding delivery replay");
  expect(brokerIds(replay.ids)).toEqual(["y"]);
  expect(owner.dispatch({ $: "CompleteCall", id: "x", digest: "result-x" }).$).toBe("ResultReplayed");
  expect(owner.dispatch({ $: "CompleteCall", id: "x", digest: "other" })).toEqual({ $: "Reject", reason: { $: "ConflictingResult" } });
  owner.dispatch({ $: "CompleteCall", id: "y", digest: "result-y" });
  expect(owner.dispatch({ $: "BeginFence" }).$).toBe("FenceUnavailable");
  owner.dispatch({ $: "CompleteActivity", id: "b" });
  expect(owner.dispatch({ $: "BeginFence" }).$).toBe("FenceOffered");
});

test("a lost claim receipt cannot resurrect a completed activity", () => {
  const owner = new VerifiedBroker("environment");
  expect(owner.dispatch({ $: "CompleteActivity", id: "late" })).toEqual({ $: "ActivityClosed", was_active: false });
  expect(owner.dispatch({ $: "CompleteActivity", id: "late" }).$).toBe("ActivityReceiptReplayed");
  expect(owner.dispatch({ $: "ClaimActivity", id: "late" })).toEqual({ $: "Reject", reason: { $: "ActivityAlreadyCompleted" } });
  expect(owner.dispatch({ $: "BeginFence" })).toEqual({ $: "FenceOffered", revision: 1n });
  expect(owner.dispatch({ $: "CheckEnvironment", environment: "changed" })).toEqual({ $: "Reject", reason: { $: "EnvironmentChanged" } });
});

test("the exported finite iterator is exactly the production step sequence", () => {
  const events: bend.BrokerEvent[] = [
    { $: "ClaimActivity", id: "a" }, { $: "Enqueue", id: "c", payload: "中文🙂" },
    { $: "BeginFence" }, { $: "Poll" }, { $: "Poll" },
    { $: "CompleteCall", id: "c", digest: "r" }, { $: "CompleteActivity", id: "a" },
    { $: "CommitFence", revision: 4n }, { $: "Retire" }, { $: "Enqueue", id: "c2", payload: "late" },
  ];
  let state = bend.brokerInitialize("env");
  const decisions = events.map(event => {
    const decision = bend.brokerStep(state, event);
    state = decision.state;
    return decision;
  });
  expect(bend.brokerRun(encodeList(events), bend.brokerInitialize("env"))).toEqual(encodeList(decisions));
  expect(decisions.at(-1)?.effect).toEqual({ $: "Reject", reason: { $: "OwnerClosed" } });
});

test("foreign broker events cannot reach the compiler's constructor fallback", () => {
  const owner = new VerifiedBroker("environment");
  for (const event of [{ $: "Unknown" }, { $: "CommitFence", revision: -1n },
    { $: "CommitFence", revision: 3 }, { $: "Enqueue", id: "x", payload: undefined },
    { $: "CompleteCall", id: "", digest: "r" }]) {
    expect(() => owner.dispatch(event as never)).toThrow();
  }
  expect(owner.dispatch({ $: "BeginFence" })).toEqual({ $: "FenceOffered", revision: 0n });
});

test("an already bound socket cannot invoke a tool after browser completion is sealed", async () => {
  const { socket, broker, token, activityId, bindingId } = await fixture();
  await callTurnBroker(socket, { method: "activity_complete", token, activityId });
  const revision = broker.beginCompletionFence(token)!;
  expect(broker.commitCompletionFence(token, revision)).toBeTrue();
  await expect(callTurnBroker(socket, { method: "invoke", bindingId, wireName: "must_not_run", arguments: {} }))
    .rejects.toThrow("already finished");
  expect(broker.beginCompletionFence(token)).toBe(revision);
  await expect(callTurnBroker(socket, { method: "claim", token, activityId: "activity_fedcba9876543210" }))
    .rejects.toThrow("already finished");
});

test("lost result acknowledgements replay without native reexecution or duplicate promise settlement", async () => {
  const { socket, broker, token, activityId, bindingId } = await fixture();
  const invoking = callTurnBroker(socket, { method: "invoke", bindingId, wireName: "example", arguments: { value: 1 } }, null);
  void invoking.catch(() => {});
  const [call] = await broker.nextToolBatch(token);
  expect(call).toBeDefined();
  const result = { content: [{ type: "text", text: "done" }], isError: false };
  broker.completeTool(token, call!.callId, result);
  expect(await invoking).toEqual(result);
  // Property order is not another tool result. The result's semantic bytes are.
  expect(() => broker.completeTool(token, call!.callId, { isError: false, content: result.content })).not.toThrow();
  expect(() => broker.completeTool(token, call!.callId, { content: [{ type: "text", text: "different" }] })).toThrow("conflicting result");
  await callTurnBroker(socket, { method: "activity_complete", token, activityId });
  expect(broker.commitCompletionFence(token, broker.beginCompletionFence(token)!)).toBeTrue();
  expect(() => broker.completeTool(token, call!.callId, result)).not.toThrow();
});

test("mutating an observer's request cannot change an at-least-once delivery replay", async () => {
  const { socket, broker, token, bindingId } = await fixture();
  const invoking = callTurnBroker(socket, { method: "invoke", bindingId, wireName: "example", arguments: { nested: { value: 1 } } }, null);
  void invoking.catch(() => {});
  const [call] = await broker.nextToolBatch(token);
  (call!.arguments!.nested as { value: number }).value = 99;
  call!.wireName = "mutated";
  const [replayed] = await broker.nextToolBatch(token);
  expect(replayed).toMatchObject({ callId: call!.callId, wireName: "example", arguments: { nested: { value: 1 } } });
  broker.completeTool(token, call!.callId, { content: [] });
  await invoking;
});
