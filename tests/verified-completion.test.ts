import { expect, test } from "bun:test";
import { ChatGptMarkdownBuffer, type ChatGptMarkdownSegment } from "../src/adapters/chatgpt-web/markdown";
import { commitChatGptCompletion } from "../src/adapters/chatgpt-web/completion-publication";
import { VerifiedBroker } from "../src/verified/broker";

function segment(text: string, key = "answer", streamable = false): ChatGptMarkdownSegment {
  return { key, text, html: `<p>${text}</p>`, streamable };
}

test("serialization failure leaves both the output ledger and the actual Bend tool broker open", async () => {
  const broker = new VerifiedBroker("environment");
  const offered = broker.dispatch({ $: "BeginFence" });
  if (offered.$ !== "FenceOffered") throw new Error("Expected completion candidate");
  let fail = true;
  let fenceCalls = 0;
  const buffer = new ChatGptMarkdownBuffer(text => {
    if (text === "Second" && fail) throw new Error("serializer unavailable");
    return text;
  });
  buffer.observe([segment("First", "a"), segment("Second", "b")]);
  await expect(commitChatGptCompletion(buffer, "First Second", async () => {
    fenceCalls += 1;
    return broker.dispatch({ $: "CommitFence", revision: offered.revision }).$ === "FenceCommitted";
  })).rejects.toThrow("serializer unavailable");
  expect(fenceCalls).toBe(0);
  expect(broker.dispatch({ $: "Enqueue", id: "still-live", payload: "tool request" }).$).toBe("InvocationQueued");
  fail = false;
  expect(buffer.finish()).toEqual({ markdown: "First\n\nSecond", delta: "First\n\nSecond" });
});

test("a stale Bend fence does not consume the final tail before another tool observation", async () => {
  const broker = new VerifiedBroker("environment");
  const offered = broker.dispatch({ $: "BeginFence" });
  if (offered.$ !== "FenceOffered") throw new Error("Expected completion candidate");
  const buffer = new ChatGptMarkdownBuffer();
  buffer.observe([segment("Before tool")]);
  broker.dispatch({ $: "ClaimActivity", id: "new-tool" });
  expect(await commitChatGptCompletion(buffer, "Before tool", async () =>
    broker.dispatch({ $: "CommitFence", revision: offered.revision }).$ === "FenceCommitted",
  )).toBeUndefined();
  buffer.observe([segment("After tool")]);
  broker.dispatch({ $: "CompleteActivity", id: "new-tool" });
  const fresh = broker.dispatch({ $: "BeginFence" });
  if (fresh.$ !== "FenceOffered") throw new Error("Expected fresh completion candidate");
  expect(await commitChatGptCompletion(buffer, "After tool", async () =>
    broker.dispatch({ $: "CommitFence", revision: fresh.revision }).$ === "FenceCommitted",
  )).toEqual({ markdown: "After tool", delta: "After tool" });
  expect(buffer.finish()).toEqual({ markdown: "After tool", delta: "" });
});

test("unserializable visible text and a tool-rejection sentinel never close the tool fence", async () => {
  let fences = 0;
  const fence = async () => { fences += 1; return true; };
  const empty = new ChatGptMarkdownBuffer();
  await expect(commitChatGptCompletion(empty, "Visible but missing markup", fence)).rejects.toThrow("serialized as Markdown");
  const sentinel = new ChatGptMarkdownBuffer();
  sentinel.observe([segment("api_tool unavailable")]);
  await expect(commitChatGptCompletion(sentinel, "api_tool unavailable", fence)).rejects.toThrow("rejected the Codex Native");
  expect(fences).toBe(0);
});

test("a lost fence response leaves prepared output intact and re-encodes no text after commitment", async () => {
  let conversions = 0;
  const buffer = new ChatGptMarkdownBuffer(text => { conversions += 1; return text; });
  buffer.observe([segment("Answer")]);
  await expect(commitChatGptCompletion(buffer, "Answer", async () => { throw new Error("transport lost"); })).rejects.toThrow("transport lost");
  expect(await commitChatGptCompletion(buffer, "Answer", async () => {
    expect(conversions).toBe(2);
    return true;
  })).toEqual({ markdown: "Answer", delta: "Answer" });
  expect(conversions).toBe(2);
});

test("a streaming serialization failure cannot swallow a successfully encoded earlier block", () => {
  let fail = true;
  const buffer = new ChatGptMarkdownBuffer(text => {
    if (text === "Second" && fail) throw new Error("serializer unavailable");
    return text;
  }, 0);
  const parts = [segment("First", "a", true), segment("Second", "b", true)];
  expect(() => buffer.observe(parts, 0)).toThrow("serializer unavailable");
  fail = false;
  expect(buffer.observe(parts, 1)).toBe("First\n\nSecond");
  expect(buffer.finish()).toEqual({ markdown: "First\n\nSecond", delta: "" });
});

test("a prepared snapshot is single-use and cannot overwrite a newer observation", () => {
  const buffer = new ChatGptMarkdownBuffer();
  buffer.observe([segment("Old")]);
  const stale = buffer.prepareFinish();
  buffer.observe([segment("New")]);
  expect(() => stale.commit()).toThrow("obsolete");
  const fresh = buffer.prepareFinish();
  fresh.commit();
  fresh.commit();
  expect(buffer.finish()).toEqual({ markdown: "New", delta: "" });
});
