/** The application interpreter. Bend owns state and authority; this file owns
 * live IO handles. Disconnecting a handle never resets a durable operation. */
import { randomBytes } from "node:crypto";
import { BridgeError, type Browser, type Context, type ObjectValue, type Placement, type RetainedReceipt, type Snapshot, type Tool } from "./contracts";
import { canonical, digest, object } from "./codec";
import { array, compiled, list, type Decision, type Input, type Invocation } from "./kernel";
import { attachments, DEFAULT_LIMITS, plan, tokens, type Limits } from "./prompts";
import { finalReceipt, responseObject, toolOutput, validateArguments, type ParsedRequest } from "./protocol";
import { Store, type Change, type Operation } from "./store";

interface ObservationHandle {
  timer?: ReturnType<typeof setTimeout>;
  paused: boolean;
  inFlight?: Promise<void>;
  last?: Snapshot;
}

interface WaitHandle { promise: Promise<void>; dispose(): void }

function waitForChange(store: Store, id: string, signal?: AbortSignal): WaitHandle {
  let done = false;
  let unsubscribe: () => void = () => {};
  let abort: () => void = () => {};
  let resolveWait: () => void = () => {};
  let rejectWait: (reason: unknown) => void = () => {};
  const promise = new Promise<void>((resolve, reject) => { resolveWait = resolve; rejectWait = reject; });
  const dispose = () => {
    if (done) return;
    done = true;
    unsubscribe();
    signal?.removeEventListener("abort", abort);
  };
  unsubscribe = store.subscribe(operation => { if (operation === id) { dispose(); resolveWait(); } });
  abort = () => { dispose(); rejectWait(signal?.reason ?? new DOMException("Observer detached", "AbortError")); };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  // A signal may abort before the caller reaches await; keep it handled while
  // preserving the rejection for that await.
  void promise.catch(() => {});
  return { promise, dispose };
}

function live(operation: Operation): boolean {
  return operation.state.output.$ === "None" && operation.state.broker.lifetime.$ !== "Retired";
}

export class Application {
  private readonly observers = new Map<string, ObservationHandle>();
  private readonly effects = new Map<string, Promise<void>>();
  private readonly invocations = new Map<string, Promise<ObjectValue>>();
  private stopped = false;
  private readonly closing = new AbortController();
  private readonly localActivities = new Map<string, Promise<ObjectValue>>();

  constructor(readonly store: Store, readonly browser: Browser, readonly limits: Limits = { ...DEFAULT_LIMITS },
    readonly observationInterval = 750, readonly stabilityInterval = 1500) {}

  private fault(id: string, code: string): void {
    const observer = this.observers.get(id);
    if (observer) {
      observer.paused = true;
      if (observer.timer) clearTimeout(observer.timer);
    }
    this.store.saveSetting(`fault:${id}`, { code, at: Date.now(), resolution: "Inspect the existing webpage. Resume observation explicitly; no resend, reload, or automatic cancellation is available." });
    this.store.change(id, [{ $: "Uncertain" }]);
  }

  private async select(parsed: ParsedRequest): Promise<Placement> {
    if (!parsed.previous) return {};
    const previous = this.store.previous(parsed.previous).operation;
    const receipt = this.store.receipt(previous);
    if (!receipt) throw new BridgeError("previous_response_unavailable", "The predecessor no longer owns an available webpage", 409);
    let snapshot: Snapshot;
    try { snapshot = await this.browser.inspect(receipt.page); }
    catch { throw new BridgeError("previous_response_unavailable", "The original webpage is unavailable; no replacement was allocated", 409); }
    const reusable = compiled.surface_resume({ $: "Evidence", present: snapshot.facts.present,
      untouched: snapshot.untouched && snapshot.document === receipt.document && snapshot.assistant === receipt.assistant,
      idle: !snapshot.facts.running && !snapshot.facts.reply_error && !snapshot.facts.stopped_badge,
      assistant_tail: snapshot.assistantTail && snapshot.assistant === receipt.assistant,
      recorded_key: receipt.page, key: snapshot.page,
      recorded_operation: receipt.operation, operation: snapshot.operation,
      recorded_answer: receipt.answer, expected_answer: receipt.answer, answer: snapshot.text });
    if (!reusable) throw new BridgeError("previous_response_unavailable", "The original page or its final answer changed; no replacement was allocated", 409);
    return { page: receipt.page, receipt };
  }

  async submit(parsed: ParsedRequest): Promise<Operation> {
    const admission = this.store.admission(parsed);
    if (admission.$ === "Replay") {
      if (parsed.kind === "Results" && this.store.round(parsed.id, parsed.round) === undefined) await this.receiveResults(parsed);
      return this.store.get(parsed.id);
    }
    if (parsed.kind === "Results") {
      this.store.registerResults(parsed);
      await this.receiveResults(parsed);
      return this.store.get(parsed.id);
    }
    const context: Context = { ...parsed.context, attachments: attachments(parsed.context) };
    const capability = `turn_${randomBytes(32).toString("base64url")}`;
    const placement = await this.select(parsed);
    const prepared = plan(context, capability, parsed.previous !== null, this.limits);
    context.measurement = { inputTokens: prepared.inputTokens };
    const admissionResult = this.store.admit(parsed, context, capability, placement, prepared.payloads);
    if (admissionResult.created) this.dispatch(admissionResult);
    return admissionResult.operation;
  }

  private dispatch(change: Change): void {
    if (!change.effects.length) return;
    const id = change.operation.id;
    const prior = this.effects.get(id) ?? Promise.resolve();
    const job = prior.then(async () => {
      for (const effect of change.effects) await this.execute(effect);
    }).catch(() => {
      try { this.fault(id, "effect_boundary_failed"); } catch { /* No physical effect is retried when storage is unavailable. */ }
    });
    this.effects.set(id, job);
    void job.finally(() => { if (this.effects.get(id) === job) this.effects.delete(id); });
  }

  private apply(id: string, input: Input, receipt?: RetainedReceipt): Decision {
    const change = this.store.change(id, [input], receipt);
    this.dispatch(change);
    return change.decisions.at(-1)!;
  }

  private async execute(id: number): Promise<void> {
    if (this.stopped) return;
    const claimed = this.store.claim(id);
    if (!claimed) return;
    const operation = this.store.get(claimed.operation);
    const effect = claimed.effect;
    try {
      if (effect.$ === "BrowserCommand") {
        switch (effect.command.$) {
          case "PrepareSurface": {
            const batch = operation.state.batch;
            const isFinal = batch.$ === "Batch" && batch.pending.$ === "Nil";
            const context = { ...operation.context,
              attachments: isFinal ? operation.context.attachments : [] };
            const page = await this.browser.prepare(operation.id, Number(effect.slot), effect.payload, context, operation.placement);
            this.store.bindPage(operation.id, page.page, page.document);
            this.apply(operation.id, { $: "Ready" });
            break;
          }
          case "SendPrompt": {
            const result = await this.browser.send(operation.id, Number(effect.slot));
            if (!result.clicked) throw new Error("The one-use send command has no positive activation receipt");
            this.observe(operation.id);
            break;
          }
          case "StopByUser":
            await this.browser.cancel(operation.id);
            this.stopObservation(operation.id);
            break;
          default:
            throw new Error("An unsupported physical command crossed the Bend boundary");
        }
      } else if (effect.$ === "EncodeFinal") {
        const inputTokens = operation.context.measurement?.inputTokens ?? tokens(canonical(operation.context.input));
        const output = finalReceipt(operation, effect.text, { input: inputTokens, output: tokens(effect.text) });
        // Re-read after encoding, before the compare-and-seal transition. A
        // stale candidate or a tool arriving meanwhile invalidates publication.
        const snapshot = await this.browser.snapshot(operation.id);
        if (snapshot.operation !== operation.id || snapshot.page !== operation.page || snapshot.document !== operation.document)
          throw new Error("The final observation changed ownership");
        const observer = this.observers.get(operation.id);
        if (observer) observer.last = snapshot;
        this.apply(operation.id, { $: "Observe", facts: snapshot.facts, text: snapshot.text, signature: snapshot.signature,
          now: BigInt(Date.now()), stable_ms: BigInt(this.stabilityInterval), revision: operation.state.broker.revision, slot: BigInt(snapshot.slot) });
        this.apply(operation.id, { $: "Encoded", revision: effect.revision, signature: effect.signature, output },
          { operation: operation.id, page: snapshot.page, document: snapshot.document, assistant: snapshot.assistant, answer: snapshot.text });
      } else if (effect.$ === "Publish") {
        this.stopObservation(operation.id);
      }
      this.store.settle(id, true);
    } catch (error) {
      this.store.settle(id, false);
      this.fault(operation.id, error instanceof BridgeError ? error.code : effect.$ === "EncodeFinal" ? "output_encoding_failed" : "browser_command_unknown");
    }
  }

  private stopObservation(id: string): void {
    const handle = this.observers.get(id);
    if (handle?.timer) clearTimeout(handle.timer);
    if (handle) handle.paused = true;
  }

  private observe(id: string): void {
    if (this.stopped) return;
    const old = this.observers.get(id);
    if (old && !old.paused) return;
    const handle: ObservationHandle = { paused: false, ...(old?.last ? { last: old.last } : {}) };
    this.observers.set(id, handle);
    const tick = async () => {
      if (handle.paused || this.stopped || this.observers.get(id) !== handle || !live(this.store.get(id))) return;
      const operation = this.store.get(id);
      const revision = operation.state.broker.revision;
      const slot = operation.state.batch.$ === "Batch" ? operation.state.batch.slot : 0n;
      try {
        const snapshot = await this.browser.snapshot(id);
        if (handle.paused || this.observers.get(id) !== handle) return;
        if (snapshot.operation !== id || snapshot.page !== operation.page || snapshot.document !== operation.document)
          throw new Error("The observation no longer belongs to the owned document");
        if (BigInt(snapshot.slot) === slot) {
          handle.last = snapshot;
          if (snapshot.accepted) this.apply(id, { $: "SubmissionSeen", slot });
          this.apply(id, { $: "Observe", facts: snapshot.facts, text: snapshot.text, signature: snapshot.signature,
            now: BigInt(Date.now()), stable_ms: BigInt(this.stabilityInterval), revision, slot });
        }
      } catch {
        // A failed read is not retried. Other tools and the webpage retain their
        // capabilities; only this failed observation subscription is paused.
        this.fault(id, "browser_observation_failed");
      }
      if (!handle.paused && !this.stopped && live(this.store.get(id))) {
        handle.timer = setTimeout(() => { handle.inFlight = tick(); void handle.inFlight.catch(() => {}); }, this.observationInterval);
      }
    };
    handle.inFlight = tick();
    void handle.inFlight.catch(() => {});
  }

  private async receiveResults(parsed: ParsedRequest): Promise<void> {
    const operation = this.store.get(parsed.id);
    const invocations = array(operation.state.broker.invocations);
    if (parsed.results.every(result => invocations.find(call => call.id === result.call_id)?.delivery.$ === "Result")) {
      this.store.completeResults(parsed, operation.state.latest);
      return;
    }
    let baseline = operation.state.latest;
    const observer = this.observers.get(operation.id);
    if (observer && !observer.paused) {
      try {
        const snapshot = await this.browser.snapshot(operation.id);
        if (snapshot.operation !== operation.id || snapshot.page !== operation.page || snapshot.document !== operation.document)
          throw new Error("Tool boundary changed document");
        baseline = snapshot.text;
        observer.last = snapshot;
      } catch { this.fault(operation.id, "tool_boundary_observation_failed"); }
    } else this.fault(operation.id, "tool_boundary_observation_failed");
    // A failed observation blocks final publication, not delivery of known tool
    // results. Replay after restart can still finish the committed result batch.
    this.store.completeResults(parsed, baseline);
  }

  private poll(id: string, round: string): string | undefined {
    const request = this.store.request(round);
    if (!request || request.operation !== id) throw new Error("A response requires its durable request identity");
    return this.store.pollRound(id, round, (operation, decision) => {
      const reply = decision.reply;
      if (reply.$ === "FinalReceipt") {
        const final = object(JSON.parse(reply.output));
        return canonical(responseObject(operation, request, (final.output as ObjectValue[]), final.usage ?? null));
      }
      if (reply.$ !== "ToolReceipt" || (reply.receipt.$ !== "CallsDelivered" && reply.receipt.$ !== "CallsReplayed")) return undefined;
      const ids = array(reply.receipt.ids);
      const invocations = array(operation.state.broker.invocations);
      const output = ids.map(id => {
        const invocation = invocations.find(invocation => invocation.id === id);
        if (!invocation) throw new Error("Delivered invocation missing from durable state");
        return toolOutput(invocation, operation.context.tools);
      });
      return canonical(responseObject(operation, request, output));
    }).body;
  }

  resource(responseId: string): ObjectValue {
    const record = this.store.responseRecord(responseId);
    const saved = this.poll(record.operation, record.key);
    if (saved !== undefined) return object(JSON.parse(saved));
    const operation = this.store.get(record.operation);
    const fault = this.store.setting<{ code: string } | null>(`fault:${operation.id}`);
    return { ...responseObject(operation, record, []),
      status: operation.state.broker.lifetime.$ === "Retired" ? "cancelled" : fault ? "interrupted" : "in_progress",
      ...(fault ? { error: { code: fault.code, message: "Inspect the original page and explicitly resume observation" } } : {}) };
  }

  async response(parsed: ParsedRequest, signal?: AbortSignal): Promise<string> {
    signal = signal ? AbortSignal.any([signal, this.closing.signal]) : this.closing.signal;
    await this.submit(parsed);
    try {
      for (;;) {
        if (signal.aborted) throw signal.reason ?? new DOMException("Observer detached", "AbortError");
        const wait = waitForChange(this.store, parsed.id, signal);
        try {
          const body = this.poll(parsed.id, parsed.round);
          if (body !== undefined) return body;
          const operation = this.store.get(parsed.id);
          if (operation.state.broker.lifetime.$ === "Retired") throw new BridgeError("operation_cancelled", "The user explicitly cancelled this operation", 409);
          const fault = this.store.setting<{ code: string } | null>(`fault:${parsed.id}`);
          if (fault) throw new BridgeError("operation_interrupted", `Observation is interrupted (${fault.code}); inspect and resume the original page`, 409);
          await wait.promise;
        } finally { wait.dispose(); }
      }
    } finally {
      if (signal.aborted) this.apply(parsed.id, { $: "Detached" });
    }
  }

  /** A caller's abort signal is intentionally not a tool-execution lifetime. */
  async local(capability: string, requestId: string, payload: ObjectValue, work: () => ObjectValue): Promise<ObjectValue> {
    return this.activity(capability, requestId, payload, async () => work());
  }

  async activity(capability: string, requestId: string, payload: ObjectValue, work: () => Promise<ObjectValue>): Promise<ObjectValue> {
    const operation = this.store.byCapability(capability);
    const id = `local_${digest(requestId).slice(0, 40)}`;
    this.store.putBlob(operation.id, `request:${id}`, canonical(payload));
    const cached = this.store.blob(operation.id, `local:${id}`);
    if (cached !== undefined) return object(JSON.parse(cached));
    const key = `${operation.id}:${id}`;
    const pending = this.localActivities.get(key);
    if (pending) return pending;
    const job = this.runLocal(operation, id, work);
    this.localActivities.set(key, job);
    void job.finally(() => this.localActivities.delete(key)).catch(() => {});
    return job;
  }

  private async runLocal(operation: Operation, id: string, work: () => Promise<ObjectValue>): Promise<ObjectValue> {
    const decision = this.apply(operation.id, { $: "BeginTool", id });
    if (decision.reply.$ === "Rejected" || (decision.reply.$ === "ToolReceipt" && decision.reply.receipt.$ === "Reject"))
      throw new BridgeError("tool_owner_closed", "The operation does not admit local tool activity", 409);
    try {
      const value = await work();
      const snapshot = await this.browser.snapshot(operation.id);
      if (snapshot.operation !== operation.id || snapshot.page !== operation.page || snapshot.document !== operation.document)
        throw new Error("Local tool observation lost ownership");
      // Encoding/storage precedes the completion receipt. If either fails, the
      // activity stays outstanding; no old answer can win the final fence.
      this.dispatch(this.store.completeLocal(operation.id, id, canonical(value), snapshot.text));
      return value;
    } catch (error) {
      this.fault(operation.id, "tool_boundary_observation_failed");
      throw error;
    }
  }

  async invoke(capability: string, requestId: string, wire: string, supplied: unknown): Promise<ObjectValue> {
    const operation = this.store.byCapability(capability);
    const tool = operation.context.tools.find(tool => tool.wire === wire);
    if (!tool) throw new BridgeError("unknown_native_tool", "The wire name is not declared in this native turn");
    const args = validateArguments(tool, supplied);
    const payload = canonical({ wire, ...(tool.kind === "custom" ? { input: args } : { arguments: args }) });
    const activity = `mcp_${digest(requestId).slice(0, 40)}`;
    const key = `${operation.id}:${activity}`;
    const prior = this.invocations.get(key);
    if (prior) {
      if (this.store.blob(operation.id, `request:${activity}`) !== payload) throw new BridgeError("conflicting_mcp_request", "The same MCP request identity has different arguments", 409);
      return prior;
    }
    this.store.putBlob(operation.id, `request:${activity}`, payload);
    const cached = this.store.blob(operation.id, `mcp:${activity}`);
    if (cached !== undefined) {
      this.apply(operation.id, { $: "EndTool", id: activity });
      return object(JSON.parse(cached));
    }
    const promise = this.runInvocation(operation, activity, tool, payload);
    this.invocations.set(key, promise);
    void promise.finally(() => { if (this.invocations.get(key) === promise) this.invocations.delete(key); }).catch(() => {});
    return promise;
  }

  private async runInvocation(operation: Operation, activity: string, tool: Tool, payload: string): Promise<ObjectValue> {
    const claimed = this.apply(operation.id, { $: "BeginTool", id: activity });
    if (claimed.reply.$ === "Rejected" || (claimed.reply.$ === "ToolReceipt" && claimed.reply.receipt.$ === "Reject"))
      throw new BridgeError("tool_owner_closed", "The operation does not admit another tool activity", 409);
    const callId = `call_${digest(`${operation.id}:${activity}`).slice(0, 40)}`;
    const existing = array(this.store.get(operation.id).state.broker.invocations).find(item => item.id === callId);
    if (existing && existing.payload !== payload) throw new BridgeError("conflicting_tool_invocation", "The stable native call identity has different arguments", 409);
    if (!existing) {
      const queued = this.apply(operation.id, { $: "CallTool", id: callId, wire: tool.wire, payload });
      if (queued.reply.$ === "Rejected" || (queued.reply.$ === "ToolReceipt" && queued.reply.receipt.$ === "Reject")) {
        this.apply(operation.id, { $: "EndTool", id: activity });
        throw new BridgeError("tool_not_admitted", "The native invocation was not admitted", 409);
      }
    }
    for (;;) {
      const wait = waitForChange(this.store, operation.id, this.closing.signal);
      try {
        const current = this.store.get(operation.id);
        const invocation = array(current.state.broker.invocations).find(item => item.id === callId);
        if (invocation?.delivery.$ === "Result") {
          const body = this.store.blob(operation.id, `result:${callId}`);
          if (body === undefined || digest(body) !== invocation.delivery.digest) throw new Error("The native result receipt is not durable");
          const result = mcpResult(JSON.parse(body));
          this.store.putBlob(operation.id, `mcp:${activity}`, canonical(result));
          this.apply(operation.id, { $: "EndTool", id: activity });
          return result;
        }
        if (current.state.broker.lifetime.$ === "Retired") throw new BridgeError("operation_cancelled", "The user cancelled the owning operation", 409);
        await wait.promise;
      } finally { wait.dispose(); }
    }
  }

  async resume(id: string, acceptCurrentAnswer = false): Promise<void> {
    const operation = this.store.get(id);
    if (!this.store.db.query("SELECT key FROM requests WHERE operation=? LIMIT 1").get(id))
      throw new BridgeError("legacy_protocol_unavailable", "Old-protocol operations are retained for inspection and explicit cancellation, not converted into new requests", 409);
    if (!operation.page || !operation.document) throw new BridgeError("page_not_bound", "No original owned page is recorded. A new page is not a recovery action.", 409);
    const fault = this.store.setting<{ code: string } | null>(`fault:${id}`);
    if (fault?.code === "tool_boundary_observation_failed" && !acceptCurrentAnswer)
      throw new BridgeError("completion_evidence_missing", "A tool completed while its webpage could not be observed. Inspect the page and explicitly confirm its current reply before resuming completion detection.", 409);
    if (!await this.browser.attach(id, operation.page, operation.document)) throw new BridgeError("owned_page_missing", "The original page/document is unavailable. This operation will not be submitted again.", 409);
    this.apply(id, acceptCurrentAnswer ? { $: "UserConfirm" } : { $: "Reattach" });
    this.store.saveSetting(`fault:${id}`, null);
    this.observe(id);
  }

  async cancel(id: string): Promise<void> {
    const change = this.store.change(id, [{ $: "UserCancel" }]);
    this.dispatch(change);
    this.stopObservation(id);
    await (this.effects.get(id) ?? Promise.resolve());
  }

  recover(): void {
    this.store.recover();
    // Recovery restores data only. Attaching to a surviving owned document is
    // an explicit control action, never a new browser allocation or send.
  }

  async close(): Promise<void> {
    this.stopped = true;
    this.closing.abort(new DOMException("Runtime detached; operation remains durable", "AbortError"));
    for (const [id] of this.observers) this.stopObservation(id);
    await Promise.allSettled([...this.effects.values()]);
    await Promise.allSettled([...this.observers.values()].flatMap(handle => handle.inFlight ? [handle.inFlight] : []));
    await Promise.allSettled([...this.invocations.values()]);
    await Promise.allSettled([...this.localActivities.values()]);
  }
}

export function mcpResult(value: unknown): ObjectValue {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const result = object(value);
    if (Array.isArray(result.content)) {
      const content = result.content.map(raw => {
        const part = object(raw, "caller tool result part");
        if (part.type === "text" && typeof part.text === "string") return part;
        if (part.type === "image" && typeof part.data === "string" && typeof part.mimeType === "string") return part;
        throw new BridgeError("unsupported_tool_result_part", "The caller tool returned a content part this MCP transport cannot encode", 422);
      });
      return { content, ...(result.isError === true ? { isError: true } : {}), ...(result.structuredContent && typeof result.structuredContent === "object" ? { structuredContent: result.structuredContent } : {}) };
    }
  }
  // Strings are verbatim text. Rich MCP output is an explicit JSON object;
  // never guess whether a string should be parsed a second time.
  return { content: [{ type: "text", text: typeof value === "string" ? value : canonical(value) }] };
}
