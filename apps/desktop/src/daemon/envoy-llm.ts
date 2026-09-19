/**
 * Envoy Harness LLM settings — provider, model, optional base URL, and an API key kept off the wire.
 *
 * ## Why this exists
 *
 * Envoy Harness is the built-in agent. Settings → LLM writes its base URL, model string and API key
 * here. The key lives under `secretsDir` (0600) and is never returned by `coder.getEnvoyLlm` — only
 * `apiKeySet: true|false`. The provider is derived from the model string so the form does not ask for one.
 *
 * ## What is not stored here
 *
 * Claude / Codex / Cursor credentials stay in those CLIs. User-declared ACP providers still name env
 * vars only (`AgentProviderConfig.env`). This module is the one exception for the built-in agent.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  envoyProviderApiKeyEnv,
  isEnvoyHarnessProvider,
  modelIdFor,
  resolveModelChoice,
} from "@envoydev/agent-catalog";
import {
  ENVOYDEV_ERRORS,
  coderError,
  type AgentModels,
  type CoderSettings,
} from "@envoydev/protocol";
import type { CoderPaths } from "@envoydev/host-bridge";

import { ref } from "./messages.js";
import type { CoderStore } from "./store.js";

/** Non-secret half — safe to put under `stateDir`. */
export interface EnvoyLlmConfig {
  provider: string;
  model: string;
  baseUrl?: string;
}

/** What the window may see — never the key. */
export interface EnvoyLlmPublic {
  provider?: string;
  model?: string;
  baseUrl?: string;
  apiKeySet: boolean;
  options: readonly { id: string; provider: string; model: string; label: string }[];
}

export interface EnvoyLlmSetInput {
  provider: string;
  model: string;
  /** Empty or omitted clears a stored base URL. */
  baseUrl?: string;
  /** When present and non-empty, replaces the stored key. */
  apiKey?: string;
  /** When true, removes any stored key. */
  clearApiKey?: boolean;
}

function stateFile(paths: CoderPaths): string {
  return join(paths.stateDir, "envoy-llm.json");
}

function secretFile(paths: CoderPaths): string {
  return join(paths.secretsDir, "envoy-llm-key.json");
}

async function atomicWrite(path: string, body: string): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, body, { encoding: "utf8", mode: 0o600 });
  await rename(tmp, path);
}

/**
 * Turn the model string a person typed into the provider/model Envoy Harness launches with.
 *
 * `anthropic/claude-sonnet-4-5` names both halves. A bare id (`gpt-4o`, or a custom id) is OpenAI-compatible
 * unless it is a MiniMax id (`MiniMax-M3`, `Minimax M3`) or the client already named a provider.
 */
function miniMaxModelId(input: string): string | undefined {
  const compact = input.replace(/[\s_-]+/g, "").toLowerCase();
  const match = /^minimaxm(\d+)$/.exec(compact);
  return match === null ? undefined : `MiniMax-M${match[1]}`;
}

export function deriveEnvoyLlmChoice(
  modelInput: string,
  clientProvider = "",
): { provider: string; model: string } {
  const trimmed = modelInput.trim();
  const slash = trimmed.indexOf("/");
  if (slash > 0 && slash < trimmed.length - 1) {
    const left = trimmed.slice(0, slash).toLowerCase();
    const right = trimmed.slice(slash + 1).trim();
    if (right.length > 0 && isEnvoyHarnessProvider(left)) {
      const mini = miniMaxModelId(right);
      return { provider: left, model: mini ?? right };
    }
  }
  const mini = miniMaxModelId(trimmed);
  if (mini !== undefined) return { provider: "minimax", model: mini };
  const fallback = clientProvider.trim().toLowerCase();
  if (isEnvoyHarnessProvider(fallback)) return { provider: fallback, model: trimmed };
  return { provider: "openai", model: trimmed };
}

/** What the model field shows. OpenAI is the default, so a bare id is not prefixed. */
export function envoyLlmModelField(provider: string | undefined, model: string | undefined): string {
  if (model === undefined || model === "") return "";
  if (provider === undefined || provider === "" || provider === "openai") return model;
  return `${provider}/${model}`;
}

/** Re-derive on read so a model saved as OpenAI before MiniMax was recognised still launches as MiniMax. */
function normalizeStored(raw: Partial<EnvoyLlmConfig>): EnvoyLlmConfig | undefined {
  if (typeof raw.provider !== "string" || raw.provider.length === 0) return undefined;
  if (typeof raw.model !== "string" || raw.model.length === 0) return undefined;
  const choice = deriveEnvoyLlmChoice(envoyLlmModelField(raw.provider, raw.model), raw.provider);
  if (choice.model.length === 0) return undefined;
  return {
    provider: choice.provider,
    model: choice.model,
    ...(typeof raw.baseUrl === "string" && raw.baseUrl.trim() !== ""
      ? { baseUrl: raw.baseUrl.trim() }
      : {}),
  };
}

export async function readEnvoyLlmConfig(paths: CoderPaths): Promise<EnvoyLlmConfig | undefined> {
  try {
    const raw = JSON.parse(await readFile(stateFile(paths), "utf8")) as Partial<EnvoyLlmConfig>;
    return normalizeStored(raw);
  } catch {
    // Missing or unreadable — no settings yet.
  }
  return undefined;
}

async function readApiKey(paths: CoderPaths): Promise<string | undefined> {
  try {
    const raw = JSON.parse(await readFile(secretFile(paths), "utf8")) as { apiKey?: unknown };
    if (typeof raw.apiKey === "string" && raw.apiKey.length > 0) return raw.apiKey;
  } catch {
    // No key stored.
  }
  return undefined;
}

export async function getEnvoyLlmPublic(paths: CoderPaths): Promise<EnvoyLlmPublic> {
  const config = await readEnvoyLlmConfig(paths);
  const key = await readApiKey(paths);
  return {
    ...(config !== undefined
      ? {
          provider: config.provider,
          model: config.model,
          ...(config.baseUrl !== undefined ? { baseUrl: config.baseUrl } : {}),
        }
      : {}),
    apiKeySet: key !== undefined,
    options: config === undefined ? [] : [configuredOption(config)],
  };
}

export async function setEnvoyLlm(
  paths: CoderPaths,
  store: CoderStore,
  input: EnvoyLlmSetInput,
): Promise<EnvoyLlmPublic> {
  const choice = deriveEnvoyLlmChoice(input.model, input.provider);
  const provider = choice.provider;
  const model = choice.model;
  if (model.length === 0) {
    throw coderError(
      ENVOYDEV_ERRORS.badRequest,
      "Envoy Harness needs a model, so the LLM settings were not saved.",
      ref("error.envoyLlmUnknownModel", { provider, model: input.model }),
    );
  }

  const baseUrl =
    typeof input.baseUrl === "string" && input.baseUrl.trim() !== "" ? input.baseUrl.trim() : undefined;

  const needsKey = envoyProviderApiKeyEnv(provider) !== undefined;
  // Clear is allowed even when this provider normally needs a key. The next launch simply
  // starts without one; refusing here made the Clear button a no-op for every real provider.
  if (needsKey && input.clearApiKey !== true) {
    const existing = await readApiKey(paths);
    const next = typeof input.apiKey === "string" && input.apiKey.length > 0 ? input.apiKey : existing;
    if (next === undefined) {
      throw coderError(
        ENVOYDEV_ERRORS.badRequest,
        `Envoy Harness needs an API key for ${provider}, and none is saved yet.`,
        ref("error.envoyLlmApiKeyRequired", { provider }),
      );
    }
  }

  await mkdir(paths.stateDir, { recursive: true });
  const config: EnvoyLlmConfig = {
    provider,
    model,
    ...(baseUrl !== undefined ? { baseUrl } : {}),
  };
  await atomicWrite(stateFile(paths), `${JSON.stringify(config, null, 2)}\n`);

  if (input.clearApiKey === true) {
    await mkdir(paths.secretsDir, { recursive: true, mode: 0o700 });
    await atomicWrite(secretFile(paths), `${JSON.stringify({ apiKey: "" }, null, 2)}\n`);
  } else if (typeof input.apiKey === "string" && input.apiKey.length > 0) {
    await mkdir(paths.secretsDir, { recursive: true, mode: 0o700 });
    await atomicWrite(secretFile(paths), `${JSON.stringify({ apiKey: input.apiKey }, null, 2)}\n`);
  }

  // Keep New tasks / composer defaults aligned with this panel.
  const patch: Partial<CoderSettings> = {
    defaults: { model: modelIdFor(provider, model) },
  };
  await store.updateSettings(patch);

  return getEnvoyLlmPublic(paths);
}

/**
 * Env vars to hand the envoy-harness child for the run's provider, when a key is stored for the
 * active LLM settings and that provider matches.
 *
 * Synchronous because `launchForHarness` is — a spawn path must not await disk between probe and fork.
 */
export function envoyLlmLaunchEnv(
  paths: CoderPaths,
  runProvider: string | undefined,
): Record<string, string> {
  const config = readEnvoyLlmConfigSync(paths);
  if (config === undefined || runProvider === undefined) return {};
  if (config.provider.toLowerCase() !== runProvider.toLowerCase()) return {};
  const envName = envoyProviderApiKeyEnv(runProvider);
  if (envName === undefined) return {};
  const key = readApiKeySync(paths);
  if (key === undefined) return {};
  return { [envName]: key };
}

/** Optional `--base-url` for the active LLM settings when the run uses that same provider. */
export function envoyLlmBaseUrlArgs(
  paths: CoderPaths,
  runProvider: string | undefined,
): string[] {
  const config = readEnvoyLlmConfigSync(paths);
  if (config === undefined || config.baseUrl === undefined || runProvider === undefined) return [];
  if (config.provider.toLowerCase() !== runProvider.toLowerCase()) return [];
  return ["--base-url", config.baseUrl];
}

function configuredOption(config: EnvoyLlmConfig): {
  id: string;
  provider: string;
  model: string;
  label: string;
} {
  return {
    id: modelIdFor(config.provider, config.model),
    provider: config.provider,
    model: config.model,
    label: config.model,
  };
}

/**
 * What the composer may offer for Envoy Harness.
 *
 * The harness has no model of its own. Until Settings saves one, the control is off. After that,
 * the list is that model — not the catalogue of provider defaults.
 */
export function envoyHarnessModels(paths: CoderPaths): AgentModels {
  const config = readEnvoyLlmConfigSync(paths);
  if (config === undefined) {
    return {
      kind: "none",
      options: [],
      source: "Envoy Harness has no model of its own. Settings has not saved one.",
    };
  }
  return {
    kind: "listed",
    options: [configuredOption(config)],
    source: "The model saved in Settings. Envoy Harness does not ship a model list.",
  };
}

/**
 * The model a new Envoy Harness run should use.
 *
 * An empty choice, or a choice for a different provider than the saved key, becomes the saved
 * model. A choice for the same provider is kept, so one key can later cover more than one model.
 */
export function envoyRunModel(paths: CoderPaths, requested: string | undefined): string | undefined {
  const config = readEnvoyLlmConfigSync(paths);
  if (config === undefined) return requested === "" ? undefined : requested;
  const configured = modelIdFor(config.provider, config.model);
  if (requested === undefined || requested.trim() === "") return configured;
  const resolved = resolveModelChoice("envoy-harness", requested);
  if (!resolved.ok) return configured;
  if (resolved.provider.toLowerCase() !== config.provider.toLowerCase()) return configured;
  return modelIdFor(resolved.provider, resolved.model);
}

function readEnvoyLlmConfigSync(paths: CoderPaths): EnvoyLlmConfig | undefined {
  try {
    const raw = JSON.parse(readFileSync(stateFile(paths), "utf8")) as Partial<EnvoyLlmConfig>;
    return normalizeStored(raw);
  } catch {
    // Missing or unreadable.
  }
  return undefined;
}

function readApiKeySync(paths: CoderPaths): string | undefined {
  try {
    const raw = JSON.parse(readFileSync(secretFile(paths), "utf8")) as { apiKey?: unknown };
    if (typeof raw.apiKey === "string" && raw.apiKey.length > 0) return raw.apiKey;
  } catch {
    // No key.
  }
  return undefined;
}
