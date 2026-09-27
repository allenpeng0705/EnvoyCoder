/**
 * Team labels stay distinct when the same name is requested twice.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createTeam, uniqueTeamLabel } from "../src/daemon/teams.js";

const leftovers: string[] = [];

afterEach(async () => {
  await Promise.all(leftovers.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});

describe("uniqueTeamLabel", () => {
  it("keeps the first name free, then suffixes 2, 3, …", () => {
    expect(uniqueTeamLabel("Desk team", [])).toBe("Desk team");
    expect(uniqueTeamLabel("Desk team", ["Desk team"])).toBe("Desk team 2");
    expect(uniqueTeamLabel("Desk team", ["Desk team", "Desk team 2"])).toBe("Desk team 3");
    expect(uniqueTeamLabel("  Desk team  ", ["desk team"])).toBe("Desk team 2");
  });
});

describe("createTeam label uniqueness", () => {
  it("renumbers when the requested label is already on this machine", async () => {
    const dir = await mkdtemp(join(tmpdir(), "envoydev-team-label-"));
    leftovers.push(dir);
    const teamsFile = join(dir, "teams.json");
    const first = await createTeam(teamsFile, {
      label: "Desk team",
      originWs: "ws://127.0.0.1:9",
    });
    const second = await createTeam(teamsFile, {
      label: "Desk team",
      originWs: "ws://127.0.0.1:9",
    });
    expect(first.team.label).toBe("Desk team");
    expect(second.team.label).toBe("Desk team 2");
  });
});

describe("listTeams dedupes stored duplicates", () => {
  it("renames later teams that share a label", async () => {
    const dir = await mkdtemp(join(tmpdir(), "envoydev-team-dedupe-"));
    leftovers.push(dir);
    const teamsFile = join(dir, "teams.json");
    // Bypass createTeam uniquify by writing a colliding file directly, then list.
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      teamsFile,
      JSON.stringify({
        version: 1,
        teams: {
          a: {
            id: "a",
            label: "Desk team",
            token: "t1",
            tokenHash: "h1",
            tokenExpiresAt: "2099-01-01T00:00:00.000Z",
            tokenGeneration: 1,
            roleCatalog: [{ id: "orchestrate", writer: false }, { id: "developer", writer: true }],
            members: [
              {
                id: "local",
                label: "desk",
                rolesOffered: ["orchestrate", "developer"],
                joinedAt: "2026-01-01T00:00:00.000Z",
                connection: { status: "online", transport: "local" },
                acceptPolicy: { mode: "manual" },
              },
            ],
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            lastActivityAt: "2026-01-01T00:00:00.000Z",
            idleTtlHours: 168,
          },
          b: {
            id: "b",
            label: "Desk team",
            token: "t2",
            tokenHash: "h2",
            tokenExpiresAt: "2099-01-01T00:00:00.000Z",
            tokenGeneration: 1,
            roleCatalog: [{ id: "orchestrate", writer: false }, { id: "developer", writer: true }],
            members: [
              {
                id: "local",
                label: "desk",
                rolesOffered: ["orchestrate", "developer"],
                joinedAt: "2026-01-02T00:00:00.000Z",
                connection: { status: "online", transport: "local" },
                acceptPolicy: { mode: "manual" },
              },
            ],
            createdAt: "2026-01-02T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z",
            lastActivityAt: "2026-01-02T00:00:00.000Z",
            idleTtlHours: 168,
          },
        },
      }),
      "utf8",
    );
    const { listTeams } = await import("../src/daemon/teams.js");
    const listed = await listTeams(teamsFile);
    const labels = listed.map((t) => t.label).sort();
    expect(labels).toEqual(["Desk team", "Desk team 2"]);
  });
});
