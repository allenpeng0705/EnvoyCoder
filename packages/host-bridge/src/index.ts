/**
 * The bridge between EnvoyCoder and the EnvoyMesh family.
 *
 * ## Two directions, and they are not the same relationship
 *
 * **EnvoyCoder is a host to its own clients.** Its daemon serves the app's windows and the mobile
 * app, exactly as Paseo's daemon serves its clients (`docs/envoycoder-paseo-inheritance.md`). That
 * surface is EnvoyCoder's own protocol, on its own port, with its own tokens.
 *
 * **EnvoyCoder is a *client* of the mesh.** When an EnvoyMesh node is running on this machine,
 * EnvoyCoder attaches to it as a **product** and gets a scoped session — `product:EnvoyCoder` —
 * that can only call the methods that node's owner granted. This is the family's model
 * (`docs/envoymesh-multi-product-design.md` D2) and it is deliberately the opposite of a
 * bearer-capability URL: a product session is *issued*, scoped, and revocable, and a QR code is
 * not by itself authority to run anything.
 *
 * The distinction matters for distributed mode: "run this task on my other machine" is a *mesh*
 * operation between two EnvoyCoder daemons, not a hole in the local daemon's auth.
 *
 * ## What this module refuses to own
 *
 * Nothing here re-implements identity, transport, discovery or pairing. Those live in
 * `@envoymesh/{node-core,host-connect,reuse-host,protocol}` and are imported. The family's guide
 * (`docs/envoymesh-new-app-guide.md`) is explicit about why: a product that forked the mesh layer
 * would drift from the family's security fixes — which is the class of bug that turned a
 * "harmless" sibling copy of `@envoymesh/protocol` four modules out of date into a node that
 * could not start.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import {
  type RunningNode,
  type VerifiedRunningNode,
  isProductScope,
  isValidProductName,
  productScopeKey,
  resolveRunningNode,
} from "@envoymesh/node-core";
import {
  type ProductSessionGrant,
  requestProductSession,
} from "@envoymesh/host-connect";
import {
  type ReuseHost,
  type ReuseHostOptions,
  buildPairingUri,
  createReuseHost,
  createShellHostNodeService,
  parsePairingUri,
} from "@envoymesh/reuse-host";
import { pairingAppMismatch } from "@envoymesh/protocol";
import {
  DEFAULT_DAEMON_PATH,
  DEFAULT_DAEMON_PORT,
  ENVOYCODER_ERRORS,
  ENVOYCODER_PRODUCT_NAME,
  type CoderHostDescriptor,
} from "@envoycoder/protocol";

/* ────────────────────────────── product state on disk ───────────────────────────── */

/**
 * EnvoyCoder's state directory, inside the shared home.
 *
 * The family's rule (design §5): a shared home holds **kernel** state that every product reads —
 * identity, trust, node config, the vault index — and each product keeps its own state in
 * `<home>/<product>/`. For EnvoyCoder that means projects, workspaces, run transcripts and
 * per-project settings live in `<home>/EnvoyCoder/` and nowhere else: another product must not be
 * able to read which repositories this user has opened, and EnvoyCoder must not be able to read
 * anyone else's chat transcripts.
 *
 * The home itself is resolved by `@envoymesh/node-core` (`resolveHomeDir`), so
 * `ENVOYMESH_HOME`, the per-OS default and legacy `~/.envoymesh` adoption all behave identically
 * in both apps. This function only appends the product segment.
 */
export interface CoderPaths {
  home: string;
  stateDir: string;
  projectsFile: string;
  workspacesFile: string;
  settingsFile: string;
  runsDir: string;
  transcriptsDir: string;
  logsDir: string;
  /** Pairing/daemon secrets — `0600` on POSIX, and see the platform note below. */
  secretsDir: string;
}

/**
 * Note for Windows, because the family already learned this: file modes are advisory there.
 * `chmod`-style guarantees (`0600`) are a POSIX property; on Windows the file inherits the
 * user's profile ACL instead. Everything that actually protects a secret here is therefore the
 * *session* (a token the node issued) rather than the file permission, and this comment is the
 * reminder not to build a security claim on a mode bit on a platform where it does nothing.
 */
export function coderPaths(home: string = homedir()): CoderPaths {
  const stateDir = join(home, ENVOYCODER_PRODUCT_NAME);
  return {
    home,
    stateDir,
    projectsFile: join(stateDir, "projects.json"),
    workspacesFile: join(stateDir, "workspaces.json"),
    settingsFile: join(stateDir, "settings.json"),
    runsDir: join(stateDir, "runs"),
    transcriptsDir: join(stateDir, "transcripts"),
    logsDir: join(stateDir, "logs"),
    secretsDir: join(stateDir, "secrets"),
  };
}

/* ────────────────────────────── attaching to the mesh ───────────────────────────── */

export type MeshAttachOutcome =
  | {
      kind: "attached";
      /** Ready-to-dial URL with the product token appended. */
      wsUrl: string;
      scopeKey: string;
      ownerId: string;
      /** Never logged; kept only in the daemon's memory. */
      token: string;
      node: VerifiedRunningNode;
    }
  | {
      kind: "no-node";
      /** End-user wording: why there is nothing to attach to. */
      reason: string;
      /** The underlying status, for the audit log. */
      status: "none" | "unverified" | "stale" | "unknown";
    }
  | { kind: "refused"; code: string; reason: string };

export interface MeshAttachDeps {
  /** Defaults to the real `resolveRunningNode` from node-core. */
  resolveNode?: (home: string) => Promise<RunningNode>;
  /**
   * Defaults to the real loopback attach client.
   *
   * The endpoint is derived from the node's own `wsUrl` rather than reassembled from parts: the
   * node publishes the URL it is actually reachable at, and a product that rebuilds it from a port
   * number is one config change away from dialling somewhere the node is not.
   */
  requestSession?: (input: { port: number; path?: string }) => Promise<ProductSessionGrant>;
  product?: string;
  version?: string;
}

/** Split a published `ws://host:port/path` into the parts the attach client takes. */
function endpointFromWsUrl(wsUrl: string): { port: number; path: string } | null {
  try {
    const url = new URL(wsUrl);
    const port = url.port ? Number(url.port) : url.protocol === "wss:" ? 443 : 80;
    if (!Number.isInteger(port) || port <= 0) return null;
    return { port, path: url.pathname && url.pathname !== "/" ? url.pathname : DEFAULT_DAEMON_PATH };
  } catch {
    return null;
  }
}

/**
 * Ask the local EnvoyMesh node for a product session.
 *
 * Refuses rather than degrades: if there is no *verified* node — one whose endpoint answers and
 * whose advertised identity matches the profile on disk — EnvoyCoder does not attach. "Something
 * answers on that port" is not the same question, and the attach call is the one that hands out a
 * credential, so a stale endpoint must not be handed a token.
 */
export async function attachToMeshNode(
  home: string,
  deps: MeshAttachDeps = {},
): Promise<MeshAttachOutcome> {
  const product = deps.product ?? ENVOYCODER_PRODUCT_NAME;
  if (!isValidProductName(product)) {
    return {
      kind: "refused",
      code: ENVOYCODER_ERRORS.meshRefused,
      reason: `"${product}" is not a usable product name for the mesh (letters, digits, dash and underscore).`,
    };
  }

  const resolveNode = deps.resolveNode ?? (async (h: string) => resolveRunningNode(h));
  const node = await resolveNode(home);
  if (node.status !== "running" || !node.wsUrl) {
    return {
      kind: "no-node",
      status: node.status === "none" ? "none" : (node.status as "unverified" | "stale"),
      reason:
        node.status === "none"
          ? "EnvoyMesh is not running on this machine, so there is no mesh to attach to. EnvoyCoder works on its own until it is."
          : `Something is listening where EnvoyMesh's node was expected, but it did not identify itself as the node for this profile${
              node.reason ? ` (${node.reason})` : ""
            }. Not attaching.`,
    };
  }

  const endpoint = endpointFromWsUrl(node.wsUrl);
  if (!endpoint) {
    return {
      kind: "refused",
      code: ENVOYCODER_ERRORS.meshRefused,
      reason: `The node published an endpoint EnvoyCoder cannot read (${node.wsUrl}).`,
    };
  }

  const requestSession =
    deps.requestSession ??
    (async (input: { port: number; path?: string }) =>
      requestProductSession(input, { product, ...(deps.version ? { version: deps.version } : {}) }));

  try {
    const grant = await requestSession(endpoint);
    if (!isProductScope(grant.scopeKey)) {
      // A token that is not product-scoped is the owner's token, and holding one would mean
      // EnvoyCoder could do anything the owner can. Refuse it loudly rather than use it.
      return {
        kind: "refused",
        code: ENVOYCODER_ERRORS.meshRefused,
        reason: `The node issued a "${grant.scopeKey}" session instead of ${productScopeKey(product)}. Refusing to use an owner-scoped token.`,
      };
    }
    return {
      kind: "attached",
      wsUrl: grant.wsUrl,
      scopeKey: grant.scopeKey,
      ownerId: grant.ownerId,
      token: grant.token,
      node: node as VerifiedRunningNode,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      kind: "refused",
      code: ENVOYCODER_ERRORS.meshRefused,
      reason:
        `EnvoyMesh is running, but it did not grant EnvoyCoder a session: ${message}. ` +
        `The node's owner can grant it in EnvoyMesh → Settings → apps.`,
    };
  }
}

/* ────────────────────────────── the daemon host ───────────────────────────── */

export interface CoderDaemonHostOptions extends Omit<ReuseHostOptions, "port"> {
  port?: number;
  path?: string;
}

export interface CoderDaemonHost {
  /** The port actually bound (the OS picks one when `port: 0`). */
  readonly port: number;
  readonly path: string;
  serve(): Promise<void>;
  /** A pairing code for a client, carrying this app's name. */
  pairingUri(input: {
    token: string;
    ownerPublicKey: string;
    ownerId: string;
    /** Reachable `host:port` for the client; LAN IP, tailnet address, or a tunnel. */
    host: string;
    lanHost?: string;
    ssh?: CoderHostDescriptor["ssh"];
    secure?: boolean;
  }): string;
  /** What a client needs to connect, without the secret. */
  descriptor(ssh?: CoderHostDescriptor["ssh"]): CoderHostDescriptor;
  stop(): void;
}

/**
 * EnvoyCoder's own host: a second product serving *its* clients.
 *
 * `createReuseHost` comes from the family's reusable surface and takes exactly two ports — session
 * identity and dispatch — so this does not touch a profile directory, a store or an identity
 * model. Everything that is genuinely EnvoyCoder's (which RPC methods exist, what a token means,
 * where its state lives) arrives through those ports, which is what keeps the family's transport
 * reusable and this product's behaviour auditable.
 */
export function createCoderDaemonHost(
  options: CoderDaemonHostOptions,
  product: string = ENVOYCODER_PRODUCT_NAME,
): CoderDaemonHost {
  const host: ReuseHost = createReuseHost({
    ...options,
    port: options.port ?? DEFAULT_DAEMON_PORT,
    ...(options.path ? { path: options.path } : {}),
  });

  const descriptor = (ssh?: CoderHostDescriptor["ssh"]): CoderHostDescriptor => ({
    endpoint: `127.0.0.1:${host.port}`,
    ownerId: "",
    app: product,
    ...(ssh ? { ssh } : {}),
  });

  return {
    get port() {
      return host.port;
    },
    get path() {
      return host.path;
    },
    async serve() {
      await host.serve(createShellHostNodeService());
    },
    pairingUri(input) {
      const wsUrl = `${input.secure ? "wss" : "ws"}://${input.host}:${host.port}${host.path}`;
      return buildPairingUri({
        wsUrl,
        token: input.token,
        ownerPublicKey: input.ownerPublicKey,
        ownerId: input.ownerId,
        // The `app` claim is the whole reason a code from another family member is refused
        // instead of silently connecting to the wrong daemon.
        app: product,
        ...(input.lanHost ? { lanWsUrl: `ws://${input.lanHost}:${host.port}${host.path}` } : {}),
      });
    },
    descriptor,
    stop() {
      host.stop();
    },
  };
}

/* ────────────────────────────── pairing checks ───────────────────────────── */

export type PairingCheck =
  | { ok: true; wsUrl: string; token: string; ownerId: string; lanWsUrl?: string }
  | { ok: false; code: string; /** End-user wording. */ message: string };

/**
 * Read a pairing code the way a client must: refuse another app's code, with the family's sentence.
 *
 * `pairingAppMismatch` is shared with every other app in the family, so all of them refuse each
 * other's codes in the same words — "That code was made by EnvoyMesh, and this is EnvoyCoder.
 * Open EnvoyMesh and show its pairing code, or install EnvoyMesh here." A per-product variation of
 * that sentence would be a UX bug, which is why it lives in `@envoymesh/protocol` and not here.
 */
export function checkPairingCode(
  input: string,
  product: string = ENVOYCODER_PRODUCT_NAME,
): PairingCheck {
  let parsed: ReturnType<typeof parsePairingUri>;
  try {
    parsed = parsePairingUri(input);
  } catch (error) {
    return {
      ok: false,
      code: ENVOYCODER_ERRORS.daemonUnreachable,
      message: `That does not look like a pairing code: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!parsed) {
    return {
      ok: false,
      code: ENVOYCODER_ERRORS.daemonUnreachable,
      message: "That pairing code is empty or could not be read.",
    };
  }
  const mismatch = pairingAppMismatch(parsed.app, product);
  if (mismatch) return { ok: false, code: ENVOYCODER_ERRORS.appMismatch, message: mismatch };
  return {
    ok: true,
    wsUrl: parsed.wsUrl,
    token: parsed.token,
    ownerId: parsed.ownerId,
    ...(parsed.lanWsUrl ? { lanWsUrl: parsed.lanWsUrl } : {}),
  };
}
