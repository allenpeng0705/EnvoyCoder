/**
 * Team default labels — project name + number; host as Orchestrator · project.
 */

import { describe, expect, it } from "vitest";

import {
  defaultTeamBase,
  hostMemberLabel,
  uniqueTeamLabel,
} from "../src/state/team-defaults.js";

describe("team-defaults", () => {
  it("uses the project name, then suffixes 2, 3, …", () => {
    expect(defaultTeamBase("api")).toBe("api");
    expect(defaultTeamBase("  ")).toBe("Team");
    expect(uniqueTeamLabel("api", [])).toBe("api");
    expect(uniqueTeamLabel("api", ["api"])).toBe("api 2");
    expect(uniqueTeamLabel("api", ["api", "api 2"])).toBe("api 3");
  });

  it("names the host machine Orchestrator · project", () => {
    expect(hostMemberLabel("Orchestrator", "api")).toBe("Orchestrator · api");
    expect(hostMemberLabel("Orchestrator", undefined)).toBe("Orchestrator");
    expect(hostMemberLabel("编排器", "EnvoyCoder")).toBe("编排器 · EnvoyCoder");
  });
});
