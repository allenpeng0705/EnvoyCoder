/**
 * The EnvoyMesh bridge: paths, pairing refusal, and the attach contract.
 *
 * The attach is tested with injected resolvers rather than a live node: what matters here is the
 * *decisions* — never attach to an unverified endpoint, never accept an owner-scoped token, refuse
 * another app's pairing code in the family's words — and those are decidable without a mesh.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CAPABILITY_CODING,
  ENVOYCODER_ERRORS,
  ENVOYCODER_PRODUCT_NAME,
  coderProductName,
} from "@envoycoder/protocol";
import {
  attachToMeshNode,
  checkPairingCode,
  coderPaths,
  coderSessionIdentity,
  createCoderDaemonHost,
  createCoderDispatcher,
} from "../src/index.js";

const NODE_WS = "ws://127.0.0.1:3030/ws";

describe("the capability this product exists to use", () => {
  it("is a name the owner grants, not something the product assumes", () => {
    expect(CAPABILITY_CODING).toBe("coding");
  });
});

describe("product state on disk", () => {
  it("keeps this product's state inside the shared home, under its own name", () => {
    const paths = coderPaths("/home/dev/.envoymesh");
    expect(paths.stateDir).toBe("/home/dev/.envoymesh/EnvoyCoder");
    for (const file of [paths.projectsFile, paths.tasksFile, paths.settingsFile]) {
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

describe("guide alignment (§4.4, §4.5, §4.6, §9)", () => {
  it("resolves the shared home the family's way, so ENVOYMESH_HOME is honoured", () => {
    // The bug this prevents: `os.homedir()` would ignore ENVOYMESH_HOME and the per-OS default,
    // giving a user who set the variable a second home — and a second set of projects.
    const previous = process.env.ENVOYMESH_HOME;
    process.env.ENVOYMESH_HOME = "/tmp/envoycoder-guide-check";
    try {
      const paths = coderPaths();
      expect(paths.home).toBe("/tmp/envoycoder-guide-check");
      expect(paths.stateDir).toBe("/tmp/envoycoder-guide-check/EnvoyCoder");
    } finally {
      if (previous === undefined) delete process.env.ENVOYMESH_HOME;
      else process.env.ENVOYMESH_HOME = previous;
    }
  });

  it("takes the endpoint from the node's descriptor, and the fallback from its URL", async () => {
    // §4.5 uses `running.endpoint.{port,path}`; the URL parse exists only for a node whose
    // descriptor is incomplete. Both must land on the same attach call.
    const seen: { port: number; path?: string }[] = [];
    const requestSession = async (input: { port: number; path?: string }) => {
      seen.push(input);
      return {
        token: "t",
        scopeKey: "product:EnvoyCoder",
        ownerId: "o",
        wsUrl: "ws://127.0.0.1:9/ws?token=t",
      };
    };
    await attachToMeshNode("/home/dev/.envoymesh", {
      resolveNode: async () => ({
        status: "running",
        wsUrl: "ws://127.0.0.1:3030/ws",
        endpoint: { pid: 1, app: "EnvoyMesh", version: "0.5.0", startedAt: "", port: 4040, path: "/ws", token: "" },
      }),
      requestSession,
    });
    await attachToMeshNode("/home/dev/.envoymesh", {
      resolveNode: async () => ({ status: "running", wsUrl: "ws://127.0.0.1:3030/ws" }),
      requestSession,
    });
    expect(seen).toEqual([
      { port: 4040, path: "/ws" },
      { port: 3030, path: "/ws" },
    ]);
  });

  it("names the product from the environment, falling back to our own name", () => {
    // §9: `ENVOYMESH_APP_NAME=EnvoyCoder`. The fallback must be *our* name, because
    // `resolveAppName()` answers "EnvoyMesh" when the variable is unset — the one wrong answer.
    expect(coderProductName({})).toBe("EnvoyCoder");
    expect(coderProductName({ ENVOYMESH_APP_NAME: "EnvoyCoder" })).toBe("EnvoyCoder");
    expect(coderProductName({ ENVOYMESH_APP_NAME: "  " })).toBe("EnvoyCoder");
  });

  it("passes the shared relay roster through a pairing code unchanged (§9)", () => {
    const host = createCoderDaemonHost({
      port: 0,
      // The real resolver, not a stub: a host whose identity port is a bare `() => undefined` is
      // the mistake `coderSessionIdentity` exists to prevent, and the type error this test used to
      // carry went unnoticed only because `packages/*/test` was in no tsconfig.
      sessionIdentity: coderSessionIdentity(),
      dispatch: async () => undefined,
    });
    try {
      const uri = host.pairingUri({
        token: "t",
        ownerPublicKey: "KEY",
        ownerId: "envoy:owner:abc",
        host: "10.0.0.5",
        lanHost: "192.168.1.20",
        relayPeerId: "12D3KooWrelay",
        relayWsUrls: ["wss://relay.example/ws"],
      });
      // The roster is the family's; a product that rewrote it would be a second network wearing
      // the first one's name.
      expect(uri).toContain("relayPeerId=12D3KooWrelay");
      expect(uri).toContain(encodeURIComponent("wss://relay.example/ws"));
      expect(uri).toContain("app=EnvoyCoder");
    } finally {
      host.stop();
    }
  });

  it("refuses any method it does not serve, rather than growing an anonymous surface (§4.6)", async () => {
    const dispatch = createCoderDispatcher({ handlers: {} });
    // Positional: (method, params, session) — the family's port signature.
    await expect(dispatch("coder.listProjects", {}, undefined)).rejects.toThrow(
      /not implemented in this build/,
    );
    // An unknown method is refused too: silence would leave a client waiting, and "try anyway" is
    // how a product gains a surface nobody reviewed.
    await expect(dispatch("coder.doAnything", {}, undefined)).rejects.toThrow(/Method not found/);
    // A served method is served, so the refusal above is a decision and not a blanket failure.
    const served = createCoderDispatcher({ handlers: { "coder.hello": () => ({ ok: true }) } });
    await expect(served("coder.hello", {}, undefined)).resolves.toEqual({ ok: true });
  });
});
