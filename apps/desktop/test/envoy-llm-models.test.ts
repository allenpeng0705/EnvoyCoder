/**
 * Live Envoy provider model fetch — fail soft, cache, OpenAI-compat parse.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchEnvoyLiveModelIds,
  invalidateEnvoyLlmModelCache,
} from "../src/daemon/envoy-llm-models.js";

afterEach(() => {
  invalidateEnvoyLlmModelCache();
  vi.unstubAllGlobals();
});

describe("fetchEnvoyLiveModelIds", () => {
  it("returns [] without an API key for keyed providers", async () => {
    const ids = await fetchEnvoyLiveModelIds({ provider: "openai" });
    expect(ids).toEqual([]);
  });

  it("parses OpenAI-compatible /models and drops embedding noise", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: [
              { id: "gpt-6.2-sol" },
              { id: "text-embedding-3-small" },
              { id: "whisper-1" },
              { id: "gpt-5.5" },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    const ids = await fetchEnvoyLiveModelIds({
      provider: "openai",
      apiKey: "sk-test",
      baseUrl: "https://api.openai.com/v1",
    });
    expect(ids).toEqual(["gpt-6.2-sol", "gpt-5.5"]);
  });

  it("fails soft on HTTP errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 401 })),
    );
    const ids = await fetchEnvoyLiveModelIds({
      provider: "anthropic",
      apiKey: "sk-bad",
      baseUrl: "https://api.anthropic.com",
    });
    expect(ids).toEqual([]);
  });
});
