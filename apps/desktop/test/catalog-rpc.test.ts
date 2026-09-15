/**
 * The catalogue over the wire: **every row arrives with a verdict, and building them starts nothing.**
 *
 * ## What this file is defending, and what it used to defend
 *
 * There was a second method here (`coder.probeCatalogAgent`) and it measured **one entry, on the user's
 * press**, caching the answer and refusing to cache a negative one. Two of its rules were genuinely load
 * bearing — a cached `not-installed` would mean a user who installs Goose, comes back and presses *Check
 * again* is shown the answer from before they acted; `unknown` must never be served as an absence — and both
 * of them are gone with the method, because the question they were about is gone: nothing is cached, so
 * nothing can be stale, and nothing is asked about one row at a time.
 *
 * What replaced it has one property that matters and is easy to lose in a refactor: **the cheap facts for all
 * 38 rows are resolved when the list is served, and resolving them starts nothing and downloads nothing.**
 * Believing that was impossible is what produced thirty-eight *Check* buttons, so the assertion is not a
 * comment — it is a counter:
 *
 *   * `probed` records every call into the prober, and the first test asserts it is **38 long**, because a
 *     list whose rows carry a verdict has necessarily asked about every row. A "cost saving" that stopped
 *     asking would be the *"Not checked yet"* screen coming back.
 *   * the same test counts **child processes** — `spawn`, `execFile`, `exec`, `fork` — across the whole read
 *     and requires **zero**. That is the mandate's *"assert that loading the page spawns no process — a test,
 *     not an intention"*, at the layer where a spawn would actually happen: `@envoycoder/agent-catalog`'s
 *     prober reaches `@envoycoder/platform`, which is where a program is looked for, and a probe that ever
 *     shells out to ask the user's login shell would show up here as a count of one.
 *
 * ## Why the handlers and not a socket
 *
 * `daemon-rpc.test.ts` proves the transport; nothing about *this* question is about transport. What matters is
 * what the handler answers and what it did to get there, which is a function call with a recording prober.
 */

import { createRequire } from "node:module";

import { describe, expect, it, vi } from "vitest";

/**
 * **A live count of every process this file causes — patched into the builtin module object itself.**
 *
 * ## Why this is not a `vi.mock`, which is what it was first
 *
 * The first version of this instrument was `vi.mock("node:child_process", …)`, and it was **wrong in a way
 * that produced a comfortable green**: the counter was asserted to be live by calling `execFileSync` from this
 * file (an ESM import, which the mock replaces) while the code under test reached the module through
 * `require` — and a `require` is not intercepted by `vi.mock`. So the mutation that made the prober shell out
 * once per row walked straight past the assertion, and the "spawns no process" test passed on a run that
 * spawned thirty-eight of them. That is the exact failure this repository keeps paying for: an instrument that
 * reports a zero for every question asked of it.
 *
 * ## What this does instead
 *
 * It patches the **properties of the builtin module object**, which is the one place both access paths meet:
 * `require("node:child_process")` returns that object, and an ESM named import of a Node builtin is a live
 * binding onto the same properties. So a call from either side is counted, whichever way the source reached
 * for it. Every entry point a process could be started through is replaced, because a subset is a test that
 * passes when the code picks a different one.
 *
 * `it("counts a process when one is really started")` is the negative test that keeps this honest: without it,
 * a mis-patched instrument reports zero for everything.
 */
const processes = vi.hoisted(() => ({ count: 0 }));

const nodeRequire = createRequire(import.meta.url);
/** The real module object, patched in place. Typed loosely on purpose — the point is the runtime object. */
const childProcess = nodeRequire("node:child_process") as Record<string, (...args: unknown[]) => unknown>;
for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) {
  const original = childProcess[name];
  if (typeof original !== "function") continue;
  childProcess[name] = (...args: unknown[]) => {
    processes.count += 1;
    return original(...args);
  };
}


import type { AcpAgentEntry, ProbeFinding } from "@envoycoder/agent-catalog";
import { acpAgent, cataloguedProviderInput, cataloguedRecipe, probeRecipe } from "@envoycoder/agent-catalog";
import { HarnessAvailabilitySchema } from "@envoycoder/protocol";

import { createCatalogHandlers } from "../src/daemon/catalog.js";
import type { CoderHandler } from "../src/daemon/service.js";

/**
 * The handlers over a **recording** prober.
 *
 * `answers` decides what one entry's measurement says, by entry id, so a test can make Goose present and Cline
 * absent without a filesystem. Every call is recorded, because "did this ask about every row" is the question
 * the first half of this file asks.
 */
function handlersWith(
  answers: Record<string, ProbeFinding> = {},
): { handlers: Record<string, CoderHandler>; probed: string[] } {
  const probed: string[] = [];
  const handlers = createCatalogHandlers({
    probe: (entry: AcpAgentEntry): ProbeFinding => {
      probed.push(entry.id);
      return answers[entry.id] ?? { state: "not-installed", reason: `${entry.title} is not installed.` };
    },
  }) as Record<string, CoderHandler>;
  return { handlers, probed };
}

const ready = (binary: string): ProbeFinding => ({ state: "ready", binaryPath: binary, via: "path" });

/**
 * The handlers over the **real** prober, with only the filesystem faked.
 *
 * A test that replaced the prober would be testing its own stub: the install steps, the reason sentences and
 * the `unknown`-when-we-could-not-search rule all come from `probeRecipe` over `cataloguedRecipe(entry)`, and
 * those are exactly the parts a row renders. So this drives the daemon's actual path with `find` answering
 * from a table.
 */
function handlersOverFind(find: (name: string) => string | null): Record<string, CoderHandler> {
  return createCatalogHandlers({
    probe: (entry) => probeRecipe(cataloguedRecipe(entry), { find }),
  }) as Record<string, CoderHandler>;
}

type Row = {
  id: string;
  title: string;
  command: string;
  args: readonly string[];
  env: readonly { name: string; value: string }[];
  transport: string;
  install: { kind: string; package?: string; binary?: string };
  installLink: string;
  version: string;
  builtIn: boolean;
  availability: { state: string; binary?: string; agentBinary?: string; fix?: readonly unknown[] };
};

async function rowsOf(handlers: Record<string, CoderHandler>): Promise<Row[]> {
  const { entries } = (await handlers["coder.listCatalog"]?.({})) as { entries: Row[] };
  return entries;
}

describe("the catalogue, as a list", () => {
  it("answers for every row, and starts nothing to do it", async () => {
    // **The mutation this fails on:** going back to a list that knows nothing. Removing the `availability`
    // field from `rowOf` — or replacing the prober with a constant — makes `probed` shorter than the row
    // count and takes the verdict off every row, which is the *"Not checked yet"* screen the owner reported.
    const { handlers, probed } = handlersWith();
    const answer = (await handlers["coder.listCatalog"]?.({})) as { entries: Row[] };

    expect(answer.entries).toHaveLength(38);
    // Every row was asked about. A list of 38 verdicts that measured fewer than 38 rows is a list with rows
    // whose state came from somewhere other than a measurement.
    expect(probed).toHaveLength(38);
    expect(new Set(probed).size).toBe(38);
  });

  it("spawns no process to resolve all 38 rows", async () => {
    // **The mandate's own test, at the layer a spawn would happen in:** *"Assert that loading the page spawns
    // no process — a test, not an intention."* A probe that ever asked the user's login shell about a name
    // instead of reading the answer the daemon primed at boot would call `execFile` here, and 38 rows would
    // mean 38 shells.
    processes.count = 0;
    const handlers = handlersOverFind((name) => (name === "npx" ? "/usr/bin/npx" : null));
    const result = (await handlers["coder.listCatalog"]?.({})) as { entries: Row[] };
    // Asserted only after the read resolved, so a throw cannot leave a zero that reads as a pass.
    expect(result.entries).toHaveLength(38);
    expect(processes.count).toBe(0);
  });

  it("counts a process when one is really started — the instrument is live", async () => {
    // **Without this, the zero above is worth nothing.** A mis-wired spy reports zero for every question; this
    // calls the same seam the prober would, through the module the mock replaced, and requires the counter to
    // move. It is the negative test for the assertion next door.
    processes.count = 0;
    // **Through `require`, deliberately**: that is the access path a `vi.mock` does not see, and the one the
    // mutation that first defeated this assertion used. A counter that only watches ESM imports is a counter
    // that reports zero for the shape of spawn it cannot see.
    (nodeRequire("node:child_process") as { execFileSync: (...a: unknown[]) => unknown }).execFileSync(
      "/bin/echo",
      ["a process, really started"],
      { stdio: "ignore" },
    );
    expect(processes.count).toBe(1);
  });

  it("gives every row a state the schema accepts, including on a machine with nothing installed", async () => {
    // The agreement rules of `HarnessAvailabilitySchema` — a `fix` exactly when something is missing, a
    // `binary` exactly when we resolved the program we drive, and an `agentBinary` only for `needs-bridge` —
    // are what stops a row saying "install this" about a program that is present. Parsing all 38 rows is the
    // cheapest possible way to keep that true for the projection this file serves.
    const entries = await rowsOf(handlersOverFind(() => null));
    const parsed = entries.map((entry) => HarnessAvailabilitySchema.parse(entry.availability));
    expect(parsed).toHaveLength(38);
    expect(parsed.every((availability) => availability.state === "not-installed")).toBe(true);
    expect(parsed.every((availability) => (availability.fix?.length ?? 0) > 0)).toBe(true);
  });

  it("reports 'we could not look' rather than 'not installed' when the daemon had nothing to search", async () => {
    // The fifth state, over a real recipe: an empty search list is not an absence, and the difference is the
    // whole reason `unknown` exists. `searchable: false` is the daemon saying it could not assemble one.
    const handlers = createCatalogHandlers({
      probe: (entry) => probeRecipe(cataloguedRecipe(entry), { find: () => null, searchable: false }),
    }) as Record<string, CoderHandler>;
    const entries = await rowsOf(handlers);
    const goose = entries.find((entry) => entry.id === "goose");
    expect(goose?.availability.state).toBe("unknown");
    // And no install step: telling a user to install something we never established was missing is the
    // `available: false` bug wearing a new field.
    expect(goose?.availability.fix).toBeUndefined();
  });

  it("states, per entry, the command, the argv, the dialect and how the program is obtained", async () => {
    const { handlers } = handlersWith();
    const entries = await rowsOf(handlers);

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

    // **The four entries whose recipe sets a variable carry the constant, and the row is where it belongs.**
    // The recipe is our own reviewed, git-tracked data, so a constant of a command line anybody can read is
    // not a secret — and it has to travel, because the window has to be able to say which variables the
    // recipe supplies and which are the user's to set.
    const vtcode = entries.find((entry) => entry.id === "vtcode");
    expect(vtcode?.env).toEqual([
      { name: "VT_ACP_ENABLED", value: "1" },
      { name: "VT_ACP_ZED_ENABLED", value: "1" },
    ]);

    // …and the *value* stops here. What `coder.addProvider` takes for this entry is the four recipe facts
    // plus `catalogEntryId`; there is no parameter a value could ride in, which is the wire half of the
    // names-only rule (`AgentProviderConfig`) — and it is why `providers.json` holds no value at all.
    expect(Object.keys(goose ?? {})).toContain("env");
    const add = cataloguedProviderInput(acpAgent("vtcode")!);
    expect(add.env).toEqual(["VT_ACP_ENABLED", "VT_ACP_ZED_ENABLED"]);
    expect(add.catalogEntryId).toBe("vtcode");
    expect(JSON.stringify(add)).not.toContain('"1"');
  });

  it("measures an npx recipe as ready — its package is fetched on the first run, not missing", async () => {
    // **The mandate's `npx` rule, at the wire.** *"an `npx` recipe → it is not a problem: the program is
    // fetched on first run, and say so."* The probe looks for `npx` rather than the package, deliberately —
    // looking for the package would report all 14 of these rows as missing — so with `npx` present the row is
    // `ready` and the window says how the program is obtained. The mutation: making the prober look for the
    // package, which turns 14 working rows into a wall of "not installed".
    const entries = await rowsOf(handlersOverFind((name) => (name === "npx" ? "/usr/bin/npx" : null)));
    const cline = entries.find((entry) => entry.id === "cline");
    expect(cline?.availability.state).toBe("ready");
    expect(cline?.availability.binary).toBe("/usr/bin/npx");
    // Not `unsupported`, not `needs-bridge`, and with no install step offered for a package nothing has to
    // install: the only states a row may read as a problem are the ones that assert one.
    expect(cline?.availability.fix).toBeUndefined();
  });

  it("says which entry is also an agent we ship, so no client has to decide the overlap", async () => {
    // `cursor` is a built-in *and* a recipe. The rule that a built-in wins lives in `resolveAgentEntry`; the
    // window is told the answer rather than working it out, because a second place computing it is a second
    // place to get it wrong.
    const { handlers } = handlersWith();
    const entries = await rowsOf(handlers);
    expect(entries.filter((entry) => entry.builtIn).map((entry) => entry.id)).toEqual(["cursor"]);
  });

  it("answers for a daemon that sends no parameters at all — it takes none", async () => {
    const { handlers } = handlersWith();
    await expect(handlers["coder.listCatalog"]?.(undefined)).resolves.toBeTruthy();
  });

  it("refuses parameters the schema does not describe", async () => {
    const { handlers } = handlersWith();
    await expect(handlers["coder.listCatalog"]?.({ depth: 3 })).rejects.toThrow();
  });
});
