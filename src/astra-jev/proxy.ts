import {
  ASTRA_JEV_MODEL_ID,
  ASTRA_JEV_UPSTREAM_MODEL,
  AstraJevSettingsStore,
  defaultAstraJevConfig,
  type AstraJevConfig,
} from "./config";
import {
  AstraJevError,
  type AstraJevSettingsInput,
  type AstraJevState,
} from "./types";
import { HistoryStore, type HistorySession } from "./history-store";
import { JevClient } from "./jev";

export { ASTRA_JEV_MODEL_ID, ASTRA_JEV_UPSTREAM_MODEL };

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
]);

const ACCOUNT_HEADERS = [
  "chatgpt-account-id",
  "x-chatgpt-account-id",
  "openai-account-id",
  "x-openai-account-id",
];

const SESSION_HEADERS = [
  "x-codex-session-id",
  "x-session-id",
  "session-id",
  "session_id",
];

type JsonObject = Record<string, unknown>;
export type AstraJevForward = (request: Request, body: JsonObject) => Promise<Response>;

export interface AstraJevServiceOptions {
  config?: AstraJevConfig;
  settingsStore?: AstraJevSettingsStore;
  historyStore?: HistoryStore;
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function errorResponse(error: unknown): Response {
  const candidate = error instanceof AstraJevError
    ? error
    : new AstraJevError(500, "internal_error", "Astra Jev request failed");
  return Response.json({
    error: {
      code: candidate.code,
      message: candidate.message,
    },
  }, {
    status: candidate.status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function reject(status: number, code: string, message: string): never {
  throw new AstraJevError(status, code, message);
}

function parseMetadata(value: unknown): JsonObject | undefined {
  if (isObject(value)) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value);
    return isObject(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function cleanIdentity(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= 512 ? trimmed : undefined;
}

function requestThreadId(body: JsonObject, request: Request): string | undefined {
  const clientMetadata = isObject(body.client_metadata) ? body.client_metadata : undefined;
  const metadataValues = [
    clientMetadata?.["x-codex-turn-metadata"],
    request.headers.get("x-codex-turn-metadata"),
  ];
  for (const value of metadataValues) {
    const metadata = parseMetadata(value);
    const threadId = cleanIdentity(metadata?.thread_id);
    if (threadId) return threadId;
  }

  for (const name of SESSION_HEADERS) {
    const sessionId = cleanIdentity(request.headers.get(name));
    if (sessionId) return sessionId;
  }

  return cleanIdentity(body.prompt_cache_key);
}

function requestAccountId(request: Request): string {
  for (const name of ACCOUNT_HEADERS) {
    const account = cleanIdentity(request.headers.get(name));
    if (account) return account;
  }
  return "unknown";
}

function historyIdentity(body: JsonObject, request: Request): string {
  const threadId = requestThreadId(body, request);
  if (!threadId) {
    reject(
      400,
      "history_identity_required",
      "A stable history identity is required: provide thread_id metadata, a session_id header, or prompt_cache_key",
    );
  }
  const accountId = requestAccountId(request);
  return [ASTRA_JEV_MODEL_ID, ASTRA_JEV_UPSTREAM_MODEL, accountId, threadId]
    .map(value => encodeURIComponent(value))
    .join(":");
}

function hasDeltaContinuation(body: JsonObject): boolean {
  if (body.delta !== undefined || body.input_delta !== undefined) return true;
  if (!Array.isArray(body.input)) return false;
  return body.input.some(item => {
    if (!isObject(item)) return false;
    if (item.delta !== undefined || item.input_delta !== undefined) return true;
    return typeof item.type === "string" && item.type.toLowerCase().includes("delta");
  });
}

function validateManagedRequest(body: JsonObject, supportedEfforts: readonly string[]): void {
  if (body.model !== ASTRA_JEV_MODEL_ID) {
    reject(400, "unsupported_model", `Astra Jev manages model ${ASTRA_JEV_MODEL_ID} only`);
  }
  if (body.previous_response_id !== undefined && body.previous_response_id !== null) {
    reject(400, "previous_response_id_unsupported", "previous_response_id continuations are unsupported; send the full retained input history");
  }
  if (hasDeltaContinuation(body)) {
    reject(400, "delta_unsupported", "Delta continuations are unsupported; send the full retained input history");
  }
  if (!Array.isArray(body.input)) {
    reject(400, "input_required", "A full input array is required on every Astra Jev request");
  }
  if (body.input.length === 0) {
    reject(400, "input_empty", "Astra Jev requires at least one retained input item");
  }
  if (supportedEfforts.length === 0) {
    reject(500, "configuration_error", "Astra Jev has no supported reasoning efforts configured");
  }
}

function responseHeaders(response: Response): Headers {
  const headers = new Headers(response.headers);
  for (const name of HOP_BY_HOP_HEADERS) headers.delete(name);
  headers.delete("content-length");
  return headers;
}

function isOutputTextEvent(value: JsonObject): boolean {
  return typeof value.type === "string" && value.type.includes("output_text");
}

function appendPreview(value: unknown, target: { text: string }, limit: number): void {
  if (target.text.length >= limit) return;
  if (!isObject(value)) return;
  if (isOutputTextEvent(value)) {
    for (const key of ["delta", "text", "value"]) {
      if (typeof value[key] === "string") {
        target.text += value[key];
        if (target.text.length >= limit) {
          target.text = target.text.slice(0, limit);
          return;
        }
      }
    }
    return;
  }
  for (const child of Object.values(value)) {
    if (isObject(child)) appendPreview(child, target, limit);
    else if (Array.isArray(child)) {
      for (const item of child) appendPreview(item, target, limit);
    }
    if (target.text.length >= limit) return;
  }
}

function outputPreview(captured: string, contentType: string, limit: number): unknown[] | undefined {
  const target = { text: "" };
  if (contentType.toLowerCase().includes("text/event-stream")) {
    for (const line of captured.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        appendPreview(JSON.parse(payload), target, limit);
      } catch {
        // A partial or provider-specific SSE event is still forwarded unchanged.
      }
      if (target.text.length >= limit) break;
    }
  } else {
    try {
      appendPreview(JSON.parse(captured), target, limit);
    } catch {
      if (!contentType.toLowerCase().includes("json")) target.text = captured.slice(0, limit);
    }
  }
  const text = target.text.slice(0, limit);
  if (!text) return undefined;
  return [{
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text }],
  }];
}

function streamWithSession(
  upstreamBody: ReadableStream<Uint8Array>,
  requestSignal: AbortSignal,
  contentType: string,
  maxPreviewChars: number,
  onComplete: (output?: unknown[]) => void,
  onAbort: () => void,
): ReadableStream<Uint8Array> {
  const reader = upstreamBody.getReader();
  const decoder = new TextDecoder();
  let captured = "";
  let settled = false;
  let abortListener: (() => void) | undefined;

  const settleAbort = () => {
    if (settled) return;
    settled = true;
    if (abortListener) requestSignal.removeEventListener("abort", abortListener);
    onAbort();
  };
  const settleComplete = () => {
    if (settled) return;
    settled = true;
    if (abortListener) requestSignal.removeEventListener("abort", abortListener);
    try {
      onComplete(outputPreview(captured, contentType, maxPreviewChars));
    } catch {
      onAbort();
    }
  };
  const observe = (chunk: Uint8Array) => {
    if (captured.length >= maxPreviewChars * 8) return;
    const text = decoder.decode(chunk, { stream: true });
    captured += text.slice(0, maxPreviewChars * 8 - captured.length);
  };

  abortListener = () => {
    settleAbort();
    void reader.cancel(requestSignal.reason).catch(() => {});
  };
  if (requestSignal.aborted) abortListener();
  else requestSignal.addEventListener("abort", abortListener, { once: true });

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (settled) {
        controller.close();
        return;
      }
      try {
        const result = await reader.read();
        if (result.done) {
          const tail = decoder.decode();
          if (tail && captured.length < maxPreviewChars * 8) {
            captured += tail.slice(0, maxPreviewChars * 8 - captured.length);
          }
          settleComplete();
          controller.close();
          return;
        }
        observe(result.value);
        controller.enqueue(result.value);
      } catch (error) {
        settleAbort();
        controller.error(error);
      }
    },
    async cancel(reason) {
      settleAbort();
      await reader.cancel(reason).catch(() => {});
    },
  });
}


export class AstraJevService {
  private readonly config: AstraJevConfig;
  private readonly settingsStore: AstraJevSettingsStore;
  private readonly historyStore: HistoryStore;
  private settings: ReturnType<AstraJevSettingsStore["snapshot"]>;
  private jevClient: JevClient | undefined;
  private closed = false;

  constructor(options: AstraJevServiceOptions = {}) {
    this.config = options.config ?? defaultAstraJevConfig();
    this.settingsStore = options.settingsStore
      ?? new AstraJevSettingsStore(this.config.storageDirectory);
    this.historyStore = options.historyStore
      ?? new HistoryStore({ directory: this.config.storageDirectory });
    this.settings = this.settingsStore.snapshot(this.config);
    this.jevClient = this.createClient(this.settings);
  }

  getState(endpoint: string): AstraJevState {
    return {
      modelId: ASTRA_JEV_MODEL_ID,
      endpoint,
      provider: this.settings.provider,
      configured: this.jevClient !== undefined,
      supportedEfforts: [...this.settings.supportedEfforts],
      timeoutMs: this.settings.timeoutMs,
      retentionHours: this.config.retentionHours,
      latestMessageLimit: this.config.latestMessageLimit,
      histories: this.historyStore.list(),
    };
  }

  saveSettings(input: AstraJevSettingsInput, endpoint: string): AstraJevState {
    const next = this.settingsStore.save(input);
    this.settings = {
      provider: next.provider,
      apiKey: next.apiKey,
      timeoutMs: this.config.timeoutMs,
      supportedEfforts: [...this.config.supportedEfforts],
    };
    this.jevClient = this.createClient(this.settings);
    return this.getState(endpoint);
  }

  getHistory(id: string): import("./types").HistoryDetail | undefined {
    return this.historyStore.get(id);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.historyStore.close();
  }

  async handleResponse(request: Request, body: JsonObject, forward: AstraJevForward): Promise<Response> {
    if (request.method !== "POST") {
      return errorResponse(new AstraJevError(405, "method_not_allowed", "Responses endpoint accepts POST requests"));
    }

    let session: HistorySession | undefined;
    const settings = this.settings;
    const client = this.jevClient;
    try {
      if (!client) {
        reject(
          503,
          "jev_credentials_missing",
          "Configure an Astra Jev provider API key before selecting Astra Jev",
        );
      }
      if (new TextEncoder().encode(JSON.stringify(body)).byteLength > this.config.maxRequestBytes) {
        reject(413, "request_too_large", `Request body exceeds the ${this.config.maxRequestBytes}-byte limit`);
      }
      validateManagedRequest(body, settings.supportedEfforts);
      const id = historyIdentity(body, request);
      session = await this.historyStore.begin({
        id,
        body,
        supportedEfforts: [...settings.supportedEfforts],
      }, request.signal);
      const prepared = await session.prepare(context => client!.decide(context, request.signal));
      const upstreamBody = { ...prepared.body, model: ASTRA_JEV_UPSTREAM_MODEL };

      let upstream: Response;
      try {
        upstream = await forward(request, upstreamBody);
      } catch (error) {
        session.abort();
        if (request.signal.aborted) {
          return errorResponse(new AstraJevError(499, "request_cancelled", "Astra Jev request was cancelled"));
        }
        throw new AstraJevError(
          502,
          "upstream_error",
          "Responses upstream request failed: " + (error instanceof Error ? error.message : "network failure"),
        );
      }

      if (!upstream.ok) {
        session.abort();
        return new Response(upstream.body, {
          status: upstream.status,
          statusText: upstream.statusText,
          headers: responseHeaders(upstream),
        });
      }

      if (!upstream.body) {
        session.complete();
        return new Response(null, {
          status: upstream.status,
          statusText: upstream.statusText,
          headers: responseHeaders(upstream),
        });
      }

      const bodyStream = streamWithSession(
        upstream.body,
        request.signal,
        upstream.headers.get("content-type") || "",
        this.config.maxPreviewChars,
        output => session?.complete(output),
        () => session?.abort(),
      );
      return new Response(bodyStream, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders(upstream),
      });
    } catch (error) {
      session?.abort();
      if (request.signal.aborted && !(error instanceof AstraJevError)) {
        return errorResponse(new AstraJevError(499, "request_cancelled", "Astra Jev request was cancelled"));
      }
      return errorResponse(error);
    }
  }

  private createClient(settings: ReturnType<AstraJevSettingsStore["snapshot"]>): JevClient | undefined {
    if (!settings.apiKey) return undefined;
    try {
      return new JevClient({
        provider: settings.provider,
        apiKey: settings.apiKey,
        timeoutMs: settings.timeoutMs,
      });
    } catch {
      return undefined;
    }
  }
}

export function createAstraJevService(options: AstraJevServiceOptions = {}): AstraJevService {
  return new AstraJevService(options);
}

export function formatAstraJevError(error: unknown): Response {
  return errorResponse(error);
}

export function astraJevErrorResponse(status: number, code: string, message: string): Response {
  return errorResponse(new AstraJevError(status, code, message));
}
