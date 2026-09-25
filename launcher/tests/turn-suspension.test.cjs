const test = require("node:test");
const assert = require("node:assert/strict");
const {
  refreshTurnLeasesAfterSuspension,
  shouldBlockSleepForTurns,
  sweepGapIndicatesSuspension,
} = require("../electron/turn-suspension.cjs");

// Suspension freezes both launcher sweeps and helper heartbeats. These tests pin wake-side lease
// re-baselining and sleep prevention without treating suspended time as helper failure.

test("a sweep gap of multiples of the interval is recognised as a suspension", () => {
  assert.equal(sweepGapIndicatesSuspension(1_000, 1_000 + 5_000 * 6, 5_000), true);
  assert.equal(sweepGapIndicatesSuspension(1_000, 1_000 + 15 * 60_000, 5_000), true);
});

test("ordinary sweep cadence and busy-loop jitter are not a suspension", () => {
  assert.equal(sweepGapIndicatesSuspension(1_000, 6_000, 5_000), false);
  assert.equal(sweepGapIndicatesSuspension(1_000, 1_000 + 5_000 * 6 - 1, 5_000), false);
  assert.equal(sweepGapIndicatesSuspension(undefined, 99_000, 5_000), false);
});

test("a suspension re-baselines running leases and restores an unfinished bootstrap budget", () => {
  const running = { status: "running", traceId: "aaa", bootstrapReady: true, lastHeartbeatAt: 5 };
  const booting = {
    status: "running", traceId: "bbb", bootstrapReady: false,
    lastHeartbeatAt: 5, bootstrapDeadlineAt: 10,
  };
  const retained = { status: "ready", traceId: "ccc", lastHeartbeatAt: 5 };

  const refreshed = refreshTurnLeasesAfterSuspension([running, booting, retained], 1_000_000, 120_000);

  assert.deepEqual(refreshed, ["aaa", "bbb"]);
  assert.equal(running.lastHeartbeatAt, 1_000_000);
  assert.equal(booting.bootstrapDeadlineAt, 1_120_000);
  // A retained tab holds no live helper; its idle TTL keeps counting through a sleep.
  assert.equal(retained.lastHeartbeatAt, 5);
});

test("sleep is blocked exactly while a turn is running", () => {
  assert.equal(shouldBlockSleepForTurns([]), false);
  assert.equal(shouldBlockSleepForTurns([{ status: "ready" }, { status: "error" }]), false);
  assert.equal(shouldBlockSleepForTurns([{ status: "ready" }, { status: "running" }]), true);
});
