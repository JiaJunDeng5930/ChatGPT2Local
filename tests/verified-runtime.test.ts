import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decide, historyOffset, type Phase } from "../src/verified/core";
import { phases, events } from "../src/verified/generated/core.cjs";
import { SubmissionJournal, SubmissionOutcomeUnknownError } from "../src/verified/submission-journal";

const directories: string[] = [];
function temporary(): string {
  const path = mkdtempSync(join(tmpdir(), "bend-web-"));
  directories.push(path);
  return path;
}
function planned(root: string, operation: string, definition = operation, payloads = ["prompt"]): SubmissionJournal {
  const journal = new SubmissionJournal(root, operation, definition);
  journal.acquire();
  journal.configurePlan(payloads);
  return journal;
}
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe("stable physical submission identity", () => {
  const nativeTurn = "c".repeat(64);
  const firstConfiguration = `${"a".repeat(64)}:${nativeTurn}`;
  const nextConfiguration = `${"b".repeat(64)}:${nativeTurn}`;

  test("changing configuration cannot acquire another allowance for the same native turn", () => {
    const root = temporary();
    const first = planned(root, firstConfiguration, "same user revision");
    first.authorizeSend();
    const next = new SubmissionJournal(root, nextConfiguration, "same user revision");
    expect(next.directory).toBe(first.directory);
    expect(() => next.recover()).toThrow(SubmissionOutcomeUnknownError);
    expect(() => next.acquire()).toThrow(SubmissionOutcomeUnknownError);
  });

  test("a completed result remains replayable after a configuration change", () => {
    const root = temporary();
    const first = planned(root, firstConfiguration, "same user revision");
    first.authorizeSend();
    first.complete("already paid for");
    const next = new SubmissionJournal(root, nextConfiguration, "same user revision");
    expect(next.recover()).toEqual({ type: "completed", answer: "already paid for" });
    expect(() => next.acquire()).toThrow(SubmissionOutcomeUnknownError);
  });

  function legacy(root: string, operation: string): string {
    const directory = join(root, createHash("sha256").update(operation).digest("hex"));
    mkdirSync(directory);
    writeFileSync(join(directory, "owner.json"), JSON.stringify({
      version: 1, operation, definition: "same user revision", reservation: "old writer",
    }));
    return directory;
  }

  test("a previous migration's configuration-scoped owner still forbids a new send", () => {
    const root = temporary();
    legacy(root, firstConfiguration);
    const next = new SubmissionJournal(root, nextConfiguration, "same user revision");
    expect(() => next.recover()).toThrow(SubmissionOutcomeUnknownError);
    expect(() => next.acquire()).toThrow(SubmissionOutcomeUnknownError);
  });

  test("a legacy completed receipt replays read-only without rewriting its evidence", () => {
    const root = temporary();
    const directory = legacy(root, firstConfiguration);
    const encoded = JSON.stringify({ version: 1, operation: firstConfiguration,
      definition: "same user revision", answer: "legacy completion" });
    writeFileSync(join(directory, "final.json"), encoded);
    const next = new SubmissionJournal(root, nextConfiguration, "same user revision");
    expect(next.recover()).toEqual({ type: "completed", answer: "legacy completion" });
    expect(readFileSync(join(directory, "final.json"), "utf8")).toBe(encoded);
  });

  test("multiple legacy owners require reconciliation rather than choosing a winner", () => {
    const root = temporary();
    legacy(root, firstConfiguration);
    legacy(root, nextConfiguration);
    expect(() => new SubmissionJournal(root, firstConfiguration, "same user revision").recover())
      .toThrow(SubmissionOutcomeUnknownError);
  });
});

describe("production Bend decisions", () => {
  test("all foreign enum values are decoded before entering compiled code", () => {
    expect(() => decide("Bogus" as Phase, "UserCancel")).toThrow("Invalid value");
    expect(() => decide("Running", "Bogus" as never)).toThrow("Invalid value");
  });

  test("exhaustive reachable-state exploration never mints a second send", () => {
    const pending: Array<{ phase: Phase; sends: number }> = [{ phase: "Fresh", sends: 0 }];
    const seen = new Set<string>();
    while (pending.length) {
      const current = pending.pop()!;
      const key = `${current.phase}:${current.sends}`;
      if (seen.has(key)) continue;
      seen.add(key);
      for (const event of events) {
        const result = decide(current.phase, event);
        const sends = current.sends + Number(result.effect === "SendPrompt");
        expect(sends).toBeLessThanOrEqual(1);
        if (result.effect === "StopByUser") expect(event).toBe("UserCancel");
        pending.push({ phase: result.phase, sends });
      }
    }
    expect(seen.has("Completed:1")).toBe(true);
  });

  test("unknown observations, disconnects and recovery cannot send or stop", () => {
    for (const phase of phases) {
      for (const event of ["Uncertain", "Detach", "Recover", "Attach"] as const) {
        const decision = decide(phase, event);
        expect(["SendPrompt", "StopByUser"]).not.toContain(decision.effect);
      }
      expect(decide(phase, "Detach")).toEqual({ phase, effect: "NoEffect" });
    }
    expect(decide("Unknown", "Finished")).toEqual({ phase: "Completed", effect: "PublishFinal" });
  });

  test("history is an exact confirmed prefix including its interpretation environment", () => {
    expect(historyOffset("a", "a", ["u1", "a1"], ["u1", "a1", "u2"])).toBe(2);
    expect(historyOffset("a", "a", ["u1", "a1"], ["different", "a1", "u2"])).toBeUndefined();
    expect(historyOffset("a", "b", ["u1"], ["u1", "u2"])).toBeUndefined();
    expect(historyOffset("a", "a", ["u1", "a1"], ["u1"])).toBeUndefined();
    expect(historyOffset("a", "a", [], ["u1"])).toBe(0);
    expect(historyOffset("a", "a", ["中文🙂"], ["中文🙂", "next"])).toBe(1);
    expect(historyOffset("a", "a", ["ab", "c"], ["a", "bc"])).toBeUndefined();
  });
});

describe("durable send effect boundary", () => {
  test("intent is committed before dispatch and a second interpreter cannot acquire it", () => {
    const root = temporary();
    const first = new SubmissionJournal(root, "turn", "definition");
    const second = new SubmissionJournal(root, "turn", "definition");
    expect(first.recover()).toEqual({ type: "fresh" });
    expect(second.recover()).toEqual({ type: "fresh" });
    first.acquire();
    expect(() => second.acquire()).toThrow(SubmissionOutcomeUnknownError);
    first.configurePlan(["prompt"]);
    first.authorizeSend();
    const receipt = JSON.parse(readFileSync(join(first.directory, "intent-0.json"), "utf8"));
    expect(receipt.decision).toEqual({ phase: "Attempted", effect: "SendPrompt" });
    expect(() => second.authorizeSend()).toThrow(SubmissionOutcomeUnknownError);
    expect(() => first.authorizeSend()).toThrow(SubmissionOutcomeUnknownError);
  });

  test("crash after intent, lost acknowledgment, and partial writes are unknown, never retries", () => {
    const root = temporary();
    const turn = planned(root, "turn");
    turn.authorizeSend();
    expect(() => new SubmissionJournal(root, "turn").recover()).toThrow(SubmissionOutcomeUnknownError);
    turn.accepted();
    turn.uncertain();
    expect(() => turn.authorizeSend()).toThrow(SubmissionOutcomeUnknownError);
    writeFileSync(join(turn.directory, "intent-0.json"), "{");
    expect(() => new SubmissionJournal(root, "turn").recover()).toThrow(SubmissionOutcomeUnknownError);
  });

  test("a committed final answer replays without acquiring a send permission", () => {
    const root = temporary();
    const turn = planned(root, "turn", "revision1");
    turn.authorizeSend();
    turn.accepted();
    turn.complete("answer");
    expect(new SubmissionJournal(root, "turn", "revision1").recover()).toEqual({ type: "completed", answer: "answer" });
    expect(() => new SubmissionJournal(root, "turn", "revision2").recover()).toThrow("Corrupt submission receipt");
  });

  test("only an acknowledged multipart stage permits the next distinct stage", () => {
    const root = temporary();
    const turn = planned(root, "multipart", "multipart", ["first", "final"]);
    turn.authorizeSend();
    turn.accepted();
    expect(() => turn.authorizeSend()).toThrow(SubmissionOutcomeUnknownError);
    turn.acknowledgeStage(1);
    turn.authorizeSend();
    expect(JSON.parse(readFileSync(join(turn.directory, "intent-1.json"), "utf8")).stage).toBe("1");
    turn.complete("final");
    expect(new SubmissionJournal(root, "multipart").recover()).toEqual({ type: "completed", answer: "final" });
  });

  test("late completion cannot override explicit cancellation", () => {
    const root = temporary();
    const turn = planned(root, "turn");
    turn.authorizeSend();
    expect(turn.cancelByUser()).toBe(true);
    expect(turn.cancelByUser()).toBe(false);
    expect(() => turn.complete("late")).toThrow("no active submission");
    expect(() => new SubmissionJournal(root, "turn").recover()).toThrow(SubmissionOutcomeUnknownError);
  });

  test("failed intent persistence never authorizes an effect", () => {
    const root = temporary();
    const turn = planned(root, "turn");
    mkdirSync(join(turn.directory, "intent-0.json"), { recursive: true });
    expect(() => turn.authorizeSend()).toThrow();
    expect(() => turn.authorizeSend()).toThrow(SubmissionOutcomeUnknownError);
    expect(() => new SubmissionJournal(root, "turn").recover()).toThrow(SubmissionOutcomeUnknownError);
  });

  test("the finite plan cannot be reset, acknowledged out of order, or extended", () => {
    const root = temporary();
    const turn = planned(root, "finite", "finite", ["first", "last"]);
    expect(() => turn.configurePlan(["replacement"])).toThrow("only once");
    expect(() => turn.acknowledgeStage(1)).toThrow("Bend rejected");
    turn.authorizeSend();
    expect(() => turn.complete("too soon")).toThrow("Bend rejected");
    expect(() => turn.acknowledgeStage(2)).toThrow("Bend rejected");
    turn.acknowledgeStage(1);
    expect(() => turn.acknowledgeStage(1)).toThrow("Bend rejected");
    turn.authorizeSend();
    expect(() => turn.acknowledgeStage(2)).toThrow("Bend rejected");
    turn.complete("done");
    expect(turn.cancelByUser()).toBe(false);
    expect(new SubmissionJournal(root, "finite").recover()).toEqual({ type: "completed", answer: "done" });
  });

  test("cancellation before preparation cannot be resurrected by installing a plan", () => {
    const root = temporary();
    const turn = new SubmissionJournal(root, "cancel-before-plan");
    expect(turn.cancelByUser()).toBe(false);
    expect(() => turn.configurePlan(["late"])).toThrow("only once");
    expect(() => turn.authorizeSend()).toThrow(SubmissionOutcomeUnknownError);
    expect(() => new SubmissionJournal(root, "cancel-before-plan").recover()).toThrow(SubmissionOutcomeUnknownError);
  });

  test("an unclaimed interpreter cannot prepare or send, even before another process creates intent", () => {
    const root = temporary();
    const first = new SubmissionJournal(root, "reserved");
    expect(() => first.configurePlan(["prompt"])).toThrow("only once");
    expect(() => first.authorizeSend()).toThrow(SubmissionOutcomeUnknownError);
    first.acquire();
    expect(() => first.acquire()).toThrow(SubmissionOutcomeUnknownError);
    expect(() => new SubmissionJournal(root, "reserved").recover()).toThrow(SubmissionOutcomeUnknownError);
    first.configurePlan(["prompt"]);
    first.authorizeSend();
    expect(readFileSync(join(first.directory, "owner.json"), "utf8")).toContain('"operation":"reserved"');
  });
});
