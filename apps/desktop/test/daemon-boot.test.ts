/**
 * What the daemon decides at boot, and the exit codes it must not improvise.
 *
 * These are the rules, separated from the socket so they can be asserted without booting one. Two
 * properties matter more than the wording:
 *
 *   * a **damaged** profile stops the process and changes nothing — the family's rule, because writing
 *     into a half-readable profile is how a user loses contacts and bonds without being told;
 *   * the two reserved exit codes stay reserved. `2` belongs to the family's supervisor handshake and
 *     `1` to unclassified failures, so no decision here may return either by accident.
 */

import { describe, expect, it } from "vitest";

import type { CoderHomeFacts } from "@envoydev/host-bridge";
import {
  EXIT_DAMAGED_HOME,
  EXIT_OK,
  decideBoot,
  serveFailureOutcome,
} from "../src/daemon/boot.js";

function facts(over: Partial<CoderHomeFacts> = {}): CoderHomeFacts {
  return {
    home: "/home/owner/.envoymesh",
    profileDir: "/home/owner/.envoymesh/profile",
    state: "found",
    headline: "A profile for Ada was found on this computer.",
    detail: "It was created today.",
    facts: ["Owner: Ada"],
    choices: ["use", "quit"],
    canCreate: false,
    ...over,
  };
}

describe("what the daemon does about the shared home", () => {
  it("serves when the profile is healthy, and repeats the family's words", () => {
    const decision = decideBoot(facts());
    expect(decision.serve).toBe(true);
    if (!decision.serve) throw new Error("unreachable");
    expect(decision.notes[0]).toBe("A profile for Ada was found on this computer.");
  });

  it("serves with no EnvoyMesh profile at all, because our own state does not need one", () => {
    const decision = decideBoot(
      facts({ state: "missing", headline: "No profile was found on this computer." }),
    );
    expect(decision.serve).toBe(true);
    if (!decision.serve) throw new Error("unreachable");
    expect(decision.notes.join(" ")).toContain("no EnvoyMesh profile on this machine yet");
  });

  it("serves when another family app owns the identity, and says which one", () => {
    const decision = decideBoot(
      facts({
        state: "in-use",
        headline: "EnvoyMesh is already using this profile.",
        holder: { app: "EnvoyMesh", pid: 42, port: 3030, verified: true },
      }),
    );
    expect(decision.serve).toBe(true);
    if (!decision.serve) throw new Error("unreachable");
    const notes = decision.notes.join(" ");
    expect(notes).toContain("EnvoyMesh owns this machine's mesh identity");
    expect(notes).toContain("attaches to it as a product");
  });

  it("does not tell the user to close an app that has stopped answering", () => {
    // A live claim whose endpoint did not answer is a different situation: the honest message says so,
    // because "close it" is poor advice for a process that may already be shutting down.
    const decision = decideBoot(
      facts({
        state: "in-use",
        holder: { app: "EnvoyMesh", pid: 42, verified: false },
      }),
    );
    expect(decision.serve).toBe(true);
    if (!decision.serve) throw new Error("unreachable");
    expect(decision.notes.join(" ")).toContain("claims (but is not answering on)");
  });

  it("refuses a damaged profile, with the family's code, and promises to change nothing", () => {
    // The fixture mirrors what the family actually says, including its closing promise — the point of
    // this test is that we pass that sentence through instead of restating it in our own words.
    const damaged = facts({
      state: "damaged",
      headline: "A profile here looks incomplete.",
      detail:
        "In “…/profile”, some files are missing (libp2p-private.key). Nothing has been changed.",
    });
    const decision = decideBoot(damaged);
    expect(decision.serve).toBe(false);
    if (decision.serve) throw new Error("unreachable");
    expect(decision.exitCode).toBe(EXIT_DAMAGED_HOME);
    expect(decision.exitCode).toBe(4);
    expect(decision.headline).toBe("A profile here looks incomplete.");
    expect(decision.detail[0]).toBe(damaged.detail);
    expect(decision.detail.join(" ")).toMatch(/restore a backup/);
    expect(
      decision.detail.filter((line) => /nothing (was|has been) changed/i.test(line)),
    ).toHaveLength(1);
  });

  it("never returns an exit code the family reserved", () => {
    // 2 is `exitForNodeSupervisor`'s restart signal and 1 is "unclassified failure": a daemon that
    // returned 2 for a damaged profile would make a supervisor loop on a state no restart can fix.
    const states = ["found", "missing", "damaged", "in-use"] as const;
    for (const state of states) {
      const decision = decideBoot(facts({ state, holder: { app: "EnvoyMesh", pid: 1 } }));
      if (!decision.serve) expect(decision.exitCode).not.toBe(2);
    }
  });
});

describe("what a failed bind means", () => {
  it("treats an occupied port as a client that has not noticed yet, not as a failure", () => {
    const error = Object.assign(new Error("listen EADDRINUSE: address already in use 127.0.0.1:4770"), {
      code: "EADDRINUSE",
    });
    const outcome = serveFailureOutcome(4770, error);
    expect(outcome.exitCode).toBe(EXIT_OK);
    expect(outcome.headline).toContain("already running");
    expect(outcome.detail.join(" ")).toContain("attach");
  });

  it("recognises it from the message too, because not every failure arrives with a code", () => {
    const outcome = serveFailureOutcome(4770, new Error("bind failed: address already in use"));
    expect(outcome.exitCode).toBe(EXIT_OK);
  });

  it("reports a real failure as one, and names the way out", () => {
    const outcome = serveFailureOutcome(4770, new Error("permission denied"));
    expect(outcome.exitCode).toBe(1);
    expect(outcome.detail.join(" ")).toContain("ENVOYDEV_DAEMON_PORT");
  });
});
