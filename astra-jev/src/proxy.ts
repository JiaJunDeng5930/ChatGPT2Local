import { join } from "node:path";

import type { AstraJevConfig } from "./config";
import { AstraJevError, type HistoryDetail, type HistorySummary } from "./types";
import { HistoryStore, type HistorySession } from "./history-store";
import { JevClient } from "./jev";

export const ASTRA_JEV_MODEL = "gpt-6-astra";

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
type FetchLike = (input: Request | URL | string, init?: RequestInit) => Promise<Response>;

export interface AstraJevProxyOptions {
  config: AstraJevConfig;
  historyStore: HistoryStore;
  jevClient: JevClient;
  fetchUpstream?: FetchLike;
  uiDirectory?: string;
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function errorResponse(error: unknown): Response {
  const candidate = error instanceof AstraJevError
    ? error
    : new AstraJevError(500, "internal_error", "Astra Jev request failed");
  const type = candidate.status >= 500
    ? "server_error"
    : candidate.status === 401 || candidate.status === 403
      ? "authentication_error"
      : candidate.status === 404
        ? "not_found_error"
        : candidate.status === 429
          ? "rate_limit_error"
          : "invalid_request_error";
  return Response.json({
    error: {
      type,
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

async function readJsonBody(request: Request, maxBytes: number): Promise<JsonObject> {
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > maxBytes) {
      reject(413, "request_too_large", `Request body exceeds the ${maxBytes}-byte limit`);
    }
  }

  let bytes: ArrayBuffer;
  try {
    bytes = await request.arrayBuffer();
  } catch {
    reject(400, "invalid_request_error", "Request body could not be read");
  }
  if (bytes.byteLength > maxBytes) {
    reject(413, "request_too_large", `Request body exceeds the ${maxBytes}-byte limit`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    reject(400, "invalid_request_error", "Request body must be valid JSON");
  }
  if (!isObject(parsed)) reject(400, "invalid_request_error", "Request body must be a JSON object");
  return parsed;
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

function historyIdentity(body: JsonObject, request: Request, upstreamBaseUrl: string): string {
  const threadId = requestThreadId(body, request);
  if (!threadId) {
    reject(
      400,
      "history_identity_required",
      "A stable history identity is required: provide thread_id metadata, a session_id header, or prompt_cache_key",
    );
  }
  const accountId = requestAccountId(request);
  return ["astra-jev", upstreamBaseUrl, accountId, threadId]
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
  if (body.model !== ASTRA_JEV_MODEL) {
    reject(400, "unsupported_model", `Astra Jev manages model ${ASTRA_JEV_MODEL} only`);
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

function forwardedRequestHeaders(request: Request, config: AstraJevConfig): Headers {
  const headers = new Headers(request.headers);
  for (const name of HOP_BY_HOP_HEADERS) headers.delete(name);
  headers.delete("content-length");
  if (config.upstreamApiKey) headers.set("authorization", `Bearer ${config.upstreamApiKey}`);
  headers.set("content-type", "application/json");
  return headers;
}

function upstreamResponsesUrl(request: Request, baseUrl: string): string {
  const base = `${baseUrl.replace(/\/+$/, "")}/`;
  const target = new URL("responses", base);
  target.search = new URL(request.url).search;
  return target.toString();
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

function loopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost"
    || normalized === "127.0.0.1"
    || normalized === "::1"
    || normalized === "0.0.0.0"
    || normalized === "::";
}

function requestHost(request: Request): string | undefined {
  const header = request.headers.get("host");
  if (!header) return undefined;
  try {
    return new URL(`http://${header}`).hostname;
  } catch {
    return undefined;
  }
}

function localReadAllowed(request: Request, configuredHost: string): boolean {
  const requestUrl = new URL(request.url);
  const host = requestHost(request);
  if (host && !loopbackHost(host) && host !== configuredHost.toLowerCase()) return false;
  const originHeader = request.headers.get("origin");
  if (!originHeader) return true;
  try {
    const origin = new URL(originHeader);
    if (origin.protocol !== requestUrl.protocol) return false;
    const sameHost = origin.hostname === requestUrl.hostname
      || (loopbackHost(origin.hostname) && loopbackHost(requestUrl.hostname));
    const originPort = origin.port || (origin.protocol === "https:" ? "443" : "80");
    const requestPort = requestUrl.port || (requestUrl.protocol === "https:" ? "443" : "80");
    return sameHost && originPort === requestPort;
  } catch {
    return false;
  }
}

function contentTypeFor(pathname: string): string {
  if (pathname.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (pathname.endsWith(".css")) return "text/css; charset=utf-8";
  return "text/html; charset=utf-8";
}

export class AstraJevProxy {
  private readonly fetchUpstream: FetchLike;
  private readonly uiDirectory: string;

  constructor(private readonly options: AstraJevProxyOptions) {
    this.fetchUpstream = options.fetchUpstream || fetch;
    this.uiDirectory = options.uiDirectory || join(import.meta.dir, "../ui");
  }

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/v1/responses" || url.pathname === "/responses") {
      if (request.method === "GET") return new Response("Astra Jev uses HTTP/SSE; WebSocket transport is unavailable\n", {
        status: 426,
        headers: { "content-type": "text/plain; charset=utf-8", upgrade: "websocket" },
      });
      if (request.method === "POST") return this.handleResponses(request);
      return errorResponse(new AstraJevError(405, "method_not_allowed", "Responses endpoint accepts POST requests"));
    }

    if (request.method === "GET" && (url.pathname === "/v1/models" || url.pathname === "/models")) {
      return Response.json({
        object: "list",
        data: [{
          id: ASTRA_JEV_MODEL,
          object: "model",
          created: Math.floor(this.options.config.startedAt / 1_000),
          owned_by: "openai",
        }],
      }, { headers: { "cache-control": "no-store" } });
    }

    if (url.pathname === "/api/status" || url.pathname === "/api/histories" || url.pathname.startsWith("/api/histories/")) {
      if (!localReadAllowed(request, this.options.config.host)) {
        return errorResponse(new AstraJevError(403, "origin_not_allowed", "This local read API only accepts loopback same-origin requests"));
      }
      return this.handleReadApi(request, url);
    }

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/assets/app.js" || url.pathname === "/assets/style.css")) {
      if (!localReadAllowed(request, this.options.config.host)) {
        return new Response("Origin not allowed\n", { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
      }
      return this.handleStatic(url.pathname);
    }

    return errorResponse(new AstraJevError(404, "not_found", "Astra Jev route not found"));
  }

  private async handleResponses(request: Request): Promise<Response> {
    let session: HistorySession | undefined;
    try {
      if (!this.options.jevClient || !this.options.config.jev.apiKey) {
        reject(503, "jev_credentials_missing", "Set ASTRA_JEV_JEV_API_KEY or the configured provider API key before sending managed requests");
      }
      const body = await readJsonBody(request, this.options.config.maxRequestBytes);
      validateManagedRequest(body, this.options.config.supportedEfforts);
      const id = historyIdentity(body, request, this.options.config.upstreamBaseUrl);
      session = await this.options.historyStore.begin({
        id,
        body,
        supportedEfforts: this.options.config.supportedEfforts,
      }, request.signal);
      const prepared = await session.prepare(context => this.options.jevClient.decide(context, request.signal));

      let upstream: Response;
      try {
        upstream = await this.fetchUpstream(upstreamResponsesUrl(request, this.options.config.upstreamBaseUrl), {
          method: "POST",
          headers: forwardedRequestHeaders(request, this.options.config),
          body: JSON.stringify(prepared.body),
          signal: request.signal,
          redirect: "error",
        });
      } catch (error) {
        session.abort();
        if (request.signal.aborted) {
          return errorResponse(new AstraJevError(499, "request_cancelled", "Astra Jev request was cancelled"));
        }
        throw new AstraJevError(502, "upstream_error", `Responses upstream request failed: ${error instanceof Error ? error.message : "network failure"}`);
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
        this.options.config.maxPreviewChars,
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

  private async handleReadApi(request: Request, url: URL): Promise<Response> {
    if (request.method !== "GET") {
      return errorResponse(new AstraJevError(405, "method_not_allowed", "History APIs accept GET requests"));
    }
    this.options.historyStore.sweep();
    if (url.pathname === "/api/status") {
      return Response.json({
        name: this.options.config.serviceName,
        upstreamBaseUrl: this.options.config.upstreamBaseUrl,
        retentionHours: this.options.config.retentionHours,
        latestMessageLimit: this.options.config.latestMessageLimit,
        historiesCount: this.options.historyStore.list().length,
        startedAt: this.options.config.startedAt,
      }, { headers: { "cache-control": "no-store" } });
    }
    if (url.pathname === "/api/histories") {
      const histories: HistorySummary[] = this.options.historyStore.list();
      return Response.json({ histories }, { headers: { "cache-control": "no-store" } });
    }
    const rawId = url.pathname.slice("/api/histories/".length);
    let id: string;
    try {
      id = decodeURIComponent(rawId);
    } catch {
      return errorResponse(new AstraJevError(400, "invalid_history_id", "History id is not valid URL encoding"));
    }
    const detail: HistoryDetail | undefined = this.options.historyStore.get(id);
    if (!detail) return errorResponse(new AstraJevError(404, "history_not_found", "History is missing or expired"));
    return Response.json(detail, { headers: { "cache-control": "no-store" } });
  }

  private async handleStatic(pathname: string): Promise<Response> {
    const relative = pathname === "/" ? "index.html" : pathname.slice("/assets/".length);
    const allowed = new Set(["index.html", "app.js", "style.css"]);
    if (!allowed.has(relative)) return new Response("Not found\n", { status: 404 });
    const file = Bun.file(join(this.uiDirectory, relative));
    if (!(await file.exists())) return new Response("Astra Jev UI asset is unavailable\n", { status: 503 });
    return new Response(file, { headers: { "content-type": contentTypeFor(relative), "cache-control": "no-store" } });
  }
}

export function createAstraJevProxy(options: AstraJevProxyOptions): AstraJevProxy {
  return new AstraJevProxy(options);
}

export function formatAstraJevError(error: unknown): Response {
  return errorResponse(error);
}
