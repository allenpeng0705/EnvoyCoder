/**
 * Peer-side team memberships and inbound step offers (M5).
 *
 * Origin owns `teams.json` / `jobs.json`. A member that joined remotely keeps a
 * local membership row (token + originWs + memberId) and inbound offers so the
 * window can Accept/Refuse without holding the whole team roster.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

import type { AcceptPolicy, JobRole, StepOffer } from "@envoydev/protocol";
import { DEFAULT_ACCEPT_POLICY } from "@envoydev/protocol";

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === "ENOENT";
}

async function readJsonFile<T>(path: string, empty: T): Promise<T> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if (isMissing(error)) return empty;
    return empty;
  }
}

async function writeJsonFile(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

export interface TeamMembership {
  teamId: string;
  memberId: string;
  label: string;
  teamLabel: string;
  /** Team token for heartbeat / origin notify. */
  token: string;
  /** Per-member secret from join — proves this machine is that roster row. */
  memberToken: string;
  originWs: string;
  rolesOffered: readonly JobRole[];
  acceptPolicy: AcceptPolicy;
  joinedAt: string;
}

export interface MembershipFile {
  memberships: Record<string, TeamMembership>;
}

export interface InboundOfferRecord extends StepOffer {
  /** Origin to notify on accept/refuse. */
  originWs: string;
  /** Team token presented with origin notify. */
  teamToken: string;
  receivedAt: string;
  /** Local task created for this offer's run (peer transcript §11.3). */
  taskId?: string;
  /** Pending harness approval so origin can answer first (§7.7). */
  pendingApproval?: { requestId: string; runId: string };
}

export interface InboundOfferFile {
  offers: Record<string, InboundOfferRecord>;
}

export async function readMemberships(path: string): Promise<MembershipFile> {
  const file = await readJsonFile<MembershipFile>(path, { memberships: {} });
  if (typeof file.memberships !== "object" || file.memberships === null) return { memberships: {} };
  return file;
}

export async function saveMembership(path: string, membership: TeamMembership): Promise<TeamMembership> {
  const file = await readMemberships(path);
  file.memberships[membership.teamId] = membership;
  await writeJsonFile(path, file);
  return membership;
}

export async function listMemberships(path: string): Promise<TeamMembership[]> {
  const file = await readMemberships(path);
  return Object.values(file.memberships).sort((a, b) => a.teamLabel.localeCompare(b.teamLabel));
}

export async function getMembership(path: string, teamId: string): Promise<TeamMembership | undefined> {
  const file = await readMemberships(path);
  return file.memberships[teamId];
}

export async function updateMembershipAcceptPolicy(
  path: string,
  teamId: string,
  acceptPolicy: AcceptPolicy,
): Promise<TeamMembership | undefined> {
  const file = await readMemberships(path);
  const row = file.memberships[teamId];
  if (!row) return undefined;
  const next = { ...row, acceptPolicy };
  file.memberships[teamId] = next;
  await writeJsonFile(path, file);
  return next;
}

export async function removeMembership(path: string, teamId: string): Promise<void> {
  const file = await readMemberships(path);
  delete file.memberships[teamId];
  await writeJsonFile(path, file);
}

export async function readInboundOffers(path: string): Promise<InboundOfferFile> {
  const file = await readJsonFile<InboundOfferFile>(path, { offers: {} });
  if (typeof file.offers !== "object" || file.offers === null) return { offers: {} };
  return file;
}

export async function saveInboundOffer(path: string, offer: InboundOfferRecord): Promise<InboundOfferRecord> {
  const file = await readInboundOffers(path);
  file.offers[offer.offerId] = offer;
  await writeJsonFile(path, file);
  return offer;
}

export async function listPendingInboundOffers(path: string): Promise<InboundOfferRecord[]> {
  const file = await readInboundOffers(path);
  return Object.values(file.offers)
    .filter((o) => o.status === "pending")
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}

export async function getInboundOffer(path: string, offerId: string): Promise<InboundOfferRecord | undefined> {
  const file = await readInboundOffers(path);
  return file.offers[offerId];
}

export async function patchInboundOffer(
  path: string,
  offerId: string,
  patch: Partial<InboundOfferRecord>,
): Promise<InboundOfferRecord | undefined> {
  const file = await readInboundOffers(path);
  const current = file.offers[offerId];
  if (!current) return undefined;
  const next = { ...current, ...patch };
  file.offers[offerId] = next;
  await writeJsonFile(path, file);
  return next;
}

export function defaultMemberAcceptPolicy(): AcceptPolicy {
  return { ...DEFAULT_ACCEPT_POLICY };
}
