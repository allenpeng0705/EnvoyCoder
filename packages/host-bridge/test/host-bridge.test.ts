/**
 * The EnvoyMesh bridge: paths, pairing refusal, and the attach contract.
 *
 * The attach is tested with injected resolvers rather than a live node: what matters here is the
 * *decisions* — never attach to an unverified endpoint, never accept an owner-scoped token, refuse
 * another app's pairing code in the family's words — and those are decidable without a mesh.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ENVOYCODER_ERRORS, ENVOYCODER_PRODUCT_NAME } from "@envoycoder/protocol";
import { attachToMeshNode, coderPaths, checkPairingCode } from "../src/index.js";

const NODE_WS = "ws://127.0.0.1:3030/ws";

describe("product state on disk", () => {
  it("keeps this product's state inside the shared home, under its own name", () => {
    const paths = coderPaths("/home/dev/.envoymesh");
    expect(paths.stateDir).toBe("/home/dev/.envoymesh/EnvoyCoder");
    for (const file of [paths.projectsFile, paths.workspacesFile, paths.settingsFile]) {
      expect(file.startsWith(paths.stateDir)).toBe(true);
    }
    // Another product's state must not be reachable through these paths.
    expect(JSON.stringify(paths)).not.toMatch(/EnvoyMesh\/|profile\//);
  });

  it("does not claim that a file mode protects a secret on Windows", () => {
    // This is a documented platform fact, not a nitpick: `chmod`-style guarantees do not exist
    // there, so the protection has to be the issued session rather than the file mode.
    const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
    expect(source).toMatch(/file modes are advisory/i);
  });
});

describe("pairing", () => {
  const built = (app: string): string =>
    `envoy://pair?wsUrl=${encodeURIComponent(NODE_WS)}&token=t0ken&ownerPublicKey=KEY&ownerId=envoy%3Aowner%3Aabc&app=${app}`;

  it("accepts this app's code and returns what a client needs", () => {
    const result = checkPairingCode(built(ENVOYCODER_PRODUCT_NAME));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.wsUrl).toBe(NODE_WS);
    expect(result.token).toBe("t0ken");
    expect(result.ownerId).toBe("envoy:owner:abc");
  });

  it("refuses another family member's code, in the family's own sentence", () => {
    const result = checkPairingCode(built("EnvoyMesh"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe(ENVOYCODER_ERRORS.appMismatch);
    // Shared wording matters: every app refuses in the same words, so a user is never told
    // something different by each app they try.
    expect(result.message).toMatch(/made by EnvoyMesh/);
    expect(result.message).toMatch(/this is EnvoyCoder/);
  });

  it("treats a code with no app claim as usable (older codes) and garbage as unreadable", () => {
    const legacy = `envoy://pair?wsUrl=${encodeURIComponent(NODE_WS)}&token=t&ownerPublicKey=K&ownerId=o`;
    expect(checkPairingCode(legacy).ok).toBe(true);
    expect(checkPairingCode("not a uri").ok).toBe(false);
  });
});

describe("attaching to the mesh", () => {
  it("does not attach when no node is running, and says so in plain language", async () => {
    const outcome = await attachToMeshNode("/home/dev/.envoymesh", {
      resolveNode: async () => ({ status: "none" }),
    });
    expect(outcome.kind).toBe("no-node");
    if (outcome.kind !== "no-node") return;
    expect(outcome.reason).toMatch(/not running/);
    expect(outcome.reason).toMatch(/works on its own/);
  });

  it("refuses an endpoint that merely answers on the port", async () => {
    // "Something answers" is not "the node for this profile": the attach hands out a credential,
    // so an unverified endpoint must not receive one.
    const outcome = await attachToMeshNode("/home/dev/.envoymesh", {
      resolveNode: async () => ({ status: "unverified", reason: "answered with a different owner" }),
    });
    expect(outcome.kind).toBe("no-node");
    if (outcome.kind !== "no-node") return;
    expect(outcome.reason).toMatch(/did not identify itself/);
  });

  it("attaches with the endpoint the node published, and a product-scoped session", async () => {
    let asked: { port: number; path?: string } | undefined;
    const outcome = await attachToMeshNode("/home/dev/.envoymesh", {
      resolveNode: async () => ({ status: "running", wsUrl: NODE_WS }),
      requestSession: async (input) => {
        asked = input;
        return {
          token: "product-token",
          scopeKey: "product:EnvoyCoder",
          ownerId: "envoy:owner:abc",
          wsUrl: `${NODE_WS}?token=product-token`,
        };
      },
    });
    expect(asked).toEqual({ port: 3030, path: "/ws" });
    expect(outcome.kind).toBe("attached");
    if (outcome.kind !== "attached") return;
    expect(outcome.scopeKey).toBe("product:EnvoyCoder");
  });

  it("refuses an owner-scoped token rather than holding the owner's authority", async () => {
    const outcome = await attachToMeshNode("/home/dev/.envoymesh", {
      resolveNode: async () => ({ status: "running", wsUrl: NODE_WS }),
      requestSession: async () => ({
        token: "owner-token",
        scopeKey: "owner",
        ownerId: "envoy:owner:abc",
        wsUrl: `${NODE_WS}?token=owner-token`,
      }),
    });
    expect(outcome.kind).toBe("refused");
    if (outcome.kind !== "refused") return;
    expect(outcome.reason).toMatch(/Refusing to use an owner-scoped token/);
  });

  it("turns a node's refusal into something a user can act on", async () => {
    const outcome = await attachToMeshNode("/home/dev/.envoymesh", {
      resolveNode: async () => ({ status: "running", wsUrl: NODE_WS }),
      requestSession: async () => {
        throw new Error("UNAUTHORIZED: only the owner may grant a product session");
      },
    });
    expect(outcome.kind).toBe("refused");
    if (outcome.kind !== "refused") return;
    expect(outcome.reason).toMatch(/Settings → apps/);
  });

  it("rejects a product name the mesh would not accept", async () => {
    const outcome = await attachToMeshNode("/home/dev/.envoymesh", { product: "not a name!" });
    expect(outcome.kind).toBe("refused");
  });
});
