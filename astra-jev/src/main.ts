import { mkdir } from "node:fs/promises";

import { HistoryStore } from "./history-store";
import { JevClient } from "./jev";
import { loadAstraJevConfig, type AstraJevConfig } from "./config";
import { createAstraJevProxy, formatAstraJevError } from "./proxy";

export interface AstraJevRuntime {
  config: AstraJevConfig;
  server: ReturnType<typeof Bun.serve>;
  historyStore: HistoryStore;
  close(): void;
}

export async function startAstraJev(config: AstraJevConfig = loadAstraJevConfig()): Promise<AstraJevRuntime> {
  await mkdir(config.homeDirectory, { recursive: true });
  const historyStore = new HistoryStore({ directory: config.homeDirectory });
  const jevClient = new JevClient(config.jev);
  const proxy = createAstraJevProxy({ config, historyStore, jevClient });
  const sweepTimer = setInterval(() => historyStore.sweep(), 60_000);

  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({
      hostname: config.host,
      port: config.port,
      fetch: request => proxy.handle(request),
      error: error => formatAstraJevError(error),
    });
  } catch (error) {
    clearInterval(sweepTimer);
    historyStore.close();
    throw error;
  }

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(sweepTimer);
    server.stop(true);
    historyStore.close();
  };

  return { config, server, historyStore, close };
}

async function run(): Promise<void> {
  const runtime = await startAstraJev();
  const address = `http://${runtime.config.host}:${runtime.config.port}`;
  console.log(`[astra-jev] listening on ${address}; upstream=${runtime.config.upstreamBaseUrl}; Jev provider=${runtime.config.jev.provider}`);
  if (!runtime.config.jev.apiKey) {
    console.warn("[astra-jev] Jev provider key is not configured; managed requests will return jev_credentials_missing");
  }

  const shutdown = () => {
    runtime.close();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

if (import.meta.main) {
  run().catch(error => {
    console.error(`[astra-jev] startup failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  });
}
