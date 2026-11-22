/**
 * Live model ids from an Envoy Harness LLM provider — merged with the curated catalogue by callers.
 *
 * Failures return `[]` so the UI still has curated options. Results are cached in-memory per
 * provider+baseUrl until `invalidateEnvoyLlmModelCache` (after Settings save).
 */

import { normalizeEnvoyProvider } from "@envoydev/agent-catalog";

const DEFAULT_BASE_URLS: Readonly<Record<string, string>> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  deepseek: "https://api.deepseek.com/v1",
  minimax: "https://api.minimax.io/v1",
  glm: "https://open.bigmodel.cn/api/paas/v4",
  qwen: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  ollama: "http://localhost:11434/v1",
};

const cache = new Map<string, { at: number; ids: readonly string[] }>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;

/** Drop cached live lists after Settings changes the key / base URL / provider. */
export function invalidateEnvoyLlmModelCache(): void {
  cache.clear();
}

export function defaultEnvoyProviderBaseUrl(provider: string): string | undefined {
  return DEFAULT_BASE_URLS[normalizeEnvoyProvider(provider)];
}

export interface FetchEnvoyLiveModelsInput {
  provider: string;
  /** Settings base URL when set; otherwise the provider default. */
  baseUrl?: string;
  /** Stored API key. Omitted / empty skips the fetch (except ollama). */
  apiKey?: string;
}

/**
 * Bare model ids already in the process cache — no network. Used by `listHarnesses` so the
 * harness sidebar cannot block on a slow provider `/models` call.
 */
export function peekCachedEnvoyLiveModelIds(input: {
  provider: string;
  baseUrl?: string;
}): readonly string[] {
  const key = normalizeEnvoyProvider(input.provider);
  const baseUrl = input.baseUrl ?? defaultEnvoyProviderBaseUrl(key);
  if (baseUrl === undefined) return [];
  const hit = cache.get(`${key}::${baseUrl}`);
  if (hit === undefined || Date.now() - hit.at >= CACHE_TTL_MS) return [];
  return hit.ids;
}

/**
 * Bare model ids the provider currently advertises. Empty when there is no key (except ollama),
 * on timeout, or on HTTP/parse failure.
 */
export async function fetchEnvoyLiveModelIds(
  input: FetchEnvoyLiveModelsInput,
): Promise<readonly string[]> {
  const key = normalizeEnvoyProvider(input.provider);
  const baseUrl = input.baseUrl ?? defaultEnvoyProviderBaseUrl(key);
  if (baseUrl === undefined) return [];

  const cacheKey = `${key}::${baseUrl}`;
  const hit = cache.get(cacheKey);
  if (hit !== undefined && Date.now() - hit.at < CACHE_TTL_MS) return hit.ids;

  const apiKey = input.apiKey;
  if (key !== "ollama" && (apiKey === undefined || apiKey === "")) return [];

  let ids: readonly string[] = [];
  try {
    ids =
      key === "anthropic"
        ? await fetchAnthropicModels(baseUrl, apiKey!)
        : key === "ollama"
          ? await fetchOllamaModels(baseUrl)
          : await fetchOpenAiCompatModels(baseUrl, apiKey!);
  } catch {
    ids = [];
  }
  cache.set(cacheKey, { at: Date.now(), ids });
  return ids;
}

async function fetchOpenAiCompatModels(baseUrl: string, apiKey: string): Promise<readonly string[]> {
  const root = baseUrl.replace(/\/+$/, "");
  const res = await fetchWithTimeout(`${root}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { data?: unknown };
  if (!Array.isArray(body.data)) return [];
  const ids: string[] = [];
  for (const row of body.data) {
    if (row === null || typeof row !== "object") continue;
    const id = (row as { id?: unknown }).id;
    if (typeof id !== "string" || id === "") continue;
    if (isNoisyOpenAiModelId(id)) continue;
    ids.push(id);
  }
  return ids;
}

async function fetchAnthropicModels(baseUrl: string, apiKey: string): Promise<readonly string[]> {
  const root = baseUrl.replace(/\/+$/, "");
  const url = root.endsWith("/v1") ? `${root}/models` : `${root}/v1/models`;
  const res = await fetchWithTimeout(url, {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      Accept: "application/json",
    },
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { data?: unknown };
  if (!Array.isArray(body.data)) return [];
  const ids: string[] = [];
  for (const row of body.data) {
    if (row === null || typeof row !== "object") continue;
    const id = (row as { id?: unknown }).id;
    if (typeof id === "string" && id !== "") ids.push(id);
  }
  return ids;
}

async function fetchOllamaModels(baseUrl: string): Promise<readonly string[]> {
  const root = baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");
  const openaiCompat = await fetchWithTimeout(`${root}/v1/models`, {
    headers: { Accept: "application/json" },
  }).catch(() => undefined);
  if (openaiCompat !== undefined && openaiCompat.ok) {
    const body = (await openaiCompat.json()) as { data?: unknown };
    if (Array.isArray(body.data)) {
      const ids: string[] = [];
      for (const row of body.data) {
        if (row === null || typeof row !== "object") continue;
        const id = (row as { id?: unknown }).id;
        if (typeof id === "string" && id !== "") ids.push(id);
      }
      if (ids.length > 0) return ids;
    }
  }
  const res = await fetchWithTimeout(`${root}/api/tags`, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { models?: unknown };
  if (!Array.isArray(body.models)) return [];
  const ids: string[] = [];
  for (const row of body.models) {
    if (row === null || typeof row !== "object") continue;
    const name = (row as { name?: unknown }).name;
    if (typeof name === "string" && name !== "") ids.push(name);
  }
  return ids;
}

/** Drop embeddings / audio / realtime noise from OpenAI-compatible catalogues. */
function isNoisyOpenAiModelId(id: string): boolean {
  const lower = id.toLowerCase();
  return (
    lower.includes("embedding") ||
    lower.includes("whisper") ||
    lower.includes("tts") ||
    lower.includes("realtime") ||
    lower.includes("audio") ||
    lower.includes("moderation") ||
    lower.includes("dall-e") ||
    lower.includes("image") ||
    lower.startsWith("text-")
  );
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
