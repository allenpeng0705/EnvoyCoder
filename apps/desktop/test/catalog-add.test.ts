/**
 * **Every row in the catalogue can actually be added** — the leg that would have caught 38 broken buttons.
 *
 * The owner pressed **Add** on the catalogue and got a refusal in the notice strip:
 * *"coder.addProvider was given a provider this build cannot store: a provider cannot be the catalogue entry it
 * says it came from — the reference would resolve to the provider itself"*. The window was sending `entry.id` as
 * both the provider's id and its `catalogEntryId`, and the store's own rule refuses that self-reference.
 *
 * Nothing caught it because the existing leg built the same input and only **inspected its fields**
 * (`catalog-rpc.test.ts`: `expect(add.catalogEntryId).toBe("vtcode")`), and the UI legs use fixtures. A builder
 * whose output is never *stored* is a builder nobody has run — so this test stores one of every entry, through the
 * same handler a press reaches.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { coderPaths } from "@envoycoder/host-bridge";
import type { CatalogEntry } from "@envoycoder/protocol";

import { addedProviderIds, addInputFor } from "../src/components/settings/agent-catalog.js";
import { CoderStore } from "../src/daemon/store.js";
import { createCoderHandlers } from "../src/daemon/service.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/**
 * The handler table over a throwaway home, with the catalogue probe injected so the rows come from the daemon
 * itself — **the rows a user is looking at**, rather than a second description of the catalogue written here.
 */
async function handlersOverCatalogue(): Promise<Record<string, (params: unknown) => Promise<unknown>>> {
  const home = await mkdtemp(join(tmpdir(), "envoycoder-add-"));
  cleanups.push(() => rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const paths = coderPaths(home);
  const store = await CoderStore.open({ paths });
  return createCoderHandlers({
    store,
    paths,
    instance: { instanceId: "add-test", version: "0.1.0", startedAt: "2026-09-15T00:00:00.000Z", connectionCount: () => 1 },
    mesh: () => ({ kind: "no-node", reason: "" }),
    // Every entry resolves to `ready` over a search that ran: this test is about *storing* a row, not about the
    // machine it was measured on.
    probeCatalogEntry: (entry) => ({ state: "ready", binaryPath: entry.command[0] }),
  }) as unknown as Record<string, (params: unknown) => Promise<unknown>>;
}

/** The catalogue as the wire serves it, which is what a row's Add is handed. */
async function catalogRows(handlers: Record<string, (params: unknown) => Promise<unknown>>): Promise<CatalogEntry[]> {
  const answer = (await handlers["coder.listCatalog"]?.({})) as { entries: CatalogEntry[] };
  return answer.entries;
}

describe("adding a catalogue row", () => {
  it("stores every one of them, through the handler a press reaches", async () => {
    const handlers = await handlersOverCatalogue();
    const rows = await catalogRows(handlers);
    expect(rows.length).toBeGreaterThanOrEqual(38);

    const refused: { id: string; why: string }[] = [];
    for (const row of rows) {
      try {
        await handlers["coder.addProvider"]?.(addInputFor(row));
      } catch (error) {
        refused.push({ id: row.id, why: error instanceof Error ? error.message.slice(0, 160) : String(error) });
      }
    }

    // The whole catalogue, or the refusal that says which row and why — never a silent skip.
    expect(refused, JSON.stringify(refused.slice(0, 3), null, 1)).toEqual([]);
    const stored = (await handlers["coder.listProviders"]?.({})) as {
      providers: { id: string; catalogEntryId?: string }[];
    };
    expect(stored.providers).toHaveLength(rows.length);

    // **And the catalogue rows know it.** A provider added from a row has an id of its own, so a list matching on
    // ids alone would keep offering *Add* for a recipe already in the user's list — and let it be added again and
    // again. `addedProviderIds` is the function that decides, and this is the assertion for it.
    const added = addedProviderIds(
      stored.providers.map((provider) => ({
        ...provider,
        label: provider.id,
        command: "x",
        args: [],
        env: [],
        transport: "acp" as const,
        availability: { state: "ready" as const, binary: "/usr/bin/x" },
        detail: "",
      })),
    );
    for (const row of rows) expect(added.has(row.id), `${row.id} is not seen as already added`).toBe(true);
  });

  it("gives each provider an id of its own, and keeps the reference to the recipe", async () => {
    // The two facts the schema's rule is about, asserted on the builder rather than discovered on the wire.
    const rows = await catalogRows(await handlersOverCatalogue());
    for (const row of rows) {
      const input = addInputFor(row);
      expect(input.catalogEntryId, row.id).toBe(row.id);
      expect(input.id, `${row.id}: a provider may not be the entry it references`).not.toBe(row.id);
    }
  });
});
