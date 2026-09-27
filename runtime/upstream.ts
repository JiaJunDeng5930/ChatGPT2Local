/** Optional native network boundary. No automatic generation retry exists. */
import { readFileSync } from "node:fs";
import type { Config } from "./config";
import { BridgeError, type ObjectValue } from "./contracts";
import { canonical, object } from "./codec";
import { COMPACTION_PREFIX, SUMMARY_PREFIX } from "./protocol";

export function readableNativeInput(body: ObjectValue): ObjectValue {
  if (!Array.isArray(body.input)) return body;
  const bridged = body.input.some(raw => {
    const item = object(raw);
    return (typeof item.encrypted_content === "string" && item.encrypted_content.startsWith(COMPACTION_PREFIX)) ||
      (item.type === "message" && typeof item.id === "string" && /^msg_[a-f0-9]{32}$/.test(item.id));
  });
  if (!bridged) return body;
  return { ...body, previous_response_id: null, input: body.input.map(raw => {
    const item = { ...object(raw) };
    delete item.id; delete item.status;
    if (item.type === "compaction" && typeof item.encrypted_content === "string" && item.encrypted_content.startsWith(COMPACTION_PREFIX)) {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(item.encrypted_content.slice(COMPACTION_PREFIX.length), "base64"));
      return { type: "message", role: "user", content: [{ type: "input_text", text: `${SUMMARY_PREFIX}\n${text}` }] };
    }
    return item;
  }) };
}

export class NativeUpstream {
  constructor(readonly config: Config["native"], readonly fetcher: typeof fetch = fetch) {}

  private credentials(): { key: string; account?: string } {
    if (!this.config) throw new BridgeError("native_not_configured", "Native passthrough is not configured", 503);
    if (this.config.keyEnv) {
      const key = process.env[this.config.keyEnv];
      if (key) return { key };
      throw new BridgeError("native_credentials_missing", "The configured native key environment variable is empty; no other credential was substituted", 503);
    }
    if (this.config.authFile) {
      try {
        const host = new URL(this.config.baseUrl).hostname;
        if (!["chatgpt.com", "api.openai.com", "127.0.0.1", "[::1]"].includes(host))
          throw new Error("A shared Codex credential cannot be sent to a third-party upstream");
        const auth = JSON.parse(readFileSync(this.config.authFile, "utf8"));
        if (typeof auth.OPENAI_API_KEY === "string") return { key: auth.OPENAI_API_KEY };
        if (host !== "api.openai.com" && typeof auth.tokens?.access_token === "string") return { key: auth.tokens.access_token,
          ...(typeof auth.tokens.account_id === "string" ? { account: auth.tokens.account_id } : {}) };
      } catch { /* Never disclose credential file contents or filesystem errors. */ }
    }
    throw new BridgeError("native_credentials_missing", "Sign in through Codex or configure the native key environment variable", 503);
  }

  async request(path: string, request: Request, body?: ObjectValue): Promise<Response> {
    const { key, account } = this.credentials();
    const headers = new Headers({ authorization: `Bearer ${key}`, accept: request.headers.get("accept") ?? "application/json" });
    if (account) headers.set("chatgpt-account-id", account);
    for (const name of ["originator", "user-agent", "version", "openai-beta", "x-codex-turn-metadata", "x-codex-session-id", "session_id", "conversation_id", "idempotency-key"])
      if (request.headers.has(name)) headers.set(name, request.headers.get(name)!);
    if (body) headers.set("content-type", "application/json");
    const url = new URL(`${this.config!.baseUrl.replace(/\/$/, "")}/${path}`);
    const query = new URL(request.url).search;
    if (query) url.search = query;
    const response = await this.fetcher(url, { method: request.method, headers, redirect: "error", signal: request.signal,
      ...(body ? { body: canonical(readableNativeInput(body)) } : {}) });
    const outgoing = new Headers(response.headers);
    for (const name of ["set-cookie", "connection", "transfer-encoding", "content-length", "content-encoding"]) outgoing.delete(name);
    outgoing.set("cache-control", "no-store");
    return new Response(response.body, { status: response.status, headers: outgoing });
  }
}
