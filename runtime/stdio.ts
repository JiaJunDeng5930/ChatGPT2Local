/** MCP stdio is only a transport to the one owning application process. */
import { createInterface } from "node:readline";
import { once } from "node:events";
import type { Config } from "./config";
import { object } from "./codec";

export async function stdio(config: Config): Promise<void> {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  let session: string | undefined;
  let initialize: Promise<void> = Promise.resolve();
  let output = Promise.resolve();
  const pending = new Set<Promise<void>>();
  const transport = new AbortController();
  let ended = false;
  const publish = (value: unknown) => {
    output = output.then(async () => {
      if (ended || process.stdout.destroyed) return;
      if (!process.stdout.write(JSON.stringify(value) + "\n")) await once(process.stdout, "drain");
    });
    return output;
  };
  const handle = async (line: string) => {
    let rpc: ReturnType<typeof object>;
    try {
      if (Buffer.byteLength(line) > 8 * 1024 * 1024) throw new Error("Oversized MCP frame");
      rpc = object(JSON.parse(line));
    } catch { await publish({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid bounded JSON frame" } }); return; }
    try {
      if (rpc.method !== "initialize") await initialize;
      const response = await fetch(`http://127.0.0.1:${config.port}/mcp`, { method: "POST", redirect: "error", signal: transport.signal,
        headers: { "content-type": "application/json", accept: "application/json", ...(session ? { "mcp-session-id": session } : {}) }, body: line });
      const nextSession = response.headers.get("mcp-session-id");
      if (nextSession) session = nextSession;
      if (rpc.id !== undefined) {
        if (!response.ok) throw new Error("MCP application transport unavailable");
        await publish(await response.json());
      }
    } catch {
      if (rpc.id !== undefined) await publish({ jsonrpc: "2.0", id: rpc.id,
        error: { code: -32000, message: "The owning application is unavailable. No task was restarted or cancelled." } });
    }
  };
  for await (const line of lines) {
    if (!line.trim()) continue;
    const job = handle(line);
    // Initialization establishes the session before following requests; tool
    // requests thereafter can wait concurrently, without blocking result IO.
    try { if (JSON.parse(line).method === "initialize") initialize = job; } catch { /* handle emits the parse error. */ }
    pending.add(job);
    void job.finally(() => pending.delete(job)).catch(() => {});
  }
  // stdin close means this transport disappeared. It is not user cancellation;
  // the durable activities remain owned by the runtime process.
  ended = true;
  transport.abort(new DOMException("stdio transport detached", "AbortError"));
  await Promise.allSettled([...pending]);
  await output.catch(() => {});
  process.exitCode = 0;
}
