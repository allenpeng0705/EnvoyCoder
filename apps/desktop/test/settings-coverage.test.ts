/**
 * Every field of `CoderSettings` is **read** somewhere, or it is not in the schema at all.
 *
 * ## The defect this exists to prevent, in one sentence
 *
 * A settings pane shipped with five controls, of which two stored a preference **nothing read**:
 * `requireApprovalForDestructive` (the approvals were unconditional) and `allowRemoteRuns` (there was no
 * remote path to gate). `defaultProjectPath` was worse in a quieter way — stored, validated, advertised
 * on the wire and read by nobody. `docs/settings-parity.md` §7.1 is the inventory and §8.1 is the work;
 * this file is the gate §8.1 asks for, written as a test rather than a grep so that **adding a field
 * without a reader fails CI** instead of being caught by whoever next reads the pane.
 *
 * ## Why the schema is the list of fields, and not the interface
 *
 * `CoderSettingsSchema` is what is **stored and served**: a field that exists only on the TypeScript
 * interface is not a setting anybody can hold, so it has no reader to be missing. `.strict()` means the
 * schema is also the whole truth about the shape on disk — which is why dropping a field from it has to
 * go through `RETIRED_SETTINGS_KEYS`, asserted at the bottom of this file.
 *
 * ## What "read at a named site" means here, exactly
 *
 * A `{ file, needle }` pair whose needle must be present in that file's source. That is deliberately
 * weaker than a data-flow analysis and deliberately stronger than "the string appears anywhere":
 *
 *   * **Weak** because it proves the *reference* exists, not that the reference is genuine. A reviewer
 *     is still who tells "this field reaches the agent" from "this field is spread into a log line".
 *     The honest alternative is a per-field behavioural test, which is what the daemon tests are — the
 *     approvals row has four in `runs.test.ts` and `defaultProjectPath` has two in `palette-flow.test.tsx`.
 *   * **Strong** because the two places a field is guaranteed to appear without being read are
 *     **excluded by rule** below: the pane that renders it, and the module that declares it. Those are
 *     exactly the references `defaultProjectPath` had while it was dead, so a guard that accepted them
 *     would have passed on the defect it was written for.
 */

import { readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { CoderSettingsSchema, RETIRED_SETTINGS_KEYS } from "@envoydev/protocol";

/** The repository root, so a read site can be written the way a reader would cite it. */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** One place a field is read, with the source text that must still be there. */
interface ReadSite {
  /** Repo-relative, forward-slashed — the same form every other citation in this repo uses. */
  file: string;
  /** The reference that must appear in that file. */
  needle: string;
  /** What the reader does with the value, so the pair can be reviewed rather than trusted. */
  because: string;
}

/**
 * The read sites, by field. `defaults.*` are spelled out rather than nested, because it is the *leaf*
 * that is a setting: `defaults` itself is a container, and a container is never read by anything.
 */
const READERS: Readonly<Record<string, readonly ReadSite[]>> = {
  language: [
    {
      file: "apps/desktop/src/main.tsx",
      needle: "state.settings.language",
      because:
        "the root `I18nProvider` takes the stored preference, which is what re-renders every `t()` in " +
        "the window when it changes",
    },
  ],
  defaultProjectPath: [
    {
      file: "apps/desktop/src/components/CoderApp.tsx",
      needle: "state.settings.defaultProjectPath",
      because:
        "handed to `buildCommandContributions`, whose `project.add` row seeds its text stage with it; " +
        "`palette-flow.test.tsx` asserts the seeded field end to end",
    },
  ],
  "defaults.harness": [
    {
      file: "apps/desktop/src/daemon/store.ts",
      needle: "appDefaults: this.settingsState.defaults",
      because: "`createTask` passes the app defaults into the resolver, below the project's and below",
    },
    {
      file: "packages/task-model/src/index.ts",
      needle: "input.appDefaults?.harness",
      because: "the third link of `resolveTaskDefaults` — after the explicit choice and the project's",
    },
  ],
  "defaults.model": [
    {
      file: "packages/task-model/src/index.ts",
      needle: "input.appDefaults?.model",
      because: "the same resolution order, for the model a new task starts on",
    },
  ],
  "defaults.extraArgs": [
    {
      file: "packages/task-model/src/index.ts",
      needle: "input.appDefaults?.extraArgs",
      because: "and for the agent's extra argv, which reaches the launch flags the same way",
    },
  ],
  requireApprovalForDestructive: [
    {
      file: "apps/desktop/src/daemon/runs.ts",
      needle: "this.settings().requireApprovalForDestructive",
      because:
        "resolved once per run, for the run's own agent, and put on the live run so `drive` applies " +
        "that answer rather than a value read again a moment later",
    },
    {
      file: "apps/desktop/src/daemon/run-options.ts",
      needle: 'requireApprovalForDestructive ? "always-confirm" : "off"',
      because:
        "the mapping to the value `envoy-harness` validates; `runs.test.ts` proves both positions " +
        "reach the agent over a real pipe",
    },
  ],
  keepTranscripts: [
    {
      file: "apps/desktop/src/daemon/runs.ts",
      needle: "if (!this.settings().keepTranscripts) return;",
      because: "`appendTranscript` returns before touching the disk when the record is not wanted",
    },
  ],
  // **`hiddenAgents` is not here, and its absence is the assertion.** This registry is checked in both
  // directions against `CoderSettingsSchema` below, so a field that came back would fail this test for
  // having no reader — and a field removed without being retired would fail it too. The preference was
  // deleted rather than left stored: it was the one setting that could make an agent we ship disappear from
  // the product's own lists, and what decides which agents a picker offers is now derived from probed facts
  // (`apps/desktop/src/composer/agent-for.ts`), which is not a setting at all and therefore has nothing to
  // register here. `RETIRED_SETTINGS_KEYS` carries the old key so an upgrading settings file still parses.
};

/**
 * The two places a reference proves nothing, refused by rule rather than by reviewer discipline.
 *
 * Both are the files `defaultProjectPath` was found in while it was dead: the pane rendered it and the
 * protocol declared it. A guard that counted either would have called that field honest.
 */
const NOT_A_READER: readonly string[] = [
  // Where a field is rendered. A control writing or showing a value says nothing about any workflow
  // consuming it — which is the whole distinction between "the pane has a row for it" and "it works".
  "apps/desktop/src/components/SettingsPane.tsx",
  // …and the section pages the pane renders, added to this list when the pane was split into sections.
  // The directory rather than six file names: the *reason* is that everything under it exists to draw
  // settings, so a needle found there is a row, not a reader, whichever file it lands in. A new section
  // page is therefore covered the day it is written, which is the opposite of how this defect used to
  // arrive (`defaultProjectPath` was citeable from the pane that rendered it).
  "apps/desktop/src/components/settings",
  // Where a field is declared, schematised, parsed and defaulted. `CoderSettingsSchema` naming a field
  // is what makes it *storable*; it is not a reader.
  "packages/protocol/src",
];

/** Every leaf field the stored schema actually has, spelled `defaults.model` for the nested ones. */
function storedFields(): string[] {
  const shape = CoderSettingsSchema.shape as Record<string, { shape?: Record<string, unknown> }>;
  const fields: string[] = [];
  for (const [key, entry] of Object.entries(shape)) {
    // A nested object is a container, and its members are the settings — `defaults` is not one.
    const inner = entry?.shape;
    if (inner !== undefined) {
      for (const leaf of Object.keys(inner)) fields.push(`${key}.${leaf}`);
      continue;
    }
    fields.push(key);
  }
  return fields.sort();
}

const source = (file: string): string => readFileSync(join(ROOT, file), "utf8");

describe("every stored setting is read by something", () => {
  it("has a named read site for each field of `CoderSettings`, and none left over", () => {
    // Both directions in one assertion, because the failure a reader needs to see is the *difference*:
    // a field with no reader is the defect, and a registry entry for a field that no longer exists is
    // the residue that makes the next person think an old setting is still live — which is exactly what
    // `allowRemoteRuns` would have become.
    expect(Object.keys(READERS).sort()).toEqual(storedFields());
  });

  it("points every read site at source that still contains it", () => {
    for (const [field, sites] of Object.entries(READERS)) {
      expect(sites.length, `${field} names no read site at all`).toBeGreaterThan(0);
      for (const site of sites) {
        // A missing file is reported as its own failure rather than as a thrown ENOENT, so a renamed
        // module reads as "this cursor is stale" instead of as a broken suite.
        const text = (() => {
          try {
            return source(site.file);
          } catch {
            return undefined;
          }
        })();
        expect(text, `${field}: ${site.file} does not exist, so it cannot be the read site`).toBeDefined();
        expect(
          text?.includes(site.needle),
          `${field}: ${site.file} no longer contains ${JSON.stringify(site.needle)} — the read site ` +
            `moved and this cursor has to move with it (it was there for: ${site.because})`,
        ).toBe(true);
      }
    }
  });

  it("refuses a read site in the pane that renders the field, or the module that declares it", () => {
    // The rule that makes the two checks above mean something. Stated as a test rather than as a comment
    // on the registry so that the tempting shortcut — "it is referenced in SettingsPane, that counts" —
    // fails here, with the reason, instead of shipping.
    for (const [field, sites] of Object.entries(READERS)) {
      for (const site of sites) {
        const refusing = NOT_A_READER.filter((entry) =>
          entry.endsWith(".tsx") || entry.endsWith(".ts")
            ? site.file === entry
            : site.file === entry || site.file.startsWith(entry.endsWith(sep) ? entry : `${entry}/`),
        );
        expect(
          refusing,
          `${field}: ${site.file} is where the field is rendered or declared, not where it is read`,
        ).toEqual([]);
      }
    }
  });

  it("has no retired key still in the schema, so the strip cannot hide a live setting", () => {
    // `withoutRetiredSettingsKeys` deletes these before the schema parses, so a key that was retired and
    // then re-added would be silently discarded on read while every write appeared to work. Cheap to
    // check, and the alternative is a field that looks live in the pane and never survives a restart.
    const live = new Set(storedFields().map((field) => field.split(".")[0]));
    for (const key of RETIRED_SETTINGS_KEYS) {
      expect(live.has(key), `"${key}" is retired but still in CoderSettingsSchema`).toBe(false);
    }
  });
});

/**
 * The registry has to cite real paths, so this fails loudly if the tree moves under it.
 *
 * Kept separate from the field checks because it answers a different question: those ask "does the
 * setting reach anything", this asks "is the citation itself still the file the reader will open". A
 * `relative` in the failure message is the `git mv` that moved it.
 */
describe("the coverage registry's citations", () => {
  it("are repository-relative paths, spelled the way the rest of the repo spells them", () => {
    for (const [field, sites] of Object.entries(READERS)) {
      for (const site of sites) {
        expect(site.file, `${field}: ${site.file}`).not.toContain(sep === "/" ? "\\\\" : "/");
        expect(
          relative(ROOT, join(ROOT, site.file)).startsWith(".."),
          `${field}: ${site.file} points outside the repository`,
        ).toBe(false);
        // A note is required, not optional: the registry is read by people, and a needle with no
        // sentence beside it is a cursor nobody can maintain.
        expect(site.because.length, `${field}: ${site.file} explains nothing`).toBeGreaterThan(20);
      }
    }
  });
});
