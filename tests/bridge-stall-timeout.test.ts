import { expect, test } from "bun:test";
import { bridgeToResponsesSSE } from "../src/bridge";
import { DEFAULT_STALL_TIMEOUT_SEC, MAX_STALL_TIMEOUT_SEC, resolveStallTimeoutSec } from "../src/stall-timeout";
import type { AdapterEvent } from "../src/types";

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function bridged(events: AsyncGenerator<AdapterEvent>, heartbeatMs: number): ReadableStream<Uint8Array> {
  return bridgeToResponsesSSE(
    events,
    "chatgpt-web/test",
    undefined,
    undefined,
    undefined,
    undefined,
    heartbeatMs,
    { streamPlatform: "darwin" },
  );
}

test("upstream silence keeps the stream open for later real output", async () => {
  async function* silent(): AsyncGenerator<AdapterEvent> {
    await sleep(50);
    yield { type: "text_delta", text: "after silence" };
    yield { type: "done", endTurn: true };
  }

  const body = await new Response(bridged(silent(), 10)).text();

  expect(body).toContain("event: response.heartbeat");
  expect(body).toContain("after silence");
  expect(body).toContain("event: response.completed");
  expect(body).not.toContain("upstream_stall_timeout");
});

test("an adapter that keeps heartbeating is never cancelled, however long it takes", async () => {
  async function* thinkingHard(): AsyncGenerator<AdapterEvent> {
    // Ten times the stall budget elapses, and nothing but keep-alives crosses the boundary.
    for (let beat = 0; beat < 20; beat++) {
      await sleep(100);
      yield { type: "heartbeat" };
    }
    yield { type: "text_delta", text: "answer" };
    yield { type: "done", endTurn: true };
  }

  const body = await new Response(bridged(thinkingHard(), 10)).text();

  expect(body).not.toContain("upstream_stall_timeout");
  expect(body).toContain("answer");
  expect(body).toContain("event: response.completed");
});

test("the stall budget is configurable and falls back to the shipped default", () => {
  expect(resolveStallTimeoutSec(undefined)).toBe(DEFAULT_STALL_TIMEOUT_SEC);
  expect(resolveStallTimeoutSec(Number.NaN)).toBe(DEFAULT_STALL_TIMEOUT_SEC);
  expect(resolveStallTimeoutSec(900)).toBe(900);
  expect(resolveStallTimeoutSec(0)).toBe(1);
  expect(resolveStallTimeoutSec(Number.MAX_VALUE)).toBe(MAX_STALL_TIMEOUT_SEC);
  expect(resolveStallTimeoutSec(MAX_STALL_TIMEOUT_SEC + 1)).toBe(MAX_STALL_TIMEOUT_SEC);
});
