/**
 * The ACP catalogue: what it promises, and the two things it deliberately does not.
 *
 * The value of a list this long is coverage — a user with Gemini CLI, Goose or Cline installed should
 * find it here rather than being told the product supports six agents. The risk of a list this long is
 * the opposite: that entries rot, duplicate, or quietly claim more than we know. So these tests pin the
 * *shape* and the *honesty* of the data, not its content: an entry may be wrong about a third-party
 * tool (their docs move), but it may not be malformed, ambiguous, or pretending to be tested.
 *
 * Provenance: catalogued from Paseo v0.8.0 (`packages/app/src/data/acp-provider-catalog.ts`). The count
 * and the spot-checks below are what make an upstream change visible in *our* suite.
 */

import { describe, expect, it } from "vitest";

import {
  ACP_AGENT_CATALOG,
  acpAgent,
  acpAgentIds,
  cataloguedCommandLine,
  cataloguedEnvNames,
  cataloguedEnvValues,
  cataloguedInstall,
  cataloguedProviderInput,
  cataloguedRecipe,
  overlappingAgentIds,
  probeRecipe,
  resolveAgentEntry,
  ALL_HARNESSES,
} from "../src/index.js";
import { CatalogEnvConstantSchema, looksLikeCredentialEnvName } from "@envoycoder/protocol";

describe("the catalogued ACP agents", () => {
  it("carries every entry Paseo ships, and nothing malformed", () => {
    // 38 is Paseo v0.8.0's count. If it changes, this test is where the decision gets made — add the
    // entry, or say why we are not.
    expect(ACP_AGENT_CATALOG).toHaveLength(38);

    for (const entry of ACP_AGENT_CATALOG) {
      expect(entry.id, "id").toMatch(/^[a-z0-9][a-z0-9-]*$/);
      expect(entry.title.trim().length, `${entry.id} title`).toBeGreaterThan(0);
      expect(entry.description.trim().length, `${entry.id} description`).toBeGreaterThan(10);
      expect(entry.version.trim().length, `${entry.id} version`).toBeGreaterThan(0);
      expect(entry.installLink, `${entry.id} install link`).toMatch(/^https?:\/\//);
      expect(entry.command.length, `${entry.id} command`).toBeGreaterThan(0);
      expect(entry.command[0].trim().length, `${entry.id} binary`).toBeGreaterThan(0);
      for (const part of entry.command) expect(part.trim().length, `${entry.id} argv part`).toBeGreaterThan(0);
    }
  });

  it("uses unique ids, sorted, so lookups and diffs are stable", () => {
    const ids = acpAgentIds();
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...ids].sort());
  });

  it("knows where each agent comes from, and how it is obtained", () => {
    // Two shapes, and the difference matters to a user: a *fetched* agent (npx pins a version in the
    // command) versus an *installed* one (the version is whatever they have). 14 and 24 today.
    const fetched = ACP_AGENT_CATALOG.filter((entry) => entry.command[0] === "npx");
    const installed = ACP_AGENT_CATALOG.filter((entry) => entry.command[0] !== "npx");
    expect(fetched).toHaveLength(14);
    expect(installed).toHaveLength(24);

    for (const entry of fetched) {
      expect(entry.command.join(" "), `${entry.id} pins a version when it fetches`).toMatch(/@\d/);
    }
    // The ones we cannot pin: the tool updates itself, so the honest version string is "manual".
    expect(ACP_AGENT_CATALOG.filter((entry) => entry.version === "manual").map((e) => e.id)).toEqual([
      "codebuddy-code",
      "devin",
      "gjc",
      "hermes",
      "kiro",
      "traecli",
    ]);
  });

  it("carries the one parameter that changes how we must drive an agent", () => {
    // `supportsMcpServers: false` is not a preference: an adapter that cannot create a session while
    // `mcpServers` is non-empty breaks outright if the host injects MCP tools. Exactly one entry says
    // so, and it must survive future edits to this file.
    const withParams = ACP_AGENT_CATALOG.filter((entry) => entry.params);
    expect(withParams.map((entry) => entry.id)).toEqual(["factory-droid"]);
    expect(withParams[0].params).toEqual({ supportsMcpServers: false });

    // A few entries need environment to behave correctly at all (auto-update off, ACP mode on).
    expect(ACP_AGENT_CATALOG.filter((entry) => entry.env).map((e) => e.id)).toEqual([
      "auggie",
      "factory-droid",
      "gjc",
      "vtcode",
    ]);
  });

  it("covers the agents a user is most likely to have installed", () => {
    for (const id of ["cursor", "gemini", "qwen-code", "kimi", "kiro", "traecli", "cline", "goose", "grok", "devin", "codewhale", "deepagents"]) {
      expect(acpAgent(id), id).toBeDefined();
    }
    expect(acpAgent("not-an-agent")).toBeUndefined();
  });
});

describe("an id that exists in both tiers", () => {
  it("is resolved to the built-in, because that is the one we have evidence about", () => {
    expect(resolveAgentEntry("cursor", ALL_HARNESSES)).toEqual({ tier: "built-in", id: "cursor" });
    expect(resolveAgentEntry("gemini", ALL_HARNESSES)?.tier).toBe("catalogued");
    expect(resolveAgentEntry("nope", ALL_HARNESSES)).toBeNull();
  });

  it("has a known, finite overlap — a new collision has to be a decision, not an accident", () => {
    // `cursor` is the whole list today: we drive it ourselves, and Paseo drives it as an ACP preset.
    // When this fails, someone added an agent under a name we already ship — which is fine, but the
    // UI must not show it twice.
    expect(overlappingAgentIds(ALL_HARNESSES)).toEqual(["cursor"]);
  });
});

/**
 * One catalogued entry, projected exactly as the daemon projects it for `coder.listCatalog`'s rows.
 *
 * This used to be `probeCatalogAgent(id, options)` from the package — a helper with no caller left once the
 * per-row method was deleted. Re-pointed rather than deleted so that what these tests are *about* (a bridged
 * entry, an `npx` recipe, an unsearchable machine) is still asserted against the same two functions production
 * composes.
 */
function probeCatalogAgent(id: string, options: Parameters<typeof probeRecipe>[1] = {}) {
  const entry = acpAgent(id);
  if (!entry) return undefined;
  return { id, ...probeRecipe(cataloguedRecipe(entry), options) };
}

describe("probing a catalogued agent", () => {
  it("reports an installed agent with the path we resolved", () => {
    const probe = probeCatalogAgent("goose", {
      find: (name) => (name === "goose" ? "/usr/local/bin/goose" : null),
    });
    expect(probe).toEqual({ id: "goose", state: "ready", binaryPath: "/usr/local/bin/goose", via: "path" });
  });

  it("says what to install when an installed-binary agent is missing — the one thing the user needs", () => {
    // `goose` ships as a binary (`goose`), unlike the npx-fetched entries — the two produce different
    // reasons on purpose, and this is the binary case.
    const probe = probeCatalogAgent("goose", { find: () => null })!;
    expect(probe.state).toBe("not-installed");
    expect(probe.reason).toContain("not installed");
    expect(probe.reason).toContain("goose");
    // **The two things a user acts on, both present.** The entry's own install link, and the exact
    // command the row would run — so somebody who installed it somewhere we did not look can see why.
    expect(probe.fix?.[0]?.url).toBe(acpAgent("goose")!.installLink);
    expect(probe.fix?.[0]?.command).toContain("goose acp");
    expect(probe.reason).toContain("goose acp");
  });

  it("measures an npx recipe by the only thing it can: whether `npx` is here", () => {
    // **The cost, stated as behaviour.** An `npx -y …` recipe is fetched on first run, so the row must
    // not claim the agent is installed: what this probe can establish is that `npx` exists, and the
    // separate fact that no install is needed is carried by the entry (`cataloguedInstall`), not by a
    // probe that would have had to download the package to learn it.
    const probe = probeCatalogAgent("cline", { find: (name) => (name === "npx" ? "/usr/bin/npx" : null) })!;
    expect(probe.state).toBe("ready");
    expect(probe.binaryPath).toBe("/usr/bin/npx");

    const noNpx = probeCatalogAgent("cline", { find: () => null })!;
    expect(noNpx.state).toBe("not-installed");
    expect(noNpx.reason).toContain("npx");
    expect(noNpx.reason).toContain("needs no install");
  });

  it("reports `needs-bridge` for an entry that declares the vendor binary its adapter drives", () => {
    // **The state no catalogued row could reach.** `agentBinaries` had recorded both halves of "installed"
    // for the nine shipped agents since the "why all of them shown 'Not Installed'" bug, and the catalogue
    // had nowhere to say it — so a machine with Amp installed and `amp-acp` missing was told the *agent*
    // was not installed. `wrappedAgent` is that field, and `amp-acp` is the one entry with evidence for it.
    const probe = probeCatalogAgent("amp-acp", {
      find: (name) => (name === "amp" ? "/opt/homebrew/bin/amp" : null),
      fileExists: () => false,
    })!;
    expect(probe.state).toBe("needs-bridge");
    expect(probe.agentBinaryPath).toBe("/opt/homebrew/bin/amp");
    // What we drive was *not* found, so no path claims it was — the same rule the shipped entries follow.
    expect(probe.binaryPath).toBeUndefined();
    // The fix is the **adapter** alone: the vendor's program is already there, and offering to install it
    // again is the wrong sentence this state exists to avoid.
    expect(probe.fix?.map((step) => step.command)).toEqual(["npm install -g amp-acp"]);
    expect(probe.reason).toMatch(/is installed at \/opt\/homebrew\/bin\/amp/);
    expect(probe.reason).toMatch(/adapter/);
    // And the word that was wrong never appears **about the agent**. The sentence does contain "not
    // installed", and it must: it is the *adapter* that is missing. The assertion is precise for that
    // reason — the bug was "Amp is not installed", not the phrase itself.
    expect(probe.reason).not.toMatch(/Amp is not installed/);
    expect(probe.reason).toMatch(/the Agent Client Protocol adapter/);

    // Both halves missing is still `not-installed`, with **both** steps in the order they must be run —
    // the agent first, then the adapter over it. A state that named one would land the user at the other.
    const neither = probeCatalogAgent("amp-acp", { find: () => null, fileExists: () => false })!;
    expect(neither.state).toBe("not-installed");
    expect(neither.fix?.map((step) => step.command)).toEqual([
      "install Amp — its own program, which `amp-acp` drives",
      "npm install -g amp-acp",
    ]);
    // The two halves have two different links, and swapping them is the class of wrong sentence the
    // single-hint version produced: the adapter's page is the entry's own, the vendor's is its own.
    expect(neither.fix?.[0]?.url).toBe("https://ampcode.com/");
    expect(neither.fix?.[1]?.url).toBe(acpAgent("amp-acp")!.installLink);
  });

  it("declares a wrapped agent exactly once, and never by assumption", () => {
    // The count is the claim. Every entry here came from the reference product's catalogue, which carries
    // **no** vendor-binary field at all (`AcpProviderCatalogEntry` has `command`, `env`, `params`), so this
    // cannot be populated by porting — it needs evidence, and a wrong `agentBinaries` turns "the program is
    // missing" into "your agent is installed and something else is wrong", which is a worse sentence and
    // unfalsifiable from the row. So the expectation is a list, not a `> 0`.
    const wrapped = ACP_AGENT_CATALOG.filter((entry) => entry.wrappedAgent !== undefined);
    expect(wrapped.map((entry) => entry.id)).toEqual(["amp-acp"]);
    // And every one that declares it produces **both** halves the prober needs: something to look for, and
    // the adapter's install step. Without the step, `needs-bridge` would carry no fix — which
    // `HarnessAvailabilitySchema` refuses, so the failure would be a schema error rather than a test.
    for (const entry of ACP_AGENT_CATALOG) {
      const recipe = cataloguedRecipe(entry);
      if (entry.wrappedAgent === undefined) {
        expect(recipe.agentBinaries, `${entry.id} must not invent a vendor program`).toBeUndefined();
        expect(recipe.install?.bridge, `${entry.id} must not invent an adapter step`).toBeUndefined();
        continue;
      }
      expect(recipe.agentBinaries, `${entry.id} agentBinaries`).toEqual([...entry.wrappedAgent.binaries]);
      expect(recipe.install?.bridge?.hint, `${entry.id} bridge hint`).toBe(
        entry.wrappedAgent.adapterInstall,
      );
      expect(recipe.install?.url, `${entry.id} vendor link`).toBe(entry.wrappedAgent.installLink);
    }
  });

  it("answers `undefined` for an id it does not know, rather than inventing a state for one", () => {    // The old shape answered `available: false` with a reason, which read exactly like "we looked for a
    // program and it is not here". An id nobody catalogued is a bad *parameter*, and the daemon refuses
    // it by name; there is no program to have an opinion about.
    expect(probeCatalogAgent("does-not-exist", { find: () => "/usr/bin/anything" })).toBeUndefined();
  });

  it("never reports a program as ready on the strength of a search that never happened", () => {
    // The one rule the fifth state exists for, over the catalogue's own entries: no search path means
    // `unknown`, and `unknown` must not be "not installed" either.
    const probe = probeCatalogAgent("goose", { find: () => null, searchable: false })!;
    expect(probe.state).toBe("unknown");
    expect(probe.fix).toBeUndefined();
  });
});

describe("what an entry states about the dialect it speaks", () => {
  it("states one, per entry, so a new entry cannot be added without deciding", () => {
    // **Why this is data and not a default.** A recipe says how to start a program and nothing about how
    // to talk to it; `coder.addProvider` requires this field from a user for the same reason. Making it
    // required on the entry is what turns "somebody added a one-shot CLI to the ACP list" into a compile
    // error — and a `"cli"` entry is then honestly `unsupported` rather than offered as ready.
    for (const entry of ACP_AGENT_CATALOG) {
      expect(["acp", "cli"], `${entry.id} transport`).toContain(entry.transport);
    }
    expect(ACP_AGENT_CATALOG.filter((entry) => entry.transport === "acp")).toHaveLength(38);
  });

  it("states **nothing** about the two dialect facts guessing gets silently wrong", () => {
    // `modeParam` and `authMethodId` are the pair that produces *silent* wrongness: a peer that does not
    // recognise the field name it was sent ignores it and reports success. No entry has evidence for
    // either, so neither may appear on the wire an entry produces — this is the test that fails the day
    // somebody "helpfully" defaults one.
    for (const entry of ACP_AGENT_CATALOG) {
      const input: Record<string, unknown> = { ...cataloguedProviderInput(entry) };
      expect(Object.keys(input), `${entry.id} input keys`).toEqual([
        "id",
        "label",
        "command",
        "args",
        "env",
        "transport",
        // Not a recipe fact and not a value: the **reference** that lets the daemon resolve the entry's own
        // environment constants without a value crossing this boundary. It is listed here so that a field
        // added to this projection has to be a deliberate decision rather than a drift.
        "catalogEntryId",
      ]);
      expect(input.modeParam, `${entry.id} must not invent a modeParam`).toBeUndefined();
      expect(input.authMethodId, `${entry.id} must not invent an authMethodId`).toBeUndefined();
      expect(entry).not.toHaveProperty("modeParam");
      expect(entry).not.toHaveProperty("authMethodId");
    }
  });

  it("carries the command, the args and the environment **names**, and no value", () => {
    const goose = acpAgent("goose")!;
    expect(cataloguedProviderInput(goose)).toEqual({
      id: "goose",
      label: "goose",
      command: "goose",
      args: ["acp"],
      env: [],
      transport: "acp",
      catalogEntryId: "goose",
    });

    // The four entries whose recipe sets a variable: what crosses is the **name**, plus the reference to
    // the entry. There is no field in `AgentProviderConfig` for a value, which is the security decision
    // that shape states — and the reference is what makes the value unnecessary rather than merely
    // forbidden.
    expect(cataloguedEnvNames(acpAgent("vtcode")!)).toEqual(["VT_ACP_ENABLED", "VT_ACP_ZED_ENABLED"]);
    const vtcode = cataloguedProviderInput(acpAgent("vtcode")!);
    expect(vtcode.env).toEqual(["VT_ACP_ENABLED", "VT_ACP_ZED_ENABLED"]);
    expect(vtcode.catalogEntryId).toBe("vtcode");
    expect(JSON.stringify(vtcode)).not.toContain(":1");
    expect(JSON.stringify(vtcode)).not.toContain("\"1\"");

    // The other half of the same rule, one layer out: the **row** does carry the constants, because the
    // recipe is our own git-tracked data and a row has to be able to say which variables it supplies.
    // `cataloguedEnvValues` is that projection, and it is a different function on purpose — no caller has
    // to read `.env` keys itself, and the two lists cannot drift.
    expect(cataloguedEnvValues(acpAgent("vtcode")!)).toEqual([
      { name: "VT_ACP_ENABLED", value: "1" },
      { name: "VT_ACP_ZED_ENABLED", value: "1" },
    ]);
    expect(cataloguedEnvValues(acpAgent("goose")!)).toEqual([]);
  });

  it("refuses a recipe constant under a credential-looking name, loudly", () => {
    // **The rule that makes "our own reviewed data may carry a value" defensible.** A constant of a command
    // line anybody can read is not a secret; `ANTHROPIC_API_KEY` names a slot whose whole purpose is to
    // hold one, and a value there would be a real key in a git-tracked catalogue. This asserts the refusal
    // is a *failure* rather than a silent drop: an entry quietly losing its variable would be a row lying
    // about its own recipe.
    for (const name of [
      "ANTHROPIC_API_KEY",
      "GITHUB_TOKEN",
      "AWS_SECRET_ACCESS_KEY",
      "DB_PASSWD",
      "MY_CREDENTIAL",
      "OPENAI_APIKEY",
      "AUTH_TOKEN",
    ]) {
      expect(looksLikeCredentialEnvName(name), `${name} must look like a credential`).toBe(true);
      expect(
        CatalogEnvConstantSchema.safeParse({ name, value: "sk-live-1f4c9ab7" }).success,
        `${name} must be refused with a value`,
      ).toBe(false);
    }
    // …and the six constants of the four catalogued recipes, plus ordinary flags, must **not** trip it:
    // a rule that refuses the data it exists to permit is a rule that gets switched off.
    for (const name of [
      "AUGMENT_DISABLE_AUTO_UPDATE",
      "DROID_DISABLE_AUTO_UPDATE",
      "FACTORY_DROID_AUTO_UPDATE_ENABLED",
      "GJC_ACP_PERMISSION_MODE",
      "VT_ACP_ENABLED",
      "VT_ACP_ZED_ENABLED",
      "NODE_ENV",
      "LOG_LEVEL",
      "MONKEY",
      "TURKEY",
      "AUTHOR",
    ]) {
      expect(looksLikeCredentialEnvName(name), `${name} must be allowed`).toBe(false);
    }
    // And every entry we actually ship passes, which is the guard on the 38 rather than on a fixture.
    for (const entry of ACP_AGENT_CATALOG) {
      for (const [name, value] of Object.entries(entry.env ?? {})) {
        expect(
          CatalogEnvConstantSchema.safeParse({ name, value }).success,
          `${entry.id}.${name} must pass the recipe-constant rule`,
        ).toBe(true);
      }
    }
  });

  it("tells the two ways of obtaining an agent apart, because they need different sentences", () => {
    // 14 recipes are fetched on first run and need **no install at all**; the other 24 want a program
    // that is simply not on the machine. A screen that blurred the two would send a user to a download
    // page for something that installs itself.
    expect(cataloguedInstall(acpAgent("cline")!)).toEqual({ kind: "npx", package: "cline@3.0.46" });
    expect(cataloguedInstall(acpAgent("qwen-code")!)).toEqual({
      kind: "npx",
      package: "@qwen-code/qwen-code@0.20.1",
    });
    expect(cataloguedInstall(acpAgent("goose")!)).toEqual({ kind: "binary", binary: "goose" });

    expect(ACP_AGENT_CATALOG.filter((entry) => cataloguedInstall(entry).kind === "npx")).toHaveLength(14);
    expect(ACP_AGENT_CATALOG.filter((entry) => cataloguedInstall(entry).kind === "binary")).toHaveLength(24);
    // Every npx entry names the package the first run would fetch — never an empty string.
    for (const entry of ACP_AGENT_CATALOG) {
      const install = cataloguedInstall(entry);
      if (install.kind === "npx") expect(install.package, `${entry.id} package`).not.toBe("");
    }
  });

  it("probes the program, not the package: an npx recipe looks for `npx`", () => {
    // A probe that looked for `cline` on PATH would report **every** fetched recipe as missing, on every
    // machine — the mistake that would make this list useless.
    const recipe = cataloguedRecipe(acpAgent("cline")!);
    expect(recipe.binaries).toEqual(["npx"]);
    expect(recipe.transport).toBe("acp");
    expect(recipe.commandLine).toBe(cataloguedCommandLine(acpAgent("cline")!));
    expect(recipe.install?.url).toBe("https://nodejs.org/en/download");
    expect(recipe.install?.hint).toContain("needs no install");
    // And a binary entry points at its own page, with its own command in the sentence.
    const goose = cataloguedRecipe(acpAgent("goose")!);
    expect(goose.binaries).toEqual(["goose"]);
    expect(goose.install?.url).toBe(acpAgent("goose")!.installLink);
  });
});
