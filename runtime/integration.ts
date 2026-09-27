/** A reversible edit of one named Codex profile, not a replacement config. */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { atomicFile, type Config } from "./config";
import { WEB_MODELS } from "./protocol";

const BEGIN = "# BEGIN codex-chatgpt-web bend profile";
const END = "# END codex-chatgpt-web bend profile";

export function catalog(config: Config): Record<string, unknown>[] {
  const models: Record<string, unknown>[] = WEB_MODELS.filter(model => config.efforts.includes(model.effort)).map((model, priority) => ({
    slug: model.id, display_name: model.label, description: "User-authenticated webpage; one durable operation per native turn",
    visibility: "list", supported_in_api: true, priority, availability_nux: null,
    default_reasoning_level: model.codexEffort,
    supported_reasoning_levels: [{ effort: model.codexEffort, description: model.label }],
    shell_type: "exec", prefer_websockets: false, supports_parallel_tool_calls: true,
    input_modalities: ["text", "image"], context_window: config.limits.contextTokens,
    effective_context_window_percent: 95, truncation_policy: { mode: "tokens", limit: 10000 },
  }));
  if (config.jev) models.push({ ...models[0], slug: "astra-jev", display_name: "Astra Jev", priority: models.length,
    description: "Native API with checked adaptive effort leases; independent of webpage history",
    default_reasoning_level: "medium", supported_reasoning_levels: [{ effort: "medium", description: "Adaptive per-generation advice" }] });
  return models;
}

export function installProfile(home: string, config: Config, codexHome = process.env.CODEX_HOME || join(homedir(), ".codex")): string {
  const path = join(codexHome, "config.toml");
  const original = existsSync(path) ? readFileSync(path, "utf8") : "";
  const starts = original.split(BEGIN).length - 1, ends = original.split(END).length - 1;
  if (starts !== ends || starts > 1 || (starts && original.indexOf(END) < original.indexOf(BEGIN))) throw new Error("Codex profile markers are inconsistent; the existing file was not changed");
  const preserved = starts ? original.slice(0, original.indexOf(BEGIN)) + original.slice(original.indexOf(END) + END.length).replace(/^\r?\n/, "") : original;
  if (/^\s*\[(?:profiles\.web|model_providers\.bend_web)\]\s*$/m.test(preserved)) throw new Error("An unrelated web profile or bend_web provider already exists");
  const catalogPath = join(home, "models.json");
  const models = catalog(config);
  atomicFile(catalogPath, JSON.stringify({ models }, null, 2) + "\n");
  const block = `${BEGIN}\n[model_providers.bend_web]\nname = "Codex Web · Bend"\nbase_url = ${JSON.stringify(`http://127.0.0.1:${config.port}/v1`)}\nwire_api = "responses"\nrequires_openai_auth = false\nhttp_headers = { "Authorization" = ${JSON.stringify(`Bearer ${config.token}`)} }\n\n[profiles.web]\nmodel_provider = "bend_web"\nmodel = ${JSON.stringify(String(models[0]?.slug ?? "chatgpt-web/medium"))}\nmodel_catalog_json = ${JSON.stringify(catalogPath)}\n${END}\n`;
  if (original) atomicFile(`${path}.before-bend`, original);
  // Retain the backup and reject a detected concurrent editor. The filesystem
  // does not provide CAS against arbitrary noncooperating applications.
  if ((existsSync(path) ? readFileSync(path, "utf8") : "") !== original) throw new Error("Codex configuration changed during installation");
  atomicFile(path, preserved.replace(/\s*$/, "") + (preserved.trim() ? "\n\n" : "") + block);
  return "Installed profile web. Start Codex with `codex --profile web`. Your other profiles and default provider were preserved.";
}
