/**
 * **"In my agents" versus "hidden"** — the preference, and the one thing it is allowed to change.
 *
 * ## Why this file is separate from the provider and probe tests
 *
 * The defect this slice corrects was not a missing feature but a **conceptual** one: an earlier audit ruled
 * Paseo's "Enable {provider}" row out as "not applicable as a setting", on the grounds that a switch would
 * "let a user hide a working agent". That sentence conflates two facts with two different owners —
 * *availability is ours to detect, preference is theirs to set* — and the whole shape of this feature follows
 * from keeping them apart:
 *
 *   * the preference is **stored** (`CoderSettings.hiddenAgents`, one list, addressed by id);
 *   * it is **read in one place** (the daemon's projection, which sets a `hidden` flag *beside* the probed
 *     state);
 *   * and it is **consumed in one place** (the picker filter, `pickable`).
 *
 * So the assertions here are mostly negative: a hidden agent still reports everything true about itself, and
 * there is no code path from the preference to `availability`, to `auth`, or to a launch.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CoderSettingsSchema,
  ENVOYCODER_ERRORS,
  type HarnessAuth,
  type HarnessSummary,
  coderErrorCode,
  coderErrorRef,
} from "@envoycoder/protocol";
import { coderPaths } from "@envoycoder/host-bridge";

import { hiddenAgent, pickable } from "../src/composer/agent-for.js";
import { createCoderHandlers, type CoderHandler } from "../src/daemon/service.js";
import { summarize, summarizeProvider } from "../src/daemon/summaries.js";
import { CoderStore } from "../src/daemon/store.js";
import { isMessageKey } from "../src/i18n/messages/en.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
  return dir;
}

/**
 * A probe that found an agent on this machine — the injected seam, so "an installed agent that is hidden
 * still reports it is installed" is a fact about one function rather than about this laptop.
 */
const foundIt = (id: Parameters<typeof summarize>[0]) => ({
  id,
  state: "ready" as const,
  binaryPath: "/usr/local/bin/installed-agent",
  via: "path" as const,
});

const ready: HarnessAuth = { state: "ready", observedAt: "2026-09-14T10:00:00.000Z" };

/** One harness row, as the daemon builds it. */
function row(hidden: boolean): HarnessSummary {
  return summarize("envoy-harness", foundIt, undefined, hidden, {
    harness: "envoy-harness",
    observedAt: "2026-09-14T10:00:00.000Z",
    state: "ready",
    detail: "A session opened, so this agent needs no sign-in.",
  });
}

/* ────────────────────────────── two facts, not one ────────────────────────────── */

describe("a hidden agent still reports the truth about itself", () => {
  it("keeps its availability and its auth state, and adds a preference beside them", () => {
    const shown = row(false);
    const hidden = row(true);

    // **The assertion this whole feature exists for.** Hiding is a filter over what a picker offers; it is not
    // a claim about the machine, and the row a user reads must not change its answer because they tidied their
    // list. `availability` is byte-identical, and it still says the agent is installed.
    expect(hidden.availability).toEqual(shown.availability);
    expect(hidden.availability.state).toBe("ready");
    expect(hidden.availability.fix).toBeUndefined();
    // The same for the third fact: a preference about a row cannot change whether the agent will talk to us.
    expect(hidden.auth).toEqual(shown.auth);
    expect(hidden.auth.state).toBe("ready");
    // Everything else about the row is untouched too — a hidden agent is the same agent.
    expect({ ...hidden, hidden: shown.hidden }).toEqual(shown);
    // And the two facts are two fields, so a client can render "Installed · hidden from your pickers" rather
    // than having to choose which of the two to believe.
    expect(hidden.hidden).toBe(true);
    expect(shown.hidden).toBe(false);
  });

  it("is what a picker drops, and the only reason it drops a row that is not absent", () => {
    // The filter is the *only* consumer of the preference, and this is it: a hidden agent leaves the list…
    expect(pickable(row(true))).toBe(false);
    expect(pickable(row(false))).toBe(true);
    // …while an agent nobody has looked at yet stays, because dropping it would be a decision taken on the
    // user's behalf — which is the mistake this pair of functions exists to keep apart.
    const unexamined: HarnessSummary = {
      ...row(false),
      availability: { state: "unknown" },
      auth: { state: "unknown" },
    };
    expect(pickable(unexamined)).toBe(true);
    // A daemon built before the field sends no `hidden` at all, and absence means "not hidden": an older daemon
    // cannot be hiding anything, because it had no way to.
    const legacy = { ...row(false), hidden: undefined } as unknown as HarnessSummary;
    expect(hiddenAgent(legacy)).toBe(false);
    expect(pickable(legacy)).toBe(true);
  });

  it("is the same preference for a provider the user declared", () => {
    const provider = {
      id: "my-agent",
      label: "My Agent",
      command: "auggie",
      args: ["--acp"],
      env: [],
      transport: "acp" as const,
    };
    const probe = () => ({
      id: "my-agent",
      state: "ready" as const,
      binaryPath: "/usr/local/bin/auggie",
      via: "path" as const,
    });

    // **One preference, two lists.** A user who declutters their pickers has decluttered them for the agents we
    // ship *and* for the agents they declared — a provider is not a different kind of thing because the user
    // typed its command line.
    expect(summarizeProvider(provider, probe, {}, true).hidden).toBe(true);
    expect(summarizeProvider(provider, probe, {}, false).hidden).toBe(false);
    // And the state beside it is still the probe's answer, not the preference's.
    expect(summarizeProvider(provider, probe, {}, true).availability.state).toBe("ready");
    // A provider carries no auth field at all: nothing here opens a session with one, and a field that would
    // read `unknown` forever is a statement about us dressed as one about the program.
    expect("auth" in summarizeProvider(provider, probe, {}, true)).toBe(false);
  });
});

/* ────────────────────────────── the stored shape ────────────────────────────── */

describe("the stored preference", () => {
  it("is a list of ids, and a value of the wrong shape is quarantined rather than repaired", () => {
    // One list, addressed by id: the two agent id spaces cannot collide (`AgentProviderConfigSchema` refuses a
    // provider id that names a shipped agent), so one field addresses both lists without ambiguity.
    const base = CoderSettingsSchema.parse({
      defaults: {},
      requireApprovalForDestructive: true,
      keepTranscripts: true,
    });
    expect(CoderSettingsSchema.safeParse({ ...base, hiddenAgents: ["codex", "my-agent"] }).success).toBe(true);
    expect(CoderSettingsSchema.safeParse({ ...base, hiddenAgents: [] }).success).toBe(true);
    // A string where a list belongs, or a number inside it, is a file we cannot understand — which is not the
    // same as an *id* that names nothing. An inert id matcher is a typo a user can live with; a repaired value
    // is a preference they never expressed.
    expect(CoderSettingsSchema.safeParse({ ...base, hiddenAgents: "codex" }).success).toBe(false);
    expect(CoderSettingsSchema.safeParse({ ...base, hiddenAgents: [42] }).success).toBe(false);
    expect(CoderSettingsSchema.safeParse({ ...base, hiddenAgents: [""] }).success).toBe(false);
  });

  it("is quarantined, never emptied, when the settings file cannot be read", async () => {
    // The store's oldest rule, applied to the newest field: a file we cannot parse is **moved aside** and the
    // reason is reported at `coder.hello`. Emptying it would silently take the user's language, their folder and
    // their default agent with the preference.
    const home = tempDir("envoycoder-hidden-quarantine-");
    const paths = coderPaths(home);
    mkdirSync(paths.stateDir, { recursive: true });
    writeFileSync(
      paths.settingsFile,
      JSON.stringify({
        defaults: { harness: "deepseek-harness" },
        requireApprovalForDestructive: true,
        keepTranscripts: true,
        language: "de",
        hiddenAgents: "codex",
      }),
      "utf8",
    );

    const store = await CoderStore.open({ paths });

    // The preference is not half-read and not repaired into something the user did not write.
    expect(store.settings().hiddenAgents).toBeUndefined();
    const notes = store.notes().quarantined;
    expect(notes.some((entry) => entry.file.endsWith("settings.json"))).toBe(true);
    // And the bytes are still there, under a name a user can open — which is what makes it recoverable.
    const saved = readdirSync(paths.stateDir).find((name) => name.startsWith("settings.corrupt-"));
    expect(saved).toBeDefined();
    expect(readFileSync(join(paths.stateDir, saved ?? ""), "utf8")).toContain('"hiddenAgents":"codex"');
  });
});

/* ────────────────────────────── what the store writes ────────────────────────────── */

describe("hiding and un-hiding, through the store", () => {
  it("round-trips, sorts, de-duplicates, and drops the key when nothing is hidden", async () => {
    const paths = coderPaths(tempDir("envoycoder-hidden-store-"));
    const store = await CoderStore.open({ paths });

    await store.setAgentHidden("omp", true);
    await store.setAgentHidden("codex", true);
    await store.setAgentHidden("codex", true);

    // Sorted and de-duplicated on write, so the file is stable and a diff of it is readable — and hiding twice
    // is one fact, not two.
    expect(store.settings().hiddenAgents).toEqual(["codex", "omp"]);
    expect(JSON.parse(readFileSync(paths.settingsFile, "utf8")).hiddenAgents).toEqual(["codex", "omp"]);

    await store.setAgentHidden("codex", false);
    expect(store.settings().hiddenAgents).toEqual(["omp"]);

    await store.setAgentHidden("omp", false);
    // Absent rather than `[]`: an empty list would be a claim that the preference was considered, which is a
    // different thing from never having expressed one.
    expect(store.settings().hiddenAgents).toBeUndefined();
    expect(JSON.parse(readFileSync(paths.settingsFile, "utf8")).hiddenAgents).toBeUndefined();
  });

  it("survives a restart, because it is the user's preference and not a window's", async () => {
    const home = tempDir("envoycoder-hidden-restart-");
    const paths = coderPaths(home);

    const first = await CoderStore.open({ paths });
    await first.setAgentHidden("cursor", true);

    const second = await CoderStore.open({ paths });
    // On disk, so the phone and a second window see the same list — and so a restart does not quietly put an
    // agent the user removed back into their pickers.
    expect(second.settings().hiddenAgents).toEqual(["cursor"]);
  });

  it("tells a listener which list moved, so a second window refetches the right one", async () => {
    const paths = coderPaths(tempDir("envoycoder-hidden-events-"));
    const store = await CoderStore.open({ paths });
    const changes: { kind: string; ids?: readonly string[] }[] = [];
    store.onChange((change) => changes.push({ kind: change.kind, ...(change.ids ? { ids: change.ids } : {}) }));

    await store.setAgentHidden("cursor", true);
    await store.addProvider({
      id: "my-agent",
      label: "My Agent",
      command: "auggie",
      args: ["--acp"],
      env: [],
      transport: "acp",
    });
    await store.setAgentHidden("my-agent", true);

    // **Two events per toggle, because two things moved.** The row a window is drawing lives in an *agent* list
    // (`harnesses` or `providers`), while the stored preference lives in the settings document — and the store's
    // rule is that an event says what changed so a client refetches exactly that. One event would either leave
    // the row on screen wrong or make every window refetch every list.
    expect(changes).toEqual([
      { kind: "settings" },
      { kind: "harnesses", ids: ["cursor"] },
      { kind: "providers", ids: ["my-agent"] },
      { kind: "settings" },
      { kind: "providers", ids: ["my-agent"] },
    ]);
  });
});

/* ────────────────────────────── the wire ────────────────────────────── */

describe("the method, and the id it refuses", () => {
  async function handlersFor(paths: ReturnType<typeof coderPaths>): Promise<Record<string, CoderHandler>> {
    const store = await CoderStore.open({ paths });
    return createCoderHandlers({
      store,
      paths,
      instance: { instanceId: "t", version: "0", startedAt: new Date().toISOString(), connectionCount: () => 1 },
      mesh: () => ({ kind: "no-node", reason: "test" }),
    }) as Record<string, CoderHandler>;
  }

  it("hides one we ship and one the user declared, and returns the whole list", async () => {
    const paths = coderPaths(tempDir("envoycoder-hidden-rpc-"));
    const handlers = await handlersFor(paths);
    await handlers["coder.addProvider"]?.({
      id: "my-agent",
      label: "My Agent",
      command: "auggie",
      transport: "acp",
    });

    const one = (await handlers["coder.setAgentHidden"]?.({ id: "codex", hidden: true })) as {
      id: string;
      hidden: boolean;
      hiddenAgents: string[];
    };
    // The whole resulting list, so a client can update every row it is showing without a second round trip.
    expect(one).toEqual({ id: "codex", hidden: true, hiddenAgents: ["codex"] });

    const two = (await handlers["coder.setAgentHidden"]?.({ id: "my-agent", hidden: true })) as {
      hiddenAgents: string[];
    };
    expect(two.hiddenAgents).toEqual(["codex", "my-agent"]);
  });

  it("refuses an id that names no agent, with a sentence in the user's language", async () => {
    const paths = coderPaths(tempDir("envoycoder-hidden-missing-"));
    const handlers = await handlersFor(paths);

    let code: string | null = null;
    let key: string | undefined;
    try {
      await handlers["coder.setAgentHidden"]?.({ id: "no-such-agent", hidden: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      code = coderErrorCode(message);
      key = coderErrorRef(message)?.key;
    }
    // Its own code, because it answers about the **union** of the two agent lists — `provider-missing` would be
    // a sentence about the wrong list when a user mistyped one of the nine we ship.
    expect(code).toBe(ENVOYCODER_ERRORS.agentMissing);
    expect(key).toBe("error.agentNotFound");
    expect(isMessageKey(key ?? "")).toBe(true);
  });

  it("stores nothing when the id is a credential", async () => {
    // The field takes an id, and it is exactly the field somebody could paste a key into. Refused *before*
    // anything is written, which is what keeps the preference list a list of ids: no name is invented, nothing
    // is echoed into a sentence that reaches a log, and no value is stored.
    const paths = coderPaths(tempDir("envoycoder-hidden-secret-"));
    const handlers = await handlersFor(paths);
    const secret = "sk-live-1f4c9ab7-not-a-real-key";
    // A real preference first, so the file exists and the assertion is about its contents rather than about a
    // missing file.
    await handlers["coder.setAgentHidden"]?.({ id: "codex", hidden: true });

    let message = "";
    try {
      await handlers["coder.setAgentHidden"]?.({ id: secret, hidden: true });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(coderErrorCode(message)).toBe(ENVOYCODER_ERRORS.agentMissing);
    // The refusal names the id it refused — that is how a user fixes a typo — and an id that happens to look
    // like a key is not special-cased into silence or into memory.
    expect(message).toContain(secret);
    const stored = readFileSync(paths.settingsFile, "utf8");
    expect(stored).toContain("codex");
    expect(stored.includes(secret), "the value was written to the preference list").toBe(false);
  });
});
