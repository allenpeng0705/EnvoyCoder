/**
 * Curated Envoy provider catalog + merge with live / saved ids.
 */

import { describe, expect, it } from "vitest";

import {
  envoyProviderCatalogModels,
  mergeEnvoyProviderModels,
  normalizeEnvoyProvider,
} from "../src/models.js";

describe("envoy provider catalog", () => {
  it("lists coding-focused openai models with the default first", () => {
    const models = envoyProviderCatalogModels("openai").map((entry) => entry.model);
    expect(models[0]).toBe("gpt-6.2-sol");
    expect(models).toContain("gpt-6.2-astra");
  });

  it("normalizes zhipu → glm and dashscope → qwen", () => {
    expect(normalizeEnvoyProvider("zhipu")).toBe("glm");
    expect(normalizeEnvoyProvider("dashscope")).toBe("qwen");
    expect(envoyProviderCatalogModels("zhipu")[0]?.provider).toBe("glm");
  });

  it("merges saved + curated + live without duplicates", () => {
    const merged = mergeEnvoyProviderModels({
      provider: "openai",
      savedModel: "gpt-5.5",
      liveModelIds: ["gpt-6.2-sol", "gpt-private-gateway", "text-embedding-3-small"],
    });
    const models = merged.map((entry) => entry.model);
    expect(models[0]).toBe("gpt-5.5");
    expect(models).toContain("gpt-6.2-sol");
    expect(models).toContain("gpt-private-gateway");
    expect(models.filter((id) => id === "gpt-6.2-sol")).toHaveLength(1);
    // Live noise is filtered by the daemon fetch, not merge — merge keeps what it is given.
    expect(models).toContain("text-embedding-3-small");
  });
});
