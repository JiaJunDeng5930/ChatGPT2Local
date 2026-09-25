import type { AppConfig } from "./config";
import { ASTRA_JEV_MODEL_ID, ASTRA_JEV_UPSTREAM_MODEL, DEFAULT_SUPPORTED_EFFORTS } from "./astra-jev/config";
import type { CodexModelContextOverride } from "./codex-integration";
import {
  availableChatGptWebModelRoutes,
  CHATGPT_WEB_MODEL_PREFIX,
  type ChatGptWebModelRoute,
} from "./chatgpt-web-models";

type JsonObject = Record<string, unknown>;

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as JsonObject;
}

function slug(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = (value as JsonObject).slug;
  return typeof candidate === "string" ? candidate : undefined;
}

function reasoningLevel(template: JsonObject, effort: string, description: string): JsonObject {
  const levels = Array.isArray(template.supported_reasoning_levels)
    ? template.supported_reasoning_levels.filter(level => level && typeof level === "object" && !Array.isArray(level)) as JsonObject[]
    : [];
  const source = levels.find(level => level.effort === effort);
  return { ...(source ? structuredClone(source) : {}), effort, description };
}

function modelPriority(template: JsonObject): number | undefined {
  const value = template.priority;
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error("Native Codex model template priority must be an integer");
  }
  return value;
}

function routedModelPriority(
  template: JsonObject,
  route: ChatGptWebModelRoute,
  config: AppConfig,
): number | undefined {
  const priority = modelPriority(template);
  if (priority === undefined
    || config.subagentProtocol !== "compatibility-v1"
    || route.slug !== "chatgpt-web/light") return priority;
  if (priority === Number.MAX_SAFE_INTEGER) {
    throw new Error("Native Codex model template priority cannot reserve the Compatibility V1 roster");
  }
  // Codex V1 exposes at most five model overrides. Keep the native Sol row plus the four useful
  // delegated Web efforts (Medium, High, Extra High, Pro); Instant remains a selectable root model
  // but does not displace Pro from spawn_agent's bounded registry.
  return priority + 1;
}

function nativeTemplateCandidate(value: unknown, requireTools: boolean): value is JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const model = value as JsonObject;
  const modelSlug = slug(model);
  if (!modelSlug || modelSlug.startsWith(CHATGPT_WEB_MODEL_PREFIX)) return false;
  // This route forwards ChatGPT authentication. Codex's own model manager keeps every list-visible
  // model in ChatGPT mode even when `supported_in_api` is false; that flag gates API-key mode, not
  // whether the backend row is a valid catalog template. The routed Web row overrides the flag to
  // true because this local Responses endpoint implements it.
  if (model.visibility !== "list") return false;
  if (!Array.isArray(model.supported_reasoning_levels)) return false;
  return !requireTools || (typeof model.tool_mode === "string" && model.tool_mode.length > 0);
}

function selectNativeTemplate(models: unknown[], config: AppConfig): JsonObject {
  const requireTools = config.mode === "full";
  const candidates = models.filter(model => nativeTemplateCandidate(model, requireTools)) as JsonObject[];
  const template = candidates[0];
  if (template) return template;
  throw new Error(
    requireTools
      ? "Native Codex models response has no list-visible, tool-capable model with reasoning metadata"
      : "Native Codex models response has no list-visible model with reasoning metadata",
  );
}

function useCompatibilityV1SubagentSurface(model: JsonObject): void {
  // Compatibility V1 is an explicit whole-task protocol mode. Preserve an explicit disabled
  // capability instead of advertising support that the native model denied.
  if (model.multi_agent_version !== "disabled") model.multi_agent_version = "v1";
}

function routedSubagentVersion(template: JsonObject, config: AppConfig): string | undefined {
  if (config.subagentProtocol === "compatibility-v1") return "v1";
  return typeof template.multi_agent_version === "string" ? template.multi_agent_version : undefined;
}

export function buildChatGptWebModel(
  templateValue: unknown,
  route: ChatGptWebModelRoute,
  config: AppConfig,
): JsonObject {
  const template = object(templateValue, "native Codex model template");
  const templateSlug = slug(template);
  if (!templateSlug || templateSlug.startsWith(CHATGPT_WEB_MODEL_PREFIX)) {
    throw new Error("ChatGPT Web model template must be a native Codex model");
  }
  const multiAgentVersion = routedSubagentVersion(template, config);
  const priority = routedModelPriority(template, route, config);
  const model: JsonObject = {
    ...structuredClone(template),
    slug: route.slug,
    display_name: route.displayName,
    description: route.description,
    input_modalities: ["text", "image"],
    visibility: "list",
    // These slugs are implemented by this local Responses-compatible bridge. Marking them false
    // makes Codex drop them from spawn_agent whenever openai_base_url points at the bridge.
    supported_in_api: true,
    // Follow the official template's ordering without outranking it. Codex advertises at most five
    // spawn-agent overrides; forcing every routed row to priority 0 displaced gpt-5.6-sol from that
    // registry and made an explicit native child model fail validation.
    ...(priority === undefined ? {} : { priority }),
    // In native mode the routed row follows the official template's protocol surface. Web-origin
    // V2 collaboration calls carry the protocol's explicit plaintext marker; Compatibility V1
    // instead pins the entire catalog and Codex feature override to V1.
    ...(multiAgentVersion === undefined
      ? {}
      : { multi_agent_version: multiAgentVersion }),
    // Code mode collapses the outer registry into an exec gateway; routed models need the regular
    // Responses tool surface so MCP namespaces, deferred tool_search, and custom tools reach us.
    tool_mode: null,
    upgrade: null,
    default_reasoning_level: route.codexEffort,
    supported_reasoning_levels: [reasoningLevel(template, route.codexEffort, route.displayName)],
    // Codex uses these fields to schedule context compaction and truncate Web input. This adapter
    // owns browser transport limits itself and leaves the native client no Web-specific trigger.
    context_window: null,
    max_context_window: null,
    effective_context_window_percent: null,
    auto_compact_token_limit: null,
    // ChatGPT Web has no Codex service tier. Never inherit the native template's Fast tiers.
    additional_speed_tiers: [],
    service_tiers: [],
    default_service_tier: null,
  };
  // A native template's compaction hash describes OpenAI's native model contract, not this routed
  // browser model. Web transport limits are enforced by the adapter, never copied to native rows
  // or the user's top-level model_context_window setting.
  delete model.comp_hash;
  delete model.availability_nux;
  return model;
}

function nativeAstraTemplate(models: unknown[]): JsonObject | undefined {
  const candidate = models.find(value => {
    const modelSlug = slug(value);
    return modelSlug === ASTRA_JEV_UPSTREAM_MODEL || modelSlug === ASTRA_JEV_MODEL_ID;
  });
  return candidate && typeof candidate === "object" && !Array.isArray(candidate)
    ? candidate as JsonObject
    : undefined;
}

function buildAstraJevModel(models: unknown[]): JsonObject {
  const source = nativeAstraTemplate(models);
  const model = source
    ? structuredClone(source)
    : {
      slug: ASTRA_JEV_MODEL_ID,
      input_modalities: ["text"],
      supported_reasoning_levels: [],
      visibility: "list",
      supported_in_api: true,
    } as JsonObject;
  const sourceLevels = Array.isArray(model.supported_reasoning_levels)
    ? model.supported_reasoning_levels.filter(level => level && typeof level === "object" && !Array.isArray(level)) as JsonObject[]
    : [];
  const levelFor = (effort: string): JsonObject => {
    const sourceLevel = sourceLevels.find(level => level.effort === effort);
    return {
      ...(sourceLevel ? structuredClone(sourceLevel) : {}),
      effort,
      description: "Astra Jev uses medium as the baseline and adaptively selects the next reasoning effort from retained task state.",
    };
  };
  model.slug = ASTRA_JEV_MODEL_ID;
  model.display_name = "Astra Jev";
  model.description = "Astra Jev uses medium as the baseline and adaptively selects reasoning effort from retained task state.";
  model.visibility = "list";
  model.supported_in_api = true;
  model.default_reasoning_level = "medium";
  model.supported_reasoning_levels = DEFAULT_SUPPORTED_EFFORTS.map(levelFor);
  model.tool_mode = null;
  model.upgrade = null;
  delete model.comp_hash;
  delete model.availability_nux;
  if (!source) {
    // The upstream catalog did not describe Astra; leaving context fields absent avoids inventing a
    // window that could cause the native client to truncate or compact at the wrong boundary.
    delete model.context_window;
    delete model.max_context_window;
    delete model.effective_context_window_percent;
    delete model.auto_compact_token_limit;
  }
  return model;
}

export function augmentNativeModelCatalog(
  value: unknown,
  config: AppConfig,
  contextOverride?: CodexModelContextOverride,
): JsonObject {
  const catalog = object(value, "native Codex models response");
  if (!Array.isArray(catalog.models)) {
    throw new Error("Native Codex models response is missing a models array");
  }
  const nativeModels = structuredClone(
    catalog.models.filter(model => {
      const modelSlug = slug(model);
      return !modelSlug?.startsWith(CHATGPT_WEB_MODEL_PREFIX) && modelSlug !== ASTRA_JEV_MODEL_ID;
    }),
  );
  if (config.subagentProtocol === "compatibility-v1") {
    for (const candidate of nativeModels) {
      if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
        useCompatibilityV1SubagentSurface(candidate as JsonObject);
      }
    }
  }
  const template = selectNativeTemplate(nativeModels, config);
  if (contextOverride) {
    // model_context_window is a single top-level Codex setting, not a per-model one. Apply its
    // advertised maximum to every native row so switching native models cannot silently clamp the
    // effective override. Codex itself applies context_window and auto-compaction configuration.
    for (const candidate of nativeModels) {
      const modelSlug = slug(candidate);
      if (!modelSlug) continue;
      const model = object(candidate, `native ${modelSlug} model`);
      const current = model.max_context_window;
      if (current !== undefined && current !== null
        && (typeof current !== "number" || !Number.isSafeInteger(current) || current <= 0)) {
        throw new Error(`Native ${modelSlug} max_context_window must be a positive integer`);
      }
      if (current === undefined || current === null || current < contextOverride.contextWindow) {
        model.max_context_window = contextOverride.contextWindow;
      }
    }
  }
  const webModels = availableChatGptWebModelRoutes(config)
    .map(route => buildChatGptWebModel(template, route, config));
  const astraJevModel = buildAstraJevModel(nativeModels);
  return {
    ...structuredClone(catalog),
    models: [...nativeModels, ...webModels, astraJevModel],
  };
}
