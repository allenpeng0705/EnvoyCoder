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
 *   * **Nothing, any more.** There used to be a third shape — `probeCatalogAgent`'s measurement, one
 *     catalogued row at a time on the user's press — and it is gone with the method. The daemon resolves every
 *     row's cheap facts before it serves the list (`CatalogEntry.availability`), so no action on this page
 *     exists in order to *find out* a state; what a user can do here is what a user can **do**: declare an
 *     agent, forget one they declared, or run an agent's own sign-in.
 */

import type { HarnessId, SignInOutcome } from "@envoycoder/protocol";

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

  /** Trigger the agent's own sign-in flow. See the module doc for why all five outcomes are `ok: true`. */
  signInAgent(
    harness: HarnessId,
    options?: { methodId?: string },
  ): Promise<{ ok: true; outcome: SignInOutcome; detail: string } | Refusal>;
}
