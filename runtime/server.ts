import { Application } from "./application";
import { WebBrowser } from "./browser";
import { NativeMcp } from "./mcp";
import { Store } from "./store";
import { OwnerLock } from "./owner";
import { NativeUpstream } from "./upstream";
import { BridgeError, type ObjectValue } from "./contracts";
import { equalSecret, errorResponse, jsonResponse, object, readJson } from "./codec";
import { parseRequest, responseEvents, WEB_MODELS } from "./protocol";
import { compiled } from "./kernel";
import { catalog, installProfile } from "./integration";
import { VERSION, type Config } from "./config";
import { html, css, javascript } from "./dashboard";
import { AdaptiveRoute } from "./adaptive";
import { validateConfig } from "./config";

export interface ServerOptions {
  app: Application;
  config: Config;
  upstream?: NativeUpstream;
  closing?: AbortSignal;
  install?: () => string;
  adaptive?: AdaptiveRoute;
}

function staticResponse(body: string, type: string): Response {
  return new Response(body, { headers: { "content-type": `${type}; charset=utf-8`, "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" } });
}

export function handler(options: ServerOptions): (request: Request) => Promise<Response> {
  const { app, config } = options;
  const mcp = new NativeMcp(app);
  const upstream = options.upstream ?? new NativeUpstream(config.native);
  const signals = (request: Request) => options.closing ? AbortSignal.any([request.signal, options.closing]) : request.signal;
  const host = async (path: string, body: ObjectValue) => {
    if (!config.browser.hostUrl) throw new BridgeError("desktop_required", "This action is available in the desktop host. Open the configured browser directly for CLI-only operation", 409);
    const result = await fetch(`${config.browser.hostUrl}${path}`, { method: "POST", redirect: "error",
      headers: { authorization: `Bearer ${config.browser.hostToken}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!result.ok) throw new Error("The desktop host rejected the command");
    return jsonResponse({ ok: true });
  };
  return async request => {
    try {
      const url = new URL(request.url);
      // A tunnel connects through the stdio MCP adapter or preserves loopback
      // Host. The local dashboard and bearer API are never public tunnel routes.
      if (!["127.0.0.1", "[::1]"].includes(url.hostname)) throw new BridgeError("invalid_host", "The application accepts only literal loopback Host addresses", 403);
      const origin = request.headers.get("origin");
      if (origin && origin !== url.origin) throw new BridgeError("invalid_origin", "Cross-origin browser requests are not permitted", 403);
      if (request.method === "GET") {
        if (url.pathname === "/") return staticResponse(html, "text/html");
        if (url.pathname === "/ui.js") return staticResponse(javascript, "text/javascript");
        if (url.pathname === "/ui.css") return staticResponse(css, "text/css");
        if (url.pathname === "/health") return jsonResponse({ ok: true, version: VERSION, kernel: compiled.fingerprint });
      }
      if (url.pathname === "/mcp") {
        if (config.mode !== "full") throw new BridgeError("full_mode_required", "The connector is disabled in browser-only mode", 409);
        return await mcp.handle(request);
      }
      if (!equalSecret(request.headers.get("authorization") ?? "", `Bearer ${config.token}`)) throw new BridgeError("unauthorized", "A local control token is required", 401);
      if (url.pathname === "/control/status" && request.method === "GET") {
        const operations = app.store.summaries();
        return jsonResponse({ version: VERSION, kernel: compiled.fingerprint, mode: config.mode,
          models: WEB_MODELS.filter(model => config.efforts.includes(model.effort)).map(model => model.id), operations,
          faults: operations.flatMap(operation => { const fault = app.store.setting(`fault:${operation.id}`); return fault ? [{ id: operation.id, fault }] : []; }),
          legacy: app.store.db.query("SELECT id,status FROM legacy ORDER BY id").all(),
          adaptive: options.adaptive?.summaries() ?? [],
          connector: config.mode === "full" ? `Codex Native2 · http://127.0.0.1:${config.port}/mcp` : "Disabled · set mode to full in application.json, then explicitly restart the runtime" });
      }
      if (url.pathname.startsWith("/control/") && request.method === "POST") {
        const body = await readJson(request, 64 * 1024);
        if (url.pathname === "/control/login") return await host("/login", {});
        if (url.pathname === "/control/install") return jsonResponse({ message: options.install ? options.install() : installProfile(app.store.home, config) });
        if (typeof body.id !== "string") throw new BridgeError("operation_required", "A durable operation ID is required");
        if (url.pathname === "/control/resume") { await app.resume(body.id, body.confirm === true); return jsonResponse({ ok: true }); }
        if (url.pathname === "/control/cancel") { await app.cancel(body.id); return jsonResponse({ ok: true }); }
        if (url.pathname === "/control/show") {
          const op = app.store.get(body.id);
          if (!op.page) throw new BridgeError("page_not_bound", "This operation has no bound page", 409);
          return await host("/show", { page: op.page });
        }
      }
      const path = url.pathname.replace(/^\/v1\//, "/");
      if (path === "/models" && request.method === "GET") return jsonResponse({ object: "list", data: catalog(config).map(model => ({ id: model.slug, object: "model", owned_by: "local-web" })), models: catalog(config) });
      if ((path === "/responses" || path === "/responses/compact") && request.method === "POST") {
        const body = await readJson(request, 64 * 1024 * 1024);
        if (typeof body.model !== "string") throw new BridgeError("model_required", "A model is required");
        if (body.model === "astra-jev") {
          if (!options.adaptive) throw new BridgeError("advisor_not_configured", "The optional adaptive native route is not configured", 503);
          if (path.endsWith("/compact")) return await upstream.request(path.slice(1), request, { ...body, model: config.jev!.targetModel });
          return await options.adaptive.response(request, body);
        }
        if (!body.model.startsWith("chatgpt-web/")) return await upstream.request(path.slice(1), request, body);
        const model = WEB_MODELS.find(model => model.id === body.model);
        if (!model || !config.efforts.includes(model.effort)) throw new BridgeError("model_disabled", "This profile does not expose the selected webpage effort");
        const parsed = parseRequest(body, request.headers, config.mode, app.store, path.endsWith("/compact"));
        await app.submit(parsed); // Admission failures remain HTTP errors, before SSE headers.
        const signal = signals(request);
        if (!parsed.stream) return new Response(await app.response(parsed, signal), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
        const detached = new AbortController();
        const transport = AbortSignal.any([signal, detached.signal]);
        const encoder = new TextEncoder();
        let timer: ReturnType<typeof setInterval> | undefined;
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const emit = (text: string) => { if (!transport.aborted) controller.enqueue(encoder.encode(text)); };
            emit(": observing durable webpage operation\n\n");
            timer = setInterval(() => { try { emit(": observer alive\n\n"); } catch { detached.abort(); } }, 10_000);
            void app.response(parsed, transport).then(text => {
              for (const event of responseEvents(object(JSON.parse(text)))) emit(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
              emit("data: [DONE]\n\n");
            }).catch(error => {
              if (!transport.aborted) emit(`event: error\ndata: ${JSON.stringify({ type: "error", code: error instanceof BridgeError ? error.code : "boundary_failure", message: "The page is retained. No automatic resend or cancellation occurred." })}\n\n`);
            }).finally(() => {
              if (timer) clearInterval(timer);
              try { controller.close(); } catch { /* The subscriber already detached. */ }
            });
          },
          cancel() { detached.abort(new DOMException("SSE subscriber detached", "AbortError")); if (timer) clearInterval(timer); },
        });
        return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" } });
      }
      if (["/alpha/search", "/images/generations", "/images/edits"].includes(path) && request.method === "POST")
        return await upstream.request(path.slice(1), request, await readJson(request, 64 * 1024 * 1024));
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
  let adaptive: AdaptiveRoute | undefined;
  try {
    app.recover();
    const upstream = new NativeUpstream(config.native);
    adaptive = config.jev ? new AdaptiveRoute(home, config.jev, upstream) : undefined;
    const server = Bun.serve({ hostname: "127.0.0.1", port: config.port, idleTimeout: 0,
      maxRequestBodySize: 64 * 1024 * 1024, fetch: handler({ app, config, upstream, adaptive, closing: closing.signal }) });
    config.port = server.port!;
    let closed: Promise<void> | undefined;
    return { server, app, store, close(): Promise<void> {
      return closed ??= (async () => {
        closing.abort(new DOMException("Runtime transport detached", "AbortError"));
        await server.stop(true);
        await app.close();
        await adaptive?.close();
        await Bun.sleep(0); // Flush subscriber Detached commits before closing storage.
        store.close(); owner.close();
      })();
    } };
  } catch (error) { void adaptive?.close(); store.close(); owner.close(); throw error; }
}
