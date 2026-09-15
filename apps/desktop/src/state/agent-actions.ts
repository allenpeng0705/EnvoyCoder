/**
 * What the agents screen may **do** — the daemon methods that change something, named once.
 *
 * ## Why this is an interface rather than the store itself
 *
 * The settings pane is handed its actions rather than a reference to the whole store, for the same reason
 * every row in it is handed `onUpdate` rather than `updateSettings`: a section that can reach every method
 * on the store is a section that can quietly grow a second way to write the same thing. This names the five
 * calls the agents screen is allowed to make, and `CoderStore` satisfies it structurally — there is no
 * adapter, so the interface cannot drift from the implementation into a second set of behaviours.
 *
 * ## The three shapes of answer, and why they are three
 *
 *   * **`ok: false` with a `Refusal`** — the call failed. `Refusal` carries the daemon's sentence *and* the
 *     catalogue key, so a German user reads German even though the daemon wrote English.
 *   * **`signInAgent`'s outcome** — five answers, of which four are not success, and **all five are
 *     `ok: true`**. The agent refused, or accepted without finishing, or named no method we may send; those
 *     are things this call found out, not failures of it. Collapsing them into `ok: false` would tell a user
 *     the request was broken when in fact the agent answered.
 *   * **`probeCatalogAgent`'s measurement** — always an answer, never a claim beyond what it measured, and it
 *     carries `costMs` and `observedAt` so the row can say what the measurement was and when it was taken.
 */

import type { CatalogProbe, HarnessId, SignInOutcome } from "@envoycoder/protocol";

import type { Refusal } from "../i18n/notice.js";
import type { AddProviderInput } from "./coderStore.js";

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
   * Put an agent in the user's list, or out of it — **a preference, and the only thing it changes**.
   *
   * It never touches what the row reports: a hidden agent that is installed still reads *Ready*, still
   * carries its install command when it is not, and still runs when a task already names it.
   */
  setAgentHidden(
    id: string,
    hidden: boolean,
  ): Promise<{ ok: true; hidden: boolean; hiddenAgents: readonly string[] } | Refusal>;

  /**
   * Measure **one** catalogued entry, on the user's press.
   *
   * `force` is the difference between "tell me what you know" and "measure it now": the daemon refuses to
   * cache a negative answer precisely because a user is about to change it, and a second press after they
   * have is asking for a new measurement.
   */
  probeCatalogAgent(
    id: string,
    options?: { force?: boolean },
  ): Promise<{ ok: true; probe: CatalogProbe } | Refusal>;

  /** Trigger the agent's own sign-in flow. See the module doc for why all five outcomes are `ok: true`. */
  signInAgent(
    harness: HarnessId,
    options?: { methodId?: string },
  ): Promise<{ ok: true; outcome: SignInOutcome; detail: string } | Refusal>;
}
