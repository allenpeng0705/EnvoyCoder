/**
 * Reading and writing the daemon's state files — **without ever destroying one.**
 *
 * ## The rule this module exists to keep
 *
 * A file we cannot parse is **quarantined, not overwritten**. The bytes are renamed aside with a
 * timestamp, the daemon carries on with the defaults, and the reason is reported through `coder.hello` so
 * the user is told rather than left to discover an empty sidebar. Silently writing over a corrupt file is
 * how a control plane makes someone lose the list of what they were working on, and it is unrecoverable —
 * the one failure mode worth being paranoid about here.
 *
 * A single *invalid entry* inside a valid file is a lesser case with a lesser response: the entry is
 * skipped, the rest of the file is kept, and the skip is reported. One bad row must not cost the other
 * forty.
 *
 * ## Why it is its own module rather than five private methods
 *
 * It was five private methods on `CoderStore`, which was right while there were three collections and
 * wrong the moment there were five: the class crossed `AGENTS.md`'s eight-hundred-line rule, and the
 * thing that had grown was not the store's subject (what EnvoyCoder remembers) but this one — how a JSON
 * document is read, written and, when it cannot be, set aside. `CoderStore` owns the state directory and
 * the write chain; this owns the file.
 *
 * `StateFiles` is deliberately **not** a second writer: `CoderStore.enqueue` still serialises every
 * mutation, and this only knows how to put bytes on disk atomically. The one piece of state it keeps is
 * the list of files it had to quarantine or skip, because it is the only thing that can know.
 */

import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { DroppedSettingsKey } from "@envoycoder/protocol";
import type { z } from "zod";

/** What a read could not use, in end-user words. Reported at `coder.hello`. */
export interface FileNotes {
  readonly quarantined: readonly { file: string; movedTo: string; reason: string }[];
  readonly skipped: readonly { file: string; reason: string }[];
  /**
   * Keys a settings document carried that this build does not have, and that it therefore dropped.
   *
   * **A category of its own rather than more `skipped` entries, and the difference is the point.** A
   * skipped row is a *diagnostic*: an entry this build cannot represent, reported with a schema
   * validator's own message because there is no sentence that would help. These are the opposite —
   * the read succeeded, the document is in force, and the only thing the user might want to know is
   * that a key they can see in the file is not doing anything. That is a sentence in their language,
   * which is why it is its own channel with its own keys instead of a line of validator prose.
   */
  readonly droppedKeys: readonly {
    file: string;
    keys: readonly DroppedSettingsKey[];
  }[];
}

export interface StateFilesOptions {
  /** Where a quarantined file goes. Defaults to beside the original, so it is findable. */
  quarantineSuffix?: (at: Date) => string;
  now?: () => Date;
}

/**
 * A quarantined file's name.
 *
 * `projects.json` becomes `projects.corrupt-20260913T101500Z.json` — **still a `.json` file**, in
 * the same directory, so the user can open it and a backup tool will include it. Renaming it to
 * something without an extension, or moving it to a temp directory, would technically preserve the
 * bytes and practically lose them.
 */
function defaultQuarantineSuffix(at: Date): string {
  const stamp = at.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `.corrupt-${stamp}.json`;
}

export class StateFiles {
  private readonly quarantineSuffix: (at: Date) => string;
  private readonly now: () => Date;
  private readonly quarantined: { file: string; movedTo: string; reason: string }[] = [];
  private readonly skipped: { file: string; reason: string }[] = [];
  private readonly droppedKeys: { file: string; keys: DroppedSettingsKey[] }[] = [];

  constructor(options: StateFilesOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.quarantineSuffix = options.quarantineSuffix ?? defaultQuarantineSuffix;
  }

  /** What could not be read, for `coder.hello` to report. */
  notes(): FileNotes {
    return { quarantined: this.quarantined, skipped: this.skipped, droppedKeys: this.droppedKeys };
  }

  /**
   * Record keys a settings document carried that this build has no field for.
   *
   * **Nothing is written here, and that is deliberate.** `readCollection`'s caller rewrites a list after
   * skipping a row, so the warning is not repeated every launch. This does not, because an unknown
   * settings key is far more often a newer build's setting than garbage — see `CoderStore.readSettings`
   * for the whole argument — and deleting it from disk would be destroying a value a build the user also
   * runs does read. The note is therefore repeated until the user's next settings write, which is
   * harmless: it is one line under *Things worth knowing*, and it is true every time it appears.
   */
  noteDroppedSettingsKeys(file: string, keys: readonly DroppedSettingsKey[]): void {
    if (keys.length === 0) return;
    this.droppedKeys.push({ file: basename(file), keys: [...keys] });
  }

  /**
   * Read a collection, tolerating both a broken file and a broken row.
   *
   * The schema is applied **per element**, not to the whole array: one invalid row costs that row,
   * not the file. The caller rewrites the file when anything was skipped, so the warning appears
   * once at startup instead of on every launch for a row that will never be valid.
   */
  async readCollection<S extends z.ZodTypeAny>(
    file: string,
    schema: S,
  ): Promise<{ items: z.infer<S>[]; skipped: string[] }> {
    const raw = await this.readJson(file);
    if (raw === undefined) return { items: [], skipped: [] };
    if (!Array.isArray(raw)) {
      await this.quarantine(file, `expected a list in ${basename(file)}, found ${typeof raw}`);
      return { items: [], skipped: [] };
    }

    const items: z.infer<S>[] = [];
    const skipped: string[] = [];
    for (const [index, entry] of raw.entries()) {
      const parsed = schema.safeParse(entry);
      if (parsed.success) {
        items.push(parsed.data as z.infer<S>);
        continue;
      }
      const reason = `entry ${index + 1}: ${parsed.error.issues[0]?.message ?? "did not match the schema"}`;
      skipped.push(reason);
      this.skipped.push({ file: basename(file), reason });
    }
    if (skipped.length > 0) {
      this.skipped.push({
        file: basename(file),
        reason: `${skipped.length} entr${skipped.length === 1 ? "y was" : "ies were"} left out of the list, and the file has been rewritten without ${skipped.length === 1 ? "it" : "them"}.`,
      });
    }
    return { items, skipped };
  }

  /**
   * Read and parse one file.
   *
   * `undefined` means "there is nothing here", which covers a missing file and a file whose bytes
   * were not JSON — the second only after the bytes have been moved aside, since "there is nothing
   * here" must never be *made* true by us reading it.
   */
  async readJson(file: string): Promise<unknown> {
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    if (text.trim() === "") return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      await this.quarantine(file, `not readable as JSON: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  /** Move an unreadable file aside, and remember that we did. */
  async quarantine(file: string, reason: string): Promise<void> {
    const at = this.now();
    const movedTo = join(dirname(file), baseNameWithoutExtension(file) + this.quarantineSuffix(at));
    try {
      await rename(file, movedTo);
    } catch (error) {
      // A file we cannot even move is reported and left alone. Deleting it would be the one action
      // that turns a recoverable problem into an unrecoverable one.
      this.quarantined.push({
        file,
        movedTo: "",
        reason: `${reason} (and it could not be moved aside: ${error instanceof Error ? error.message : String(error)})`,
      });
      return;
    }
    this.quarantined.push({ file, movedTo, reason });
  }

  async writeJsonAtomic(file: string, value: unknown): Promise<void> {
    const text = `${JSON.stringify(value, null, 2)}\n`;
    const temp = `${file}.tmp`;
    await writeFile(temp, text, { encoding: "utf8", mode: 0o600 });

    let lastError: unknown;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await rename(temp, file);
        return;
      } catch (error) {
        lastError = error;
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") break;
        await sleep(20 * (attempt + 1));
      }
    }
    // Leave no `.tmp` behind for the next read to trip over.
    await unlink(temp).catch(() => undefined);
    throw lastError;
  }
}

function baseNameWithoutExtension(file: string): string {
  const name = basename(file);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}


function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
