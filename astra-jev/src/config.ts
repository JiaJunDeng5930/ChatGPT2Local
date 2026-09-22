import { homedir } from "node:os";
import { join } from "node:path";

import type { JevClientOptions } from "./jev";
import type { ReasoningEffort } from "./types";

export const ASTRA_JEV_SERVICE_NAME = "astra-jev";
export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 17_842;
export const DEFAULT_UPSTREAM_BASE_URL = "https://chatgpt.com/backend-api/codex";
export const DEFAULT_RETENTION_HOURS = 24;
export const DEFAULT_LATEST_MESSAGE_LIMIT = 8;
export const DEFAULT_JEV_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_REQUEST_BYTES = 8 * 1024 * 1024;
export const DEFAULT_MAX_PREVIEW_CHARS = 4_000;

export const ALL_REASONING_EFFORTS: readonly ReasoningEffort[] = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
];

export const DEFAULT_SUPPORTED_EFFORTS: readonly ReasoningEffort[] = ["low", "medium", "high"];

export interface AstraJevConfig {
  serviceName: string;
  host: string;
  port: number;
  homeDirectory: string;
  upstreamBaseUrl: string;
  upstreamApiKey: string | undefined;
  supportedEfforts: ReasoningEffort[];
  jev: JevClientOptions;
  retentionHours: number;
  latestMessageLimit: number;
  maxRequestBytes: number;
  maxPreviewChars: number;
  startedAt: number;
}

type Environment = Record<string, string | undefined>;

function configurationError(message: string): Error {
  return new Error(`Astra Jev configuration error: ${message}`);
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function flagValue(argv: readonly string[], ...names: string[]): string | undefined {
  for (let index = 2; index < argv.length; index += 1) {
    const argument = argv[index];
    for (const name of names) {
      if (argument === name) {
        const value = argv[index + 1];
        if (!value || value.startsWith("--")) {
          throw configurationError(`CLI option ${name} requires a value`);
        }
        return value;
      }
      if (argument.startsWith(`${name}=`)) return argument.slice(name.length + 1);
    }
  }
  return undefined;
}

function parsePort(value: string | undefined): number {
  if (value === undefined || value.trim() === "") return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw configurationError(`port must be an integer from 1 to 65535, received ${JSON.stringify(value)}`);
  }
  return port;
}

function parsePositiveInteger(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw configurationError(`${name} must be a positive integer, received ${JSON.stringify(value)}`);
  }
  return parsed;
}

function parseUpstreamBaseUrl(value: string | undefined): string {
  const candidate = value?.trim() || DEFAULT_UPSTREAM_BASE_URL;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw configurationError(`upstream base URL is invalid: ${JSON.stringify(candidate)}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw configurationError("upstream base URL must use http or https");
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw configurationError("upstream base URL must not contain credentials or a fragment");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  return parsed.toString().replace(/\/$/, "");
}

function parseProvider(value: string | undefined): JevClientOptions["provider"] {
  const provider = (value?.trim() || "vercel").toLowerCase();
  if (provider === "vercel" || provider === "typesafe" || provider === "openrouter") return provider;
  throw configurationError(`Jev provider must be vercel, typesafe, or openrouter, received ${JSON.stringify(provider)}`);
}

function parseSupportedEfforts(value: string | undefined): ReasoningEffort[] {
  const raw = value?.trim();
  const values = raw
    ? raw.split(",").map(item => item.trim()).filter(Boolean)
    : [...DEFAULT_SUPPORTED_EFFORTS];
  if (values.length === 0) throw configurationError("supported efforts must contain at least one effort");

  const result: ReasoningEffort[] = [];
  for (const value of values) {
    if (!(ALL_REASONING_EFFORTS as readonly string[]).includes(value)) {
      throw configurationError(`unsupported reasoning effort ${JSON.stringify(value)}`);
    }
    const effort = value as ReasoningEffort;
    if (!result.includes(effort)) result.push(effort);
  }
  return result;
}

function expandHomeDirectory(value: string | undefined, environment: Environment): string {
  const configured = value?.trim();
  if (!configured) return join(environment.HOME?.trim() || homedir(), ".astra-jev");
  if (configured === "~") return environment.HOME?.trim() || homedir();
  if (configured.startsWith("~/")) {
    return join(environment.HOME?.trim() || homedir(), configured.slice(2));
  }
  return configured;
}

function providerKey(environment: Environment, provider: JevClientOptions["provider"]): string | undefined {
  return firstNonEmpty(
    environment.ASTRA_JEV_JEV_API_KEY,
    provider === "vercel" ? environment.AI_GATEWAY_API_KEY : undefined,
    provider === "typesafe" ? environment.TYPESAFE_API_KEY : undefined,
    provider === "openrouter" ? environment.OPENROUTER_API_KEY : undefined,
  );
}

export function loadAstraJevConfig(
  environment: Environment = process.env,
  argv: readonly string[] = Bun.argv,
): AstraJevConfig {
  const provider = parseProvider(
    flagValue(argv, "--jev-provider", "--provider") || environment.ASTRA_JEV_JEV_PROVIDER,
  );
  const supportedEfforts = parseSupportedEfforts(
    flagValue(argv, "--supported-efforts", "--efforts") || environment.ASTRA_JEV_SUPPORTED_EFFORTS,
  );
  const homeDirectory = expandHomeDirectory(
    flagValue(argv, "--home", "--astra-jev-home") || environment.ASTRA_JEV_HOME,
    environment,
  );
  const maxRequestBytes = parsePositiveInteger(
    "max request bytes",
    environment.ASTRA_JEV_MAX_REQUEST_BYTES,
    DEFAULT_MAX_REQUEST_BYTES,
  );
  const maxPreviewChars = parsePositiveInteger(
    "max preview characters",
    environment.ASTRA_JEV_MAX_PREVIEW_CHARS,
    DEFAULT_MAX_PREVIEW_CHARS,
  );
  const timeoutMs = parsePositiveInteger(
    "Jev timeout",
    flagValue(argv, "--jev-timeout-ms", "--timeout-ms") || environment.ASTRA_JEV_JEV_TIMEOUT_MS,
    DEFAULT_JEV_TIMEOUT_MS,
  );

  return {
    serviceName: ASTRA_JEV_SERVICE_NAME,
    host: firstNonEmpty(flagValue(argv, "--host"), environment.ASTRA_JEV_HOST) || DEFAULT_HOST,
    port: parsePort(flagValue(argv, "--port") || environment.ASTRA_JEV_PORT),
    homeDirectory,
    upstreamBaseUrl: parseUpstreamBaseUrl(
      flagValue(argv, "--upstream-base-url", "--upstream") || environment.ASTRA_JEV_UPSTREAM_BASE_URL,
    ),
    upstreamApiKey: firstNonEmpty(
      flagValue(argv, "--upstream-api-key"),
      environment.ASTRA_JEV_UPSTREAM_API_KEY,
    ),
    supportedEfforts,
    jev: {
      provider,
      apiKey: firstNonEmpty(flagValue(argv, "--jev-api-key"), providerKey(environment, provider)) || "",
      timeoutMs,
    },
    retentionHours: DEFAULT_RETENTION_HOURS,
    latestMessageLimit: DEFAULT_LATEST_MESSAGE_LIMIT,
    maxRequestBytes,
    maxPreviewChars,
    startedAt: Date.now(),
  };
}
