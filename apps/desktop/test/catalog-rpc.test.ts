/**
 * The catalogue over the wire: **what one method promises, and what the other one costs.**
 *
 * ## What this file is defending
 *
 * `coder.listCatalog` and `coder.probeCatalogAgent` are the two methods the agents screen is built on, and
 * each of them has one property that is easy to lose in a refactor and impossible to notice afterwards:
 *
 *   * **`coder.listCatalog` measures nothing.** It is a projection of a static list, which is what makes it
 *     safe to call while a pane opens. If somebody ever "improves" it by probing while it builds its rows,
 *     every window would start walking the search path thirty-eight times on startup — and the symptom, on a
 *     machine with everything installed, is nothing at all. So the injected prober records its calls, and
 *     the test asserts there are none.
 *   * **`coder.probeCatalogAgent` measures one entry, caches the answer, and never caches a negative one.**
 *     A cached `not-installed` would mean a user who installs Goose, comes back and presses *Check again* is
 *     shown the answer from before they did it — the row they just acted on, lying to them. The staleness
 *     window, the `force` flag and the two non-cacheable states are asserted here, with an injected clock so
 *     none of it depends on waiting.
 *
 * ## Why the handlers and not a socket
 *
 * `daemon-rpc.test.ts` already proves the transport for the provider methods, and nothing about *this*
 * question is about transport. What matters is what each handler answers and what it did to get there, which
 * is a function call with a recording prober.
 */

import { describe, expect, it } from "vitest";

import type { AcpAgentEntry, ProbeFinding } from "@envoycoder/agent-catalog";
import { acpAgent, cataloguedRecipe, probeRecipe } from "@envoycoder/agent-catalog";
import { coderErrorCode, coderErrorMessage, coderErrorRef } from "@envoycoder/protocol";

import { CATALOG_PROBE_STALE_MS, createCatalogHandlers } from "../src/daemon/catalog.js";
import type { CoderHandler } from "../src/daemon/service.js";

/**
 * The handlers over a **recording** prober.
 *
 * `answers` decides what one entry's measurement says, by entry id, so a test can make Goose present and
 * Cline absent without a filesystem. Every call is recorded, because "how many times did this measure"
 * is the question half of this file asks.
 */
function handlersWith(
  answers: Record<string, ProbeFinding> = {},
  options: { now?: () => number } = {},
): { handlers: Record<string, CoderHandler>; probed: string[] } {
  const probed: string[] = [];
  const handlers = createCatalogHandlers({
    probe: (entry: AcpAgentEntry): ProbeFinding => {
      probed.push(entry.id);
      return answers[entry.id] ?? { state: "not-installed", reason: `${entry.title} is not installed.` };
    },
    ...(options.now ? { now: options.now } : {}),
  }) as Record<string, CoderHandler>;
  return { handlers, probed };
}

const ready = (binary: string): ProbeFinding => ({ state: "ready", binaryPath: binary, via: "path" });

/**
 * The handlers over the **real** prober, with only the filesystem faked.
 *
 * A test that replaced the prober would be testing its own stub: the install steps, the reason sentences and
 * the `unknown`-when-we-could-not-search rule all come from `probeRecipe` over `cataloguedRecipe(entry)`, and
 * those are exactly the parts a row renders. So this drives the daemon's actual path — the one
 * `service.ts` builds — with `find` answering from a table.
 */
function handlersOverFind(find: (name: string) => string | null): Record<string, CoderHandler> {
  return createCatalogHandlers({
    probe: (entry) => probeRecipe(cataloguedRecipe(entry), { find }),
  }) as Record<string, CoderHandler>;
}

describe("the catalogue, as a list", () => {
  it("serves every entry, and measures none of them", async () => {
    // **The mutation this fails on:** building the rows by probing. The recorded list would be 38 long and
    // every window's startup would walk the search path — invisible on a developer's machine, wasteful on a
    // user's, and worst exactly where the product matters (a laptop on a metered connection, where 14 of the
    // entries are npx recipes).
    const { handlers, probed } = handlersWith();
    const answer = (await handlers["coder.listCatalog"]?.({})) as { entries: unknown[] };

    expect(answer.entries).toHaveLength(38);
    expect(probed).toEqual([]);
  });

  it("states, per entry, the command, the argv, the dialect and how the program is obtained", async () => {
    const { handlers } = handlersWith();
    const { entries } = (await handlers["coder.listCatalog"]?.({})) as {
      entries: {
        id: string;
        title: string;
        command: string;
        args: readonly string[];
        env: readonly string[];
        transport: string;
        install: { kind: string; package?: string; binary?: string };
        installLink: string;
        version: string;
        builtIn: boolean;
      }[];
    };

    const goose = entries.find((entry) => entry.id === "goose");
    expect(goose).toBeDefined();
    expect(goose?.command).toBe("goose");
    expect(goose?.args).toEqual(["acp"]);
    expect(goose?.transport).toBe("acp");
    expect(goose?.install).toEqual({ kind: "binary", binary: "goose" });
    expect(goose?.installLink).toMatch(/^https?:\/\//);
    expect(goose?.builtIn).toBe(false);

    // An npx recipe: the package the first run fetches, and no install step at all.
    const cline = entries.find((entry) => entry.id === "cline");
    expect(cline?.command).toBe("npx");
    expect(cline?.install).toEqual({ kind: "npx", package: "cline@3.0.46" });

    // **The four entries whose recipe sets a variable carry the name and not the value.** There is no field
    // in `AgentProviderConfig` for a value, and this is the wire half of that: what crosses is `VT_ACP_ENABLED`,
    // never the `"1"` the recipe sets it to.
    const vtcode = entries.find((entry) => entry.id === "vtcode");
    expect(vtcode?.env).toEqual(["VT_ACP_ENABLED", "VT_ACP_ZED_ENABLED"]);
    expect(JSON.stringify(entries)).not.toContain('"1"');
  });

  it("says which entry is also an agent we ship, so no client has to decide the overlap", async () => {
    // `cursor` is a built-in *and* a recipe. The rule that a built-in wins lives in `resolveAgentEntry`; the
    // window is told the answer rather than working it out, because a second place computing it is a second
    // place to get it wrong.
    const { handlers } = handlersWith();
    const { entries } = (await handlers["coder.listCatalog"]?.({})) as {
      entries: { id: string; builtIn: boolean }[];
    };
    expect(entries.filter((entry) => entry.builtIn).map((entry) => entry.id)).toEqual(["cursor"]);
  });

  it("answers for a daemon that sends no parameters at all — it takes none", async () => {
    const { handlers } = handlersWith();
    await expect(handlers["coder.listCatalog"]?.(undefined)).resolves.toBeTruthy();
  });
});

describe("probing one catalogued entry", () => {
  it("measures the entry it was asked about, and only that one", async () => {
    // **The mutation this fails on:** a sweep. One call, one row — that is the whole cost policy, and a
    // "check everything" convenience would be the defect the per-entry shape exists to prevent.
    const { handlers, probed } = handlersWith({ goose: ready("/usr/local/bin/goose") });
    const answer = (await handlers["coder.probeCatalogAgent"]?.({ id: "goose" })) as {
      id: string;
      availability: { state: string; binary?: string };
      cached: boolean;
      costMs: number;
      observedAt: string;
    };

    expect(probed).toEqual(["goose"]);
    expect(answer.id).toBe("goose");
    expect(answer.availability.state).toBe("ready");
    expect(answer.availability.binary).toBe("/usr/local/bin/goose");
    expect(answer.cached).toBe(false);
    expect(answer.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Number.isInteger(answer.costMs)).toBe(true);
  });

  it("carries the install step the entry's own recipe authored when the program is missing", async () => {
    // Over the **real** prober, so the fix is the one a window would render: the entry's own link, and the
    // exact command line the row would run. That is the pair the fourth agreement rule of
    // `HarnessAvailabilitySchema` demands of any state asserting an absence.
    const handlers = handlersOverFind(() => null);
    const answer = (await handlers["coder.probeCatalogAgent"]?.({ id: "goose" })) as {
      availability: { state: string; fix?: readonly { command: string; url?: string }[] };
    };
    expect(answer.availability.state).toBe("not-installed");
    expect(answer.availability.fix?.[0]?.url).toBe(acpAgent("goose")?.installLink);
    expect(answer.availability.fix?.[0]?.command).toContain("goose acp");

    // And the `npx` case gets the *other* sentence, because what is missing there is Node, not the agent:
    // a row saying "install Cline" would send a user to a download page for a package that installs itself.
    const noNpx = (await handlers["coder.probeCatalogAgent"]?.({ id: "cline" })) as {
      availability: { state: string; fix?: readonly { command: string; url?: string }[] };
    };
    expect(noNpx.availability.state).toBe("not-installed");
    expect(noNpx.availability.fix?.[0]?.command).toContain("needs no install");

    // With `npx` present the entry measures ready — on the *right* binary: a probe that looked for `cline`
    // on PATH would report every fetched recipe as missing, on every machine.
    const withNpx = handlersOverFind((name) => (name === "npx" ? "/usr/bin/npx" : null));
    const cline = (await withNpx["coder.probeCatalogAgent"]?.({ id: "cline" })) as {
      availability: { state: string; binary?: string };
    };
    expect(cline.availability.state).toBe("ready");
    expect(cline.availability.binary).toBe("/usr/bin/npx");
  });

  it("says 'we could not look' rather than 'not installed' when the daemon had nothing to search", async () => {
    // The fifth state, over a real recipe: no search list is not an absence, and the difference is the whole
    // reason `unknown` exists. `searchable: false` is the daemon saying it could not assemble one.
    const handlers = createCatalogHandlers({
      probe: (entry) =>
        probeRecipe(cataloguedRecipe(entry), { find: () => null, searchable: false }),
    }) as Record<string, CoderHandler>;
    const answer = (await handlers["coder.probeCatalogAgent"]?.({ id: "goose" })) as {
      availability: { state: string; fix?: unknown };
    };
    expect(answer.availability.state).toBe("unknown");
    expect(answer.availability.fix).toBeUndefined();
  });

  it("remembers a positive answer, and says it answered from memory", async () => {
    let clock = 1_000_000;
    const { handlers, probed } = handlersWith({ goose: ready("/usr/local/bin/goose") }, { now: () => clock });

    await handlers["coder.probeCatalogAgent"]?.({ id: "goose" });
    clock += 60_000;
    const second = (await handlers["coder.probeCatalogAgent"]?.({ id: "goose" })) as {
      cached: boolean;
      observedAt: string;
    };

    expect(probed).toEqual(["goose"]);
    expect(second.cached).toBe(true);
    // The moment of the *measurement*, not of this answer: a `observedAt` that moved on every read would be
    // a timestamp of the wrong event.
    expect(second.observedAt).toBe(new Date(1_000_000).toISOString());
  });

  it("measures again once the answer is stale, and always when the caller forces it", async () => {
    // A user who has just installed something and presses *Check again* means it, and the stale window is the
    // automatic half of the same fix.
    let clock = 1_000_000;
    const { handlers, probed } = handlersWith({ goose: ready("/usr/local/bin/goose") }, { now: () => clock });

    await handlers["coder.probeCatalogAgent"]?.({ id: "goose" });
    await handlers["coder.probeCatalogAgent"]?.({ id: "goose", force: true });
    expect(probed).toEqual(["goose", "goose"]);

    clock += CATALOG_PROBE_STALE_MS + 1;
    const afterStale = (await handlers["coder.probeCatalogAgent"]?.({ id: "goose" })) as { cached: boolean };
    expect(probed).toEqual(["goose", "goose", "goose"]);
    expect(afterStale.cached).toBe(false);
  });

  it("never serves an absence from cache — that is the answer a user is about to change", async () => {
    // **The one caching rule with a user-visible failure.** A user installs Goose, comes back to the page and
    // presses *Check again*: with `not-installed` cached, the row they just acted on would repeat the answer
    // from before they acted. `unknown` is excluded for the plainer reason that nothing was measured.
    const answers: Record<string, ProbeFinding> = {};
    let clock = 1_000_000;
    const probed: string[] = [];
    const handlers = createCatalogHandlers({
      probe: (entry) => {
        probed.push(entry.id);
        return answers[entry.id] ?? { state: "not-installed", reason: "not installed" };
      },
      now: () => clock,
    }) as Record<string, CoderHandler>;

    const first = (await handlers["coder.probeCatalogAgent"]?.({ id: "goose" })) as { cached: boolean };
    clock += 1_000;
    const second = (await handlers["coder.probeCatalogAgent"]?.({ id: "goose" })) as { cached: boolean };
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(false);
    expect(probed).toEqual(["goose", "goose"]);

    // …and the moment it *is* there, the answer is remembered.
    answers.goose = ready("/usr/local/bin/goose");
    const third = (await handlers["coder.probeCatalogAgent"]?.({ id: "goose" })) as { cached: boolean };
    clock += 1_000;
    const fourth = (await handlers["coder.probeCatalogAgent"]?.({ id: "goose" })) as { cached: boolean };
    expect(third.cached).toBe(false);
    expect(fourth.cached).toBe(true);
    expect(probed).toEqual(["goose", "goose", "goose"]);
  });

  it("does not treat a clock that went backwards as freshness", async () => {
    // A laptop waking from sleep or an NTP correction can make the age negative. That is not evidence that a
    // measurement is young, and reading it as one would serve a stale answer indefinitely.
    let clock = 1_000_000;
    const { handlers, probed } = handlersWith({ goose: ready("/usr/local/bin/goose") }, { now: () => clock });
    await handlers["coder.probeCatalogAgent"]?.({ id: "goose" });
    clock = 0;
    const answer = (await handlers["coder.probeCatalogAgent"]?.({ id: "goose" })) as { cached: boolean };
    expect(answer.cached).toBe(false);
    expect(probed).toEqual(["goose", "goose"]);
  });

  it("refuses an id nobody catalogued, with a key a window can translate", async () => {
    // **The mutation this fails on:** answering `unknown`. That word means "we could not look", and saying it
    // about a program that does not exist turns a typo into a state a user can act on.
    const { handlers, probed } = handlersWith();
    const failure = await handlers["coder.probeCatalogAgent"]?.({ id: "no-such-agent" }).then(
      () => undefined,
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    expect(failure).toBeDefined();
    expect(coderErrorCode(failure ?? "")).toBe("envoycoder.bad-request");
    expect(coderErrorMessage(failure ?? "")).toContain("no-such-agent");
    expect(coderErrorRef(failure ?? "")?.key).toBe("error.catalogAgentMissing");
    expect(probed).toEqual([]);
  });

  it("refuses parameters the schema does not describe", async () => {
    const { handlers } = handlersWith();
    await expect(handlers["coder.probeCatalogAgent"]?.({})).rejects.toThrow();
    await expect(handlers["coder.probeCatalogAgent"]?.({ id: "goose", depth: 3 })).rejects.toThrow();
  });
});
