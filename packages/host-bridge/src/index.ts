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

import { join } from "node:path";
import {
  type ProfileChoiceId,
  type ProfileInUse,
  type ProfileSituationState,
  type RunningNode,
  type VerifiedRunningNode,
  describeProfileSituation,
  inspectProfile,
  isProductScope,
  isValidProductName,
  profileDirIn,
  productDirIn,
  productScopeKey,
  resolveHomeDir,
  resolveRunningNode,
} from "@envoymesh/node-core";
// `requestProductSession` comes from `reuse-host`, which is the product-facing surface the guide
// points at (§4.5) — it re-exports the attach client so a product depends on one package.
import {
  type HostNodeService,
  type HostRpcDispatcher,
  type ProductSessionGrant,
  type SessionIdentityResolver,
  type ReuseHost,
  type ReuseHostOptions,
  buildPairingUri,
  createReuseHost,
  createShellHostNodeService,
  parsePairingUri,
  requestProductSession,
} from "@envoymesh/reuse-host";
// `@envoymesh/api/core` — the *reusable* half. The bare `@envoymesh/api` barrel reaches product-bound
// modules, so importing it from a product is the mistake the guide calls out (§4.2) and the wiring
// gate in this repo forbids.
/**
 * The two ports a product needs in order to build its **own** node surface.
 *
 * Re-exported rather than reached for in `@envoymesh/host-connect` directly, for the same reason
 * `createReuseHost` re-exports them: a product should depend on one package for the host contract.
 * They are needed here because EnvoyCoder's daemon publishes events from its own bus and serves a
 * per-connection subscription — see `CODER_EVENTS` in `@envoycoder/protocol` for why the transport's
 * broadcast table is not the mechanism that works.
 */
export type { HostNodeService, SocketMethodPort } from "@envoymesh/reuse-host";

import { ENVOYMESH_VERSION } from "@envoymesh/api/core";
import { pairingAppMismatch } from "@envoymesh/protocol";
import {
  type CoderHostDescriptor,
  DEFAULT_DAEMON_PATH,
  DEFAULT_DAEMON_PORT,
  ENVOYCODER_ERRORS,
  ENVOYCODER_PRODUCT_NAME,
  type RpcMethod,
  coderProductName,
  isRpcMethod,
} from "@envoycoder/protocol";

/* ────────────────────────────── product state on disk ───────────────────────────── */

/**
 * EnvoyCoder's state directory, inside the shared home.
 *
 * The family's rule (design §5): a shared home holds **kernel** state that every product reads —
 * identity, trust, node config, the vault index — and each product keeps its own state in
 * `<home>/<product>/`. For EnvoyCoder that means projects, tasks, run transcripts and
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
  tasksFile: string;
  settingsFile: string;
  /**
   * What each agent published about itself the last time a session was opened with it.
   *
   * Its own file rather than a field on a task, because it is **per agent**, not per task: two tasks on
   * `deepseek-harness` share one answer, and a copy per task would be the same fact stored N times and
   * stale in N-1 places. Written by the daemon after a run (`stores.ts`'s `recordSessionOptions`) and
   * read by `coder.listHarnesses`, so the window can offer the models and thinking levels of the agent
   * it is actually talking to.
   */
  sessionOptionsFile: string;
  /**
   * The agents the **user declared** — a command, its argv, and the environment variable *names* it needs.
   *
   * Its own file rather than a field on `settings.json`, and the reason is the quarantine rule rather
   * than taste: settings are one document with one schema, so a single unusable provider entry would
   * quarantine the file and take the user's language, their folder and their default agent with it. As a
   * collection, one bad row costs that row — and the file is the thing a user can open and fix, which is
   * the property that made these JSON files rather than a database in the first place.
   *
   * **It never holds a credential.** `AgentProviderConfig.env` is a list of variable *names*; the values
   * live in the environment of whatever started the daemon. See that interface's own doc for why the shape
   * is the enforcement rather than a rule beside it.
   */
  providersFile: string;
  runsDir: string;
  transcriptsDir: string;
  logsDir: string;
  /** Pairing/daemon secrets — `0600` on POSIX, and see the platform note below. */
  secretsDir: string;
  /**
   * The running daemon's claim: pid, port, instance id.
   *
   * It lives beside the data rather than in a temp directory because it describes *this* state
   * directory — two homes are two daemons, and a single shared claim file would make them fight
   * over it. `apps/desktop/src/daemon/lock.ts` owns its format and explains why a claim file exists
   * at all when the port is already bound.
   */
  daemonFile: string;
}

/**
 * Note for Windows, because the family already learned this: file modes are advisory there.
 * `chmod`-style guarantees (`0600`) are a POSIX property; on Windows the file inherits the
 * user's profile ACL instead. Everything that actually protects a secret here is therefore the
 * *session* (a token the node issued) rather than the file permission, and this comment is the
 * reminder not to build a security claim on a mode bit on a platform where it does nothing.
 */
export function coderPaths(home: string = resolveHomeDir()): CoderPaths {
  // `resolveHomeDir()` and not `os.homedir()`: the family's resolution order is
  // `ENVOYMESH_HOME` → per-OS default → legacy `~/.envoymesh` adoption, and a product that calls
  // `homedir()` directly would ignore all three — inventing a second home and, with it, a second
  // set of projects for a user who set `ENVOYMESH_HOME`. `productDirIn` keeps the segment rule in
  // one place rather than re-implementing it here.
  const stateDir = productDirIn(home, ENVOYCODER_PRODUCT_NAME);
  return {
    home,
    stateDir,
    projectsFile: join(stateDir, "projects.json"),
    tasksFile: join(stateDir, "tasks.json"),
    settingsFile: join(stateDir, "settings.json"),
    sessionOptionsFile: join(stateDir, "session-options.json"),
    providersFile: join(stateDir, "providers.json"),
    runsDir: join(stateDir, "runs"),
    transcriptsDir: join(stateDir, "transcripts"),
    logsDir: join(stateDir, "logs"),
    secretsDir: join(stateDir, "secrets"),
    daemonFile: join(stateDir, "daemon.json"),
  };
}

/* ────────────────────────────── what the shared home looks like ───────────────────────────── */

/**
 * What EnvoyMesh's own discovery says about the home this product shares, in the family's words.
 *
 * A headless daemon has no dialog to render, but it still owes the user the truth about the profile
 * it is about to write into — and it must not invent its own vocabulary for it. So this returns the
 * family's `ProfileSituation` (headline, detail, choices) rather than a product-private summary:
 * `describeProfileSituation` is the module whose whole job is that wording, and a second
 * implementation of it here would be the drift the family keeps paying for.
 *
 * **`damaged` is the state that matters.** A profile with unreadable markers is *reported, never
 * replaced*: creating a fresh identity beside a partial one is how a user loses contacts and bonds
 * without being told. The daemon's job is therefore to stop and say so (family convention: exit 4,
 * with a readable message), not to "fix" anything.
 */
export interface CoderHomeFacts {
  home: string;
  profileDir: string;
  /** `missing` | `found` | `damaged` | `in-use` — the family's five-state flow, minus the resolution. */
  state: ProfileSituationState;
  /** One sentence answering "what did you find?" — the family's wording, shown as-is. */
  headline: string;
  /** One or two sentences answering "which profile is it, and where?". */
  detail: string;
  /** Supporting lines (who, where, when). Safe to show a user. */
  facts: string[];
  /** What a user could do about it. Never empty in the family's model; a daemon ignores the buttons. */
  choices: ProfileChoiceId[];
  /** Present when the profile is intact: who owns it. */
  ownerId?: string;
  /** Present when another process holds the home right now. */
  holder?: { app: string; pid: number; port?: number; startedAt?: string; verified?: boolean };
  /** False when this product must not create what is missing (a daemon is not a first-run dialog). */
  canCreate: boolean;
}

/**
 * Inspect the shared home and describe it the way the family would.
 *
 * `canCreate: false` on purpose: EnvoyCoder's daemon starts because *something* asked it to — a
 * window, or the user — and the family's design puts the create/choose decision in a dialog, not in
 * a background process. What a daemon may do is refuse clearly, and that is what this enables.
 */
export async function inspectCoderHome(
  home: string = resolveHomeDir(),
  options: { product?: string; canAttach?: boolean } = {},
): Promise<CoderHomeFacts> {
  const product = options.product ?? coderProductName();
  const profileDir = profileDirIn(home);
  const inspection = await inspectProfile(profileDir);

  // "in-use" is not something an inspection can report — the files may be perfectly healthy. Only the
  // lock knows, which is why the family's fifth state needed its own mechanism (`node-registry`).
  const running = await resolveRunningNode(home);
  // The holder's *claim* carries no port — the port lives on the endpoint beside it, and only when the
  // claim was verified (`status === "running"`). Reporting a port from an unverified claim would be
  // advice a user cannot act on, so it is included only when it was proven.
  const inUse: ProfileInUse | null = running.holder
    ? {
        app: running.holder.app,
        pid: running.holder.pid,
        ...(running.status === "running" && running.endpoint?.port !== undefined
          ? { port: running.endpoint.port }
          : {}),
        startedAt: running.holder.startedAt,
        verified: running.status === "running",
      }
    : null;

  const situation = describeProfileSituation({
    product,
    home,
    profileDir,
    inspection,
    ...(inspection.marker !== undefined ? { marker: inspection.marker } : {}),
    inUse,
    canAttach: options.canAttach ?? running.status === "running",
    canCreate: false,
    canChooseFolder: false,
  });

  return {
    home,
    profileDir,
    state: situation.state,
    headline: situation.headline,
    detail: situation.detail,
    facts: situation.facts.map((fact) => `${fact.label}: ${fact.value}`),
    choices: situation.choices.map((choice) => choice.id),
    ...(inspection.ownerId ? { ownerId: inspection.ownerId } : {}),
    ...(inUse ? { holder: inUse } : {}),
    canCreate: false,
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
  const product = deps.product ?? coderProductName();
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

  // The node publishes both an `endpoint` ({ port, path }) and a ready-to-dial `wsUrl`; the guide's
  // flow uses the endpoint (§4.5), so that is preferred and the URL is only a fallback for a node
  // whose descriptor is incomplete.
  const endpoint =
    node.endpoint && Number.isInteger(node.endpoint.port)
      ? { port: node.endpoint.port, path: node.endpoint.path || DEFAULT_DAEMON_PATH }
      : endpointFromWsUrl(node.wsUrl);
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
      requestProductSession(input, {
        product,
        // The node records which version asked — worth having when a family-wide change lands and
        // one product is behind.
        version: deps.version ?? ENVOYMESH_VERSION,
      }));

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
  /**
   * The node surface the transport subscribes to.
   *
   * The transport wires one listener per event in the disposition table (including the product's
   * own, passed as `eventDispositions`), and calls `nodeService.on(name, …)` for each. EnvoyCoder's
   * events come from a bus rather than from a mesh node, so the daemon passes its own — this is the
   * seam that lets a product with no mesh publish events at all, and the default
   * (`createShellHostNodeService()`) is the right answer only for a host that publishes nothing.
   */
  nodeService?: HostNodeService;
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
    /** A LAN address the phone may prefer over the wide-area one. */
    lanHost?: string;
    /**
     * Relay fallback, from the family's **shared roster** — the same one every product uses
     * (`DEFAULT_ENVOY_COMMUNITY_RELAY_BOOTSTRAP_ADDR`), never a per-product relay. A phone that is
     * not on the LAN reaches the desktop through it, which is the route this app would otherwise
     * have to invent.
     */
    relayPeerId?: string;
    relayWsUrls?: readonly string[];
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
      await host.serve(options.nodeService ?? createShellHostNodeService());
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
        // Passed through untouched: the roster is the family's, and a product that rewrote it would
        // be a second network wearing the first one's name.
        ...(input.relayPeerId ? { relayPeerId: input.relayPeerId } : {}),
        ...(input.relayWsUrls && input.relayWsUrls.length > 0
          ? { relayWsUrls: [...input.relayWsUrls] }
          : {}),
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

/* ────────────────────────────── who may call this daemon ────────────────────────────── */

/**
 * This product's session identity — the answer to "who is calling?" for **our own** surface.
 *
 * Two halves, and the split is the family's model (guide §4.6) rather than ours:
 *
 *   * **A loopback client with no token is trusted**, and gets this product's scope key. That is not a
 *     hole: it is how the family treats a desktop UI, which is the user's own window on their own
 *     machine and carries no token. Our daemon keeps the same rule, and the transport still refuses a
 *     tokenless call from anywhere but loopback (proven by the smoke's LAN leg).
 *   * **A remote caller must present a token**, and today we can resolve none: there is no session
 *     store yet (roadmap M1). So `resolveSession` answers `null` and the transport refuses — fail
 *     closed, deliberately. A daemon that invented its own token format here would be the anonymous
 *     path the guide's §8 forbids, and it would not interoperate with anything else in the family.
 *
 * It is one exported function so production and the smoke test cannot disagree about it. The smoke
 * previously passed a bare `() => undefined` for this port, which typechecked nowhere because
 * `scripts/` was in no tsconfig — and it served by accident, because with no tokens in play the
 * resolver was never consulted.
 */
export function coderSessionIdentity(
  options: { product?: string; resolveSession?: SessionIdentityResolver["resolveSession"] } = {},
): SessionIdentityResolver<unknown> {
  return {
    localScopeKey: productScopeKey(options.product ?? coderProductName()),
    resolveSession: options.resolveSession ?? (async () => null),
  };
}

/* ────────────────────────────── dispatch ───────────────────────────── */

/**
 * The daemon's dispatcher: **answer your own methods, refuse everything else** (guide §4.6).
 *
 * Fail-closed in three ways, each of which is a bug the guide warns about in other products:
 *
 *   1. **An unknown method is refused**, not ignored — silence leaves a client waiting, and a
 *      dispatcher that "tries anyway" is how a product gains an anonymous surface.
 *   2. **A known-but-unimplemented method is refused by name**, so the UI can say "not yet" instead
 *      of hanging.
 *   3. **The dispatcher never mints credentials.** `coder.pairDevice` is not in the catalogue for
 *      that reason: issuing a token is the node's act, behind its own loopback-only gate, and a
 *      product that grew its own would have invented exactly the anonymous path §8 forbids.
 *
 * The identity is resolved by the transport (`@envoymesh/host-connect`): this function only decides
 * *what* may be called, never *who* is calling.
 */
export interface CoderDispatcherDeps {
  handlers?: Partial<Record<RpcMethod, (params: unknown) => Promise<unknown> | unknown>>;
  /** What to say when a method exists but this build does not serve it yet. */
  unimplementedHint?: string;
}

export type CoderDispatcher = HostRpcDispatcher<unknown>;

export function createCoderDispatcher(deps: CoderDispatcherDeps = {}): CoderDispatcher {
  const handlers = deps.handlers ?? {};
  // **The signature is the family's port, and it is positional** (`method, params, session`). The
  // first version of this function took an object and duck-typed its way past `tsc`, so the host
  // called it with a *string* as the first argument and the dispatcher silently answered nothing —
  // the smoke test caught it, which is why the return type is annotated here rather than inferred.
  return async (
    method: string,
    params: Record<string, unknown>,
    // The session is the transport's answer to "who is calling" (guide §4.6). Unused today, and
    // deliberately taken rather than dropped: a product that grows per-session policy (refusing the
    // terminal surface to a family-profile session, say) needs it, and the port hands it over.
    // Derived from the port rather than imported separately: `reuse-host` re-exports the dispatcher
    // type but not the session type, and deriving it here means one source of truth for the shape.
    _session: Parameters<HostRpcDispatcher<unknown>>[2],
  ): Promise<unknown> => {
    if (!isRpcMethod(method)) {
      throw new Error(`Method not found: ${method}`);
    }
    const handler = handlers[method];
    if (!handler) {
      throw new Error(
        `${method} is not implemented in this build` +
          (deps.unimplementedHint ? ` — ${deps.unimplementedHint}` : "."),
      );
    }
    return await handler(params);
  };
}
