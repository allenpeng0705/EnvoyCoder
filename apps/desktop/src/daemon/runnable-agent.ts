/**
 * Whether a task or a default may name this agent id — and materialise a catalogue recipe if needed.
 *
 * A shipped harness is always choosable. A stored provider is choosable. A catalogue recipe that has
 * never been stored is **auto-Added** here (same payload as a catalogue Add), so pickers and write
 * paths share one gate instead of a separate Agents-page step.
 */

import type { AgentProviderConfig } from "@envoydev/protocol";
import { AgentProviderConfigSchema, ENVOYDEV_ERRORS, coderError, isHarnessId } from "@envoydev/protocol";
import { acpAgent, cataloguedProviderInput } from "@envoydev/agent-catalog";

import { ref } from "./messages.js";
import type { CoderStore } from "./store.js";

/**
 * The provider config to launch for this id, if any.
 *
 * Prefers an exact id match, then a legacy row whose `catalogEntryId` is this catalogue id (older
 * Adds used `${id}-${transport}` as the provider id).
 */
export function findRunnableProvider(store: CoderStore, id: string): AgentProviderConfig | undefined {
  return store.findProvider(id) ?? store.providers().find((provider) => provider.catalogEntryId === id);
}

/**
 * Ensure `id` is runnable: shipped, already stored, or a catalogue recipe we materialise now.
 */
export async function ensureRunnableAgent(store: CoderStore, id: string | undefined): Promise<void> {
  if (id === undefined || id === "") return;
  if (isHarnessId(id)) return;
  if (findRunnableProvider(store, id)) return;

  const entry = acpAgent(id);
  if (!entry) {
    throw coderError(
      ENVOYDEV_ERRORS.agentUnknown,
      `"${id}" is not an agent EnvoyDev ships or catalogues, so it was not chosen.`,
      ref("error.agentUnknown", { id }),
    );
  }

  const input = cataloguedProviderInput(entry);
  const parsed = AgentProviderConfigSchema.safeParse(input);
  if (!parsed.success) {
    throw coderError(
      ENVOYDEV_ERRORS.badRequest,
      `Catalogue entry "${id}" cannot be stored as a provider: ${parsed.error.issues[0]?.message ?? "invalid"}`,
    );
  }
  await store.addProvider(parsed.data);
}
