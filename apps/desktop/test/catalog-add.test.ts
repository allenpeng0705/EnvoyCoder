/**
 * **Every catalogue row can be stored** — through the same shape auto-Add and an explicit Add use.
 *
 * Choosing a catalogue agent from a picker calls `ensureRunnableAgent`, which stores `cataloguedProviderInput`
 * (id = catalogue id). This test stores every entry the same way so a schema regression cannot hide behind
 * the UI no longer showing an Add button.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { coderPaths } from "@envoydev/host-bridge";
import type { CatalogEntry } from "@envoydev/protocol";

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
async function handlersOverCatalogue(): Promise<Record<string, (params: unknown, context: { session: unknown }) => Promise<unknown>>> {
  const home = await mkdtemp(join(tmpdir(), "envoydev-add-"));
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
  }) as unknown as Record<string, (params: unknown, context: { session: unknown }) => Promise<unknown>>;
}

/** The catalogue as the wire serves it, which is what a row's Add is handed. */
async function catalogRows(
  handlers: Record<string, (params: unknown, context: { session: unknown }) => Promise<unknown>>,
): Promise<CatalogEntry[]> {
  const answer = (await handlers["coder.listCatalog"]?.({}, { session: undefined })) as { entries: CatalogEntry[] };
  return answer.entries;
}

describe("adding a catalogue row", () => {
  it("stores every one of them, through the handler a press reaches", async () => {
    const handlers = await handlersOverCatalogue();
    const rows = await catalogRows(handlers);
    expect(rows.length).toBeGreaterThanOrEqual(38);

    const refused: { id: string; why: string }[] = [];
    for (const row of rows) {
      if (row.builtIn) continue;
      try {
        await handlers["coder.addProvider"]?.(addInputFor(row), { session: undefined });
      } catch (error) {
        refused.push({ id: row.id, why: error instanceof Error ? error.message.slice(0, 160) : String(error) });
      }
    }

    // The whole catalogue, or the refusal that says which row and why — never a silent skip.
    expect(refused, JSON.stringify(refused.slice(0, 3), null, 1)).toEqual([]);
    const stored = (await handlers["coder.listProviders"]?.({}, { session: undefined })) as {
      providers: { id: string; catalogEntryId?: string }[];
    };
    const addable = rows.filter((row) => !row.builtIn);
    expect(stored.providers).toHaveLength(addable.length);

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
    for (const row of addable) expect(added.has(row.id), `${row.id} is not seen as already added`).toBe(true);
  });

  it("uses the catalogue id as the provider id, with the same reference", async () => {
    const rows = await catalogRows(await handlersOverCatalogue());
    for (const row of rows.filter((entry) => !entry.builtIn)) {
      const input = addInputFor(row);
      expect(input.catalogEntryId, row.id).toBe(row.id);
      expect(input.id, row.id).toBe(row.id);
    }
  });
});
