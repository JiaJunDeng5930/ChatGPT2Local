import { Application } from "./application";
import { WebBrowser } from "./browser";
import { ToolMcp } from "./mcp";
import { Store } from "./store";
import { OwnerLock } from "./owner";
import { BridgeError, type ObjectValue } from "./contracts";
import { equalSecret, errorResponse, jsonResponse, object, readJson } from "./codec";
import { parseRequest, responseEvents, WEB_MODELS, PROTOCOL, REQUEST_SCHEMA, RESPONSE_SCHEMA } from "./protocol";
import { compiled } from "./kernel";
import { VERSION, validateConfig, type Config } from "./config";
import { html, css, javascript } from "./dashboard";

export interface ServerOptions { app: Application; config: Config; closing?: AbortSignal }

function staticResponse(body: string, type: string): Response {
  return new Response(body, { headers: { "content-type": `${type}; charset=utf-8`, "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" } });
}

export function handler(options: ServerOptions): (request: Request) => Promise<Response> {
  const { app, config } = options;
  const mcp = new ToolMcp(app);
  const signals = (request: Request) => options.closing ? AbortSignal.any([request.signal, options.closing]) : request.signal;
  const host = async (path: string, body: ObjectValue) => {
    if (!config.browser.hostUrl) throw new BridgeError("desktop_required", "This action requires the desktop host; CLI users can open their configured browser directly", 409);
    const result = await fetch(`${config.browser.hostUrl}${path}`, { method: "POST", redirect: "error",
      headers: { authorization: `Bearer ${config.browser.hostToken}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!result.ok) throw new Error("The desktop host rejected the command");
    return jsonResponse({ ok: true });
  };
  return async request => {
    try {
      const url = new URL(request.url);
      if (!["127.0.0.1", "[::1]"].includes(url.hostname)) throw new BridgeError("invalid_host", "The application accepts only literal loopback Host addresses", 403);
      const origin = request.headers.get("origin");
      if (origin && origin !== url.origin) throw new BridgeError("invalid_origin", "Cross-origin browser requests are not permitted", 403);
      if (request.method === "GET") {
        if (url.pathname === "/") return staticResponse(html, "text/html");
        if (url.pathname === "/ui.js") return staticResponse(javascript, "text/javascript");
        if (url.pathname === "/ui.css") return staticResponse(css, "text/css");
        if (url.pathname === "/health") return jsonResponse({ ok: true, version: VERSION, protocol: PROTOCOL, kernel: compiled.fingerprint });
      }
      if (url.pathname === "/mcp") {
        if (config.mode !== "full") throw new BridgeError("full_mode_required", "The connector is disabled in browser-only mode", 409);
        return await mcp.handle(request);
      }
      if (!equalSecret(request.headers.get("authorization") ?? "", `Bearer ${config.token}`)) throw new BridgeError("unauthorized", "A local control token is required", 401);
      if (url.pathname === "/control/status" && request.method === "GET") {
        const operations = app.store.summaries();
        return jsonResponse({ version: VERSION, protocol: PROTOCOL, kernel: compiled.fingerprint, mode: config.mode,
          models: WEB_MODELS.filter(model => config.efforts.includes(model.effort)).map(model => model.id), operations,
          faults: operations.flatMap(operation => { const fault = app.store.setting(`fault:${operation.id}`); return fault ? [{ id: operation.id, fault }] : []; }),
          legacy: app.store.db.query("SELECT id,status FROM legacy ORDER BY id").all(),
          connector: config.mode === "full" ? `ChatGPT Web Tools · http://127.0.0.1:${config.port}/mcp` : "Disabled · enable full mode and explicitly restart the runtime" });
      }
      if (["/control/login", "/control/resume", "/control/cancel", "/control/show"].includes(url.pathname) && request.method === "POST") {
        const body = await readJson(request, 64 * 1024);
        if (url.pathname === "/control/login") return await host("/login", {});
        if (typeof body.id !== "string") throw new BridgeError("operation_required", "A durable operation ID is required");
        if (url.pathname === "/control/resume") { await app.resume(body.id, body.confirm === true); return jsonResponse({ ok: true }); }
        if (url.pathname === "/control/cancel") { await app.cancel(body.id); return jsonResponse({ ok: true }); }
        if (url.pathname === "/control/show") {
          const op = app.store.get(body.id);
          if (!op.page) throw new BridgeError("page_not_bound", "This operation has no bound page", 409);
          return await host("/show", { page: op.page });
        }
      }
      const path = url.pathname;
      if (path === "/v1/models" && request.method === "GET") return jsonResponse({ protocol: PROTOCOL,
        data: WEB_MODELS.filter(model => config.efforts.includes(model.effort)) });
      if (path === "/v1/schema" && request.method === "GET") return jsonResponse({ protocol: PROTOCOL, request: REQUEST_SCHEMA, response: RESPONSE_SCHEMA });
      const resource = /^\/v1\/responses\/(resp_[a-f0-9]{64})(?:\/(resume|cancel))?$/.exec(path);
      if (resource && request.method === "GET" && !resource[2]) return jsonResponse(app.resource(resource[1]!));
      if (resource && request.method === "POST" && resource[2]) {
        const operation = app.store.responseRecord(resource[1]!).operation;
        const body = await readJson(request, 1024);
        if (Object.keys(body).some(key => resource[2] !== "resume" || key !== "confirm") ||
          (body.confirm !== undefined && typeof body.confirm !== "boolean"))
          throw new BridgeError("invalid_request", "resume accepts only an optional boolean confirm; cancel requires an empty object");
        if (resource[2] === "resume") await app.resume(operation, body.confirm === true);
        else await app.cancel(operation);
        return jsonResponse({ ok: true, response_id: resource[1]! });
      }
      if (path === "/v1/responses" && request.method === "POST") {
        const body = await readJson(request, 64 * 1024 * 1024);
        const parsed = parseRequest(body, request.headers, config.mode, app.store);
        if (!app.store.request(parsed.round) && !config.efforts.includes(parsed.context.effort))
          throw new BridgeError("model_disabled", "This profile does not expose the selected webpage effort");
        const headers = { "cache-control": "no-store", "x-response-id": parsed.responseId, "x-web-protocol": PROTOCOL,
          location: `/v1/responses/${parsed.responseId}` };
        try { await app.submit(parsed); }
        catch (error) {
          const response = errorResponse(error);
          if (app.store.request(parsed.round)) for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
          return response;
        }
        const signal = signals(request);
        if (!parsed.stream) {
          try { return new Response(await app.response(parsed, signal), { headers: { ...headers, "content-type": "application/json" } }); }
          catch (error) { const response = errorResponse(error); for (const [key, value] of Object.entries(headers)) response.headers.set(key, value); return response; }
        }
        const detached = new AbortController();
        const transport = AbortSignal.any([signal, detached.signal]);
        const encoder = new TextEncoder();
        let timer: ReturnType<typeof setInterval> | undefined;
        let unsubscribe = () => {};
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const emit = (text: string) => { if (!transport.aborted) controller.enqueue(encoder.encode(text)); };
            const event = (type: string, data: ObjectValue) => emit(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
            event("response.in_progress", { response_id: parsed.responseId, previous_response_id: parsed.previous });
            let last = "";
            const snapshot = () => {
              if (transport.aborted || (controller.desiredSize ?? 0) <= 0) return;
              if (app.store.round(parsed.id, parsed.round) !== undefined) return;
              const text = app.store.get(parsed.id).state.latest;
              if (text === last) return;
              last = text;
              event("response.output_text.snapshot", { response_id: parsed.responseId, text, provisional: true });
            };
            unsubscribe = app.store.subscribe(id => { if (id === parsed.id) snapshot(); });
            snapshot();
            timer = setInterval(() => { try { if ((controller.desiredSize ?? 0) > 0) emit(": observer alive\n\n"); } catch { detached.abort(); } }, 10_000);
            void app.response(parsed, transport).then(text => {
              for (const item of responseEvents(object(JSON.parse(text)))) event(item.type, item);
              emit("data: [DONE]\n\n");
            }).catch(error => {
              if (!transport.aborted) event("error", { response_id: parsed.responseId,
                code: error instanceof BridgeError ? error.code : "boundary_failure",
                message: "The original operation is retained. No automatic resend or cancellation occurred." });
            }).finally(() => {
              unsubscribe();
              if (timer) clearInterval(timer);
              try { controller.close(); } catch { /* The subscriber already detached. */ }
            });
          },
          cancel() {
            detached.abort(new DOMException("SSE subscriber detached", "AbortError"));
            unsubscribe();
            if (timer) clearInterval(timer);
          },
        });
        return new Response(stream, { headers: { ...headers, "content-type": "text/event-stream", "x-accel-buffering": "no" } });
      }
      return jsonResponse({ error: { code: "not_found", message: "No such application endpoint" } }, 404);
    } catch (error) { return errorResponse(error); }
  };
}

export function startServer(home: string, config: Config) {
  config = validateConfig(config);
  const owner = new OwnerLock(home);
  let store: Store;
  try { store = new Store(home); } catch (error) { owner.close(); throw error; }
  const browser = new WebBrowser(config.browser);
  const app = new Application(store, browser, config.limits);
  const closing = new AbortController();
  try {
    app.recover();
    const server = Bun.serve({ hostname: "127.0.0.1", port: config.port, idleTimeout: 0,
      maxRequestBodySize: 64 * 1024 * 1024, fetch: handler({ app, config, closing: closing.signal }) });
    config.port = server.port!;
    let closed: Promise<void> | undefined;
    return { server, app, store, close(): Promise<void> {
      return closed ??= (async () => {
        closing.abort(new DOMException("Runtime transport detached", "AbortError"));
        await server.stop(true);
        await app.close();
        await Bun.sleep(0);
        store.close(); owner.close();
      })();
    } };
  } catch (error) { store.close(); owner.close(); throw error; }
}
