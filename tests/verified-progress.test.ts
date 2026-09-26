import { expect, test } from "bun:test";
import { ChatGptExternalTurnProgress, ChatGptMirroredTurnProgress } from "../src/adapters/chatgpt-web/turn-progress";
import { VerifiedProgress } from "../src/verified/progress";
import { encodeList } from "../src/verified/core";
import { BEND_NAT_MAX } from "../src/verified/boundary";
import * as bend from "../src/verified/generated/core.cjs";

test("invalid progress inputs leave no partially updated active calls, timestamps or revisions", () => {
  const progress = new ChatGptExternalTurnProgress();
  const empty = progress.snapshot();
  for (const time of [NaN, Infinity, -1, 0.5]) {
    expect(() => progress.recordToolBatch(1, time)).toThrow();
    expect(progress.snapshot()).toEqual(empty);
  }
  expect(() => progress.recordToolBatch(0, 10)).toThrow("non-empty");
  expect(progress.snapshot()).toEqual(empty);
  progress.recordToolBatch(1, 10);
  const active = progress.snapshot();
  expect(() => progress.recordToolResult(Infinity)).toThrow();
  expect(progress.snapshot()).toEqual(active);
  progress.recordToolResult(11);
  expect(progress.snapshot().activeToolCalls).toBe(0);
});

test("a progress result's revision cannot stand in for an actual tool-batch boundary", async () => {
  const progress = new ChatGptExternalTurnProgress();
  progress.recordToolBatch(1, 100);
  progress.recordToolResult(101);
  const nextBatch = progress.recordToolBatch(1, 102);
  expect(nextBatch).toBe(3);
  const before = progress.snapshot();
  await expect(progress.acknowledgeToolBatch(2)).rejects.toThrow("invalid batch revision");
  await expect(progress.waitForToolBatchObservation(2)).rejects.toThrow("invalid batch revision");
  expect(progress.snapshot()).toEqual(before);
  const waiting = progress.waitForToolBatchObservation(nextBatch);
  await progress.acknowledgeToolBatch(nextBatch);
  await waiting;
});

test("a wall-clock rollback does not rewind proven activity or break replica ingestion", () => {
  const progress = new ChatGptExternalTurnProgress();
  const mirror = new ChatGptMirroredTurnProgress();
  progress.recordToolBatch(1, 1_000);
  mirror.apply(progress.snapshot());
  progress.recordToolResult(500);
  expect(progress.snapshot()).toEqual({ revision: 2, lastToolBatchRevision: 1, activeToolCalls: 0, lastProgressAt: 1_000 });
  expect(mirror.apply(progress.snapshot())).toBeTrue();
  expect(mirror.snapshot()).toEqual(progress.snapshot());
});

test("wire integer exhaustion is rejected before committing a progress transition", () => {
  const progress = new ChatGptExternalTurnProgress();
  progress.recordToolBatch(Number(BEND_NAT_MAX), 1);
  const before = progress.snapshot();
  expect(() => progress.recordToolBatch(1, 2)).toThrow("wire integer boundary");
  expect(progress.snapshot()).toEqual(before);
});

test("out-of-order asynchronous boundary acknowledgements cannot rewind the replica receipt", async () => {
  const pending = new Map<number, () => void>();
  const sent: number[] = [];
  const mirror = new ChatGptMirroredTurnProgress(revision => {
    sent.push(revision);
    return new Promise<void>(resolve => { pending.set(revision, resolve); });
  });
  mirror.apply({ revision: 1, lastToolBatchRevision: 1, activeToolCalls: 1, lastProgressAt: 100 });
  const first = mirror.acknowledgeToolBatch(1);
  mirror.apply({ revision: 2, lastToolBatchRevision: 2, activeToolCalls: 2, lastProgressAt: 101 });
  const second = mirror.acknowledgeToolBatch(2);
  pending.get(2)!();
  await second;
  pending.get(1)!();
  await first;
  const replay = mirror.acknowledgeToolBatch(2);
  expect(sent).toEqual([1, 2]);
  await replay;
});

test("a lost boundary acknowledgement is retryable observation, not a tool or web resend", async () => {
  let deliveries = 0;
  const mirror = new ChatGptMirroredTurnProgress(() => {
    if (++deliveries === 1) throw new Error("receipt lost");
  });
  const frame = { revision: 1, lastToolBatchRevision: 1, activeToolCalls: 1, lastProgressAt: 100 };
  mirror.apply(frame);
  await expect(mirror.acknowledgeToolBatch(1)).rejects.toThrow("receipt lost");
  expect(mirror.snapshot()).toEqual(frame);
  await mirror.acknowledgeToolBatch(1);
  await mirror.acknowledgeToolBatch(1);
  expect(deliveries).toBe(2);
  expect(mirror.snapshot()).toEqual(frame);
});

test("one progress revision has immutable contents, including its active-call count", () => {
  const mirror = new ChatGptMirroredTurnProgress();
  const frame = { revision: 1, lastToolBatchRevision: 1, activeToolCalls: 1, lastProgressAt: 100 };
  mirror.apply(frame);
  expect(() => mirror.apply({ ...frame, activeToolCalls: 0 })).toThrow("conflicting bytes");
  expect(mirror.snapshot()).toEqual(frame);
  expect(mirror.apply(frame)).toBeFalse();
});

test("recorder and replica authority are distinct and retirement never manufactures progress", async () => {
  const recorder = new VerifiedProgress("Recorder");
  const replica = new VerifiedProgress("Replica");
  expect(recorder.dispatch({ $: "Import", snapshot: { $: "Snapshot", revision: 1n, batch: 1n, active: 1n, time: { $: "Some", value: 1n } } }))
    .toEqual({ $: "Reject", reason: { $: "WrongRole" } });
  expect(replica.dispatch({ $: "RecordBatch", count: 1n, now: 1n })).toEqual({ $: "Reject", reason: { $: "WrongRole" } });
  const progress = new ChatGptExternalTurnProgress();
  const revision = progress.recordToolBatch(2, 100);
  const waiting = progress.waitForToolBatchObservation(revision);
  void waiting.catch(() => {});
  const error = new Error("capability retired");
  expect(progress.retire(error)).toBeTrue();
  expect(progress.snapshot()).toEqual({ revision: 2, lastToolBatchRevision: 1, activeToolCalls: 0, lastProgressAt: 100 });
  await expect(waiting).rejects.toBe(error);
  expect(progress.retire(new Error("duplicate"))).toBeFalse();
  expect(() => progress.recordToolBatch(1, 200)).toThrow("capability retired");
});

test("finite progress traces use the same transition function as production dispatch", () => {
  const events: bend.ProgressEvent[] = [{ $: "RecordBatch", count: 2n, now: 100n }, { $: "Acknowledge", revision: 1n },
    { $: "RecordResult", now: 50n }, { $: "RecordResult", now: 110n }, { $: "Retire" }, { $: "RecordBatch", count: 1n, now: 111n }];
  let state = bend.progressInitialize({ $: "Recorder" });
  const decisions = events.map(event => {
    const decision = bend.progressStep(state, event);
    state = decision.state;
    return decision;
  });
  expect(bend.progressRun(encodeList(events), bend.progressInitialize({ $: "Recorder" }))).toEqual(encodeList(decisions));
  expect(decisions.at(-1)?.effect).toEqual({ $: "Reject", reason: { $: "OwnerRetired" } });
});
