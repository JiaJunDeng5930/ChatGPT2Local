/** SQLite is an effect interpreter: it never invents a lifecycle transition. */
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { BridgeError, type Context, type ObjectValue, type Placement, type RetainedReceipt } from "./contracts";
import { canonical, digest } from "./codec";
import { array, compiled, decode, encode, initialize, list as listForStore, transition, type Decision, type Effect, type Input, type State } from "./kernel";
import type { ParsedRequest, RequestIdentity } from "./protocol";

const FRAME_LIMIT = 64 * 1024 * 1024;

export interface Operation {
  id: string;
  capability: string;
  context: Context;
  state: State;
  revision: number;
  created: number;
  page?: string;
  document?: string;
  placement: Placement;
}

interface Row {
  id: string; capability: string; context: string; transcript: string; state: string;
  checksum: string; revision: number; page: string | null; document: string | null; placement: string; created: number;
}

export interface Change { operation: Operation; decisions: Decision[]; effects: number[]; changed: boolean }
export interface ClaimedEffect { id: number; operation: string; effect: Effect }
export interface RequestRecord {
  key: string; fingerprint: string; previous: string | null; operation: string;
  response_id: string; kind: "Messages" | "Results"; created: number;
}

export class Store {
  readonly db: Database;
  readonly path: string;
  private readonly listeners = new Set<(operation: string) => void>();

  constructor(readonly home: string, options: { migrate?: boolean } = {}) {
    mkdirSync(home, { recursive: true, mode: 0o700 });
    if (lstatSync(home).isSymbolicLink()) throw new Error("Application home must not be a symbolic link");
    chmodSync(home, 0o700);
    this.path = join(home, "application.sqlite");
    if (existsSync(this.path) && lstatSync(this.path).isSymbolicLink()) throw new Error("Database must not be a symbolic link");
    this.db = new Database(this.path, { create: true, strict: true });
    chmodSync(this.path, 0o600);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA trusted_schema=OFF;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS operations(
        id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, capability TEXT NOT NULL,
        context TEXT NOT NULL, transcript TEXT NOT NULL, state TEXT NOT NULL, checksum TEXT NOT NULL,
        revision INTEGER NOT NULL, page TEXT, document TEXT, placement TEXT NOT NULL,
        created INTEGER NOT NULL, updated INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS events(
        operation TEXT NOT NULL REFERENCES operations(id), revision INTEGER NOT NULL,
        input TEXT NOT NULL, decision TEXT NOT NULL, PRIMARY KEY(operation, revision));
      CREATE TABLE IF NOT EXISTS effects(
        id INTEGER PRIMARY KEY AUTOINCREMENT, operation TEXT NOT NULL REFERENCES operations(id),
        revision INTEGER NOT NULL, body TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('new','claimed','recorded','unknown','withdrawn')),
        UNIQUE(operation, revision));
      CREATE TABLE IF NOT EXISTS blobs(
        operation TEXT NOT NULL REFERENCES operations(id), key TEXT NOT NULL,
        digest TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(operation, key));
      CREATE TABLE IF NOT EXISTS rounds(
        operation TEXT NOT NULL REFERENCES operations(id), key TEXT NOT NULL, body TEXT NOT NULL,
        PRIMARY KEY(operation, key));
      CREATE TABLE IF NOT EXISTS requests(
        key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, previous TEXT UNIQUE,
        operation TEXT NOT NULL REFERENCES operations(id), response_id TEXT UNIQUE NOT NULL,
        kind TEXT NOT NULL CHECK(kind IN ('Messages','Results')), created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS receipts(page TEXT PRIMARY KEY, body TEXT NOT NULL, owner TEXT);
      CREATE TABLE IF NOT EXISTS legacy(id TEXT PRIMARY KEY, status TEXT NOT NULL, source TEXT NOT NULL);
    `);
    const meta = this.db.query("SELECT value FROM metadata WHERE key='kernel'").get() as { value: string } | null;
    if (meta && meta.value !== compiled.fingerprint && !options.migrate) {
      this.db.close();
      throw new BridgeError("migration_required", "The checked kernel changed. Run `codex-chatgpt-web migrate` before serving existing storage.", 409);
    }
    this.atomic(() => {
      if (meta && meta.value !== compiled.fingerprint) {
        for (const row of this.db.query("SELECT * FROM operations").all() as Row[])
          this.changeInside(row.id, [{ $: "Restore" }]);
        this.db.exec("UPDATE effects SET status='unknown' WHERE status IN ('new','claimed')");
      }
      this.db.query("INSERT INTO metadata(key,value) VALUES('kernel',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(compiled.fingerprint);
      this.importLegacy();
    });
  }

  private atomic<T>(body: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const value = body();
      this.db.exec("COMMIT");
      return value;
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch { /* Keep the original commit/boundary failure. */ }
      throw error;
    }
  }

  private importLegacy(): void {
    const root = join(this.home, "submission-journal");
    if (!existsSync(root)) return;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
      const path = join(root, entry.name);
      if (!readdirSync(path).length) continue;
      // Mapping an unresolved identity is permanent. Reopening the profile must
      // not import the same original directory under its old unmapped name.
      if (this.db.query("SELECT id FROM legacy WHERE source=?").get(path)) continue;
      let identity = `unmapped:${entry.name}`;
      try {
        const owner: unknown = JSON.parse(readFileSync(join(path, "owner.json"), "utf8"));
        const raw = (owner as { operation?: unknown })?.operation;
        if (typeof raw === "string") {
          const scoped = /^[a-f0-9]{64}:([a-f0-9]{64})$/.exec(raw);
          identity = scoped ? `native:${scoped[1]}` : raw;
        }
      } catch { /* Corrupt ownership is retained as an unresolved migration fact. */ }
      const status = existsSync(join(path, "cancelled.json")) ? "cancelled"
        : existsSync(join(path, "final.json")) ? "legacy-completed" : "unknown";
      this.db.query("INSERT OR IGNORE INTO legacy(id,status,source) VALUES(?,?,?)").run(identity, status, path);
    }
  }

  private fromRow(row: Row): Operation {
    if (digest(row.state) !== row.checksum) throw new Error("State checksum mismatch; automatic recovery is prohibited");
    return { id: row.id, capability: row.capability, context: JSON.parse(row.context) as Context,
      state: decode<State>(row.state, "application-domain.State"),
      revision: row.revision, created: row.created, ...(row.page ? { page: row.page } : {}), ...(row.document ? { document: row.document } : {}),
      placement: JSON.parse(row.placement) as Placement };
  }

  get(id: string): Operation {
    const row = this.db.query("SELECT * FROM operations WHERE id=?").get(id) as Row | null;
    if (!row) throw new BridgeError("operation_not_found", "The operation does not exist", 404);
    return this.fromRow(row);
  }

  find(id: string): Operation | undefined {
    const row = this.db.query("SELECT * FROM operations WHERE id=?").get(id) as Row | null;
    return row ? this.fromRow(row) : undefined;
  }

  request(key: string): RequestRecord | undefined {
    return (this.db.query("SELECT * FROM requests WHERE key=?").get(key) as RequestRecord | null) ?? undefined;
  }

  responseRecord(id: string): RequestRecord {
    const row = this.db.query("SELECT * FROM requests WHERE response_id=?").get(id) as RequestRecord | null;
    if (!row) throw new BridgeError("previous_response_not_found", "The response is not retained by this API version and profile", 404);
    return row;
  }

  /** Preview outside a transaction; authoritative recheck inside admission. */
  admission(request: RequestIdentity): ReturnType<typeof compiled.request_admit> {
    const old = this.request(request.round);
    const key: Parameters<typeof compiled.request_admit>[0] = { $: old
      ? old.fingerprint === request.fingerprint ? "RepeatedKey" : "ConflictingKey" : "FreshKey" };
    let parent: Parameters<typeof compiled.request_admit>[1] = { $: "Root" };
    if (!old && request.previous) {
      const prior = this.db.query("SELECT * FROM requests WHERE response_id=?").get(request.previous) as RequestRecord | null;
      if (!prior) parent = { $: "Missing" };
      else if (this.db.query("SELECT key FROM requests WHERE previous=?").get(request.previous)) parent = { $: "Claimed" };
      else {
        const body = this.round(prior.operation, prior.key);
        const operation = this.get(prior.operation);
        if (operation.state.broker.lifetime.$ === "Retired") parent = { $: "Unavailable" };
        else if (!body) parent = { $: "Pending" };
        else {
          const status = (JSON.parse(body) as ObjectValue).status;
          if (status === "requires_action") parent = { $: "Calls" };
          else if (status === "completed") {
            const row = operation.page ? this.db.query("SELECT body,owner FROM receipts WHERE page=?").get(operation.page) as { body: string; owner: string | null } | null : null;
            parent = !row ? { $: "Unavailable" }
              : row.owner !== null || (JSON.parse(row.body) as RetainedReceipt).operation !== operation.id ? { $: "Claimed" } : { $: "Answered" };
          } else parent = { $: "Unavailable" };
        }
      }
    }
    const decision = compiled.request_admit(key, parent, { $: request.kind });
    if (decision.$ === "Denied") {
      const errors = {
        KeyConflict: ["idempotency_conflict", "This Idempotency-Key already belongs to a different request", 409],
        PreviousMissing: ["previous_response_not_found", "The response is not retained by this API version and profile", 404],
        PreviousPending: ["previous_response_pending", "Observe the existing request until it returns tool calls or a final answer", 409],
        PreviousConsumed: ["previous_response_consumed", "This predecessor already has a successor; retry that successor's Idempotency-Key", 409],
        PreviousUnavailable: ["previous_response_unavailable", "The original webpage is unavailable; no replacement page was allocated", 409],
        MessagesRequired: ["messages_required", "This predecessor requires new messages, not tool results", 409],
        ResultsRequired: ["tool_results_required", "Return the complete tool-result batch for this predecessor", 409],
      } as const;
      const [code, message, status] = errors[decision.reason.$];
      throw new BridgeError(code, message, status);
    }
    return decision;
  }

  private registerInside(request: ParsedRequest): void {
    this.db.query("INSERT INTO requests(key,fingerprint,previous,operation,response_id,kind,created) VALUES(?,?,?,?,?,?,?)")
      .run(request.round, request.fingerprint, request.previous, request.id, request.responseId, request.kind, Date.now());
  }

  registerResults(request: ParsedRequest): Operation {
    return this.atomic(() => {
      const decision = this.admission(request);
      if (decision.$ !== "Replay") {
        if (decision.$ !== "DeliverResults") throw new Error("Tool results require a checked delivery decision");
        this.registerInside(request);
      }
      return this.get(request.id);
    });
  }

  byCapability(capability: string): Operation {
    if (capability.length < 20 || capability.length > 256) throw new BridgeError("invalid_capability", "A valid turn_token is required", 401);
    const row = this.db.query("SELECT * FROM operations WHERE token_hash=?").get(digest(capability)) as Row | null;
    if (!row) throw new BridgeError("invalid_capability", "The turn capability is not recognized", 401);
    return this.fromRow(row);
  }

  private createInside(id: string, context: Context, suppliedCapability?: string): { operation: Operation; created: boolean } {
      const existing = this.find(id);
      if (existing) return { operation: existing, created: false };
      if (this.db.query("SELECT id FROM legacy WHERE id=?").get(id))
        throw new BridgeError("legacy_operation_retained", "This native operation has an old ownership receipt. Inspect its original page; migration does not authorize another send.", 409);
      if (this.db.query("SELECT id FROM legacy WHERE id LIKE 'unmapped:%' LIMIT 1").get())
        throw new BridgeError("legacy_identity_unknown", "An unresolved legacy ownership identity prevents safe admission. Inspect and map that receipt with the migration command; it cannot be ignored.", 409);
      const state = initialize(context.mode === "full", context.tools.map(tool => tool.wire), context.environment);
      const encoded = encode(state);
      const frozen = canonical(context);
      if (Buffer.byteLength(encoded) + Buffer.byteLength(frozen) > FRAME_LIMIT) throw new BridgeError("payload_too_large", "The operation exceeds storage capacity", 413);
      const capability = suppliedCapability ?? `turn_${randomBytes(32).toString("base64url")}`;
      this.db.query("INSERT INTO operations(id,token_hash,capability,context,transcript,state,checksum,revision,page,document,placement,created,updated) VALUES(?,?,?,?,?,?,?,0,NULL,NULL,?,?,?)")
        .run(id, digest(capability), capability, frozen, "[]", encoded, digest(encoded), canonical({}), Date.now(), Date.now());
      return { operation: this.get(id), created: true };
  }

  create(id: string, context: Context): { operation: Operation; created: boolean } {
    return this.atomic(() => this.createInside(id, context));
  }

  admit(request: ParsedRequest, context: Context, capability: string, placement: Placement, payloads: string[]): Change & { created: boolean } {
    const id = request.id;
    const change = this.atomic(() => {
      const decision = this.admission(request);
      if (decision.$ === "Replay") return { operation: this.get(id), created: false, decisions: [], effects: [], changed: false };
      if (decision.$ !== "NewPage" && decision.$ !== "Append") throw new Error("A browser message requires checked admission");
      if ((decision.$ === "Append") !== !!placement.page) throw new Error("Placement disagrees with the explicit predecessor");
      const creation = this.createInside(id, context, capability);
      if (!creation.created) throw new Error("An operation exists without its request identity");
      if (placement.page) {
        const row = this.db.query("SELECT body,owner FROM receipts WHERE page=?").get(placement.page) as { body: string; owner: string | null } | null;
        if (!row || row.owner !== null || canonical(placement.receipt) !== row.body)
          throw new BridgeError("previous_response_unavailable", "The original page changed before admission; no replacement page was allocated", 409);
        this.db.query("UPDATE receipts SET owner=? WHERE page=?").run(id, placement.page);
      }
      this.db.query("UPDATE operations SET placement=? WHERE id=?").run(canonical(placement), id);
      this.registerInside(request);
      const installed = this.changeInside(id, [{ $: "Install", payloads: listForStore(payloads) }]);
      if (installed.decisions[0]?.reply.$ === "Rejected") throw new Error("A newly reserved operation rejected its measured plan");
      return { ...installed, created: true };
    });
    this.notify(id);
    return change;
  }

  private changeInside(id: string, inputs: readonly Input[]): Change {
    const original = this.get(id);
    let state = original.state;
    let revision = original.revision;
    const decisions: Decision[] = [];
    const effects: number[] = [];
    for (const input of inputs) {
      const decision = transition(state, input);
      const encoded = encode(decision);
      if (Buffer.byteLength(encoded) > FRAME_LIMIT) throw new BridgeError("decision_too_large", "The complete decision cannot be committed", 413);
      // Identical, silent, effect-free observations carry no new durable fact.
      // This is an exact representation comparison, not another state machine.
      if (decision.effect.$ === "Passive" && encode(decision.state) === encode(state)) {
        decisions.push(decision);
        continue;
      }
      revision++;
      this.db.query("INSERT INTO events(operation,revision,input,decision) VALUES(?,?,?,?)").run(id, revision, encode(input), encoded);
      if (decision.effect.$ !== "Passive") {
        const result = this.db.query("INSERT INTO effects(operation,revision,body,status) VALUES(?,?,?,'new')").run(id, revision, encode(decision.effect));
        effects.push(Number(result.lastInsertRowid));
      }
      state = decision.state;
      decisions.push(decision);
    }
    const encoded = encode(state);
    this.db.query("UPDATE operations SET state=?,checksum=?,revision=?,updated=? WHERE id=?").run(encoded, digest(encoded), revision, Date.now(), id);
    return { operation: { ...original, state, revision }, decisions, effects, changed: revision !== original.revision };
  }

  change(id: string, inputs: readonly Input[], receipt?: RetainedReceipt): Change {
    const result = this.atomic(() => {
      const pending = this.get(id).state.output.$ === "None";
      const change = this.changeInside(id, inputs);
      // The final result and its continuation authority commit together.
      if (receipt && pending && change.operation.state.output.$ === "Some") this.retainInside(receipt);
      return change;
    });
    if (result.changed) this.notify(id);
    return result;
  }

  pollRound(id: string, key: string, encoder: (operation: Operation, decision: Decision) => string | undefined): { body?: string; change?: Change } {
    const result = this.atomic(() => {
      const cached = this.round(id, key);
      if (cached !== undefined) return { body: cached, change: undefined };
      const change = this.changeInside(id, [{ $: "Poll" }]);
      // Encode the whole reply before committing native delivery. A codec or
      // capacity failure rolls back this transition and all its events.
      const body = encoder(change.operation, change.decisions.at(-1)!);
      if (body !== undefined) {
        if (Buffer.byteLength(body) > FRAME_LIMIT) throw new BridgeError("response_too_large", "The native reply cannot be committed within transport capacity", 413);
        this.db.query("INSERT INTO rounds(operation,key,body) VALUES(?,?,?)").run(id, key, body);
      }
      return { ...(body !== undefined ? { body } : {}), change };
    });
    if (result.change?.changed) this.notify(id);
    return result;
  }

  /** A claimed intent is never claimed again, including after process death. */
  claim(id: number): ClaimedEffect | undefined {
    return this.atomic(() => {
      const row = this.db.query("SELECT id,operation,body FROM effects WHERE id=? AND status='new'").get(id) as { id: number; operation: string; body: string } | null;
      if (!row) return undefined;
      const effect = decode<Effect>(row.body, "application-domain.Effect");
      if (!compiled.app_authorized(this.get(row.operation).state, effect)) {
        this.db.query("UPDATE effects SET status='withdrawn' WHERE id=?").run(id);
        return undefined;
      }
      this.db.query("UPDATE effects SET status='claimed' WHERE id=?").run(id);
      return { id: row.id, operation: row.operation, effect };
    });
  }

  settle(id: number, success: boolean): void {
    this.db.query("UPDATE effects SET status=? WHERE id=? AND status='claimed'").run(success ? "recorded" : "unknown", id);
  }

  recover(): Change[] {
    const changes = this.atomic(() => {
      const result = (this.db.query("SELECT id FROM operations").all() as { id: string }[])
        .map(row => this.changeInside(row.id, [{ $: "Restore" }]));
      this.db.exec("UPDATE effects SET status='unknown' WHERE status IN ('new','claimed')");
      return result;
    });
    for (const change of changes) this.notify(change.operation.id);
    return changes;
  }

  bindPage(id: string, page: string, document: string): void {
    this.atomic(() => {
      const op = this.get(id);
      if (op.page && (op.page !== page || op.document !== document)) throw new Error("Page ownership cannot be rebound");
      this.db.query("UPDATE operations SET page=?,document=? WHERE id=?").run(page, document, id);
    });
  }

  receipt(operation: Operation): RetainedReceipt | undefined {
    if (!operation.page) return undefined;
    const row = this.db.query("SELECT body,owner FROM receipts WHERE page=?").get(operation.page) as { body: string; owner: string | null } | null;
    if (!row || row.owner !== null) return undefined;
    const receipt = JSON.parse(row.body) as RetainedReceipt;
    return receipt.operation === operation.id ? receipt : undefined;
  }

  private retainInside(receipt: RetainedReceipt): void {
    const op = this.get(receipt.operation);
    if (op.state.output.$ !== "Some" || op.page !== receipt.page || op.document !== receipt.document || op.state.latest !== receipt.answer)
      throw new Error("A continuation requires its committed final answer and original document");
    const old = this.db.query("SELECT body,owner FROM receipts WHERE page=?").get(receipt.page) as { body: string; owner: string | null } | null;
    if (old) {
      const previous = JSON.parse(old.body) as RetainedReceipt;
      if (previous.operation === op.id) return; // Never release a successor's existing claim.
      if (old.owner !== op.id || op.placement.receipt?.operation !== previous.operation)
        throw new Error("A stale final receipt cannot replace the current page owner");
    }
    this.db.query("INSERT INTO receipts(page,body,owner) VALUES(?,?,NULL) ON CONFLICT(page) DO UPDATE SET body=excluded.body,owner=NULL")
      .run(receipt.page, canonical(receipt));
  }

  /** Validate and commit the complete result batch and causal fence atomically. */
  completeResults(request: ParsedRequest, baseline: string): Change {
    const change = this.atomic(() => {
      const operation = this.get(request.id);
      const invocations = array(operation.state.broker.invocations);
      const inputs: Input[] = [];
      for (const result of request.results) {
        const id = String(result.call_id);
        const invocation = invocations.find(item => item.id === id);
        if (!invocation || invocation.delivery.$ === "Queued")
          throw new BridgeError("result_before_delivery", "A result must name a delivered call from the predecessor response", 409);
        const body = canonical(result.output);
        if (Buffer.byteLength(body) > FRAME_LIMIT) throw new BridgeError("result_too_large", "A result exceeds storage capacity", 413);
        const hash = digest(body);
        const old = this.blob(operation.id, `result:${id}`);
        if ((old !== undefined && old !== body) || (invocation.delivery.$ === "Result" && invocation.delivery.digest !== hash))
          throw new BridgeError("conflicting_receipt", "A delivered result already has different contents", 409);
        if (invocation.delivery.$ === "Result") continue;
        this.db.query("INSERT OR IGNORE INTO blobs(operation,key,digest,body) VALUES(?,?,?,?)").run(operation.id, `result:${id}`, hash, body);
        inputs.push({ $: "ToolResult", id, digest: hash, baseline });
      }
      const accepted = this.changeInside(operation.id, inputs);
      for (const decision of accepted.decisions) {
        const reply = decision.reply;
        if (reply.$ !== "ToolReceipt" || (reply.receipt.$ !== "ResultAccepted" && reply.receipt.$ !== "ResultReplayed"))
          throw new BridgeError("tool_result_not_accepted", "The checked operation no longer accepts this result; no result blobs were committed", 409);
      }
      return accepted;
    });
    if (change.changed) this.notify(request.id);
    return change;
  }

  putBlob(id: string, key: string, body: string): string {
    if (Buffer.byteLength(body) > FRAME_LIMIT) throw new BridgeError("result_too_large", "Result exceeds storage capacity; it was not re-executed", 413);
    const hash = digest(body);
    this.atomic(() => {
      const old = this.db.query("SELECT digest FROM blobs WHERE operation=? AND key=?").get(id, key) as { digest: string } | null;
      if (old && old.digest !== hash) throw new BridgeError("conflicting_receipt", "An existing receipt has different contents", 409);
      this.db.query("INSERT OR IGNORE INTO blobs(operation,key,digest,body) VALUES(?,?,?,?)").run(id, key, hash, body);
    });
    return hash;
  }

  /** The local MCP output and its causal boundary commit together. */
  completeLocal(id: string, activity: string, body: string, baseline: string): Change {
    if (Buffer.byteLength(body) > FRAME_LIMIT) throw new BridgeError("result_too_large", "Local receipt exceeds storage capacity", 413);
    const change = this.atomic(() => {
      const key = `local:${activity}`;
      const hash = digest(body);
      const old = this.blob(id, key);
      if (old !== undefined && old !== body) throw new BridgeError("conflicting_receipt", "The local result changed", 409);
      this.db.query("INSERT OR IGNORE INTO blobs(operation,key,digest,body) VALUES(?,?,?,?)").run(id, key, hash, body);
      return this.changeInside(id, [{ $: "LocalResult", id: activity, baseline }]);
    });
    this.notify(id);
    return change;
  }

  blob(id: string, key: string): string | undefined {
    const row = this.db.query("SELECT digest,body FROM blobs WHERE operation=? AND key=?").get(id, key) as { digest: string; body: string } | null;
    if (row && digest(row.body) !== row.digest) throw new Error("Result receipt checksum mismatch");
    return row?.body;
  }

  round(id: string, key: string): string | undefined {
    return (this.db.query("SELECT body FROM rounds WHERE operation=? AND key=?").get(id, key) as { body: string } | null)?.body;
  }

  previous(response: string): { operation: Operation; body: ObjectValue; key: string } {
    const record = this.responseRecord(response);
    const body = this.round(record.operation, record.key);
    if (body === undefined) throw new BridgeError("previous_response_pending", "The response has no committed output yet", 409);
    return { operation: this.get(record.operation), body: JSON.parse(body) as ObjectValue, key: record.key };
  }

  setting<T>(key: string): T | undefined {
    const row = this.db.query("SELECT value FROM metadata WHERE key=?").get(`setting:${key}`) as { value: string } | null;
    return row ? JSON.parse(row.value) as T : undefined;
  }

  saveSetting(key: string, value: unknown): void {
    this.db.query("INSERT INTO metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(`setting:${key}`, canonical(value));
  }

  summaries(): Record<string, unknown>[] {
    return (this.db.query("SELECT * FROM operations ORDER BY updated DESC LIMIT 200").all() as Row[]).map(row => {
      const op = this.fromRow(row);
      const phase = op.state.batch.$ === "Batch" || op.state.batch.$ === "Closed" ? op.state.batch.phase.$ : "Prepared";
      return { id: op.id, model: op.context.model, phase, revision: op.revision, page: op.page ?? null,
        // Capabilities, contexts, credentials, and tool payloads are never dashboard fields.
        updated: (row as Row & { updated: number }).updated };
    });
  }

  subscribe(listener: (operation: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(id: string): void {
    for (const listener of this.listeners) { try { listener(id); } catch { /* A subscriber cannot roll back committed work. */ } }
  }

  close(): void { this.db.close(); }
}
