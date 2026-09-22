import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

import {
  AstraJevError,
  type HistoryDetail,
  type HistorySummary,
  type JevDecision,
  type JevDecisionContext,
  type JevLeaseSteps,
  type OverlayUpdate,
  type PreparedHistory,
  type ReasoningEffort,
  type RecentMessage,
} from "./types";

const STATE_VERSION = 1;
const HISTORY_RETENTION_MS = 24 * 60 * 60 * 1_000;
const RECENT_MESSAGE_LIMIT = 8;
const RECENT_MESSAGE_TEXT_LIMIT = 4_000;
const ABORT_STATUS = 499;
const REASONING_EFFORT_VALUES: readonly ReasoningEffort[] = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
];
const LEASE_STEP_VALUES: readonly JevLeaseSteps[] = [1, 2, 5, 10];

type JsonRecord = Record<string, unknown>;

interface PersistedOverlay extends OverlayUpdate {
  prefixFingerprint: string;
  generation: number;
}

interface PersistedPrepared {
  requestFingerprint: string;
  normalizedInputFingerprint: string;
  generation: number;
  effort: ReasoningEffort;
  leaseRemaining: number;
  decisionSource: "jev" | "lease";
  overlayId: string | null;
}

interface PersistedHistory extends HistorySummary {
  overlays: PersistedOverlay[];
  generation: number;
  leaseRemaining: number;
  leaseEffort: ReasoningEffort | null;
  baselineEffort: ReasoningEffort | null;
  lastPrepared: PersistedPrepared | null;
  lastInputLength: number;
  lastInputFingerprint: string | null;
  lastUserCount: number;
  lastUserBoundary: string | null;
  lastToolFailureCount: number;
  lastToolFailureFingerprint: string | null;
  compactionFingerprints: string[];
  recentMessages: RecentMessage[];
}

interface PersistedState {
  version: typeof STATE_VERSION;
  histories: Record<string, PersistedHistory>;
}

interface QueueState {
  tail: Promise<void>;
}

interface UserFacts {
  count: number;
  latestBoundary: string | null;
}

interface ToolFailureFacts {
  count: number;
  fingerprint: string | null;
}

interface RequestFacts {
  model: string | null;
  baselineEffort: ReasoningEffort | null;
  normalizedInput: unknown[];
  normalizedInputFingerprint: string;
  requestFingerprint: string;
  user: UserFacts;
  toolFailures: ToolFailureFacts;
  compactionFingerprints: string[];
  newCompaction: boolean;
  historyReplacement: boolean;
  modelBoundary: boolean;
  baselineBoundary: boolean;
  userBoundary: boolean;
  toolFailureBoundary: boolean;
  effectiveBeforeDecision: ReasoningEffort | null;
  wireInput: unknown[];
}

interface ReconciledRequest {
  body: Record<string, unknown>;
  facts: RequestFacts;
}

interface QueueRelease {
  (): void;
}

export interface HistorySession {
  prepare(decide: (context: JevDecisionContext) => Promise<JevDecision>): Promise<PreparedHistory>;
  complete(output?: unknown[]): void;
  abort(): void;
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === "string" && (REASONING_EFFORT_VALUES as readonly string[]).includes(value);
}

function isLeaseSteps(value: unknown): value is JevLeaseSteps {
  return typeof value === "number" && (LEASE_STEP_VALUES as readonly number[]).includes(value);
}

function stableJson(value: unknown, seen = new Set<unknown>()): string {
  if (value === null) return "null";
  if (value === undefined) return '"__undefined__"';
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (Number.isNaN(value)) return '"__nan__"';
    if (!Number.isFinite(value)) return value > 0 ? '"__infinity__"' : '"__negative_infinity__"';
    return JSON.stringify(value);
  }
  if (typeof value === "bigint") return JSON.stringify(`${value}n`);
  if (typeof value !== "object") return JSON.stringify(String(value));
  if (seen.has(value)) throw new AstraJevError(400, "invalid_request_body", "Request body contains a cycle");
  seen.add(value);
  let result: string;
  if (Array.isArray(value)) {
    result = `[${value.map((entry) => stableJson(entry, seen)).join(",")}]`;
  } else {
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object).sort();
    result = `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(object[key], seen)}`).join(",")}}`;
  }
  seen.delete(value);
  return result;
}

function fingerprintValue(value: unknown, seen = new Set<unknown>()): unknown {
  if (value === null || value === undefined || typeof value !== "object") return value;
  if (seen.has(value)) throw new AstraJevError(400, "invalid_request_body", "Request body contains a cycle");
  seen.add(value);
  let result: unknown;
  if (Array.isArray(value)) {
    result = value.map((entry) => fingerprintValue(entry, seen));
  } else {
    const record = value as Record<string, unknown>;
    const type = typeof record.type === "string" ? record.type.toLowerCase() : "";
    const omitDynamicId = type === "configuration_update" || type.includes("compaction");
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(record)) {
      if (omitDynamicId && (key === "id" || key === "item_id" || key === "request_id" || key === "response_id")) continue;
      normalized[key] = fingerprintValue(record[key], seen);
    }
    result = normalized;
  }
  seen.delete(value);
  return result;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(stableJson(fingerprintValue(value)), "utf8").digest("hex");
}

function inputPrefixFingerprint(input: unknown[], length: number): string {
  return fingerprint(input.slice(0, length));
}

function requestInput(body: Record<string, unknown>): unknown[] {
  if (!Array.isArray(body.input)) {
    throw new AstraJevError(400, "invalid_input", "Astra Jev requires a full input array on every request");
  }
  if (body.input.length === 0) {
    throw new AstraJevError(400, "empty_input", "Astra Jev requires at least one retained input item");
  }
  return body.input;
}

function requestModel(body: Record<string, unknown>): string | null {
  return typeof body.model === "string" && body.model.length > 0 ? body.model : null;
}

function requestBaselineEffort(body: Record<string, unknown>): ReasoningEffort | null {
  const reasoning = isRecord(body.reasoning) ? body.reasoning : undefined;
  return reasoning && isReasoningEffort(reasoning.effort) ? reasoning.effort : null;
}

function itemType(item: unknown): string {
  return isRecord(item) && typeof item.type === "string" ? item.type : "item";
}

function itemRole(item: unknown): string | null {
  return isRecord(item) && typeof item.role === "string" ? item.role : null;
}

function configurationEffort(item: unknown): ReasoningEffort | null {
  if (!isRecord(item) || item.type !== "configuration_update" || !isRecord(item.reasoning)) return null;
  return isReasoningEffort(item.reasoning.effort) ? item.reasoning.effort : null;
}

function isCompactionItem(item: unknown): boolean {
  const type = itemType(item).toLowerCase();
  return type.includes("compaction");
}

function isUserItem(item: unknown): boolean {
  return itemRole(item)?.toLowerCase() === "user";
}

function toolFailureMarker(item: unknown): string | null {
  if (!isRecord(item)) return null;
  const type = typeof item.type === "string" ? item.type.toLowerCase() : "";
  const role = typeof item.role === "string" ? item.role.toLowerCase() : "";
  const status = typeof item.status === "string" ? item.status.toLowerCase() : "";
  const failedStatus =
    status === "failed" ||
    status === "failure" ||
    status === "error" ||
    status === "errored" ||
    status.includes("fail") ||
    status.includes("error");
  const explicitFailure =
    item.is_error === true ||
    item.success === false ||
    item.error !== undefined ||
    failedStatus ||
    type.includes("error") ||
    ((type.includes("tool") || role === "tool") && typeof item.output === "string" && /\berror\b|\bfailed\b/i.test(item.output));
  if (!explicitFailure) return null;
  const marker: JsonRecord = { type, role, status };
  if (typeof item.error === "string") marker.error = item.error.slice(0, 1_000);
  else if (isRecord(item.error)) marker.error = cloneJson(item.error);
  if (typeof item.output === "string") marker.output = item.output.slice(0, 1_000);
  return stableJson(marker);
}

function userFacts(input: unknown[]): UserFacts {
  let count = 0;
  let latestBoundary: string | null = null;
  input.forEach((item, index) => {
    if (!isUserItem(item)) return;
    count += 1;
    latestBoundary = `${index + 1}:${fingerprint(input.slice(0, index))}:${fingerprint(item)}`;
  });
  return { count, latestBoundary };
}

function toolFailureFacts(input: unknown[]): ToolFailureFacts {
  const failures: string[] = [];
  input.forEach((item, index) => {
    const marker = toolFailureMarker(item);
    if (marker) failures.push(`${index + 1}:${marker}`);
  });
  return {
    count: failures.length,
    fingerprint: failures.length > 0 ? fingerprint(failures) : null,
  };
}

function compactionFacts(input: unknown[]): string[] {
  return input.filter(isCompactionItem).map((item) => fingerprint(item));
}

function textLimit(text: string): { text: string; truncated: boolean } {
  if (text.length <= RECENT_MESSAGE_TEXT_LIMIT) return { text, truncated: false };
  return { text: text.slice(0, RECENT_MESSAGE_TEXT_LIMIT), truncated: true };
}

function looksLikeEncodedData(key: string | undefined, value: string): boolean {
  if (key && /(?:base64|bytes|encrypted|image_url|audio|binary|data)/i.test(key)) return true;
  return /^data:[^;]+;base64,/i.test(value);
}

function visibleText(value: unknown, key?: string, depth = 0, seen = new Set<unknown>()): string {
  if (depth > 6 || value === null || value === undefined) return "";
  if (typeof value === "string") return looksLikeEncodedData(key, value) ? "" : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value !== "object") return "";
  if (seen.has(value)) return "";
  seen.add(value);
  if (Array.isArray(value)) {
    const text = value
      .map((entry) => visibleText(entry, key, depth + 1, seen))
      .filter(Boolean)
      .join("\n");
    seen.delete(value);
    return text;
  }
  const record = value as Record<string, unknown>;
  const hiddenKeys = new Set([
    "reasoning",
    "encrypted_content",
    "hidden_reasoning",
    "image_url",
    "audio_url",
    "base64",
    "bytes",
    "data",
  ]);
  const preferredKeys = ["text", "output_text", "summary", "message", "error", "content", "output", "input", "arguments"];
  const pieces: string[] = [];
  for (const preferred of preferredKeys) {
    if (!(preferred in record) || hiddenKeys.has(preferred)) continue;
    const piece = visibleText(record[preferred], preferred, depth + 1, seen);
    if (piece) pieces.push(piece);
  }
  if (pieces.length === 0) {
    for (const [entryKey, entryValue] of Object.entries(record)) {
      if (hiddenKeys.has(entryKey) || entryKey === "type" || entryKey === "role") continue;
      const piece = visibleText(entryValue, entryKey, depth + 1, seen);
      if (piece) pieces.push(piece);
    }
  }
  seen.delete(value);
  return pieces.join("\n");
}

function previewForItem(item: unknown, index: number): RecentMessage | null {
  const record = isRecord(item) ? item : undefined;
  const type = itemType(item);
  if (type === "configuration_update") return null;
  const role = itemRole(item);
  let text = visibleText(item);
  if (!text && record && typeof record.type === "string") text = `[${record.type}]`;
  if (!text) return null;
  const bounded = textLimit(text);
  return {
    id: `message-${index}-${fingerprint(item).slice(0, 16)}`,
    index,
    type,
    role,
    text: bounded.text,
    truncated: bounded.truncated,
  };
}

function previewsForInput(input: unknown[], indexOffset = 0): RecentMessage[] {
  const previews: RecentMessage[] = [];
  input.forEach((item, index) => {
    const preview = previewForItem(item, indexOffset + index + 1);
    if (preview) previews.push(preview);
  });
  return previews.slice(-RECENT_MESSAGE_LIMIT);
}

function requestFingerprint(body: Record<string, unknown>, normalizedInput: unknown[]): string {
  const semanticBody = cloneJson(body);
  semanticBody.input = normalizedInput;
  // These values describe delivery, rather than the semantic request being retried.
  for (const key of ["id", "request_id", "response_id", "stream", "stream_options"]) delete semanticBody[key];
  return fingerprint(semanticBody);
}

function overlayItem(effort: ReasoningEffort): Record<string, unknown> {
  return {
    type: "configuration_update",
    reasoning: { effort },
  };
}

function mergedInput(input: unknown[], overlays: PersistedOverlay[]): unknown[] {
  const byBoundary = new Map<number, PersistedOverlay[]>();
  for (const overlay of overlays) {
    const entries = byBoundary.get(overlay.afterInputIndex) ?? [];
    entries.push(overlay);
    byBoundary.set(overlay.afterInputIndex, entries);
  }
  for (const entries of byBoundary.values()) {
    entries.sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
  }
  const result: unknown[] = [];
  for (let boundary = 0; boundary <= input.length; boundary += 1) {
    for (const overlay of byBoundary.get(boundary) ?? []) result.push(cloneJson(overlay.item));
    if (boundary < input.length) result.push(cloneJson(input[boundary]));
  }
  return result;
}

function effortFromHistory(body: Record<string, unknown>, wireInput: unknown[]): ReasoningEffort | null {
  let effort = requestBaselineEffort(body);
  for (const item of wireInput) {
    const itemEffort = configurationEffort(item);
    if (itemEffort) effort = itemEffort;
  }
  return effort;
}

function defaultTitle(id: string): string {
  return id.length > 40 ? `History ${id.slice(0, 40)}` : `History ${id}`;
}

function titleFromInput(id: string, input: unknown[]): string {
  for (const item of input) {
    if (!isUserItem(item)) continue;
    const text = visibleText(item).trim();
    if (text) return textLimit(text).text;
  }
  return defaultTitle(id);
}

function abortError(): AstraJevError {
  return new AstraJevError(ABORT_STATUS, "request_aborted", "Astra Jev request was cancelled before history preparation");
}

function clonePrepared(prepared: PreparedHistory): PreparedHistory {
  return {
    ...prepared,
    body: cloneJson(prepared.body),
  };
}

function validatePersistedHistory(id: string, value: unknown): asserts value is PersistedHistory {
  if (!isRecord(value) || value.id !== id) throw new Error(`history ${id} has an invalid record`);
  if (typeof value.title !== "string" || typeof value.createdAt !== "number" || typeof value.lastActiveAt !== "number") {
    throw new Error(`history ${id} has invalid timestamps or title`);
  }
  if (typeof value.expiresAt !== "number" || typeof value.activeRequests !== "number" || typeof value.updateCount !== "number") {
    throw new Error(`history ${id} has invalid activity fields`);
  }
  if (!Array.isArray(value.overlays) || !Array.isArray(value.recentMessages) || !Array.isArray(value.compactionFingerprints)) {
    throw new Error(`history ${id} has invalid persisted collections`);
  }
  if (typeof value.generation !== "number" || typeof value.leaseRemaining !== "number" || typeof value.lastInputLength !== "number") {
    throw new Error(`history ${id} has invalid generation state`);
  }
  for (const overlay of value.overlays) {
    if (
      !isRecord(overlay) ||
      typeof overlay.id !== "string" ||
      typeof overlay.afterInputIndex !== "number" ||
      typeof overlay.createdAt !== "number" ||
      !isRecord(overlay.item) ||
      typeof overlay.prefixFingerprint !== "string" ||
      typeof overlay.generation !== "number"
    ) {
      throw new Error(`history ${id} has an invalid overlay`);
    }
  }
  for (const preview of value.recentMessages) {
    if (
      !isRecord(preview) ||
      typeof preview.id !== "string" ||
      typeof preview.index !== "number" ||
      typeof preview.type !== "string" ||
      typeof preview.text !== "string" ||
      typeof preview.truncated !== "boolean"
    ) {
      throw new Error(`history ${id} has an invalid message preview`);
    }
  }
}

export class HistoryStore {
  private readonly directory: string;
  private readonly statePath: string;
  private state: PersistedState;
  private readonly queues = new Map<string, QueueState>();
  private readonly pendingCounts = new Map<string, number>();
  private closed = false;

  constructor(options: { directory: string }) {
    if (!options || typeof options.directory !== "string" || options.directory.length === 0) {
      throw new AstraJevError(500, "invalid_history_directory", "Astra Jev history directory is required");
    }
    this.directory = options.directory;
    this.statePath = join(this.directory, "history-state.json");
    mkdirSync(this.directory, { recursive: true });
    this.state = this.loadState();
    for (const history of Object.values(this.state.histories)) history.activeRequests = 0;
    this.sweep();
  }

  async begin(
    options: { id: string; body: Record<string, unknown>; supportedEfforts: ReasoningEffort[] },
    signal?: AbortSignal,
  ): Promise<HistorySession> {
    if (this.closed) throw new AstraJevError(500, "history_store_closed", "Astra Jev history store is closed");
    if (!options || typeof options.id !== "string" || options.id.length === 0) {
      throw new AstraJevError(400, "invalid_history_id", "A stable history identity is required");
    }
    if (!isRecord(options.body)) throw new AstraJevError(400, "invalid_request_body", "Astra Jev request body must be an object");
    if (!Array.isArray(options.supportedEfforts) || options.supportedEfforts.length === 0) {
      throw new AstraJevError(500, "invalid_supported_efforts", "Astra Jev has no supported reasoning efforts");
    }
    const supportedEfforts = options.supportedEfforts.filter(isReasoningEffort);
    if (supportedEfforts.length !== options.supportedEfforts.length) {
      throw new AstraJevError(500, "invalid_supported_efforts", "Astra Jev supported efforts contain an unknown value");
    }
    requestInput(options.body);
    if (signal?.aborted) throw abortError();

    this.sweep();
    const now = Date.now();
    let history = this.state.histories[options.id];
    if (!history) {
      history = this.newHistory(options.id, now);
      this.state.histories[options.id] = history;
    }
    const pending = this.pendingCounts.get(options.id) ?? 0;
    this.pendingCounts.set(options.id, pending + 1);
    history.activeRequests += 1;
    this.touch(history, now);
    this.saveState();

    let release: QueueRelease;
    try {
      release = await this.acquire(options.id, signal);
    } catch (error) {
      this.pendingCounts.set(options.id, Math.max(0, (this.pendingCounts.get(options.id) ?? 1) - 1));
      history.activeRequests = Math.max(0, history.activeRequests - 1);
      this.touch(history, Date.now());
      this.saveState();
      throw error;
    }
    this.pendingCounts.set(options.id, Math.max(0, (this.pendingCounts.get(options.id) ?? 1) - 1));
    if (signal?.aborted) {
      release();
      history.activeRequests = Math.max(0, history.activeRequests - 1);
      this.touch(history, Date.now());
      this.saveState();
      throw abortError();
    }

    let reconciled: ReconciledRequest;
    try {
      reconciled = this.reconcile(history, options.body);
      history.recentMessages = previewsForInput(reconciled.facts.normalizedInput);
      history.updateCount = history.overlays.length;
      this.touch(history, Date.now());
      this.saveState();
    } catch (error) {
      release();
      history.activeRequests = Math.max(0, history.activeRequests - 1);
      this.touch(history, Date.now());
      this.saveState();
      throw error;
    }

    return new HistorySessionImpl(this, history, options.id, supportedEfforts, reconciled, release, signal);
  }

  list(): HistorySummary[] {
    this.sweep();
    return Object.values(this.state.histories)
      .map((history) => this.summary(history))
      .sort((left, right) => right.lastActiveAt - left.lastActiveAt || left.id.localeCompare(right.id));
  }

  get(id: string): HistoryDetail | undefined {
    this.sweep();
    const history = this.state.histories[id];
    if (!history) return undefined;
    const updates = history.overlays
      .slice()
      .sort((left, right) => left.afterInputIndex - right.afterInputIndex || left.createdAt - right.createdAt)
      .map((overlay) => ({
        id: overlay.id,
        afterInputIndex: overlay.afterInputIndex,
        createdAt: overlay.createdAt,
        item: cloneJson(overlay.item),
        ...(overlay.reason ? { reason: overlay.reason } : {}),
      }));
    return {
      history: this.summary(history),
      recentMessages: cloneJson(history.recentMessages),
      updates,
    };
  }

  sweep(): void {
    const now = Date.now();
    let changed = false;
    for (const [id, history] of Object.entries(this.state.histories)) {
      const queued = this.pendingCounts.get(id) ?? 0;
      if (history.activeRequests > 0 || queued > 0) continue;
      if (history.expiresAt <= now || now - history.lastActiveAt >= HISTORY_RETENTION_MS) {
        delete this.state.histories[id];
        changed = true;
      }
    }
    if (changed) this.saveState();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.saveState();
  }

  private newHistory(id: string, now: number): PersistedHistory {
    return {
      id,
      title: defaultTitle(id),
      createdAt: now,
      lastActiveAt: now,
      expiresAt: now + HISTORY_RETENTION_MS,
      activeRequests: 0,
      model: null,
      effort: null,
      updateCount: 0,
      overlays: [],
      generation: 0,
      leaseRemaining: 0,
      leaseEffort: null,
      baselineEffort: null,
      lastPrepared: null,
      lastInputLength: 0,
      lastInputFingerprint: null,
      lastUserCount: 0,
      lastUserBoundary: null,
      lastToolFailureCount: 0,
      lastToolFailureFingerprint: null,
      compactionFingerprints: [],
      recentMessages: [],
    };
  }

  private reconcile(history: PersistedHistory, body: Record<string, unknown>): ReconciledRequest {
    const sourceInput = requestInput(body);
    const storedOverlays = history.overlays.slice();
    const normalizedInput: unknown[] = [];
    const consumed = new Set<string>();
    const storedItemKeys = storedOverlays.map((overlay) => fingerprint(overlay.item));
    for (const item of sourceInput) {
      const itemKey = fingerprint(item);
      let match = -1;
      for (let index = 0; index < storedItemKeys.length; index += 1) {
        if (!consumed.has(String(index)) && storedItemKeys[index] === itemKey) {
          match = index;
          break;
        }
      }
      if (match >= 0) consumed.add(String(match));
      else normalizedInput.push(cloneJson(item));
    }

    const normalizedInputFingerprint = fingerprint(normalizedInput);
    const retainedOverlays = storedOverlays.filter((overlay) => {
      if (overlay.afterInputIndex < 0 || overlay.afterInputIndex > normalizedInput.length) return false;
      return inputPrefixFingerprint(normalizedInput, overlay.afterInputIndex) === overlay.prefixFingerprint;
    });
    const currentModel = requestModel(body);
    const currentBaseline = requestBaselineEffort(body);
    const historyReplacement =
      history.lastInputFingerprint !== null &&
      (normalizedInput.length < history.lastInputLength ||
        inputPrefixFingerprint(normalizedInput, history.lastInputLength) !== history.lastInputFingerprint);
    const currentCompactions = compactionFacts(normalizedInput);
    const knownCompactions = new Set(history.compactionFingerprints);
    const newCompaction = currentCompactions.some((value) => !knownCompactions.has(value));
    const modelBoundary = history.lastInputFingerprint !== null && history.model !== null && currentModel !== history.model;
    const baselineBoundary =
      history.lastInputFingerprint !== null && history.baselineEffort !== currentBaseline;
    const users = userFacts(normalizedInput);
    const failures = toolFailureFacts(normalizedInput);
    const userBoundary =
      history.lastInputFingerprint !== null &&
      (users.count > history.lastUserCount || users.latestBoundary !== history.lastUserBoundary);
    const toolFailureBoundary =
      history.lastInputFingerprint !== null &&
      failures.count > 0 &&
      (failures.count > history.lastToolFailureCount || failures.fingerprint !== history.lastToolFailureFingerprint);

    let overlays = retainedOverlays;
    if (newCompaction || modelBoundary) overlays = [];
    history.overlays = overlays;
    if (history.title === defaultTitle(history.id)) history.title = titleFromInput(history.id, normalizedInput);
    const wireInput = mergedInput(normalizedInput, overlays);
    return {
      body: { ...cloneJson(body), input: wireInput },
      facts: {
        model: currentModel,
        baselineEffort: currentBaseline,
        normalizedInput,
        normalizedInputFingerprint,
        requestFingerprint: requestFingerprint(body, normalizedInput),
        user: users,
        toolFailures: failures,
        compactionFingerprints: currentCompactions,
        newCompaction,
        historyReplacement,
        modelBoundary,
        baselineBoundary,
        userBoundary,
        toolFailureBoundary,
        effectiveBeforeDecision: effortFromHistory(body, wireInput),
        wireInput,
      },
    };
  }

  private summary(history: PersistedHistory): HistorySummary {
    return {
      id: history.id,
      title: history.title,
      createdAt: history.createdAt,
      lastActiveAt: history.lastActiveAt,
      expiresAt: history.expiresAt,
      activeRequests: history.activeRequests,
      model: history.model,
      effort: history.effort,
      updateCount: history.overlays.length,
    };
  }

  private touch(history: PersistedHistory, now: number): void {
    history.lastActiveAt = now;
    history.expiresAt = now + HISTORY_RETENTION_MS;
  }

  private async acquire(id: string, signal?: AbortSignal): Promise<QueueRelease> {
    if (signal?.aborted) throw abortError();
    const previous = this.queues.get(id)?.tail ?? Promise.resolve();
    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const tail = previous.then(() => gate);
    this.queues.set(id, { tail });
    let cancelled = false;
    let acquired = false;
    let released = false;
    const turn = previous.then(() => {
      if (cancelled) {
        releaseGate();
        return;
      }
      acquired = true;
    });
    let abortListener: (() => void) | undefined;
    const abortPromise = new Promise<never>((_, reject) => {
      abortListener = () => reject(abortError());
      signal?.addEventListener("abort", abortListener, { once: true });
    });
    try {
      await Promise.race([turn, abortPromise]);
      if (!acquired || cancelled) throw abortError();
    } catch (error) {
      if (!acquired) {
        cancelled = true;
        void previous.then(() => releaseGate());
      } else {
        releaseGate();
      }
      this.cleanupQueue(id, tail);
      throw error;
    } finally {
      if (abortListener) signal?.removeEventListener("abort", abortListener);
    }
    return () => {
      if (released) return;
      released = true;
      releaseGate();
      this.cleanupQueue(id, tail);
    };
  }

  private cleanupQueue(id: string, tail: Promise<void>): void {
    if (this.queues.get(id)?.tail === tail) this.queues.delete(id);
  }

  private loadState(): PersistedState {
    if (!existsSync(this.statePath)) return { version: STATE_VERSION, histories: {} };
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.statePath, "utf8"));
      if (!isRecord(parsed) || parsed.version !== STATE_VERSION || !isRecord(parsed.histories)) {
        throw new Error("state version or histories is invalid");
      }
      for (const [id, history] of Object.entries(parsed.histories)) validatePersistedHistory(id, history);
      return parsed as unknown as PersistedState;
    } catch (error) {
      if (error instanceof AstraJevError) throw error;
      throw new AstraJevError(500, "history_state_corrupt", "Astra Jev history state is corrupt and was not reset");
    }
  }

  private saveState(): void {
    mkdirSync(this.directory, { recursive: true });
    const temporaryPath = `${this.statePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      writeFileSync(temporaryPath, JSON.stringify(this.state), { encoding: "utf8", mode: 0o600 });
      chmodSync(temporaryPath, 0o600);
      renameSync(temporaryPath, this.statePath);
    } catch (error) {
      try {
        if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
      } catch {
        // Preserve the original persistence error.
      }
      throw new AstraJevError(500, "history_state_write_failed", "Astra Jev history state could not be persisted");
    }
  }

  /** Used by a session so release and persistence remain in one authoritative state machine. */
  _releaseSession(history: PersistedHistory, release: QueueRelease): void {
    history.activeRequests = Math.max(0, history.activeRequests - 1);
    this.touch(history, Date.now());
    try {
      this.saveState();
    } finally {
      // A failed state write must never leave the per-history queue blocked.
      release();
    }
  }

  _saveState(): void {
    this.saveState();
  }
}

class HistorySessionImpl implements HistorySession {
  private released = false;
  private preparedResult: PreparedHistory | null = null;
  private readonly abortListener?: () => void;
  private readonly signal?: AbortSignal;
  private readonly abortPromise: Promise<never> | null;
  private abortDecision!: () => void;

  constructor(
    private readonly store: HistoryStore,
    private readonly history: PersistedHistory,
    private readonly historyId: string,
    private readonly supportedEfforts: ReasoningEffort[],
    private readonly request: ReconciledRequest,
    private readonly release: QueueRelease,
    signal?: AbortSignal,
  ) {
    this.signal = signal;
    this.abortPromise = signal
      ? new Promise<never>((_, reject) => {
          this.abortDecision = () => reject(abortError());
        })
      : null;
    if (signal) {
      this.abortListener = () => {
        this.abortDecision();
        this.abort();
      };
      signal.addEventListener("abort", this.abortListener, { once: true });
      if (signal.aborted) this.abortListener();
    }
  }

  async prepare(decide: (context: JevDecisionContext) => Promise<JevDecision>): Promise<PreparedHistory> {
    if (this.released) throw abortError();
    if (this.preparedResult) return clonePrepared(this.preparedResult);
    try {
      const facts = this.request.facts;
      const prior = this.history.lastPrepared;
      if (
        prior &&
        prior.requestFingerprint === facts.requestFingerprint &&
        prior.normalizedInputFingerprint === facts.normalizedInputFingerprint
      ) {
        this.preparedResult = {
          body: this.request.body,
          historyId: this.historyId,
          generation: prior.generation,
          currentEffort: prior.effort,
          leaseRemaining: prior.leaseRemaining,
          decisionSource: "retry",
        };
        return clonePrepared(this.preparedResult);
      }

      const leaseInvalidated =
        facts.historyReplacement ||
        facts.newCompaction ||
        facts.modelBoundary ||
        facts.baselineBoundary ||
        facts.userBoundary ||
        facts.toolFailureBoundary;
      const useLease = !leaseInvalidated && this.history.leaseEffort !== null && this.history.leaseRemaining > 0;
      let generation = this.history.generation;
      let effort: ReasoningEffort;
      let leaseRemaining: number;
      let decisionSource: "jev" | "lease";
      if (useLease) {
        effort = this.history.leaseEffort as ReasoningEffort;
        leaseRemaining = this.history.leaseRemaining - 1;
        decisionSource = "lease";
        if (generation === 0) generation = 1;
      } else {
        generation = Math.max(1, generation + 1);
        let decision: JevDecision;
        try {
          const decisionPromise = decide({
            model: facts.model ?? "",
            input: cloneJson(facts.wireInput),
            supportedEfforts: this.supportedEfforts.slice(),
            previousEffort: facts.effectiveBeforeDecision,
            step: generation,
          });
          decision = await (this.abortPromise ? Promise.race([decisionPromise, this.abortPromise]) : decisionPromise);
        } catch (error) {
          if (error instanceof AstraJevError) throw error;
          throw new AstraJevError(502, "jev_decision_failed", "Jev did not return a usable decision");
        }
        if (!isRecord(decision) || !isReasoningEffort(decision.effort) || !isLeaseSteps(decision.leaseSteps)) {
          throw new AstraJevError(502, "invalid_jev_decision", "Jev returned an invalid effort or lease length");
        }
        if (!this.supportedEfforts.includes(decision.effort)) {
          throw new AstraJevError(502, "unsupported_jev_effort", "Jev selected an effort outside the configured support set");
        }
        effort = decision.effort;
        leaseRemaining = decision.leaseSteps - 1;
        decisionSource = "jev";
      }
      if (this.released) throw abortError();

      let overlayId: string | null = null;
      if (effort !== facts.effectiveBeforeDecision) {
        const now = Date.now();
        overlayId = `overlay-${now}-${fingerprint({ effort, generation, input: facts.normalizedInputFingerprint }).slice(0, 16)}`;
        this.history.overlays.push({
          id: overlayId,
          afterInputIndex: facts.normalizedInput.length,
          createdAt: now,
          item: overlayItem(effort),
          reason: decisionSource,
          prefixFingerprint: facts.normalizedInputFingerprint,
          generation,
        });
      }
      const finalWireInput = mergedInput(facts.normalizedInput, this.history.overlays);
      const finalEffort = effort;
      this.history.generation = generation;
      this.history.leaseRemaining = leaseRemaining;
      this.history.leaseEffort = effort;
      this.history.model = facts.model;
      this.history.baselineEffort = facts.baselineEffort;
      this.history.effort = finalEffort;
      this.history.updateCount = this.history.overlays.length;
      this.history.lastInputLength = facts.normalizedInput.length;
      this.history.lastInputFingerprint = facts.normalizedInputFingerprint;
      this.history.lastUserCount = facts.user.count;
      this.history.lastUserBoundary = facts.user.latestBoundary;
      this.history.lastToolFailureCount = facts.toolFailures.count;
      this.history.lastToolFailureFingerprint = facts.toolFailures.fingerprint;
      this.history.compactionFingerprints = Array.from(
        new Set([...this.history.compactionFingerprints, ...facts.compactionFingerprints]),
      ).slice(-32);
      this.history.lastPrepared = {
        requestFingerprint: facts.requestFingerprint,
        normalizedInputFingerprint: facts.normalizedInputFingerprint,
        generation,
        effort,
        leaseRemaining,
        decisionSource,
        overlayId,
      };
      this.store._saveState();
      const preparedBody = { ...cloneJson(this.request.body), input: finalWireInput };
      this.preparedResult = {
        body: preparedBody,
        historyId: this.historyId,
        generation,
        currentEffort: finalEffort,
        leaseRemaining,
        decisionSource,
      };
      return clonePrepared(this.preparedResult);
    } catch (error) {
      if (!this.released) this.abort();
      throw error;
    }
  }

  complete(output?: unknown[]): void {
    if (this.released) return;
    if (Array.isArray(output) && output.length > 0) {
      const outputPreviews = previewsForInput(output, this.request.facts.normalizedInput.length);
      const combined = [...this.history.recentMessages, ...outputPreviews];
      this.history.recentMessages = combined.slice(-RECENT_MESSAGE_LIMIT);
    }
    this.releaseSession();
  }

  abort(): void {
    if (this.released) return;
    this.releaseSession();
  }

  private releaseSession(): void {
    if (this.released) return;
    this.released = true;
    if (this.abortListener) {
      this.signal?.removeEventListener("abort", this.abortListener);
    }
    this.store._releaseSession(this.history, this.release);
  }
}
