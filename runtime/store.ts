/** SQLite is an effect interpreter: it never invents a lifecycle transition. */
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { BridgeError, type Context, type Placement, type RetainedReceipt } from "./contracts";
import { canonical, digest } from "./codec";
import { compiled, decode, encode, initialize, list as listForStore, transition, type Decision, type Effect, type Input, type State } from "./kernel";

const FRAME_LIMIT = 64 * 1024 * 1024;

export interface Operation {
  id: string;
  capability: string;
  context: Context;
  transcript: string[];
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
      CREATE TABLE IF NOT EXISTS responses(id TEXT PRIMARY KEY, operation TEXT NOT NULL, round_key TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS response_inputs(operation TEXT NOT NULL, round_key TEXT NOT NULL, input TEXT NOT NULL, PRIMARY KEY(operation,round_key));
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
      transcript: JSON.parse(row.transcript) as string[], state: decode<State>(row.state, "application-domain.State"),
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
        .run(id, digest(capability), capability, frozen, canonical(context.symbols), encoded, digest(encoded), canonical({ offset: 0 }), Date.now(), Date.now());
      return { operation: this.get(id), created: true };
  }

  create(id: string, context: Context): { operation: Operation; created: boolean } {
    return this.atomic(() => this.createInside(id, context));
  }

  admit(id: string, context: Context, capability: string, placement: Placement, payloads: string[]): Change & { created: boolean } {
    const change = this.atomic(() => {
      const creation = this.createInside(id, context, capability);
      if (!creation.created) return { operation: creation.operation, created: false, decisions: [], effects: [], changed: false };
      if (placement.page) {
        const row = this.db.query("SELECT body,owner FROM receipts WHERE page=?").get(placement.page) as { body: string; owner: string | null } | null;
        if (!row || row.owner !== null || canonical(placement.receipt) !== row.body)
          throw new BridgeError("history_lease_changed", "The retained page was claimed by another operation before admission", 409);
        this.db.query("UPDATE receipts SET owner=? WHERE page=?").run(id, placement.page);
      }
      this.db.query("UPDATE operations SET placement=? WHERE id=?").run(canonical(placement), id);
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

  change(id: string, inputs: readonly Input[]): Change {
    const result = this.atomic(() => this.changeInside(id, inputs));
    if (result.changed) this.notify(id);
    return result;
  }

  pollRound(id: string, key: string, input: unknown[], encoder: (operation: Operation, decision: Decision) => string | undefined): { body?: string; change?: Change } {
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
        this.db.query("INSERT INTO response_inputs(operation,round_key,input) VALUES(?,?,?)").run(id, key, canonical(input));
        const response = JSON.parse(body) as { id?: unknown };
        if (typeof response.id === "string") this.db.query("INSERT OR IGNORE INTO responses(id,operation,round_key) VALUES(?,?,?)").run(response.id, id, key);
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

  place(id: string, placement: Placement): boolean {
    return this.atomic(() => {
      if (placement.page) {
        const result = this.db.query("UPDATE receipts SET owner=? WHERE page=? AND owner IS NULL").run(id, placement.page);
        if (result.changes !== 1) return false;
      }
      this.db.query("UPDATE operations SET placement=? WHERE id=?").run(canonical(placement), id);
      return true;
    });
  }

  receipts(): RetainedReceipt[] {
    return (this.db.query("SELECT body FROM receipts WHERE owner IS NULL ORDER BY page").all() as { body: string }[]).map(row => JSON.parse(row.body) as RetainedReceipt);
  }

  retain(receipt: RetainedReceipt): void {
    this.atomic(() => {
      const op = this.get(receipt.operation);
      if (op.state.output.$ !== "Some" || op.page !== receipt.page || op.document !== receipt.document)
        throw new Error("A retained page requires its committed final receipt");
      this.db.query("INSERT INTO receipts(page,body,owner) VALUES(?,?,NULL) ON CONFLICT(page) DO UPDATE SET body=excluded.body,owner=NULL").run(receipt.page, canonical(receipt));
    });
  }

  transcript(id: string, symbols: string[]): void {
    this.atomic(() => {
      const operation = this.get(id);
      const old = operation.transcript;
      const environment = operation.context.environment;
      const extendsOld = compiled.history_plan(environment, environment, listForStore(old), listForStore([...symbols, "!transport-end"]));
      if (extendsOld.$ === "Some" && extendsOld.value === BigInt(old.length)) {
        this.db.query("UPDATE operations SET transcript=? WHERE id=?").run(canonical(symbols), id);
        return;
      }
      const replaysOld = compiled.history_plan(environment, environment, listForStore(symbols), listForStore([...old, "!transport-end"]));
      if (replaysOld.$ !== "Some" || replaysOld.value !== BigInt(symbols.length))
        throw new BridgeError("history_branch_conflict", "Concurrent API rounds disagree about the retained transcript. The webpage is not changed.", 409);
    });
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

  saveRound(id: string, key: string, body: string, input?: unknown[]): string {
    if (Buffer.byteLength(body) > FRAME_LIMIT) throw new BridgeError("response_too_large", "Encoded response exceeds storage capacity", 413);
    return this.atomic(() => {
      this.db.query("INSERT OR IGNORE INTO rounds(operation,key,body) VALUES(?,?,?)").run(id, key, body);
      const saved = this.round(id, key)!;
      this.db.query("INSERT OR IGNORE INTO response_inputs(operation,round_key,input) VALUES(?,?,?)").run(id, key, canonical(input ?? this.get(id).context.input));
      const response = JSON.parse(saved) as { id?: unknown };
      if (typeof response.id === "string") this.db.query("INSERT OR IGNORE INTO responses(id,operation,round_key) VALUES(?,?,?)").run(response.id, id, key);
      return saved;
    });
  }

  previous(response: string): { operation: Operation; input: import("./contracts").ObjectValue[]; output: unknown[] } {
    const row = this.db.query("SELECT operation,round_key FROM responses WHERE id=?").get(response) as { operation: string; round_key: string } | null;
    if (!row) throw new BridgeError("previous_response_not_found", "The previous response is not retained in this profile", 404);
    const body = JSON.parse(this.round(row.operation, row.round_key)!) as { output: unknown[] };
    const source = this.db.query("SELECT input FROM response_inputs WHERE operation=? AND round_key=?").get(row.operation, row.round_key) as { input: string } | null;
    if (!source) throw new BridgeError("previous_input_missing", "The previous response's exact input is not retained", 409);
    return { operation: this.get(row.operation), input: JSON.parse(source.input), output: body.output };
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
      return { id: op.id, model: op.context.model, purpose: op.context.purpose, phase, revision: op.revision, page: op.page ?? null,
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
