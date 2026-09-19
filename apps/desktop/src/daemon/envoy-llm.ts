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
  envoyHarnessDefaultModels,
  envoyProviderApiKeyEnv,
  isEnvoyHarnessProvider,
  modelIdFor,
} from "@envoydev/agent-catalog";
import {
  ENVOYDEV_ERRORS,
  coderError,
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
 * unless the client already named a provider Envoy Harness documents — older callers send them separately.
 */
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
      return { provider: left, model: right };
    }
  }
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

export async function readEnvoyLlmConfig(paths: CoderPaths): Promise<EnvoyLlmConfig | undefined> {
  try {
    const raw = JSON.parse(await readFile(stateFile(paths), "utf8")) as Partial<EnvoyLlmConfig>;
    if (
      typeof raw.provider === "string" &&
      raw.provider.length > 0 &&
      typeof raw.model === "string" &&
      raw.model.length > 0
    ) {
      return {
        provider: raw.provider,
        model: raw.model,
        ...(typeof raw.baseUrl === "string" && raw.baseUrl.trim() !== ""
          ? { baseUrl: raw.baseUrl.trim() }
          : {}),
      };
    }
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
    options: envoyHarnessDefaultModels(),
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

function readEnvoyLlmConfigSync(paths: CoderPaths): EnvoyLlmConfig | undefined {
  try {
    const raw = JSON.parse(readFileSync(stateFile(paths), "utf8")) as Partial<EnvoyLlmConfig>;
    if (
      typeof raw.provider === "string" &&
      raw.provider.length > 0 &&
      typeof raw.model === "string" &&
      raw.model.length > 0
    ) {
      return {
        provider: raw.provider,
        model: raw.model,
        ...(typeof raw.baseUrl === "string" && raw.baseUrl.trim() !== ""
          ? { baseUrl: raw.baseUrl.trim() }
          : {}),
      };
    }
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
