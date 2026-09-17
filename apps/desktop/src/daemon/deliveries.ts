/**
 * **The user's choice of delivery, per agent** — the only stored fact in this product that changes *what runs*.
 *
 * ## Why its own file rather than a settings field
 *
 * The same reason `AgentProviderConfig` has one (`host-bridge`'s own doc argues it): this is a **collection keyed
 * by an agent**, and the settings document is one structure with one schema — a single unusable row in it would
 * quarantine the user's language, their folder and their default agent along with it. As a collection, one bad
 * row costs that row (`StateFiles.readCollection` applies the schema per element), and the file is something a
 * user can open and fix.
 *
 * ## What is stored is the *choice*, never the program
 *
 * A row is `{ harness, delivery }` where `delivery` is `"installed"` or `"npx"`. There is no package name, no
 * command and no path in this file: those come from the catalogue at launch time (`bridgePackage`,
 * `fetchedBridgeArgs`), so a catalogue that gains or renames a package is a catalogue edit rather than a
 * migration of every user's stored preferences.
 *
 * A row whose harness id this build does not know, or whose delivery is not one of the two, is skipped and the
 * file is rewritten once — the discipline every other collection here follows.
 */

import { z } from "zod";

import { HARNESS_IDS, type HarnessId } from "@envoydev/protocol";

import type { CoderPaths } from "@envoydev/host-bridge";

import type { StateFiles } from "./state-file.js";

/**
 * One row, and the only two values it may carry.
 *
 * `HARNESS_IDS` is the closed nine-entry catalogue from the protocol, so a row naming a harness this build does
 * not ship is refused **by the schema** rather than remembered as a preference nothing can act on.
 */
const DeliveryRowSchema = z
  .object({
    harness: z.enum(HARNESS_IDS),
    delivery: z.enum(["installed", "npx"]),
  })
  .strict();

export type DeliveryChoice = "installed" | "npx";

export class AgentDeliveries {
  private readonly paths: CoderPaths;
  private readonly files: StateFiles;
  private choices = new Map<HarnessId, DeliveryChoice>();

  constructor(paths: CoderPaths, files: StateFiles) {
    this.paths = paths;
    this.files = files;
  }

  /**
   * Read the collection, and rewrite it if a row was skipped.
   *
   * The rewrite is what makes the warning appear once rather than on every launch, which is the contract
   * `readCollection` documents.
   */
  async load(): Promise<void> {
    const { items, skipped } = await this.files.readCollection(this.paths.deliveriesFile, DeliveryRowSchema);
    this.choices = new Map(items.map((row) => [row.harness as HarnessId, row.delivery]));
    // Rewritten once when something was skipped, the way every other collection here does it: the user saw the
    // warning in the daemon's log, and the next launch must not repeat it for a row that will never be valid.
    if (skipped.length > 0) await this.persist();
  }

  /**
   * What this machine will use for an agent.
   *
   * `installed` for anything the user has not chosen otherwise, which is the route this build has always taken:
   * a missing record must not become a downloaded package.
   */
  of(harness: HarnessId): DeliveryChoice {
    return this.choices.get(harness) ?? "installed";
  }

  /** Every choice the user has made, for the diagnostics a maintainer reads. */
  all(): ReadonlyMap<HarnessId, DeliveryChoice> {
    return this.choices;
  }

  /**
   * Remember a choice, and write it.
   *
   * `installed` is *removed* rather than stored: it is the absence of a choice, and keeping a row for it would
   * make the file grow a line per agent a user ever considered — and would make "how many agents have a
   * delivery the user chose?" unanswerable by reading it.
   */
  async set(harness: HarnessId, delivery: DeliveryChoice): Promise<void> {
    if (delivery === "installed") this.choices.delete(harness);
    else this.choices.set(harness, delivery);
    await this.persist();
  }

  private async persist(): Promise<void> {
    const rows = [...this.choices].map(([harness, delivery]) => ({ harness, delivery }));
    await this.files.writeJsonAtomic(this.paths.deliveriesFile, rows);
  }
}
