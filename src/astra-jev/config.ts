import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { atomicWriteFile, getConfigDir } from "../config";
import type { JevClientOptions } from "./jev";
import type { AstraJevSettingsInput, ReasoningEffort } from "./types";
import { AstraJevError } from "./types";

export const ASTRA_JEV_MODEL_ID = "astra-jev" as const;
export const ASTRA_JEV_UPSTREAM_MODEL = "gpt-6-astra" as const;
export const ASTRA_JEV_SERVICE_NAME = "astra-jev" as const;
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

export const DEFAULT_SUPPORTED_EFFORTS: readonly ReasoningEffort[] = ["low", "medium", "high", "xhigh"];

export const JEV_PROVIDERS: readonly JevClientOptions["provider"][] = [
  "vercel",
  "typesafe",
  "openrouter",
];

export interface AstraJevConfig {
  storageDirectory: string;
  supportedEfforts: ReasoningEffort[];
  timeoutMs: number;
  retentionHours: typeof DEFAULT_RETENTION_HOURS;
  latestMessageLimit: typeof DEFAULT_LATEST_MESSAGE_LIMIT;
  maxRequestBytes: number;
  maxPreviewChars: number;
}

export interface AstraJevSettingsSnapshot {
  provider: JevClientOptions["provider"];
  apiKey: string | undefined;
  timeoutMs: number;
  supportedEfforts: ReasoningEffort[];
}

interface PersistedSettings {
  provider: JevClientOptions["provider"];
}

function isProvider(value: unknown): value is JevClientOptions["provider"] {
  return typeof value === "string" && (JEV_PROVIDERS as readonly string[]).includes(value);
}

function validApiKey(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return undefined;
  return trimmed;
}

function settingsError(message: string): AstraJevError {
  return new AstraJevError(400, "invalid_astra_jev_settings", message);
}

/**
 * Stores the selected provider separately from one key file per provider. The files are kept under
 * the main application directory so the internal feature follows the daemon lifecycle and never
 * needs a second home, CLI, or environment-driven startup path.
 */
export class AstraJevSettingsStore {
  readonly directory: string;
  private readonly settingsPath: string;
  private provider: JevClientOptions["provider"];

  constructor(directory = join(getConfigDir(), "astra-jev")) {
    this.directory = directory;
    this.settingsPath = join(directory, "settings.json");
    this.provider = this.readProvider();
  }

  snapshot(config: Pick<AstraJevConfig, "timeoutMs" | "supportedEfforts">): AstraJevSettingsSnapshot {
    return {
      provider: this.provider,
      apiKey: this.readKey(this.provider),
      timeoutMs: config.timeoutMs,
      supportedEfforts: [...config.supportedEfforts],
    };
  }

  save(input: AstraJevSettingsInput): AstraJevSettingsSnapshot {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      throw settingsError("Astra Jev settings must be an object");
    }
    if (!isProvider(input.provider)) {
      throw settingsError("provider must be vercel, typesafe, or openrouter");
    }
    const suppliedKey = input.apiKey;
    const key = suppliedKey === undefined ? undefined : validApiKey(suppliedKey);
    if (suppliedKey !== undefined && key === undefined) {
      throw settingsError("apiKey must be a non-empty value without whitespace");
    }
    if (input.clearApiKey === true && key !== undefined) {
      throw settingsError("clearApiKey cannot be combined with a non-empty apiKey");
    }
    if (input.clearApiKey !== undefined && input.clearApiKey !== true && input.clearApiKey !== false) {
      throw settingsError("clearApiKey must be a boolean");
    }

    const previousKey = this.readKey(input.provider);
    try {
      if (input.clearApiKey === true) {
        this.removeKey(input.provider);
      } else if (key !== undefined) {
        this.writeKey(input.provider, key);
      }
      this.writeProvider(input.provider);
    } catch (error) {
      try {
        if (previousKey === undefined) this.removeKey(input.provider);
        else this.writeKey(input.provider, previousKey);
      } catch {
        // Preserve the original settings write failure; a future state read will remain unconfigured.
      }
      throw error;
    }
    this.provider = input.provider;
    return {
      provider: this.provider,
      apiKey: this.readKey(this.provider),
      timeoutMs: DEFAULT_JEV_TIMEOUT_MS,
      supportedEfforts: [...DEFAULT_SUPPORTED_EFFORTS],
    };
  }

  private keyPath(provider: JevClientOptions["provider"]): string {
    return join(this.directory, `${provider}.key`);
  }

  private readProvider(): JevClientOptions["provider"] {
    if (!existsSync(this.settingsPath)) return "vercel";
    try {
      const value = JSON.parse(readFileSync(this.settingsPath, "utf8")) as Partial<PersistedSettings>;
      return isProvider(value.provider) ? value.provider : "vercel";
    } catch {
      return "vercel";
    }
  }

  private readKey(provider: JevClientOptions["provider"]): string | undefined {
    try {
      return validApiKey(readFileSync(this.keyPath(provider), "utf8"));
    } catch {
      return undefined;
    }
  }

  private writeKey(provider: JevClientOptions["provider"], key: string): void {
    atomicWriteFile(this.keyPath(provider), `${key}\n`, { mode: 0o600 });
  }

  private removeKey(provider: JevClientOptions["provider"]): void {
    try {
      unlinkSync(this.keyPath(provider));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private writeProvider(provider: JevClientOptions["provider"]): void {
    atomicWriteFile(this.settingsPath, `${JSON.stringify({ provider })}\n`, { mode: 0o600 });
  }
}

export function defaultAstraJevConfig(directory = join(getConfigDir(), "astra-jev")): AstraJevConfig {
  return {
    storageDirectory: directory,
    supportedEfforts: [...DEFAULT_SUPPORTED_EFFORTS],
    timeoutMs: DEFAULT_JEV_TIMEOUT_MS,
    retentionHours: DEFAULT_RETENTION_HOURS,
    latestMessageLimit: DEFAULT_LATEST_MESSAGE_LIMIT,
    maxRequestBytes: DEFAULT_MAX_REQUEST_BYTES,
    maxPreviewChars: DEFAULT_MAX_PREVIEW_CHARS,
  };
}
