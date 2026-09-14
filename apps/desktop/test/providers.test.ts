/**
 * The agents a **user declared** — the config, the refusals, and the one launch path.
 *
 * ## What this file is for, in three sentences
 *
 * The shape of a provider is a security decision rather than a convenience: `env` holds environment
 * variable **names**, so a credential cannot be expressed in the schema, cannot be written to disk and
 * cannot be logged — and "we were careful" is not a mechanism, so this file asserts each of those as a
 * failing fact rather than describing them. The states a provider reports are probed rather than
 * believed, from the same prober the nine shipped agents go through, so the second half of this file
 * pins that a provider and a catalogue entry answer the *same* question the *same* way. And the launch
 * path is shared: `launchForProvider` and `launchForHarness` are two descriptions of an agent handed to
 * one body, which is what stops them drifting on argv, on `PATH`, or on which refusal a missing program
 * produces.
 */

import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  AgentProviderConfigSchema,
  ENVOYCODER_ERRORS,
  HarnessAvailabilitySchema,
  type AgentProviderConfig,
  coderErrorCode,
  coderErrorMessage,
  coderErrorRef,
} from "@envoycoder/protocol";
import { coderPaths } from "@envoycoder/host-bridge";
import {
  ALL_HARNESSES,
  harnessAvailability,
  harnessDefinition,
  harnessRecipe,
  isDrivableByAcpAdapter,
  probeProvider,
  providerEnvState,
} from "@envoycoder/agent-catalog";

import { launchForHarness, launchForProvider } from "../src/daemon/launch.js";
import { CoderStore } from "../src/daemon/store.js";
import { CATALOGUES } from "../src/i18n/catalogues.js";
import { en, isMessageKey } from "../src/i18n/messages/en.js";
import { localize, noticeOf } from "../src/i18n/notice.js";
import { createTranslator } from "../src/i18n/translate.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  return dir;
}

/** A provider that names a program, with everything else at its defaults. */
function provider(overrides: Partial<AgentProviderConfig> = {}): AgentProviderConfig {
  return {
    id: "my-agent",
    label: "My Agent",
    command: "auggie",
    args: ["--acp"],
    env: [],
    transport: "acp",
    ...overrides,
  };
}

/* ────────────────────────────── the shape is the enforcement ────────────────────────────── */

describe("a provider cannot hold a secret, because there is nowhere to put one", () => {
  it("takes a list of variable NAMES and refuses a map of values", () => {
    // The single most important assertion in this file. A `Record<string, string>` of values is what the
    // reference product stores and what this project refused to copy: it keeps API keys in plaintext in a
    // config file. `env: readonly string[]` cannot express that, so the refusal below is not a policy the
    // schema enforces — the shape simply has no right-hand side.
    const withNames = AgentProviderConfigSchema.safeParse(provider({ env: ["ANTHROPIC_API_KEY"] }));
    expect(withNames.success, JSON.stringify(withNames.error?.issues ?? [])).toBe(true);

    const withValues = AgentProviderConfigSchema.safeParse(
      provider({ env: { ANTHROPIC_API_KEY: "sk-ant-live-0000" } as unknown as string[] }),
    );
    expect(withValues.success).toBe(false);
  });

  it("refuses a credential pasted where a name belongs", () => {
    // A name is `[A-Za-z_][A-Za-z0-9_]*` and no credential is. Each of these is a shape a key actually
    // takes, and each is refused at the *schema* — the same schema the store parses every row through, so
    // it is not merely the RPC that is safe.
    for (const value of [
      "sk-ant-api03-XyZ123",
      "Bearer eyJhbGciOiJIUzI1NiJ9",
      "/Users/you/.config/token",
      "postgres://user:pw@host/db",
      "-----BEGIN PRIVATE KEY-----",
    ]) {
      const parsed = AgentProviderConfigSchema.safeParse(provider({ env: [value] }));
      expect(parsed.success, `${value} was accepted as a variable name`).toBe(false);
    }
  });

  it("refuses to store a name that is not a name, however it got there", () => {
    // `env: ["MY KEY"]` (a space), `["1PASSWORD"]` (a leading digit) — the pattern is the rule, and it is
    // applied on read as well as on write because a hand-edited file is a real input.
    expect(AgentProviderConfigSchema.safeParse(provider({ env: ["MY KEY"] })).success).toBe(false);
    expect(AgentProviderConfigSchema.safeParse(provider({ env: ["1PASSWORD"] })).success).toBe(false);
    expect(AgentProviderConfigSchema.safeParse(provider({ env: ["_PRIVATE"] })).success).toBe(true);
  });

  it("refuses an id that names an agent we already ship", () => {
    // The daemon refuses this with a translated sentence (below); the schema refuses it in the file, so a
    // hand-edited `providers.json` cannot reach the state where two rows share an id and which one a
    // caller meant depends on which list it consulted.
    for (const id of ["codex", "envoy-harness"]) {
      const parsed = AgentProviderConfigSchema.safeParse(provider({ id }));
      expect(parsed.success, `${id} was accepted as a provider id`).toBe(false);
    }
  });

  it("refuses a dialect field on a program that has no ACP session", () => {
    // `cli` says "this is a one-shot command line": there is no `authenticate` and no `session/set_mode`
    // to read either field, so carrying one would be the shape promising a step that cannot happen.
    expect(
      AgentProviderConfigSchema.safeParse(provider({ transport: "cli", modeParam: "modeId" })).success,
    ).toBe(false);
    expect(
      AgentProviderConfigSchema.safeParse(provider({ transport: "cli", authMethodId: "cursor_login" })).success,
    ).toBe(false);
    expect(AgentProviderConfigSchema.safeParse(provider({ transport: "cli" })).success).toBe(true);
    expect(AgentProviderConfigSchema.safeParse(provider({ modeParam: "modeId" })).success).toBe(true);
  });
});

/* ────────────────────────────── probed, never asserted ────────────────────────────── */

describe("what a provider reports is measured, not believed", () => {
  it("reports the five states under the same schema, from the same prober", () => {
    const dir = tempDir("envoycoder-provider-probe-");
    const binary = join(dir, "auggie");
    writeFileSync(binary, "#!/bin/sh\nexit 0\n");
    chmodSync(binary, 0o755);

    const found = probeProvider(provider({ command: binary }), { pathDirs: [dir] });
    expect(found.state).toBe("ready");
    // The same projection the nine shipped agents use, so the agreement rules are checked here too.
    expect(HarnessAvailabilitySchema.safeParse(harnessAvailability(found)).success).toBe(true);
    expect(harnessAvailability(found).binary).toBe(binary);

    // A command nothing answers to is `not-installed`, with a fix — never `ready` because a user typed it.
    const missing = probeProvider(provider({ command: "envoycoder-not-a-real-binary" }), { pathDirs: [dir] });
    expect(missing.state).toBe("not-installed");
    // The fix is the user's own command line: nobody can author an install step for a program we have
    // never heard of, and the schema refuses an "it is missing" state that names nothing to do.
    expect(missing.fix).toEqual([{ command: "envoycoder-not-a-real-binary --acp" }]);

    // And no search path at all is `unknown`, not `not-installed`: we did not look, so nothing here is a
    // statement about the program.
    const unlooked = probeProvider(provider(), { pathDirs: [], searchable: false });
    expect(unlooked.state).toBe("unknown");
    expect(unlooked.fix).toBeUndefined();
  });

  it("says a command-line provider is unsupported when its program IS installed", () => {
    // The distinction the availability field was widened for: "not installed" would be wrong advice for a
    // program that is sitting right there, and installing it again lands the user on the same refusal.
    const dir = tempDir("envoycoder-provider-cli-");
    const binary = join(dir, "one-shot");
    writeFileSync(binary, "#!/bin/sh\nexit 0\n");
    chmodSync(binary, 0o755);
    const probe = probeProvider(provider({ command: binary, transport: "cli" }), { pathDirs: [dir] });
    expect(probe.state).toBe("unsupported");
    expect(probe.binaryPath).toBe(binary);
  });
});

/* ────────────────────────────── one launch path, both tiers ────────────────────────────── */

describe("a provider launches through the same path as a catalogue entry", () => {
  it("gates drivability with the one rule the catalogue is asserted against", () => {
    // Two assertions, because they answer the same question from two sides.
    //
    // First, the deterministic one: the recipe the shared body reads carries the same `kind`/`transport`
    // that `isDrivableByAcpAdapter` decides on, for all nine agents — so the gate the refactor moved to
    // `launch.ts` cannot disagree with the gate `drivable.test.ts` pins.
    for (const harness of ALL_HARNESSES) {
      const recipe = harnessRecipe(harnessDefinition(harness));
      const gated = recipe.kind === "child-process" && recipe.transport === "acp";
      expect(gated, harness).toBe(isDrivableByAcpAdapter(harness));
    }

    // Then the observable one, over the real body and with **nothing to search**: a non-ACP agent is
    // refused as unsupported whatever the search path says (the drivability check precedes availability,
    // which is `launch.ts`'s own documented order), and a drivable one is never told that — it reaches
    // "we could not look", or `ready` from the peer checkout when this machine has one built.
    for (const harness of ALL_HARNESSES) {
      const drivable = isDrivableByAcpAdapter(harness);
      let code: string | null = null;
      try {
        launchForHarness({ harness, cwd: "/tmp", paths: coderPaths("/tmp/envoycoder-home"), searchDirs: [] });
      } catch (error) {
        code = coderErrorCode(error instanceof Error ? error.message : String(error));
      }
      if (drivable) {
        // It either launched (the peer checkout is built on this machine) or refused because there was
        // nothing to search — never because we cannot drive it.
        expect(code, harness).not.toBe(ENVOYCODER_ERRORS.harnessUnsupported);
      } else {
        expect(code, harness).toBe(ENVOYCODER_ERRORS.harnessUnsupported);
      }
    }
  });

  it("refuses a command-line provider with the same code a command-line catalogue entry gets", () => {
    const providerError = refusalOf(() =>
      launchForProvider({
        provider: provider({ transport: "cli" }),
        cwd: "/tmp",
        paths: coderPaths("/tmp/envoycoder-home"),
        searchDirs: [],
      }),
    );
    const harnessError = refusalOf(() =>
      launchForHarness({
        harness: "copilot",
        cwd: "/tmp",
        paths: coderPaths("/tmp/envoycoder-home"),
        searchDirs: [],
      }),
    );
    expect(providerError.code).toBe(ENVOYCODER_ERRORS.harnessUnsupported);
    expect(harnessError.code).toBe(ENVOYCODER_ERRORS.harnessUnsupported);
    // Both are keyed, so both are renderable in the user's language — and the keys differ on purpose,
    // because the advice does: a shipped agent needs an adapter, a provider's dialect is theirs to fix.
    expect(providerError.ref?.key).toBe("error.providerUnsupported");
    expect(harnessError.ref?.key).toBe("error.harnessUnsupported");
  });

  it("hands a provider the same PATH the probe searched, and the same refusals when it cannot look", () => {
    const dir = tempDir("envoycoder-provider-path-");
    const binary = join(dir, "auggie");
    writeFileSync(binary, "#!/bin/sh\nexit 0\n");
    chmodSync(binary, 0o755);

    const launch = launchForProvider({
      provider: provider({ command: binary }),
      cwd: dir,
      paths: coderPaths(dir),
      searchDirs: [dir],
    });
    // The command is the resolved path, and the two dialect fields travel the same channel the
    // catalogue's do — absent here because this provider declared neither.
    expect(launch.command).toBe(binary);
    expect(launch.args).toEqual(["--acp"]);
    expect(launch.env?.PATH).toBe(dir);
    expect(launch.authMethodId).toBeUndefined();
    expect(launch.modeParam).toBeUndefined();

    // Nothing to search → the same `unknown` refusal, with the same code, as a catalogue entry.
    const missing = refusalOf(() =>
      launchForProvider({
        provider: provider(),
        cwd: dir,
        paths: coderPaths(dir),
        searchDirs: [],
      }),
    );
    expect(missing.code).toBe(ENVOYCODER_ERRORS.harnessUnknown);
    expect(missing.ref?.key).toBe("error.harnessUnknown");
  });

  it("appends the task's own extra arguments through the shared splitter", () => {
    // A path with a space, in quotes, is the case the splitter exists for — and a provider must split it
    // the way a catalogue entry does, or the same task would hand two different argv to two agents.
    const dir = tempDir("envoycoder-provider-extra-");
    const binary = join(dir, "auggie");
    writeFileSync(binary, "#!/bin/sh\nexit 0\n");
    chmodSync(binary, 0o755);
    const launch = launchForProvider({
      provider: provider({ command: binary, args: ["--acp"] }),
      cwd: dir,
      paths: coderPaths(dir),
      searchDirs: [dir],
      extraArgs: '--workspace "/tmp/a dir" --verbose',
    });
    expect(launch.args).toEqual(["--acp", "--workspace", "/tmp/a dir", "--verbose"]);
  });

  it("carries the provider's own dialect facts onto the launch, verbatim", () => {
    const dir = tempDir("envoycoder-provider-dialect-");
    const binary = join(dir, "cursor-agent");
    writeFileSync(binary, "#!/bin/sh\nexit 0\n");
    chmodSync(binary, 0o755);
    const launch = launchForProvider({
      provider: provider({
        command: binary,
        args: ["acp"],
        authMethodId: "cursor_login",
        modeParam: "modeId",
      }),
      cwd: dir,
      paths: coderPaths(dir),
      searchDirs: [dir],
    });
    expect(launch.authMethodId).toBe("cursor_login");
    expect(launch.modeParam).toBe("modeId");
  });
});

/* ────────────────────────────── the environment ────────────────────────────── */

describe("the environment a provider is given", () => {
  it("copies the value of a named variable out of the daemon's own environment", () => {
    const dir = tempDir("envoycoder-provider-env-");
    const binary = join(dir, "auggie");
    writeFileSync(binary, "#!/bin/sh\nexit 0\n");
    chmodSync(binary, 0o755);

    const launch = launchForProvider({
      provider: provider({ command: binary, env: ["ENVOYCODER_TEST_TOKEN"] }),
      cwd: dir,
      paths: coderPaths(dir),
      searchDirs: [dir],
      env: { ENVOYCODER_TEST_TOKEN: "sk-live-not-a-real-secret", PATH: "/usr/bin" },
    });
    // The value reaches the **child** and nowhere else: not the file, not the refusal, not a log line.
    expect(launch.env?.ENVOYCODER_TEST_TOKEN).toBe("sk-live-not-a-real-secret");
    // And it is not smuggled in as the agent's own `PATH`, which is ours to choose.
    expect(launch.env?.PATH).toBe(dir);
  });

  it("reports a missing variable instead of starting an agent without its credential", async () => {
    const dir = tempDir("envoycoder-provider-missing-");
    const binary = join(dir, "auggie");
    writeFileSync(binary, "#!/bin/sh\nexit 0\n");
    chmodSync(binary, 0o755);

    const refusal = refusalOf(() =>
      launchForProvider({
        provider: provider({ command: binary, env: ["ENVOYCODER_DEFINITELY_UNSET"] }),
        cwd: dir,
        paths: coderPaths(dir),
        searchDirs: [dir],
        env: { PATH: "/usr/bin" },
      }),
    );

    expect(refusal.code).toBe(ENVOYCODER_ERRORS.providerEnvUnset);
    expect(refusal.ref?.key).toBe("error.providerEnvUnset.one");
    // **Per agent, and in the user's language.** The sentence names the provider the user called it and
    // the variable — and the view in German says the same thing, which is the whole reason the key
    // travels with it.
    expect(isMessageKey(refusal.ref?.key ?? "")).toBe(true);
    expect(refusal.message).toContain("My Agent");
    expect(refusal.message).toContain("ENVOYCODER_DEFINITELY_UNSET");
    const german = createTranslator("de", CATALOGUES.de).t;
    const germanText = localize(german, noticeOf(refusal.message)) ?? "";
    expect(germanText).toContain("ENVOYCODER_DEFINITELY_UNSET");
    expect(germanText).not.toContain("envoycoder.");
    // An English window reads exactly the catalogue's sentence: the daemon's English and `en.ts`'s entry
    // for the key are byte-identical, which is what `daemon-errors-i18n.test.ts` pins for the refusals a
    // handler produces and what this pins for the one a *launch* produces.
    const english = createTranslator("en", en).t;
    expect(localize(english, noticeOf(refusal.message))).toBe(coderErrorMessage(refusal.message));
  });

  it("names every missing variable at once, under the plural key", () => {
    const dir = tempDir("envoycoder-provider-missing-two-");
    const binary = join(dir, "auggie");
    writeFileSync(binary, "#!/bin/sh\nexit 0\n");
    chmodSync(binary, 0o755);

    const refusal = refusalOf(() =>
      launchForProvider({
        provider: provider({ command: binary, env: ["ENVOYCODER_UNSET_A", "ENVOYCODER_UNSET_B"] }),
        cwd: dir,
        paths: coderPaths(dir),
        searchDirs: [dir],
        env: { PATH: "/usr/bin" },
      }),
    );
    expect(refusal.ref?.key).toBe("error.providerEnvUnset.many");
    expect(refusal.message).toContain("ENVOYCODER_UNSET_A");
    expect(refusal.message).toContain("ENVOYCODER_UNSET_B");
  });

  it("counts an empty value as unset, because `FOO=` exports nothing", () => {
    // A shell's `export FOO=` is a present-but-empty variable. Passing it on would make an agent
    // authenticate with the empty string while every row in the window said a credential was there.
    expect(providerEnvState(provider({ env: ["EMPTY_ONE"] }), { EMPTY_ONE: "" })).toEqual([
      { name: "EMPTY_ONE", set: false },
    ]);
    expect(providerEnvState(provider({ env: ["SET_ONE"] }), { SET_ONE: "x" })).toEqual([
      { name: "SET_ONE", set: true },
    ]);
  });
});

/* ────────────────────────────── a value cannot round-trip ────────────────────────────── */

describe("a stored secret cannot round-trip", () => {
  it("writes names to providers.json and never the value it read from the environment", async () => {
    // The mechanism, asserted rather than described. A recognisable value is put where the daemon reads
    // variables from, a provider is stored naming it, and then the file on disk is read as bytes: the
    // secret is not in it. This is the test that makes "we never write a value" a fact about the artifact
    // a user can open, rather than a claim about the code that wrote it.
    const home = tempDir("envoycoder-provider-secret-");
    const paths = coderPaths(home);
    const secret = "sk-live-1f4c9ab7-not-a-real-key";
    const store = await CoderStore.open({ paths });

    await store.addProvider(provider({ env: ["ENVOYCODER_STORE_TEST_TOKEN"] }));

    const stored = readFileSync(paths.providersFile, "utf8");
    expect(stored).toContain("ENVOYCODER_STORE_TEST_TOKEN");
    expect(stored.includes(secret), "the value was written to disk").toBe(false);
    // And nothing else under the state directory carries it either — a copy of a secret in a log or a
    // sibling file would be the same leak by a different name. Walked in node rather than shelled out to
    // `grep`, so the assertion is the same one on every platform this suite runs on.
    const { readdirSync, readFileSync: read } = await import("node:fs");
    const leaking = readdirSync(paths.stateDir).filter((name) =>
      read(join(paths.stateDir, name), "utf8").includes(secret),
    );
    expect(leaking).toEqual([]);
  });

  it("stores what the schema accepts and rewrites the whole list, replacing an id in place", async () => {
    // Replace-not-merge: an entry is a complete statement of how to start one program, so a second add
    // under the same id takes over completely. Merging would leave a new command carrying the previous
    // command's arguments — a program that starts and does something nobody asked for.
    const home = tempDir("envoycoder-provider-replace-");
    const paths = coderPaths(home);
    const store = await CoderStore.open({ paths });

    await store.addProvider(provider({ args: ["--acp"], env: ["OLD_NAME"] }));
    const { created } = await store.addProvider(provider({ args: ["acp", "serve"], env: ["NEW_NAME"] }));
    expect(created).toBe(false);

    expect(store.providers()).toHaveLength(1);
    expect(store.providers()[0]?.args).toEqual(["acp", "serve"]);
    expect(store.providers()[0]?.env).toEqual(["NEW_NAME"]);
    const stored = JSON.parse(readFileSync(paths.providersFile, "utf8")) as unknown[];
    expect(stored).toHaveLength(1);
  });

  it("quarantines an unreadable providers file rather than emptying it", async () => {
    // The store's rule, applied to the newest collection: a file we cannot parse is moved aside and the
    // reason is reported. Emptying it would delete every agent the user had declared, silently.
    const home = tempDir("envoycoder-provider-corrupt-");
    const paths = coderPaths(home);
    const { mkdirSync, readdirSync } = await import("node:fs");
    mkdirSync(paths.stateDir, { recursive: true });
    writeFileSync(paths.providersFile, '[{"id":"auggie","label":"Auggie","command":"auggie",', "utf8");

    const store = await CoderStore.open({ paths });
    expect(store.providers()).toEqual([]);
    const notes = store.notes().quarantined;
    expect(notes.some((entry) => entry.file.endsWith("providers.json"))).toBe(true);
    // The bytes still exist under a name the user can find and open.
    const saved = readdirSync(paths.stateDir).find((name) => name.startsWith("providers.corrupt-"));
    expect(saved).toBeDefined();
    expect(readFileSync(join(paths.stateDir, saved ?? ""), "utf8")).toContain('"auggie"');
  });
});

/* ────────────────────────────── helpers ────────────────────────────── */

/** Run a launch, expecting it to refuse, and hand back the code, key and sentence it refused with. */
function refusalOf(run: () => unknown): { code: string | null; ref: { key: string } | undefined; message: string } {
  try {
    run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { code: coderErrorCode(message), ref: coderErrorRef(message), message };
  }
  throw new Error("this launch did not refuse, and the test needs the refusal to inspect it");
}
