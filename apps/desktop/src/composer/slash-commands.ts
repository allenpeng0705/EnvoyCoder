/**
 * Slash commands an agent published, and the bit of the composer that offers them.
 *
 * The list is the agent's. ACP sends it as `available_commands_update` once a session exists —
 * the same channel Paseo reads — so Claude's `/compact` and Cursor's own set never have to be
 * copied into a catalogue here. A command the agent did not name is one we do not offer.
 */

import type { RunEvent } from "@envoydev/protocol";

export interface SlashCommand {
  name: string;
  description: string;
  argumentHint?: string;
}

/** What the composer is asking for when the draft is a single leading `/token`. */
export function slashQuery(text: string): string | undefined {
  const match = /^\/([^\s]*)$/.exec(text);
  return match ? (match[1] ?? "") : undefined;
}

/** The newest list the agent sent. An empty list is a real answer, not "we have not asked". */
export function latestSlashCommands(events: readonly RunEvent[]): readonly SlashCommand[] {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.kind === "run.commands") return event.commands;
  }
  return [];
}

/** Prefix match on the name. An empty query is the whole list, already in the agent's order. */
export function filterSlashCommands(
  commands: readonly SlashCommand[],
  query: string,
): readonly SlashCommand[] {
  const needle = query.toLowerCase();
  if (needle === "") return commands;
  return commands.filter((command) => command.name.toLowerCase().startsWith(needle));
}

function hintOf(record: Record<string, unknown>): string {
  if (typeof record.argumentHint === "string" && record.argumentHint.trim() !== "") {
    return record.argumentHint.trim();
  }
  const input = record.input;
  if (input && typeof input === "object" && typeof (input as { hint?: unknown }).hint === "string") {
    return (input as { hint: string }).hint.trim();
  }
  return "";
}

/**
 * The commands inside one ACP `available_commands_update`.
 *
 * Names are the agent's. A leading slash is stripped so `/compact` and `compact` are one row.
 * An entry with no name is dropped rather than offered as `/`.
 */
export function slashCommandsFromAcp(update: { [key: string]: unknown }): SlashCommand[] {
  const raw = update.availableCommands;
  if (!Array.isArray(raw)) return [];
  const commands: SlashCommand[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.replace(/^\//, "").trim() : "";
    if (name === "" || /\s/.test(name) || seen.has(name)) continue;
    seen.add(name);
    const description = typeof record.description === "string" ? record.description : "";
    const hint = hintOf(record);
    commands.push({
      name,
      description,
      ...(hint !== "" ? { argumentHint: hint } : {}),
    });
  }
  return commands;
}
