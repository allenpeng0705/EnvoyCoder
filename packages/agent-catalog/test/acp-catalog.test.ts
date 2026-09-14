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
  overlappingAgentIds,
  probeAcpAgent,
  resolveAgentEntry,
  ALL_HARNESSES,
} from "../src/index.js";

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

describe("probing a catalogued agent", () => {
  it("reports an installed agent with the path we resolved", () => {
    const probe = probeAcpAgent("goose", { find: (name) => (name === "goose" ? "/usr/local/bin/goose" : null) });
    expect(probe).toEqual({ id: "goose", available: true, binaryPath: "/usr/local/bin/goose", via: "path" });
  });

  it("says what to install when an installed-binary agent is missing — the one thing the user needs", () => {
    // `goose` ships as a binary (`goose`), unlike the npx-fetched entries — the two produce different
    // reasons on purpose, and this is the binary case.
    const probe = probeAcpAgent("goose", { find: () => null });
    expect(probe.available).toBe(false);
    expect(probe.reason).toContain("not installed");
    expect(probe.reason).toContain("goose");
    expect(probe.reason).toContain(acpAgent("goose")!.installLink);
    // The reason also names the exact command, so a user who installed it elsewhere can see why we
    // did not find it.
    expect(probe.reason).toContain("goose acp");
  });

  it("marks a fetched agent as `npx`, not as installed", () => {
    // Honest reporting: `npx` fetches on first run, which is a different experience from running a
    // binary the user already has — and on a machine with no network it is not equivalent at all.
    const probe = probeAcpAgent("cline", { find: (name) => (name === "npx" ? "/usr/bin/npx" : null) });
    expect(probe.available).toBe(true);
    expect(probe.via).toBe("npx");

    const noNpx = probeAcpAgent("cline", { find: () => null });
    expect(noNpx.available).toBe(false);
    expect(noNpx.reason).toContain("npx");
    expect(noNpx.reason).toContain(acpAgent("cline")!.installLink);
  });

  it("refuses to guess about an id it does not know", () => {
    const probe = probeAcpAgent("does-not-exist", { find: () => "/usr/bin/anything" });
    expect(probe.available).toBe(false);
    expect(probe.reason).toContain("does-not-exist");
  });
});
