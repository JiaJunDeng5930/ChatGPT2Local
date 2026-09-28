/** Physical browser boundary. The only submission activation is in send(). */
import { chromium, type Browser as Connection, type Page } from "playwright-core";
import Turndown from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { randomUUID } from "node:crypto";
import { BridgeError, type Browser, type Context, type Placement, type Prepared, type Snapshot } from "./contracts";
import { canonical, digest } from "./codec";
import type { Config } from "./config";

// These selectors are external protocol assumptions, deliberately kept together.
export const DOM = Object.freeze({
  composer: 'form[data-chatgpt-composer] [data-composer-markdown][contenteditable="true"][role="textbox"], #prompt-textarea[contenteditable="true"]',
  turn: '[data-turn-key], [data-message-id][data-message-author-role]',
  assistant: '[data-conversation-role="assistant"], [data-chatgpt-agent-turn-start], [data-message-author-role="assistant"]',
  user: '[data-user-message-bubble], [data-message-author-role="user"]',
  answer: '.markdown, [data-message-content], [data-testid="assistant-message"]',
  completion: '.turn-action-controls button, [data-testid="copy-turn-action-button"]',
  stop: 'button[data-testid="stop-button"], form[data-chatgpt-composer] button[aria-label="Stop"]',
  error: '[data-testid="conversation-turn-error"], [data-message-error="true"]',
  stopped: '[data-testid="stopped-thinking"], [data-turn-status="stopped"]',
  effort: 'button[data-codex-intelligence-trigger="true"][data-composer-navigation-target="reasoning"]',
  think: 'button[data-testid="think-button"][aria-pressed]',
  slider: '[data-model-picker-power-slider] [role="slider"]',
  send: 'button[type="submit"], button[data-testid="send-button"]',
  connector: '[app-mention-path^="app://"][app-mention-display-name][contenteditable="false"]',
  mention: '[data-mention-list-scroll-area] button[data-list-navigation-item="true"]',
});

interface Ownership {
  operation: string; page: string; document: string; slot: number;
  baseline: { id: string; text: string }[]; payload: string;
  selection: { control: "slider" | "think"; label: string; value: string }; activated: boolean;
  cancellationAttempted?: boolean;
  preparedText: string;
  connector: string;
}
const MARKER = "__bend_web_ownership_v1__";

/** Logical-document observation. Only an explicit cancel input permits a
 * single Stop activation in the same DOM transaction as its ownership check. */
export function readDocument(args: { marker: string; selectors: typeof DOM; cancel?: string }) {
  const { marker, selectors: s } = args;
  const owner = (globalThis as unknown as Record<string, Ownership>)[marker];
  if (!owner) throw new Error("Document has no ownership receipt");
  const visible = (node: Element) => !!(node as HTMLElement).getClientRects().length;
  const turns = [...document.querySelectorAll(s.turn)].filter(node => !node.parentElement?.closest(s.turn));
  const role = (node: Element, selector: string) => node.matches(selector) || !!node.querySelector(selector);
  const entries = turns.map(node => ({
    node, id: node.getAttribute("data-turn-key") ?? node.getAttribute("data-message-id") ?? "",
    text: (node.querySelector(s.user) as HTMLElement | null)?.innerText ?? (node as HTMLElement).innerText,
    user: role(node, s.user), assistant: role(node, s.assistant),
  }));
  const prefix = owner.baseline.every((before, i) => entries[i]?.id === before.id && entries[i]?.text === before.text);
  const added = entries.slice(owner.baseline.length);
  const submitted = added[0]?.user ? added[0] : undefined;
  const actual = submitted?.text.trim().replace(/\r\n/g, "\n") ?? "";
  const expected = owner.payload.trim().replace(/\r\n/g, "\n");
  const prefixText = actual.endsWith(expected) ? actual.slice(0, actual.length - expected.length).trim() : "!mismatch";
  const accepted = prefix && added.filter(e => e.user).length === 1 && !!submitted && (prefixText === "" || (!!owner.connector && prefixText === owner.connector));
  const afterUser = submitted ? added.slice(added.indexOf(submitted) + 1) : [];
  const assistant = accepted ? afterUser.filter(e => e.assistant).at(-1) : undefined;
  const content = assistant ? [...assistant.node.querySelectorAll(s.answer)].filter(n => !n.parentElement?.closest(s.answer)) : [];
  const html = content.map(n => n.outerHTML).join("\n");
  const text = content.map(n => (n as HTMLElement).innerText).join("\n");
  const complete = !!assistant && [...assistant.node.querySelectorAll(s.completion)].some(visible);
  const running = [...document.querySelectorAll(s.stop)].some(visible);
  let cancelStatus: "pending" | "finished" = "pending";
  if (args.cancel !== undefined) {
    if (owner.operation !== args.cancel || !prefix || added.filter(e => e.user).length > 1 || (added.length && !accepted))
      throw new Error("Cancel ownership changed; no unrelated task was stopped");
    if (owner.cancellationAttempted || !owner.activated || complete || !!assistant?.node.querySelector(s.stopped)) cancelStatus = "finished";
    else if (accepted && running) {
      const buttons = [...document.querySelectorAll(s.stop)].filter(visible) as HTMLButtonElement[];
      if (buttons.length !== 1 || buttons[0]!.disabled || buttons[0]!.getAttribute("aria-disabled") === "true") throw new Error("Cancel control is ambiguous or disabled");
      owner.cancellationAttempted = true;
      buttons[0]!.click();
      cancelStatus = "finished";
    }
  }
  return { owner, baseline: entries.map(e => ({ id: e.id, text: e.text })), html, text,
    assistant: assistant?.id ?? "", accepted, cancelStatus,
    untouched: prefix && added.filter(e => e.user).length <= 1 && accepted,
    assistantTail: !!assistant && entries.at(-1)?.id === assistant.id,
    facts: { $: "Facts" as const, present: !!assistant && prefix && accepted,
      running, has_text: text.length > 0, completion_control: complete,
      reply_error: !!assistant?.node.querySelector(s.error), stopped_badge: !!assistant?.node.querySelector(s.stopped),
      tools_in_flight: false } };
}

export class WebBrowser implements Browser {
  private connection?: Promise<Connection>;
  private readonly owned = new Map<string, Page>();
  private readonly markdown = new Turndown({ codeBlockStyle: "fenced", headingStyle: "atx", bulletListMarker: "-" });
  constructor(readonly config: Config["browser"], readonly timeout = 15_000) { this.markdown.use(gfm); }

  async connect(): Promise<Connection> {
    // A rejected connection is not retried implicitly by another observation.
    return this.connection ??= chromium.connectOverCDP(this.config.endpoint, { timeout: this.timeout, noDefaults: true });
  }

  private async ownership(page: Page): Promise<Ownership | undefined> {
    return page.evaluate(marker => (globalThis as unknown as Record<string, Ownership>)[marker], MARKER);
  }

  private async find(key: string, by: "page" | "operation"): Promise<Page> {
    if (by === "operation") {
      const page = this.owned.get(key);
      if (page && !page.isClosed() && (await this.ownership(page))?.operation === key) return page;
    }
    const connection = await this.connect();
    const matches: Page[] = [];
    for (const context of connection.contexts()) for (const page of context.pages()) {
      if (new URL(page.url()).origin !== new URL(this.config.startUrl).origin) continue;
      const receipt = await this.ownership(page);
      if (receipt?.[by] === key) matches.push(page);
    }
    if (matches.length !== 1) throw new BridgeError("owned_page_missing", "Exactly one original owned document is required; no replacement page was created", 409);
    return matches[0]!;
  }

  private async allocate(): Promise<Page> {
    const connection = await this.connect();
    const context = connection.contexts()[0];
    if (!context) throw new Error("No browser context exists");
    if (!this.config.hostUrl) return context.newPage();
    const key = randomUUID();
    const expected = `about:blank#bend-${key}`;
    const created = context.waitForEvent("page", { predicate: page => page.url() === expected || page.url() === "about:blank", timeout: this.timeout });
    void created.catch(() => {});
    const result = await fetch(`${this.config.hostUrl}/pages`, { method: "POST", redirect: "error",
      headers: { authorization: `Bearer ${this.config.hostToken}`, "content-type": "application/json" }, body: JSON.stringify({ key }) });
    if (!result.ok) throw new Error("Desktop allocation did not return a receipt");
    const page = context.pages().find(p => p.url() === expected) ?? await created;
    await page.waitForURL(expected, { timeout: this.timeout });
    return page;
  }

  private async select(page: Page, context: Context): Promise<Ownership["selection"]> {
    const trigger = page.locator(DOM.effort).filter({ visible: true });
    const wanted = ["light", "medium", "high", "xhigh", "pro"].indexOf(context.effort);
    if (await trigger.count() === 0) {
      const think = page.locator(DOM.think).filter({ visible: true });
      if (wanted > 1 || wanted < 0 || await think.count() !== 1) throw new BridgeError("model_control_missing", "This page cannot verify the requested effort. Nothing was sent", 409);
      const selected = wanted === 1 ? "true" : "false";
      const current = await think.getAttribute("aria-pressed");
      if (current !== "true" && current !== "false") throw new Error("Think control has no exact state");
      if (current !== selected) await think.press("Enter", { timeout: this.timeout });
      if (await think.getAttribute("aria-pressed") !== selected) throw new Error("Think selection did not return an exact receipt");
      return { control: "think", label: (await think.innerText()).trim(), value: selected };
    }
    if (await trigger.count() !== 1) throw new BridgeError("model_control_missing", "The requested effort control is ambiguous. Nothing was sent", 409);
    await trigger.press("Enter", { timeout: this.timeout });
    const slider = page.locator(DOM.slider).filter({ visible: true });
    await slider.waitFor({ state: "visible", timeout: this.timeout });
    const read = async () => {
      const values = await slider.evaluate(node => [node.getAttribute("aria-valuemin"), node.getAttribute("aria-valuemax"), node.getAttribute("aria-valuenow")]);
      if (values.some(v => v === null || !/^\d+$/.test(v!))) throw new Error("Effort control has no numeric semantic state");
      return values.map(Number) as [number, number, number];
    };
    const [minimum, maximum, current] = await read();
    const target = minimum + wanted;
    if (wanted < 0 || target > maximum || maximum - minimum > 4 || current < minimum || current > maximum)
      throw new BridgeError("effort_unavailable", "This account does not expose the selected effort", 409);
    const control = slider.locator("xpath=ancestor::*[@role='menuitem'][1]");
    const keyboard = await control.count() === 1 ? control : slider;
    for (let value = current; value !== target;) {
      const delta = target > value ? 1 : -1;
      await keyboard.press(delta > 0 ? "ArrowRight" : "ArrowLeft", { timeout: this.timeout });
      const state = await read();
      if (state[0] !== minimum || state[1] !== maximum || state[2] !== value + delta) throw new Error("Effort selection has no exact change receipt");
      value += delta;
    }
    await page.keyboard.press("Escape");
    const label = (await trigger.innerText()).trim();
    if (!label || await trigger.getAttribute("aria-expanded") !== "false") throw new Error("Effort selection was not committed");
    // Verify the selected value survives closing the menu, before composing.
    await trigger.press("Enter", { timeout: this.timeout });
    const confirmed = await read();
    await page.keyboard.press("Escape");
    if (confirmed[0] !== minimum || confirmed[1] !== maximum || confirmed[2] !== target) throw new Error("Effort selection changed");
    return { control: "slider", label, value: "false" };
  }

  private async selectConnector(page: Page): Promise<void> {
    const name = this.config.connectorName ?? "ChatGPT Web Tools";
    const composer = page.locator(DOM.composer).filter({ visible: true });
    if ((await composer.innerText()).trim()) throw new Error("Connector selection cannot overwrite user text");
    await composer.pressSequentially(`@${name}`, { delay: 20, timeout: this.timeout });
    const row = page.locator(DOM.mention).filter({ has: page.getByText(name, { exact: true }), visible: true });
    await row.waitFor({ state: "visible", timeout: this.timeout });
    if (await row.count() !== 1) throw new Error("The exact connector identity is ambiguous");
    await row.press("Enter", { timeout: this.timeout });
    const selected = page.locator(DOM.composer).filter({ visible: true }).locator(DOM.connector);
    await selected.waitFor({ state: "visible", timeout: this.timeout });
    const identities = await selected.evaluateAll(nodes => nodes.map(node => node.getAttribute("app-mention-display-name")));
    if (identities.length !== 1 || identities[0] !== name) throw new Error("The requested connector was not selected");
  }

  async prepare(operation: string, slot: number, payload: string, context: Context, placement: Placement): Promise<Prepared> {
    let page = this.owned.get(operation);
    if (!page) page = placement.page ? await this.find(placement.page, "page") : await this.allocate();
    if (!placement.page && !this.owned.has(operation)) await page.goto(this.config.startUrl, { waitUntil: "domcontentloaded", timeout: this.timeout });
    page.setDefaultTimeout(this.timeout);
    const previous = await this.ownership(page);
    if (placement.page && (!previous || previous.page !== placement.page || previous.document !== placement.receipt?.document))
      throw new Error("Retained placement changed before preparation");
    if (previous && previous.operation === operation && previous.slot >= slot) throw new Error("A prepared slot cannot be prepared again");
    if (await page.locator(DOM.stop).filter({ visible: true }).count()) throw new Error("An active page is not a writable surface");
    const composer = page.locator(DOM.composer).filter({ visible: true });
    await composer.waitFor({ state: "visible", timeout: this.timeout });
    if (await composer.count() !== 1 || (await composer.innerText()).trim()) throw new Error("The composer is ambiguous or contains user work");
    if (placement.receipt && previous?.operation !== operation) {
      const before = await this.inspect(placement.page!);
      if (!before.untouched || !before.assistantTail || before.text !== placement.receipt.answer || before.assistant !== placement.receipt.assistant)
        throw new Error("The retained conversation changed after admission");
    }
    const selection = await this.select(page, context);
    if (context.mode === "full") await this.selectConnector(page);
    const baseline = await page.evaluate(s => [...document.querySelectorAll(s.turn)]
      .filter(node => !node.parentElement?.closest(s.turn)).map(node => ({
        id: node.getAttribute("data-turn-key") ?? node.getAttribute("data-message-id") ?? "",
        text: (node.querySelector(s.user) as HTMLElement | null)?.innerText ?? (node as HTMLElement).innerText,
      })), DOM);
    if (baseline.some(e => !e.id) || new Set(baseline.map(e => e.id)).size !== baseline.length) throw new Error("Conversation has ambiguous logical identities");
    const receipt: Ownership = { operation, slot, page: previous?.page ?? randomUUID(), document: previous?.document ?? randomUUID(),
      baseline, payload, selection, activated: false, preparedText: "",
      connector: context.mode === "full" ? this.config.connectorName ?? "ChatGPT Web Tools" : "" };
    // This is identity evidence, never a replacement for the SQLite send claim.
    await page.evaluate(({ marker, receipt }) => { (globalThis as unknown as Record<string, Ownership>)[marker] = receipt; }, { marker: MARKER, receipt });
    this.owned.set(operation, page);
    if (context.attachments.length) {
      const files = page.locator('input[type="file"]');
      if (await files.count() !== 1) throw new Error("The native attachment input is ambiguous");
      await files.setInputFiles(context.attachments.map(image => ({ name: image.name, mimeType: image.mime, buffer: Buffer.from(image.data, "base64") })));
      // Upload completion is externally visible; a timeout never resubmits.
      await page.locator('[role="progressbar"]').waitFor({ state: "hidden", timeout: this.timeout });
      for (const attachment of context.attachments) {
        if (!await page.getByText(attachment.name, { exact: true }).count()) throw new Error("An attachment has no visible receipt");
      }
    }
    const current = page.locator(DOM.composer).filter({ visible: true });
    await current.focus();
    await current.press(process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End");
    const inserted = await page.evaluate(text => {
      // A plain insertText command can turn empty lines into nested block
      // elements whose rendered value has extra newlines. Insert escaped text
      // with explicit line breaks through the browser's editing command; never
      // interpolate markup from the request or replace the connector node.
      const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r\n/g, "\n").replace(/\n/g, "<br>");
      return document.execCommand("insertHTML", false, escaped);
    }, (receipt.connector ? " " : "") + payload);
    if (!inserted) throw new Error("The browser refused the text editing command");
    const preparedText = (await current.innerText()).replace(/\r\n/g, "\n");
    const expected = payload.replace(/\r\n/g, "\n");
    if (!preparedText.endsWith(expected) || preparedText.slice(0, -expected.length).trim() !== receipt.connector)
      throw new Error("Composer did not retain the complete payload and exact connector");
    await page.evaluate(({ marker, operation, slot, text }) => {
      const owner = (globalThis as unknown as Record<string, Ownership>)[marker];
      if (!owner || owner.operation !== operation || owner.slot !== slot) throw new Error("Preparation ownership changed");
      owner.preparedText = text;
    }, { marker: MARKER, operation, slot, text: preparedText });
    return { page: receipt.page, document: receipt.document };
  }

  async send(operation: string, slot: number): Promise<{ clicked: boolean }> {
    const page = await this.find(operation, "operation");
    // One browser event-loop transaction rechecks the document and consumes the
    // local activation guard before click. Locator auto-retry is not used here.
    return page.evaluate(({ marker, operation, slot, s }) => {
      const owner = (globalThis as unknown as Record<string, Ownership>)[marker];
      if (!owner || owner.operation !== operation || owner.slot !== slot || owner.activated) throw new Error("Stale or consumed send");
      const visible = (n: Element) => !!(n as HTMLElement).getClientRects().length;
      const composers = [...document.querySelectorAll(s.composer)].filter(visible) as HTMLElement[];
      const controls = [...document.querySelectorAll(owner.selection.control === "think" ? s.think : s.effort)].filter(visible) as HTMLElement[];
      if (composers.length !== 1 || controls.length !== 1 || controls[0]!.innerText.trim() !== owner.selection.label ||
          controls[0]!.getAttribute(owner.selection.control === "think" ? "aria-pressed" : "aria-expanded") !== owner.selection.value || !owner.preparedText || composers[0]!.innerText.replace(/\r\n/g, "\n") !== owner.preparedText)
        throw new Error("Prepared composer or model changed");
      const connectors = [...composers[0]!.querySelectorAll(s.connector)].map(node => node.getAttribute("app-mention-display-name"));
      if (owner.connector ? connectors.length !== 1 || connectors[0] !== owner.connector : connectors.length !== 0)
        throw new Error("The prepared connector capability changed");
      const buttons = [...composers[0]!.closest("form")!.querySelectorAll(s.send)].filter(visible) as HTMLButtonElement[];
      if (buttons.length !== 1 || buttons[0]!.disabled || buttons[0]!.getAttribute("aria-disabled") === "true" || [...document.querySelectorAll(s.stop)].some(visible))
        throw new Error("There is no unique ready submitter");
      owner.activated = true;
      buttons[0]!.click();
      return { clicked: true };
    }, { marker: MARKER, operation, slot, s: DOM });
  }

  private async sample(page: Page): Promise<Snapshot> {
    const raw = await page.evaluate(readDocument, { marker: MARKER, selectors: DOM });
    const text = this.markdown.turndown(raw.html).trim();
    return { operation: raw.owner.operation, slot: raw.owner.slot, page: raw.owner.page, document: raw.owner.document,
      accepted: raw.accepted, assistant: raw.assistant, text, untouched: raw.untouched, assistantTail: raw.assistantTail,
      signature: digest(canonical({ document: raw.owner.document, slot: raw.owner.slot, assistant: raw.assistant, html: raw.html })),
      baseline: raw.baseline.map(e => e.id), facts: { ...raw.facts, has_text: text.length > 0 } };
  }

  snapshot(operation: string): Promise<Snapshot> { return this.find(operation, "operation").then(page => this.sample(page)); }
  inspect(page: string): Promise<Snapshot> { return this.find(page, "page").then(page => this.sample(page)); }
  async attach(operation: string, pageKey: string, document: string): Promise<boolean> {
    // Only an explicit resume may reconnect a failed observer transport. It
    // still has to find the same document marker and cannot create a page.
    if (this.connection) {
      try { if (!(await this.connection).isConnected()) this.connection = undefined; }
      catch { this.connection = undefined; }
    }
    const page = await this.find(pageKey, "page");
    const owner = await this.ownership(page);
    if (!owner || owner.operation !== operation || owner.document !== document) return false;
    this.owned.set(operation, page);
    return true;
  }
  async cancel(operation: string): Promise<void> {
    const page = await this.find(operation, "operation");
    const deadline = Date.now() + this.timeout;
    do {
      const result = await page.evaluate(readDocument, { marker: MARKER, selectors: DOM, cancel: operation });
      if (result.cancelStatus === "finished") return;
      // This read-only wait is exclusively part of a user cancellation. There
      // is at most one activation, never a retry following a claimed Stop.
      await new Promise(resolve => setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    throw new Error("The user cancellation has no positive owned Stop receipt. The page was not reloaded or retried");
  }
}
