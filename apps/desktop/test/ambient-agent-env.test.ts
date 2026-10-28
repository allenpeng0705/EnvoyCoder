import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { CATALOGUED_HARNESSES } from "@envoydev/protocol";
import { coderPaths } from "@envoydev/host-bridge";
import { resetSearchPathCacheForTests } from "@envoydev/platform";

import {
  ANTHROPIC_API_KEY_ENV,
  CODEX_API_KEY_ENV,
  DEEPSEEK_API_KEY_ENV,
  OPENAI_API_KEY_ENV,
  ambientAgentLaunchEnv,
  readDeepseekApiKeyFromDshHome,
  resetAmbientAgentEnvCacheForTests,
  userDshHome,
  withAmbientProviderEnv,
} from "../src/daemon/ambient-agent-env.js";
import { launchForHarness } from "../src/daemon/launch.js";

async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

describe("userDshHome", () => {
  it("prefers $DSH_HOME over ~/.dsh", () => {
    expect(userDshHome({ DSH_HOME: "/tmp/custom-dsh" }, "/Users/ada")).toBe("/tmp/custom-dsh");
    expect(userDshHome({}, "/Users/ada")).toBe("/Users/ada/.dsh");
  });
});

describe("readDeepseekApiKeyFromDshHome", () => {
  it("reads refs from .credentials.yaml before .env", () => {
    const files = new Map<string, string>([
      [
        "/home/ada/.dsh/.credentials.yaml",
        "version: 1\nrefs:\n  DEEPSEEK_API_KEY: from-credentials\nrecords: {}\n",
      ],
      ["/home/ada/.dsh/.env", "DEEPSEEK_API_KEY=from-dotenv\n"],
    ]);
    expect(readDeepseekApiKeyFromDshHome("/home/ada/.dsh", (path) => files.get(path))).toBe(
      "from-credentials",
    );
  });

  it("falls back to $DSH_HOME/.env", () => {
    const files = new Map<string, string>([["/home/ada/.dsh/.env", 'export DEEPSEEK_API_KEY="sk-env"\n']]);
    expect(readDeepseekApiKeyFromDshHome("/home/ada/.dsh", (path) => files.get(path))).toBe("sk-env");
  });
});

describe("ambientAgentLaunchEnv", () => {
  it("adds nothing when the daemon already has the known keys", () => {
    resetAmbientAgentEnvCacheForTests();
    expect(
      ambientAgentLaunchEnv({
        env: {
          [DEEPSEEK_API_KEY_ENV]: "already",
          [ANTHROPIC_API_KEY_ENV]: "already-ant",
          [OPENAI_API_KEY_ENV]: "already-oai",
          [CODEX_API_KEY_ENV]: "already-codex",
        },
        readFile: () => "DEEPSEEK_API_KEY=ignored",
        readLoginShellEnv: () => "ignored-shell",
      }),
    ).toEqual({});
  });

  it("injects DeepSeek from the user's harness home when the daemon has none", () => {
    resetAmbientAgentEnvCacheForTests();
    const files = new Map<string, string>([
      ["/Users/ada/.dsh/.env", "DEEPSEEK_API_KEY=sk-from-home\n"],
    ]);
    expect(
      ambientAgentLaunchEnv({
        env: {},
        userHome: "/Users/ada",
        readFile: (path) => files.get(path),
        readLoginShellEnv: () => undefined,
        names: [DEEPSEEK_API_KEY_ENV],
      }),
    ).toEqual({ [DEEPSEEK_API_KEY_ENV]: "sk-from-home" });
  });

  it("fills several known keys from a login shell", () => {
    resetAmbientAgentEnvCacheForTests();
    const shell: Record<string, string> = {
      [ANTHROPIC_API_KEY_ENV]: "sk-ant",
      [OPENAI_API_KEY_ENV]: "sk-oai",
      [CODEX_API_KEY_ENV]: "sk-codex",
    };
    expect(
      ambientAgentLaunchEnv({
        env: {},
        userHome: "/Users/ada",
        readFile: () => undefined,
        readLoginShellEnv: (name) => shell[name],
        // Only ask for these three so DEEPSEEK's home/shell miss does not clutter the assertion.
        names: [ANTHROPIC_API_KEY_ENV, OPENAI_API_KEY_ENV, CODEX_API_KEY_ENV],
      }),
    ).toEqual(shell);
  });

  it("fills an extra provider-named variable from the login shell", () => {
    resetAmbientAgentEnvCacheForTests();
    expect(
      ambientAgentLaunchEnv({
        env: {},
        userHome: "/Users/ada",
        readFile: () => undefined,
        readLoginShellEnv: (name) => (name === "MY_AGENT_TOKEN" ? "tok" : undefined),
        names: ["MY_AGENT_TOKEN"],
      }),
    ).toMatchObject({ MY_AGENT_TOKEN: "tok" });
  });
});

describe("withAmbientProviderEnv", () => {
  it("leaves an already-set name alone and fills a missing one", () => {
    resetAmbientAgentEnvCacheForTests();
    const next = withAmbientProviderEnv(
      ["KEEP_ME", "FILL_ME"],
      { KEEP_ME: "kept" },
      {
        readFile: () => undefined,
        readLoginShellEnv: (name) => (name === "FILL_ME" ? "filled" : undefined),
      },
    );
    expect(next.KEEP_ME).toBe("kept");
    expect(next.FILL_ME).toBe("filled");
  });
});

describe("catalogued launches stay out of EnvoyDev private homes", () => {
  it("does not point HOME / DSH_HOME / CODEX_HOME at paths.stateDir for any catalogued harness", async () => {
    const binDir = await tempDir("envoydev-ambient-bin-");
    for (const name of [
      "dsh",
      "claude-agent-acp",
      "codex-acp",
      "copilot",
      "opencode",
      "cursor-agent",
      "omp",
      "pi",
    ]) {
      const path = join(binDir, name);
      await writeFile(path, "#!/bin/sh\nexit 0\n");
      await chmod(path, 0o755);
    }
    const cwd = await tempDir("envoydev-ambient-cwd-");
    const home = await tempDir("envoydev-ambient-home-");
    const paths = coderPaths(home);
    const privatePrefix = paths.stateDir;

    resetAmbientAgentEnvCacheForTests();
    for (const id of CATALOGUED_HARNESSES) {
      let launch;
      try {
        launch = launchForHarness({
          harness: id,
          cwd,
          paths,
          searchDirs: [binDir],
        });
      } catch {
        // Unsupported / undrivable entries refuse before env is returned; skip those.
        continue;
      }
      const env = launch.env ?? {};
      for (const key of ["HOME", "DSH_HOME", "CODEX_HOME", "CLAUDE_CONFIG_DIR"] as const) {
        const value = env[key];
        if (value === undefined) continue;
        expect(value.startsWith(privatePrefix), `${id} set ${key}=${value}`).toBe(false);
      }
    }
    resetSearchPathCacheForTests();
  });
});
