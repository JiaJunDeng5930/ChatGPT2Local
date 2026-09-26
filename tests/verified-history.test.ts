import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRequest } from "../src/responses/parser";
import { digest, WebHistoryStore } from "../src/verified/web-history";

const directories: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "bend-history-"));
  directories.push(root);
  return { root, store: new WebHistoryStore(root), scope: "native-thread" };
}
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });

function request(user: string, answer?: string, next?: string) {
  return parseRequest({ model: "chatgpt-web/high", input: [
    { role: "user", content: user },
    ...(answer === undefined ? [] : [{ role: "assistant", content: answer, phase: "final_answer" }]),
    ...(next === undefined ? [] : [{ role: "user", content: next }]),
  ] });
}

describe("Bend history selection through durable completion receipts", () => {
  test("a new process reuses only the confirmed prefix and returns the exact page witness", () => {
    const { root, store, scope } = fixture();
    const first = request("First question");
    const page = store.select(scope, "first", first);
    expect(page.offset).toBeUndefined();
    store.remember(scope, "first", page, first, "First answer");
    const next = new WebHistoryStore(root).select(scope, "second", request("First question", "First answer", "Next question"));
    expect(next).toEqual({ key: page.key, offset: 2, expectedOperation: "first", expectedAnswerDigest: digest("First answer") });
    // The filesystem receipt survives independently of any process-local cache.
    expect(JSON.parse(readFileSync(join(root, digest(scope), `${digest("first")}.json`), "utf8")).operation).toBe("first");
  });

  test("the chosen receipt cannot be replaced by another receipt with the same page key and length", () => {
    const { store, scope } = fixture();
    const [otherOperation, selectedOperation] = ["operation-a", "operation-b"].sort((a, b) => digest(a).localeCompare(digest(b)));
    const good = request("Selected question");
    const page = store.select(scope, selectedOperation!, good);
    // A migrated/imported store can contain different branches of one lineage.
    // Deliberately put the ineligible branch first in directory order.
    store.remember(scope, otherOperation!, page, request("Other question"), "Other answer");
    store.remember(scope, selectedOperation!, page, good, "Selected answer");
    expect(store.select(scope, "next", request("Selected question", "Selected answer", "Continue"))).toEqual({
      key: page.key, offset: 2, expectedOperation: selectedOperation, expectedAnswerDigest: digest("Selected answer"),
    });
  });

  test("an incompatible interpretation or edited prefix starts a distinct lineage without claiming old messages", () => {
    const { store, scope } = fixture();
    const first = request("Question");
    const page = store.select(scope, "first", first);
    store.remember(scope, "first", page, first, "Answer");
    const changed = request("Question", "Answer", "Next");
    changed.options.reasoning = "xhigh";
    const incompatible = store.select(scope, "changed-environment", changed);
    const edited = store.select(scope, "edited", request("Edited question", "Answer", "Next"));
    expect(incompatible.offset).toBeUndefined();
    expect(edited.offset).toBeUndefined();
    expect(incompatible.key).not.toBe(page.key);
    expect(edited.key).not.toBe(page.key);
  });

  test("a conflicting write cannot rewrite a completed receipt", () => {
    const { root, store, scope } = fixture();
    const first = request("Question");
    const page = store.select(scope, "first", first);
    store.remember(scope, "first", page, first, "Answer");
    const path = join(root, digest(scope), `${digest("first")}.json`);
    const before = readFileSync(path, "utf8");
    store.remember(scope, "first", page, first, "Answer");
    expect(() => store.remember(scope, "first", page, first, "Different answer")).toThrow("cannot rewrite");
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  test("wrong filename identity and partial JSON deny continuation rather than inventing a fresh history", () => {
    const { root, store, scope } = fixture();
    const first = request("Question");
    const page = store.select(scope, "first", first);
    store.remember(scope, "first", page, first, "Answer");
    const path = join(root, digest(scope), `${digest("first")}.json`);
    const receipt = JSON.parse(readFileSync(path, "utf8"));
    writeFileSync(path, JSON.stringify({ ...receipt, operation: "another-operation" }));
    expect(() => store.select(scope, "next", request("Question", "Answer", "Next"))).toThrow("durable filename");
    writeFileSync(path, "{");
    expect(() => store.select(scope, "next", request("Question", "Answer", "Next"))).toThrow();
  });
});
