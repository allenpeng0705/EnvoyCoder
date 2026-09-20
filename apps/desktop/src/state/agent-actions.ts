/**
 * What a settings surface may **do** — the daemon methods that change something, named once.
 *
 * ## Why this is an interface rather than the store itself
 *
 * The settings pane is handed its actions rather than a reference to the whole store, for the same reason
 * every row in it is handed `onUpdate` rather than `updateSettings`: a section that can reach every method
 * on the store is a section that can quietly grow a second way to write the same thing. This names the calls
 * the settings surfaces may make, and `CoderStore` satisfies it structurally — there is no adapter, so the
 * interface cannot drift from the implementation into a second set of behaviours.
 *
 * **The name is historical, and the contents are the settings pane's calls.** It began with the agents
 * screen's five; pairing (`mintPairing`, `listPairedDevices`, `revoke`/`forgetPairedDevice`), the Envoy
 * Harness LLM panel (`getEnvoyLlm`/`setEnvoyLlm`) and now the daemon service
 * (`getServiceStatus`/`installService`/`uninstallService`/`restartService`) live here too, because they are
 * all rows of the same pane and all handed over the same way. Renaming it would be churn across every
 * settings test for a name no user sees; what matters is the rule above, and it is unchanged.
 *
 * ## The three shapes of answer, and why they are three
 *
 *   * **`ok: false` with a `Refusal`** — the call failed. `Refusal` carries the daemon's sentence *and* the
 *     catalogue key, so a German user reads German even though the daemon wrote English.
 *   * **`signInAgent`'s outcome** — five answers, of which four are not success, and **all five are
 *     `ok: true`**. The agent refused, or accepted without finishing, or named no method we may send; those
 *     are things this call found out, not failures of it. Collapsing them into `ok: false` would tell a user
 *     the request was broken when in fact the agent answered.
 *   * **`ServiceAnswer`'s status** — the same distinction for the operating system: a service press can be
 *     granted and still not be running yet, so `ok: true` carries what the supervisor said (`detail`, `pid`,
 *     `enabled`) rather than a bare acknowledgement.
 *   * **Nothing, any more.** There used to be a third shape — `probeCatalogAgent`'s measurement, one
 *     catalogued row at a time on the user's press — and it is gone with the method. The daemon resolves every
 *     row's cheap facts before it serves the list (`CatalogEntry.availability`), so no action on this page
 *     exists in order to *find out* a state; what a user can do here is what a user can **do**: declare an
 *     agent, forget one they declared, or run an agent's own sign-in.
 */

import type { AgentDelivery, DaemonServiceStatus, FixRunResult, FixTarget, HarnessId, SignInOutcome, DaemonLog } from "@envoydev/protocol";

import type { Refusal } from "../i18n/notice.js";
import type { AddProviderInput } from "./coderStore.js";

/** What `coder.getEnvoyLlm` / `coder.setEnvoyLlm` return — never the API key. */
export interface EnvoyLlmPublic {
  provider?: string;
  model?: string;
  baseUrl?: string;
  apiKeySet: boolean;
  options: readonly { id: string; provider: string; model: string; label: string }[];
}

export interface EnvoyLlmSetInput {
  provider: string;
  model: string;
  baseUrl?: string;
  apiKey?: string;
  clearApiKey?: boolean;
}

/**
 * What every service call answers: the status the supervisor returned, or a refusal.
 *
 * The success arm **carries the status** rather than a bare `ok`, because a service press is a request to the
 * operating system that can be accepted and still not be running yet. Callers store this answer instead of
 * assuming the press worked (`coderStore.adoptService`).
 */
export type ServiceAnswer = { ok: true; service: DaemonServiceStatus } | Refusal;

/**
 * What `coder.shutdown` answers.
 *
 * `stopping: true` is an acknowledgement and not an outcome: the daemon puts the result on the wire *before* it
 * starts draining and exits (the handler defers the stop by a tick for exactly that reason), so no caller may
 * treat this as "the process is gone".
 */
export type ShutdownAnswer = { ok: true; stopping: true } | Refusal;

/**
 * The daemon's log tail, as `coder.getDaemonLog` serves it.
 *
 * **There is no exported protocol type to import for this one.** `coder.getDaemonLog`'s result is an inline
 * `z.object({ log: … })` in `packages/protocol/src/rpc.ts`, the same shape the daemon's own `LogTail` carries;
 * every other service answer has a named schema (`ServiceStatusSchema`) and this one does not. So this is a
 * deliberate mirror rather than a second source of truth, and the honest fix is one named export upstream —
 * not a window that reads `unknown` and casts. `truncated` is the field the UI owes the user: a tail that
 * reads like a complete log is a lie somebody debugs from.
 */
// The wire's own type, imported rather than mirrored: a second definition of a result shape can drift from the
// one the daemon sends, and a mirror has nothing to warn it when it does (`DaemonLogSchema` in @envoydev/protocol).
export type DaemonLogRead = DaemonLog;

/** What a log read answers: the bounded tail, or a refusal (a daemon log is owner-window-only). */
export type DaemonLogAnswer = { ok: true; log: DaemonLogRead } | Refusal;

export interface AgentActions {
  /**
   * Declare an agent — a catalogue entry, or one nobody catalogued.
   *
   * The parameters are sent verbatim, `transport` included: the screen passes the entry's own statement of
   * its dialect through untouched, so no layer of this call can decide one.
   */
  addProvider(input: AddProviderInput): Promise<{ ok: true } | Refusal>;

  /** Forget a provider. The daemon answers the id it removed, or refuses because there is nothing there. */
  removeProvider(id: string): Promise<{ ok: true; removed: string } | Refusal>;

  /**
   * **Choose how this agent's connector is delivered.**
   *
   * `"installed"` for the ordinary route, `"npx"` to fetch the connector from npm on first run. A refusal is a
   * real answer here — an agent with no npm-published connector cannot be fetched — and the caller shows it where
   * the press was.
   */
  setAgentDelivery(
    harness: HarnessId,
    delivery: "installed" | "npx",
  ): Promise<{ ok: true; delivery: AgentDelivery } | Refusal>;

  /**
   * **Run the fix a row is showing** — the only action here that changes the user's machine.
   *
   * The target travels as an id and never as a command: the daemon resolves the commands through the same
   * probes that drew the row, at the moment of the press. The answer is one of four outcomes, all of which are
   * things the call found out rather than failures of it — a refusal is the one exception, and it means the
   * call could not be made at all.
   */
  runFix(target: FixTarget): Promise<{ ok: true; result: FixRunResult } | Refusal>;

  /**
   * **Look at this machine again** — re-ask the login shell where the user's programs are, then re-read.
   *
   * The fourth call, and the only one on this page whose subject is the measurement rather than an agent. It
   * exists because the daemon cannot know that its answer is out of date: a user who installs a bridge in their
   * own terminal tells nobody, and two of the daemon's inputs (the login shell's `PATH`, and its `command -v`
   * answer per name) are captured once per process on purpose. A press is the signal, and the page offers it
   * next to the count it invalidates.
   *
   * Returns nothing: the daemon emits the same `harnesses` change the boot primes emit, and the store re-reads
   * through its ordinary loaders. An answer carrying a list would be a second source of truth for the list.
   */
  recheckAgents(): Promise<void>;

  /** Trigger the agent's own sign-in flow. See the module doc for why all five outcomes are `ok: true`. */
  signInAgent(
    harness: HarnessId,
    options?: { methodId?: string },
  ): Promise<{ ok: true; outcome: SignInOutcome; detail: string } | Refusal>;

  /** Mint an `envoy://pair` URI for a phone. The URI carries the secret. */
  mintPairing(input?: {
    deviceLabel?: string;
    /** Hostname or `host:port` for the typed route (port is stripped; daemon port is used). */
    host?: string;
    /** User-chosen 8–10 character token for host:port; omit for QR (long random). */
    token?: string;
    /** QR path: force a new secret instead of reusing an unused one. */
    fresh?: boolean;
  }): Promise<
    | { ok: true; uri: string; device: { id: string; deviceLabel: string; createdAt: string; expiresAt: string } }
    | Refusal
  >;

  listPairedDevices(): Promise<
    | {
        ok: true;
        devices: readonly {
          id: string;
          deviceLabel: string;
          createdAt: string;
          expiresAt: string;
          revokedAt?: string;
          lastSeenAt?: string;
        }[];
      }
    | Refusal
  >;

  revokePairedDevice(
    id: string,
  ): Promise<
    | { ok: true; device: { id: string; deviceLabel: string; createdAt: string; expiresAt: string; revokedAt?: string } }
    | Refusal
  >;

  /**
   * Remove a **revoked** record from the list. The daemon refuses an active one ("revoke it first"),
   * so this is never a shortcut around revocation.
   */
  forgetPairedDevice(
    id: string,
  ): Promise<
    | { ok: true; device: { id: string; deviceLabel: string; createdAt: string; expiresAt: string; revokedAt?: string } }
    | Refusal
  >;

  /** Envoy Harness LLM panel — non-secret fields plus whether a key is stored. */
  getEnvoyLlm(): Promise<{ ok: true } & EnvoyLlmPublic | Refusal>;

  /** Save Envoy Harness LLM settings; optional key replace / clear. Syncs `defaults.model`. */
  setEnvoyLlm(input: EnvoyLlmSetInput): Promise<{ ok: true } & EnvoyLlmPublic | Refusal>;

  /**
   * **The daemon service, which the operating system owns.**
   *
   * Five calls about one state, and they are here rather than in an interface of their own for the reason the
   * pairing calls are: this is the bundle a settings surface is handed, and the *Background service* row is a
   * settings surface. What is different from every other call in this file is where the value lives — not in
   * a settings document but in launchd / systemd / the Task Scheduler — which is why the read is a status and
   * the answer to a change is *the supervisor's answer*, never our assumption (`ServiceAnswer`).
   *
   * `shutdown` is the odd one: its answer is an acknowledgement rather than a status, because the daemon is
   * about to exit (`ShutdownAnswer`). It is the row's **Stop** — the press that ends the daemon without
   * removing the service, which is what makes it different from `uninstallService`.
   *
   * The status is asked when the service page opens rather than at connect: it costs a supervisor process,
   * and nothing can act on the answer until the control is on screen.
   */
  getServiceStatus(): Promise<ServiceAnswer>;

  /** Turn it on. Idempotent on every platform; still a request the OS can refuse. */
  installService(): Promise<ServiceAnswer>;

  /** Turn it off, unit and all — the machine's daemon state is not touched. */
  uninstallService(): Promise<ServiceAnswer>;

  /** Start it again through the supervisor, for one that is installed but not running. */
  restartService(): Promise<ServiceAnswer>;

  /**
   * **End the daemon now, without removing the service.**
   *
   * This is the difference the row's copy exists to make: `shutdown` answers `{stopping: true}` and the process
   * drains and exits, so the installed service brings it back at the next login — while `uninstallService`
   * takes the service away entirely. The answer says the *request was accepted*, not that the process is gone
   * (the drain can take a while), which is why the row re-reads the status afterwards and treats a read that
   * cannot arrive as "stopped" rather than as a failure.
   */
  shutdown(): Promise<ShutdownAnswer>;

  /**
   * **Read the end of the live daemon log** — the last 200 lines out of at most the last 64 KB, whichever of
   * the supervisor's log or the shell's is live. Both bounds are the daemon's; a caller reads nothing itself.
   *
   * Owner-window-only, like the mutations: a log carries absolute paths, prompts and command lines. It is also
   * the one service call fetched **on demand** — the row's disclosure asks when it is opened, and its Refresh
   * asks again — because most visits to the row do not want a file read, and an empty `lines` with a non-empty
   * `path` is the ordinary "nothing has written one yet" rather than a failure.
   */
  getDaemonLog(): Promise<DaemonLogAnswer>;
}
