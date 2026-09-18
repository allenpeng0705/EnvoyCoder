/**
 * Envoy Harness LLM settings — store, wire surface, defaults sync, and launch inject.
 */

import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { coderPaths } from "@envoydev/host-bridge";

import { launchForHarness } from "../src/daemon/launch.js";
import {
  envoyLlmBaseUrlArgs,
  envoyLlmLaunchEnv,
  getEnvoyLlmPublic,
  setEnvoyLlm,
} from "../src/daemon/envoy-llm.js";
import { CoderStore } from "../src/daemon/store.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  return dir;
}

/** A program named `envoy-harness` so launch resolves without a peer checkout. */
function fakeEnvoyBinary(binDir: string): void {
  const path = join(binDir, "envoy-harness");
  writeFileSync(path, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  chmodSync(path, 0o755);
}

describe("Envoy Harness LLM settings", () => {
  it("never returns the API key — only apiKeySet", async () => {
    const home = tempDir("envoydev-llm-wire-");
    const paths = coderPaths(home);
    const store = await CoderStore.open({ paths });

    const saved = await setEnvoyLlm(paths, store, {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      apiKey: "sk-secret-never-on-wire",
      baseUrl: "https://proxy.example/v1",
    });

    expect(saved.apiKeySet).toBe(true);
    expect(saved.provider).toBe("anthropic");
    expect(saved.model).toBe("claude-sonnet-4-6");
    expect(saved.baseUrl).toBe("https://proxy.example/v1");
    expect(JSON.stringify(saved)).not.toContain("sk-secret-never-on-wire");
    expect(saved).not.toHaveProperty("apiKey");

    const publicView = await getEnvoyLlmPublic(paths);
    expect(publicView.apiKeySet).toBe(true);
    expect(JSON.stringify(publicView)).not.toContain("sk-secret-never-on-wire");
    expect(publicView).not.toHaveProperty("apiKey");

    const secretBody = readFileSync(join(paths.secretsDir, "envoy-llm-key.json"), "utf8");
    expect(secretBody).toContain("sk-secret-never-on-wire");
    const stateBody = readFileSync(join(paths.stateDir, "envoy-llm.json"), "utf8");
    expect(stateBody).not.toContain("sk-secret");
    expect(stateBody).toContain("anthropic");
  });

  it("writes defaults.model as provider/model on save", async () => {
    const home = tempDir("envoydev-llm-defaults-");
    const paths = coderPaths(home);
    const store = await CoderStore.open({ paths });

    await setEnvoyLlm(paths, store, {
      provider: "openai",
      model: "gpt-4o",
      apiKey: "sk-openai-test",
    });

    expect(store.settings().defaults.model).toBe("openai/gpt-4o");
  });

  it("injects the matching API key env and --base-url when launching envoy-harness", async () => {
    const home = tempDir("envoydev-llm-launch-");
    const paths = coderPaths(home);
    const store = await CoderStore.open({ paths });
    await setEnvoyLlm(paths, store, {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      apiKey: "sk-launch-inject",
      baseUrl: "https://litellm.example",
    });

    expect(envoyLlmLaunchEnv(paths, "anthropic")).toEqual({
      ANTHROPIC_API_KEY: "sk-launch-inject",
    });
    expect(envoyLlmLaunchEnv(paths, "openai")).toEqual({});
    expect(envoyLlmBaseUrlArgs(paths, "anthropic")).toEqual([
      "--base-url",
      "https://litellm.example",
    ]);

    const binDir = tempDir("envoydev-llm-bin-");
    fakeEnvoyBinary(binDir);
    const launch = launchForHarness({
      harness: "envoy-harness",
      cwd: tempDir("envoydev-llm-cwd-"),
      paths,
      model: "anthropic/claude-sonnet-4-6",
      searchDirs: [binDir],
    });
    expect(launch.env?.ANTHROPIC_API_KEY).toBe("sk-launch-inject");
    expect(launch.args).toContain("--base-url");
    expect(launch.args).toContain("https://litellm.example");
  });

  it("allows ollama without an API key", async () => {
    const home = tempDir("envoydev-llm-ollama-");
    const paths = coderPaths(home);
    const store = await CoderStore.open({ paths });

    const saved = await setEnvoyLlm(paths, store, {
      provider: "ollama",
      model: "llama3.1",
    });
    expect(saved.apiKeySet).toBe(false);
    expect(saved.provider).toBe("ollama");
  });

  it("stores a free model string and derives the provider from a slash form", async () => {
    const home = tempDir("envoydev-llm-free-");
    const paths = coderPaths(home);
    const store = await CoderStore.open({ paths });

    const bare = await setEnvoyLlm(paths, store, {
      provider: "openai",
      model: "gpt-4.1-mini",
      baseUrl: "https://proxy.example/v1",
      apiKey: "sk-free",
    });
    expect(bare.provider).toBe("openai");
    expect(bare.model).toBe("gpt-4.1-mini");
    expect(bare.baseUrl).toBe("https://proxy.example/v1");
    expect(JSON.stringify(bare)).not.toContain("sk-free");
    expect(store.settings().defaults.model).toBe("openai/gpt-4.1-mini");

    const slashed = await setEnvoyLlm(paths, store, {
      provider: "openai",
      model: "anthropic/claude-sonnet-4-6",
      apiKey: "sk-anthropic",
    });
    expect(slashed.provider).toBe("anthropic");
    expect(slashed.model).toBe("claude-sonnet-4-6");
    expect(envoyLlmLaunchEnv(paths, "anthropic")).toEqual({ ANTHROPIC_API_KEY: "sk-anthropic" });
  });
});
