/**
 * Envoy Harness LLM settings — store, wire surface, defaults sync, and launch inject.
 */

import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { coderPaths } from "@envoydev/host-bridge";

import { launchForHarness } from "../src/daemon/launch.js";
import {
  envoyLlmBaseUrlArgs,
  envoyLlmLaunchEnv,
  getEnvoyLlmPublic,
  setEnvoyLlm,
} from "../src/daemon/envoy-llm.js";
import { invalidateEnvoyLlmModelCache } from "../src/daemon/envoy-llm-models.js";
import { CoderStore } from "../src/daemon/store.js";

const cleanups: (() => void)[] = [];
beforeEach(() => {
  // Do not hit real provider /models from unit tests (setEnvoyLlm → getEnvoyLlmPublic merges live).
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })),
  );
  invalidateEnvoyLlmModelCache();
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.unstubAllGlobals();
  invalidateEnvoyLlmModelCache();
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

  it("writes defaults.model as provider/model on save when the default agent is Envoy", async () => {
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

  it("does not write defaults.model when the machine default agent is DeepSeek", async () => {
    const home = tempDir("envoydev-llm-no-pollute-");
    const paths = coderPaths(home);
    const store = await CoderStore.open({ paths });
    await store.updateSettings({ defaults: { harness: "deepseek-harness" } });

    await setEnvoyLlm(paths, store, {
      provider: "openai",
      model: "MiniMax-M3",
      apiKey: "sk-minimax-test",
    });

    expect(store.settings().defaults.harness).toBe("deepseek-harness");
    expect(store.settings().defaults.model).toBeUndefined();
    // Envoy LLM file still saved for when the user runs envoy-harness.
    const pub = await getEnvoyLlmPublic(paths);
    expect(pub.model).toBe("MiniMax-M3");
  });

  it("scrubs matching leaks off DeepSeek app/project/task defaults right after save", async () => {
    const home = tempDir("envoydev-llm-scrub-on-save-");
    const paths = coderPaths(home);
    const store = await CoderStore.open({ paths });
    const { project } = await store.addProject({ path: join(home, "repo") });

    // Plant leaks that match the id we are about to save — without waiting for reopen.
    await store.updateSettings({
      defaults: { harness: "deepseek-harness", model: "openai/MiniMax-M3" },
    });
    await store.updateProject(project.id, {
      defaults: { harness: "deepseek-harness", model: "openai/MiniMax-M3" },
    });
    const task = await store.createTask({
      projectId: project.id,
      title: "leaked-task",
      harness: "deepseek-harness",
      model: "openai/MiniMax-M3",
    });

    await setEnvoyLlm(paths, store, {
      provider: "openai",
      model: "MiniMax-M3",
      apiKey: "sk-scrub-now",
    });

    expect(store.settings().defaults.model).toBeUndefined();
    expect(store.findProject(project.id)?.defaults).toEqual({ harness: "deepseek-harness" });
    expect(store.findTask(task!.id)?.model).toBeUndefined();
    expect(store.findTask(task!.id)?.harness).toBe("deepseek-harness");
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
    expect(launch.env?.ENVOY_HARNESS_SESSION_DIR).toBe(
      join(paths.stateDir, "agents", "envoy-harness", "sessions"),
    );
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

  it("clears a saved API key when asked, including for a provider that needs one", async () => {
    const home = tempDir("envoydev-llm-clear-");
    const paths = coderPaths(home);
    const store = await CoderStore.open({ paths });

    await setEnvoyLlm(paths, store, {
      provider: "openai",
      model: "gpt-4o",
      apiKey: "sk-clear-me",
    });
    expect(envoyLlmLaunchEnv(paths, "openai")).toEqual({ OPENAI_API_KEY: "sk-clear-me" });

    const cleared = await setEnvoyLlm(paths, store, {
      provider: "openai",
      model: "gpt-4o",
      clearApiKey: true,
    });
    expect(cleared.apiKeySet).toBe(false);
    expect(JSON.stringify(cleared)).not.toContain("sk-clear-me");
    expect(envoyLlmLaunchEnv(paths, "openai")).toEqual({});
    const secretBody = readFileSync(join(paths.secretsDir, "envoy-llm-key.json"), "utf8");
    expect(secretBody).not.toContain("sk-clear-me");
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

  it("treats MiniMax-M3 / M3.1-Flash forms as MiniMax", async () => {
    const home = tempDir("envoydev-llm-minimax-");
    const paths = coderPaths(home);
    const store = await CoderStore.open({ paths });

    const typed = await setEnvoyLlm(paths, store, {
      provider: "openai",
      model: "Minimax M3",
      apiKey: "sk-mini",
    });
    expect(typed.provider).toBe("minimax");
    expect(typed.model).toBe("MiniMax-M3");
    expect(typed.options.map((option) => option.id)).toContain("minimax/MiniMax-M3");
    expect(typed.options.map((option) => option.id)).toContain("minimax/MiniMax-M3.1-Flash");
    expect(store.settings().defaults.model).toBe("minimax/MiniMax-M3");
    expect(envoyLlmLaunchEnv(paths, "minimax")).toEqual({ MINIMAX_API_KEY: "sk-mini" });

    const flash = await setEnvoyLlm(paths, store, {
      provider: "openai",
      model: "MiniMax-M3.1-Flash",
      apiKey: "sk-mini",
    });
    expect(flash.provider).toBe("minimax");
    expect(flash.model).toBe("MiniMax-M3.1-Flash");
    expect(store.settings().defaults.model).toBe("minimax/MiniMax-M3.1-Flash");
  });
});
