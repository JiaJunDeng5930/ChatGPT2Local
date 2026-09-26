import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import type { Locator } from "playwright-core";
import { ChatGptBrowserWorker, ChatGptCompletionTracker, ChatGptVisibleTraceTracker, CHATGPT_COMPLETION_SETTLE_MS } from "../src/adapters/chatgpt-web/browser-worker";
import { ChatGptMarkdownBuffer, type ChatGptMarkdownSegment } from "../src/adapters/chatgpt-web/markdown";

const powerCompleteHtml = readFileSync(new URL("./fixtures/chatgpt-power-complete.html", import.meta.url), "utf8");
const powerStreamingHtml = readFileSync(new URL("./fixtures/chatgpt-power-streaming.html", import.meta.url), "utf8");
const powerActivityHtml = readFileSync(new URL("./fixtures/chatgpt-power-activity.html", import.meta.url), "utf8");
const activitySummariesHtml = readFileSync(new URL("./fixtures/chatgpt-activity-summaries.html", import.meta.url), "utf8");
type Snapshot = {
  responsePresent: boolean;
  visibleText: string;
  fullHtml: string;
  markdownSegments: ChatGptMarkdownSegment[];
  completionActionVisible: boolean;
  traceBlocks: { kind: "answer" | "commentary" | "status"; text: string }[];
};

// Execute the production page callback, with only missing Domino browser APIs supplied.
async function snapshot(html: string): Promise<Snapshot> {
  const { createWindow } = require("@mixmark-io/domino");
  const window = createWindow(html);
  const innerText = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, "innerText");
  const append = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, "append");
  const querySelector = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, "querySelector");
  const dominoQuerySelector = window.HTMLElement.prototype.querySelector;
  Object.defineProperty(window.HTMLElement.prototype, "innerText", {
    configurable: true, get() { return this.textContent; },
  });
  Object.defineProperty(window.HTMLElement.prototype, "append", {
    configurable: true, value(this: HTMLElement, ...nodes: Node[]) { nodes.forEach(node => this.appendChild(node)); },
  });
  Object.defineProperty(window.HTMLElement.prototype, "querySelector", {
    configurable: true,
    value: function (this: HTMLElement, selector: string) {
      return dominoQuerySelector.call(this, selector) ?? null;
    },
  });
  const collections = [window.document.querySelectorAll("div"), window.document.body.children].map(Object.getPrototypeOf);
  const iterators = collections.map(prototype => Object.getOwnPropertyDescriptor(prototype, Symbol.iterator));
  for (const prototype of collections) Object.defineProperty(prototype, Symbol.iterator, {
    configurable: true, value: Array.prototype[Symbol.iterator],
  });
  try {
    const context = createContext({
      document: window.document, HTMLElement: window.HTMLElement, Element: window.Element,
      Node: window.Node, NodeFilter: window.NodeFilter, performance: { timeOrigin: 1 },
      getComputedStyle: (element: HTMLElement) => ({
        display: element.style.display || "block", visibility: "visible", opacity: "1",
      }),
      MutationObserver: class { observe() {} },
    });
    const errors: unknown[] = [];
    const locator = {
      evaluate: async (callback: Function, options: unknown) => {
        try { return runInContext(`(${callback.toString()})`, context)(window.document.getElementById("turn"), options); }
        catch (error) { errors.push(error); throw error; }
      },
      page: () => ({ isClosed: () => false }),
    } as unknown as Locator;
    const worker = Object.create(ChatGptBrowserWorker.prototype) as {
      responseDomSnapshot(locator: Locator): Promise<Snapshot>;
    };
    const result = await worker.responseDomSnapshot(locator);
    expect(errors).toEqual([]);
    return result;
  } finally {
    collections.forEach((prototype, index) => {
      if (iterators[index]) Object.defineProperty(prototype, Symbol.iterator, iterators[index]!);
      else delete prototype[Symbol.iterator];
    });
    if (innerText) Object.defineProperty(window.HTMLElement.prototype, "innerText", innerText);
    else delete window.HTMLElement.prototype.innerText;
    if (append) Object.defineProperty(window.HTMLElement.prototype, "append", append);
    else delete window.HTMLElement.prototype.append;
    if (querySelector) Object.defineProperty(window.HTMLElement.prototype, "querySelector", querySelector);
    else delete window.HTMLElement.prototype.querySelector;
  }
}

test("captured power UI excludes the user footer during streaming and completes the assistant answer", async () => {
  // Captured from the same live DEV turn on 2026-09-25. The user already has Copy/Share
  // controls while the assistant streams; both live under one data-turn-key.
  const streaming = await snapshot(powerStreamingHtml);
  expect(streaming.visibleText).toContain("How a Rainbow Begins");
  expect(streaming.visibleText).not.toContain("No tools or apps");
  expect(streaming.completionActionVisible).toBeFalse();
  const complete = await snapshot(powerCompleteHtml);
  expect(complete.visibleText).toEndWith("STREAM_END_927");
  expect(complete.completionActionVisible).toBeTrue();
  const buffer = new ChatGptMarkdownBuffer();
  buffer.observe(complete.markdownSegments, 0);
  const markdown = buffer.finish().markdown;
  expect(markdown).toContain("## How a Rainbow Begins");
  expect(markdown).toContain("1. Sunlight enters the droplet and refracts.");
  expect(markdown).toEndWith("STREAM\\_END\\_927");
  const translated = await snapshot(powerCompleteHtml.replaceAll('aria-label="Copy"', 'aria-label="복사"'));
  expect(translated.completionActionVisible).toBeTrue();
  const noAssistant = await snapshot(powerCompleteHtml.replaceAll('data-conversation-role="assistant"', 'data-conversation-role="user"'));
  expect(noAssistant.visibleText).toBe("");
  expect(noAssistant.completionActionVisible).toBeFalse();
  const userMarkdown = await snapshot(powerCompleteHtml.replace('data-user-message-bubble="true">',
    'data-user-message-bubble="true"><div class="markdown">USER CONTENT</div>'));
  expect(userMarkdown.visibleText).toBe(complete.visibleText);
});

test("captured power response keeps its Markdown ledger through final rendering", async () => {
  const streaming = await snapshot(powerStreamingHtml);
  const complete = await snapshot(powerCompleteHtml);
  const buffer = new ChatGptMarkdownBuffer(markdown => markdown, 0);
  buffer.observe(streaming.markdownSegments, 0);
  buffer.observe(complete.markdownSegments, 1000);
  expect(buffer.currentSnapshotIsConsistent()).toBeTrue();
  expect(buffer.finish().markdown).toEndWith("STREAM\\_END\\_927");
});


test("captured Activity progress is commentary before any assistant answer exists", async () => {
  const progress = await snapshot(powerActivityHtml);
  expect(progress.responsePresent).toBeTrue();
  expect(progress.markdownSegments).toEqual([]);
  expect(progress.completionActionVisible).toBeFalse();
  expect(progress.traceBlocks.filter(block => block.kind === "commentary").map(block => block.text)).toEqual(["Text 5\nText 6\nText 4\nText 8"]);
  const marker = '<span hidden="" data-chatgpt-agent-turn-start="">\n</span>';
  expect(powerActivityHtml).toContain(marker);
  const combined = powerActivityHtml.replace(marker, marker + '<div data-content-search-unit-key="answer"><h4 data-conversation-role="assistant"></h4><div data-markdown-text-style="assistant-message"><p>Final answer.</p></div></div>');
  const answer = await snapshot(combined);
  expect(answer.visibleText).toBe("Final answer.");
  expect(answer.traceBlocks.some(block => block.kind === "commentary")).toBeTrue();
});

test("captured activity summaries use the status stream and keep actual commentary and answers separate", async () => {
  const result = await snapshot(activitySummariesHtml);
  expect(result.visibleText).toBe("answer 1");
  expect(result.traceBlocks.filter(block => block.kind === "status").map(block => block.text))
    .toEqual(Array.from({ length: 10 }, (_, index) => `status ${index + 1}`));
  expect(result.traceBlocks.filter(block => block.kind === "commentary").map(block => block.text))
    .toEqual(["commentary 1", "commentary 2"]);
  const tracker = new ChatGptVisibleTraceTracker(0);
  const events = tracker.observe(result.traceBlocks, true);
  expect(events.map(event => event.kind)).toEqual([
    "reasoning", "commentary", ...Array(8).fill("reasoning"), "commentary", "reasoning",
  ]);
  expect(tracker.observe(result.traceBlocks, true)).toEqual([]);

  // Text, colour, and header placement do not determine the channel. The final
  // answer owns its own unit even if its renderer uses the same tone attribute.
  const changed = await snapshot(activitySummariesHtml
    .replaceAll("status 1", "commentary 1")
    .replace('data-markdown-text-style="assistant-message">\n<p>answer 1',
      'data-markdown-text-style="assistant-message" data-markdown-text-tone="tertiary">\n<p>answer 1'));
  expect(changed.visibleText).toBe("answer 1");
  expect(changed.traceBlocks.filter(block => block.kind === "commentary").map(block => block.text))
    .toEqual(["commentary 1", "commentary 2"]);
  expect(changed.traceBlocks.find(block => block.kind === "status")?.text).toBe("commentary 1");

  const hidden = await snapshot(activitySummariesHtml
    .replace('<div data-markdown-text-style="assistant-message" data-markdown-text-tone="tertiary">',
      '<div style="display:none"><div data-markdown-text-style="assistant-message" data-markdown-text-tone="tertiary">')
    .replace('<p>status 1</p>\n</div>', '<p>status 1</p>\n</div></div>'));
  expect(hidden.traceBlocks.some(block => block.text === "status 1")).toBeFalse();
});
