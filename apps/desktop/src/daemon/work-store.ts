/**
 * Work Engine persistence — JSON files under `coderPaths().workDir`.
 *
 * Atomic rename writes match `teams.ts`: a crash mid-write must not leave a half file.
 * Corrupt JSON is quarantined (not silently wiped) so a bad write cannot erase Tickets.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";

import {
  defaultWorkPolicy,
  type WorkCandidate,
  type WorkEffect,
  type WorkPolicy,
  type WorkTicket,
  type WorkTrigger,
} from "@envoydev/work-model";

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === "ENOENT";
}

async function quarantine(path: string, reason: string): Promise<void> {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const movedTo = path.replace(/\.json$/i, `.corrupt-${stamp}.json`);
  try {
    await rename(path, movedTo);
    console.warn(`work-store: quarantined ${path} → ${movedTo} (${reason})`);
  } catch (error) {
    console.warn(`work-store: could not quarantine ${path} (${reason}): ${String(error)}`);
  }
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(path, "utf8");
    try {
      return JSON.parse(raw) as T;
    } catch (parseError) {
      await quarantine(
        path,
        parseError instanceof Error ? parseError.message : "invalid JSON",
      );
      return fallback;
    }
  } catch (error) {
    if (isMissing(error)) return fallback;
    await quarantine(path, error instanceof Error ? error.message : String(error));
    return fallback;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

export interface TicketsFile {
  tickets: Record<string, WorkTicket>;
}

export interface EffectsFile {
  effects: WorkEffect[];
}

export interface CandidatesFile {
  candidates: WorkCandidate[];
}

export interface TriggersFile {
  triggers: WorkTrigger[];
}

export class WorkStore {
  private policy: WorkPolicy = defaultWorkPolicy();
  private tickets: Record<string, WorkTicket> = {};
  private effects: WorkEffect[] = [];
  private candidates: WorkCandidate[] = [];
  private triggers: WorkTrigger[] = [];

  constructor(private readonly workDir: string) {}

  private path(name: string): string {
    return join(this.workDir, name);
  }

  async load(): Promise<void> {
    await mkdir(this.workDir, { recursive: true });
    const policy = await readJson<Partial<WorkPolicy> | null>(this.path("policy.json"), null);
    // Merge defaults so older policy.json without github poll fields still loads.
    this.policy = policy
      ? {
          ...defaultWorkPolicy(),
          ...policy,
          allowList: Array.isArray(policy.allowList) ? [...policy.allowList] : [],
          githubPollIntervalMs:
            typeof policy.githubPollIntervalMs === "number" && Number.isFinite(policy.githubPollIntervalMs)
              ? Math.max(0, Math.floor(policy.githubPollIntervalMs))
              : 0,
        }
      : defaultWorkPolicy();
    const ticketsFile = await readJson<TicketsFile>(this.path("tickets.json"), { tickets: {} });
    this.tickets = ticketsFile.tickets ?? {};
    const effectsFile = await readJson<EffectsFile>(this.path("effects.json"), { effects: [] });
    this.effects = effectsFile.effects ?? [];
    const candidatesFile = await readJson<CandidatesFile>(this.path("candidates.json"), { candidates: [] });
    this.candidates = candidatesFile.candidates ?? [];
    const triggersFile = await readJson<TriggersFile>(this.path("triggers.json"), { triggers: [] });
    this.triggers = triggersFile.triggers ?? [];
  }

  getPolicy(): WorkPolicy {
    return this.policy;
  }

  async setPolicy(next: WorkPolicy): Promise<void> {
    this.policy = next;
    await writeJson(this.path("policy.json"), next);
  }

  listTickets(): WorkTicket[] {
    return Object.values(this.tickets);
  }

  getTicket(id: string): WorkTicket | undefined {
    return this.tickets[id];
  }

  findOpenTicketByTaskId(taskId: string): WorkTicket | undefined {
    return Object.values(this.tickets).find((t) => t.status === "open" && t.taskId === taskId);
  }

  async upsertTicket(ticket: WorkTicket): Promise<void> {
    this.tickets[ticket.id] = ticket;
    await writeJson(this.path("tickets.json"), { tickets: this.tickets });
  }

  async deleteTicket(id: string): Promise<boolean> {
    if (!(id in this.tickets)) return false;
    delete this.tickets[id];
    await writeJson(this.path("tickets.json"), { tickets: this.tickets });
    return true;
  }

  listEffects(): WorkEffect[] {
    return [...this.effects];
  }

  async setEffects(effects: WorkEffect[]): Promise<void> {
    this.effects = effects;
    await writeJson(this.path("effects.json"), { effects: this.effects });
  }

  async appendEffect(effect: WorkEffect): Promise<void> {
    this.effects.push(effect);
    await writeJson(this.path("effects.json"), { effects: this.effects });
  }

  async updateEffect(id: string, patch: Partial<WorkEffect>): Promise<WorkEffect | undefined> {
    const index = this.effects.findIndex((e) => e.id === id);
    if (index < 0) return undefined;
    const next = { ...this.effects[index]!, ...patch };
    this.effects[index] = next;
    await writeJson(this.path("effects.json"), { effects: this.effects });
    return next;
  }

  listCandidates(): WorkCandidate[] {
    return [...this.candidates];
  }

  async appendCandidate(candidate: WorkCandidate): Promise<void> {
    this.candidates.push(candidate);
    await writeJson(this.path("candidates.json"), { candidates: this.candidates });
  }

  async updateCandidate(id: string, patch: Partial<WorkCandidate>): Promise<WorkCandidate | undefined> {
    const index = this.candidates.findIndex((c) => c.id === id);
    if (index < 0) return undefined;
    const next = { ...this.candidates[index]!, ...patch };
    this.candidates[index] = next;
    await writeJson(this.path("candidates.json"), { candidates: this.candidates });
    return next;
  }

  getCandidate(id: string): WorkCandidate | undefined {
    return this.candidates.find((c) => c.id === id);
  }

  listTriggers(): WorkTrigger[] {
    return [...this.triggers];
  }

  /** Dedupe by trigger id — duplicates are ignored but still counted. */
  async storeTrigger(trigger: WorkTrigger): Promise<"duplicate" | "stored"> {
    if (this.triggers.some((t) => t.id === trigger.id)) {
      return "duplicate";
    }
    this.triggers.push(trigger);
    await writeJson(this.path("triggers.json"), { triggers: this.triggers });
    return "stored";
  }
}
