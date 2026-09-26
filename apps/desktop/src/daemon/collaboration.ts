/**
 * Collaborative task helpers (M5a / M5b).
 *
 * Pure validation and in-memory offer tracking — persistence of collaboration lives on `Task`
 * in the store; peer directory in `peers.ts`. See `docs/envoydev-collaboration.md`.
 */

import { randomUUID } from "node:crypto";

import {
  type AgentId,
  ENVOYDEV_ERRORS,
  type Task,
  type TaskCollaboration,
  type TaskParticipant,
  type TaskRole,
  coderError,
  isHarnessId,
  isTaskRole,
} from "@envoydev/protocol";

import { ref } from "./messages.js";

export interface ParticipantOffer {
  id: string;
  taskId: string;
  participantId: string;
  prompt: string;
  peerId: string;
  status: "pending" | "accepted" | "refused";
  policy?: string;
  createdAt: string;
}

function bad(message: string, key: Parameters<typeof ref>[0], values?: Record<string, string | number>) {
  return coderError(ENVOYDEV_ERRORS.badRequest, message, ref(key, values));
}

/** Validate and normalise a collaboration patch the owner sent. */
export function buildCollaboration(input: {
  participants: readonly TaskParticipant[];
  activeParticipantId?: string;
}): TaskCollaboration {
  if (input.participants.length === 0) {
    throw bad("A collaboration needs at least one participant.", "error.collaboration.empty");
  }
  const seen = new Set<string>();
  const participants: TaskParticipant[] = [];
  for (const raw of input.participants) {
    if (seen.has(raw.id)) {
      throw bad(
        `Two participants share the id “${raw.id}”. Each participant needs its own id.`,
        "error.collaboration.duplicateId",
        { id: raw.id },
      );
    }
    seen.add(raw.id);
    if (!isTaskRole(raw.role)) {
      throw bad(
        `“${raw.role}” is not a role this build knows. Use plan, implement, review, or observe.`,
        "error.collaboration.badRole",
        { role: String(raw.role) },
      );
    }
    if (raw.kind === "agent" && (raw.harness === undefined || raw.harness === "")) {
      throw bad(
        `Participant “${raw.id}” is an agent and needs a harness id.`,
        "error.collaboration.agentNeedsHarness",
        { id: raw.id },
      );
    }
    participants.push({
      id: raw.id,
      kind: raw.kind,
      role: raw.role as TaskRole,
      hostId: raw.hostId,
      ...(raw.harness !== undefined ? { harness: raw.harness } : {}),
      ...(raw.label !== undefined ? { label: raw.label } : {}),
    });
  }
  const implementers = participants.filter((p) => p.role === "implement");
  if (implementers.length > 1) {
    const hosts = new Set(implementers.map((p) => p.hostId));
    if (hosts.size < implementers.length) {
      throw bad(
        "Two implement roles on the same host would write the same tree. Keep one implementer per host.",
        "error.collaboration.multiWriter",
      );
    }
  }
  const active =
    input.activeParticipantId ??
    participants.find((p) => p.role === "plan")?.id ??
    participants[0]!.id;
  if (!seen.has(active)) {
    throw bad(
      `Active participant “${active}” is not in the participant list.`,
      "error.collaboration.activeMissing",
      { id: active },
    );
  }
  return { participants, activeParticipantId: active };
}

export function activeParticipant(task: Task): TaskParticipant | undefined {
  const collab = task.collaboration;
  if (collab === undefined) return undefined;
  const id = collab.activeParticipantId;
  if (id === undefined) return undefined;
  return collab.participants.find((p) => p.id === id);
}

/** Harness the next local run should use — active participant’s, else the task’s. */
export function harnessForRun(task: Task): AgentId {
  const active = activeParticipant(task);
  if (active?.kind === "agent" && active.harness !== undefined) return active.harness;
  return task.harness;
}

export function hostIdForRun(task: Task): string {
  const active = activeParticipant(task);
  if (active !== undefined) return active.hostId;
  return task.hostId ?? "local";
}

export function participantById(task: Task, id: string): TaskParticipant | undefined {
  return task.collaboration?.participants.find((p) => p.id === id);
}

/** In-memory offers for peer participant runs (M5b). Lost on restart — intentional for v1. */
export class OfferBook {
  private readonly offers = new Map<string, ParticipantOffer>();

  create(input: Omit<ParticipantOffer, "id" | "status" | "createdAt"> & { createdAt?: string }): ParticipantOffer {
    const offer: ParticipantOffer = {
      id: randomUUID(),
      taskId: input.taskId,
      participantId: input.participantId,
      prompt: input.prompt,
      peerId: input.peerId,
      status: "pending",
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    this.offers.set(offer.id, offer);
    return offer;
  }

  get(id: string): ParticipantOffer | undefined {
    return this.offers.get(id);
  }

  accept(id: string): ParticipantOffer {
    const offer = this.offers.get(id);
    if (offer === undefined) {
      throw coderError(
        ENVOYDEV_ERRORS.runMissing,
        "That offer is gone — it may have expired when the daemon restarted.",
        ref("error.collaboration.offerMissing"),
      );
    }
    if (offer.status !== "pending") {
      throw bad("That offer was already answered.", "error.collaboration.offerSettled");
    }
    const next = { ...offer, status: "accepted" as const };
    this.offers.set(id, next);
    return next;
  }

  refuse(id: string, policy: string): ParticipantOffer {
    const offer = this.offers.get(id);
    if (offer === undefined) {
      throw coderError(
        ENVOYDEV_ERRORS.runMissing,
        "That offer is gone — it may have expired when the daemon restarted.",
        ref("error.collaboration.offerMissing"),
      );
    }
    if (offer.status !== "pending") {
      throw bad("That offer was already answered.", "error.collaboration.offerSettled");
    }
    const next = { ...offer, status: "refused" as const, policy };
    this.offers.set(id, next);
    return next;
  }
}

/** True when this id looks like a shipped harness or a provider slug we might run. */
export function looksLikeAgentId(id: string): boolean {
  return isHarnessId(id) || (id.length > 0 && !id.includes(" "));
}
