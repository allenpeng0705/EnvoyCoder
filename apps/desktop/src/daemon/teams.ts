/**
 * Team roster + team token + per-member join secrets (M5).
 *
 * Origin mints/rotates/revokes the team token; each join also mints a `memberToken`
 * (stored hashed) so heartbeat / progress cannot impersonate another roster row
 * with the shared team token alone. See `docs/envoydev-collaboration.md` §4.
 */

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  type AcceptPolicy,
  type ConnectionDetail,
  DEFAULT_ACCEPT_POLICY,
  ENVOYDEV_ERRORS,
  type JobRole,
  type MemberStatus,
  type Team,
  type TeamMember,
  coderError,
} from "@envoydev/protocol";

import { ref } from "./messages.js";
import { encodeTeamInvite } from "./team-invite.js";

export interface TeamFile {
  teams: Record<string, TeamRecord>;
}

/** On-disk team — plaintext token kept only for join validation on origin. */
export interface TeamRecord extends Team {
  /** Origin-only secret; never returned on list/status. */
  token: string;
  /** Last join / heartbeat / offer activity — idle expiry (§4.2). */
  lastActivityAt: string;
  /** Hours without activity before the token is rejected; default 8. */
  idleTtlHours?: number;
}

export interface TeamPublic {
  id: string;
  label: string;
  tokenExpiresAt: string;
  tokenGeneration: number;
  members: readonly TeamMember[];
  createdAt: string;
  updatedAt: string;
}

/** Default idle window (§4.2) — shorter than hard TTL so unused tokens die sooner. */
export const DEFAULT_TEAM_IDLE_TTL_HOURS = 8;

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === "ENOENT";
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function mintToken(): string {
  return randomBytes(24).toString("base64url");
}

function offlineConnection(): ConnectionDetail {
  return { status: "offline", transport: "none" };
}

function onlineLocal(): ConnectionDetail {
  const at = new Date().toISOString();
  return {
    status: "online",
    transport: "lan",
    connectedAt: at,
    lastHeartbeatAt: at,
  };
}

/** Rostered but not yet dialled / heartbeated this session (§4.4). */
function unknownConnection(hostHints?: string): ConnectionDetail {
  return {
    status: "unknown",
    transport: "none",
    ...(hostHints ? { endpoint: hostHints } : {}),
  };
}

export function toPublic(team: TeamRecord): TeamPublic {
  return {
    id: team.id,
    label: team.label,
    tokenExpiresAt: team.tokenExpiresAt,
    tokenGeneration: team.tokenGeneration,
    members: team.members.map(({ memberTokenHash: _h, ...m }) => m),
    createdAt: team.createdAt,
    updatedAt: team.updatedAt,
  };
}

export async function readTeamFile(path: string): Promise<TeamFile> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as TeamFile;
    if (typeof parsed !== "object" || parsed === null || typeof parsed.teams !== "object") {
      return { teams: {} };
    }
    return parsed;
  } catch (error) {
    if (isMissing(error)) return { teams: {} };
    return { teams: {} };
  }
}

async function writeTeamFile(path: string, file: TeamFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  await writeFile(tmp, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

function tokenExpired(team: TeamRecord, now: Date): boolean {
  if (Date.parse(team.tokenExpiresAt) <= now.getTime()) return true;
  const idleHours = team.idleTtlHours ?? DEFAULT_TEAM_IDLE_TTL_HOURS;
  const last = Date.parse(team.lastActivityAt || team.updatedAt);
  if (Number.isFinite(last) && now.getTime() - last > idleHours * 60 * 60 * 1000) return true;
  return false;
}

/** Bump lastActivityAt so idle expiry resets (heartbeat, offer dial, join). */
export async function touchTeamActivity(
  path: string,
  teamId: string,
  now: () => Date = () => new Date(),
): Promise<void> {
  const file = await readTeamFile(path);
  const team = file.teams[teamId];
  if (!team) return;
  const at = now().toISOString();
  file.teams[teamId] = { ...team, lastActivityAt: at, updatedAt: at };
  await writeTeamFile(path, file);
}

function buildInvite(token: string, originWs: string, label: string): string {
  return encodeTeamInvite({ token, originWs, label });
}

export async function createTeam(
  path: string,
  input: { label: string; ttlHours?: number; originWs: string },
  now: () => Date = () => new Date(),
): Promise<{ team: TeamPublic; token: string; invite: string }> {
  const file = await readTeamFile(path);
  const at = now();
  const token = mintToken();
  const ttlMs = (input.ttlHours ?? 24) * 60 * 60 * 1000;
  const localMember: TeamMember = {
    id: "local",
    label: "This machine",
    rolesOffered: ["orchestrate", "plan", "implement", "review", "observe"],
    joinedAt: at.toISOString(),
    connection: onlineLocal(),
    acceptPolicy: { ...DEFAULT_ACCEPT_POLICY },
  };
  const record: TeamRecord = {
    id: randomUUID(),
    label: input.label.trim(),
    token,
    tokenHash: hashToken(token),
    tokenExpiresAt: new Date(at.getTime() + ttlMs).toISOString(),
    tokenGeneration: 1,
    members: [localMember],
    createdAt: at.toISOString(),
    updatedAt: at.toISOString(),
    lastActivityAt: at.toISOString(),
    idleTtlHours: DEFAULT_TEAM_IDLE_TTL_HOURS,
  };
  file.teams[record.id] = record;
  await writeTeamFile(path, file);
  return {
    team: toPublic(record),
    token,
    invite: buildInvite(token, input.originWs, record.label),
  };
}

export async function listTeams(path: string): Promise<TeamPublic[]> {
  const file = await readTeamFile(path);
  return Object.values(file.teams)
    .map(toPublic)
    .sort((a, b) => a.label.localeCompare(b.label));
}

export async function getTeamRecord(path: string, teamId: string): Promise<TeamRecord | undefined> {
  const file = await readTeamFile(path);
  return file.teams[teamId];
}

export async function requireTeam(path: string, teamId: string): Promise<TeamRecord> {
  const team = await getTeamRecord(path, teamId);
  if (!team) {
    throw coderError(ENVOYDEV_ERRORS.teamMissing, "No team with that id.", ref("error.team.missing"));
  }
  return team;
}

/** Status board: connection + optional work progress from active jobs. */
export function buildMemberStatusBoard(
  team: TeamRecord,
  jobs: readonly {
    steps: readonly {
      id: string;
      status: string;
      assigneeMemberId?: string;
      resultRef?: string;
      runPhase?: string;
      lastEventAt?: string;
      blocked?: string;
    }[];
  }[] = [],
): MemberStatus[] {
  return team.members.map((m) => {
    let currentStepId: string | undefined;
    let currentRunId: string | undefined;
    let runPhase: MemberStatus["runPhase"];
    let lastEventAt: string | undefined;
    let blocked: MemberStatus["blocked"];
    for (const job of jobs) {
      for (const step of job.steps) {
        if (step.assigneeMemberId !== m.id) continue;
        if (step.status !== "running" && step.status !== "offered") continue;
        currentStepId = step.id;
        currentRunId = step.resultRef;
        if (
          step.runPhase === "starting" ||
          step.runPhase === "streaming" ||
          step.runPhase === "needs-attention" ||
          step.runPhase === "idle"
        ) {
          runPhase = step.runPhase;
        }
        lastEventAt = step.lastEventAt;
        if (
          step.blocked === "no-progress" ||
          step.blocked === "needs-attention" ||
          step.blocked === "heartbeat-miss" ||
          step.blocked === "offer-unacked" ||
          step.blocked === "cancel-pending"
        ) {
          blocked = step.blocked;
        }
      }
    }
    return {
      memberId: m.id,
      label: m.label,
      rolesOffered: m.rolesOffered,
      connection: m.connection,
      ...(currentStepId ? { currentStepId } : {}),
      ...(currentRunId ? { currentRunId } : {}),
      ...(runPhase ? { runPhase } : {}),
      ...(lastEventAt ? { lastEventAt } : {}),
      ...(blocked ? { blocked } : {}),
    };
  });
}

export async function rotateTeamToken(
  path: string,
  teamId: string,
  input: { ttlHours?: number; originWs: string },
  now: () => Date = () => new Date(),
): Promise<{ team: TeamPublic; token: string; invite: string }> {
  const file = await readTeamFile(path);
  const team = file.teams[teamId];
  if (!team) {
    throw coderError(ENVOYDEV_ERRORS.teamMissing, "No team with that id.", ref("error.team.missing"));
  }
  const at = now();
  const token = mintToken();
  const ttlMs = (input.ttlHours ?? 24) * 60 * 60 * 1000;
  const members = team.members.map((m) =>
    m.id === "local"
      ? { ...m, connection: onlineLocal() }
      : {
          ...m,
          connection: offlineConnection(),
          // Old memberTokens die with the rotation — peers must rejoin the new invite.
          memberTokenHash: undefined,
        },
  );
  const next: TeamRecord = {
    ...team,
    token,
    tokenHash: hashToken(token),
    tokenExpiresAt: new Date(at.getTime() + ttlMs).toISOString(),
    tokenGeneration: team.tokenGeneration + 1,
    members,
    updatedAt: at.toISOString(),
    lastActivityAt: at.toISOString(),
  };
  file.teams[teamId] = next;
  await writeTeamFile(path, file);
  return {
    team: toPublic(next),
    token,
    invite: buildInvite(token, input.originWs, next.label),
  };
}

export async function dissolveTeam(path: string, teamId: string): Promise<boolean> {
  const file = await readTeamFile(path);
  if (file.teams[teamId] === undefined) {
    throw coderError(ENVOYDEV_ERRORS.teamMissing, "No team with that id.", ref("error.team.missing"));
  }
  delete file.teams[teamId];
  await writeTeamFile(path, file);
  return true;
}

export async function joinTeam(
  path: string,
  input: {
    token: string;
    label: string;
    rolesOffered?: readonly JobRole[];
    hostHints?: string;
  },
  now: () => Date = () => new Date(),
): Promise<{ teamId: string; memberId: string; team: TeamPublic; memberToken: string }> {
  const file = await readTeamFile(path);
  const at = now();
  const hash = hashToken(input.token);
  const team = Object.values(file.teams).find((t) => t.tokenHash === hash || t.token === input.token);
  if (!team) {
    throw coderError(ENVOYDEV_ERRORS.unauthorized, "That team token is not valid.", ref("error.team.badToken"));
  }
  if (tokenExpired(team, at)) {
    throw coderError(ENVOYDEV_ERRORS.teamExpired, "That team token has expired.", ref("error.team.expired"));
  }
  const roles: JobRole[] =
    input.rolesOffered && input.rolesOffered.length > 0
      ? [...input.rolesOffered]
      : ["implement", "review"];
  const label = input.label.trim();
  // Same machine rejoining (same hostHints, else same label): refresh the row instead of a zombie duplicate.
  const existingIdx = team.members.findIndex(
    (m) =>
      m.id !== "local" &&
      (input.hostHints
        ? m.hostHints === input.hostHints
        : m.label === label && !m.hostHints),
  );
  const memberId = existingIdx >= 0 ? team.members[existingIdx]!.id : randomUUID();
  const memberToken = mintToken();
  const member: TeamMember = {
    id: memberId,
    label,
    rolesOffered: roles,
    ...(input.hostHints !== undefined ? { hostHints: input.hostHints } : {}),
    joinedAt: existingIdx >= 0 ? team.members[existingIdx]!.joinedAt : at.toISOString(),
    // §4.4: unknown until first dial / heartbeat — not silently "online".
    connection: unknownConnection(input.hostHints),
    acceptPolicy:
      existingIdx >= 0 ? team.members[existingIdx]!.acceptPolicy : { ...DEFAULT_ACCEPT_POLICY },
    memberTokenHash: hashToken(memberToken),
  };
  const members =
    existingIdx >= 0
      ? team.members.map((m, i) => (i === existingIdx ? member : m))
      : [...team.members, member];
  const next: TeamRecord = {
    ...team,
    members,
    updatedAt: at.toISOString(),
    lastActivityAt: at.toISOString(),
  };
  file.teams[team.id] = next;
  await writeTeamFile(path, file);
  return { teamId: team.id, memberId, team: toPublic(next), memberToken };
}

export async function teamHeartbeat(
  path: string,
  input: {
    teamId: string;
    memberId: string;
    token: string;
    memberToken: string;
    acceptPolicy?: AcceptPolicy;
  },
  now: () => Date = () => new Date(),
): Promise<ConnectionDetail> {
  const file = await readTeamFile(path);
  const team = file.teams[input.teamId];
  if (!team) {
    throw coderError(ENVOYDEV_ERRORS.teamMissing, "No team with that id.", ref("error.team.missing"));
  }
  const at = now();
  if (tokenExpired(team, at) || (team.token !== input.token && team.tokenHash !== hashToken(input.token))) {
    throw coderError(ENVOYDEV_ERRORS.teamExpired, "That team token is no longer valid.", ref("error.team.expired"));
  }
  if (input.memberId === "local") {
    throw coderError(
      ENVOYDEV_ERRORS.unauthorized,
      "This machine does not heartbeat as local.",
      ref("error.team.unknownMember"),
    );
  }
  const idx = team.members.findIndex((m) => m.id === input.memberId);
  if (idx < 0) {
    throw coderError(ENVOYDEV_ERRORS.unauthorized, "That member is not on this team.", ref("error.team.unknownMember"));
  }
  const row = team.members[idx]!;
  if (!row.memberTokenHash || row.memberTokenHash !== hashToken(input.memberToken)) {
    throw coderError(
      ENVOYDEV_ERRORS.unauthorized,
      "That member token is not valid.",
      ref("error.team.badToken"),
    );
  }
  const connection: ConnectionDetail = {
    ...row.connection,
    status: "online",
    lastHeartbeatAt: at.toISOString(),
    connectedAt: row.connection.connectedAt ?? at.toISOString(),
    transport: row.connection.transport === "none" ? "lan" : row.connection.transport,
  };
  const members = [...team.members];
  members[idx] = {
    ...row,
    connection,
    ...(input.acceptPolicy ? { acceptPolicy: input.acceptPolicy } : {}),
  };
  file.teams[team.id] = {
    ...team,
    members,
    updatedAt: at.toISOString(),
    lastActivityAt: at.toISOString(),
  };
  await writeTeamFile(path, file);
  return connection;
}

/** Verify a member's join secret (origin-side). */
export function memberTokenMatches(member: TeamMember, memberToken: string | undefined): boolean {
  if (typeof memberToken !== "string" || memberToken.trim().length < 16) return false;
  if (!member.memberTokenHash) return false;
  return member.memberTokenHash === hashToken(memberToken);
}

export async function setMemberAcceptPolicy(
  path: string,
  input: { teamId: string; memberId: string; acceptPolicy: AcceptPolicy },
): Promise<TeamMember> {
  const file = await readTeamFile(path);
  const team = file.teams[input.teamId];
  if (!team) {
    throw coderError(ENVOYDEV_ERRORS.teamMissing, "No team with that id.", ref("error.team.missing"));
  }
  const idx = team.members.findIndex((m) => m.id === input.memberId);
  if (idx < 0) {
    throw coderError(ENVOYDEV_ERRORS.badRequest, "That member is not on this team.", ref("error.team.unknownMember"));
  }
  const members = [...team.members];
  members[idx] = { ...members[idx]!, acceptPolicy: input.acceptPolicy };
  file.teams[team.id] = { ...team, members, updatedAt: new Date().toISOString() };
  await writeTeamFile(path, file);
  return members[idx]!;
}

export async function kickMember(path: string, teamId: string, memberId: string): Promise<void> {
  if (memberId === "local") {
    throw coderError(ENVOYDEV_ERRORS.badRequest, "Cannot kick this machine from its own team.", ref("error.team.kickLocal"));
  }
  const file = await readTeamFile(path);
  const team = file.teams[teamId];
  if (!team) {
    throw coderError(ENVOYDEV_ERRORS.teamMissing, "No team with that id.", ref("error.team.missing"));
  }
  if (!team.members.some((m) => m.id === memberId)) {
    throw coderError(ENVOYDEV_ERRORS.badRequest, "That member is not on this team.", ref("error.team.unknownMember"));
  }
  file.teams[teamId] = {
    ...team,
    members: team.members.filter((m) => m.id !== memberId),
    updatedAt: new Date().toISOString(),
  };
  await writeTeamFile(path, file);
}

/** Persist a dial/heartbeat result onto the member's ConnectionDetail. */
export async function updateMemberConnection(
  path: string,
  teamId: string,
  memberId: string,
  connection: ConnectionDetail,
): Promise<TeamMember | undefined> {
  const file = await readTeamFile(path);
  const team = file.teams[teamId];
  if (!team) return undefined;
  const idx = team.members.findIndex((m) => m.id === memberId);
  if (idx < 0) return undefined;
  const members = [...team.members];
  members[idx] = { ...members[idx]!, connection };
  file.teams[teamId] = { ...team, members, updatedAt: new Date().toISOString() };
  await writeTeamFile(path, file);
  return members[idx];
}

/** Mark members offline when heartbeat is older than 3H (H=15s → 45s). Leave `unknown` alone. */
export async function refreshConnectionStatuses(
  path: string,
  heartbeatMs = 15_000,
  now: () => Date = () => new Date(),
): Promise<void> {
  const file = await readTeamFile(path);
  const at = now().getTime();
  let changed = false;
  for (const id of Object.keys(file.teams)) {
    const team = file.teams[id]!;
    const members = team.members.map((m) => {
      if (m.id === "local") return m;
      if (m.connection.status === "unknown") return m;
      const last = m.connection.lastHeartbeatAt ? Date.parse(m.connection.lastHeartbeatAt) : 0;
      const age = at - last;
      let status = m.connection.status;
      if (age > heartbeatMs * 3) status = "offline";
      else if (age > heartbeatMs) status = "degraded";
      else if (last > 0) status = "online";
      if (status === m.connection.status) return m;
      changed = true;
      return { ...m, connection: { ...m.connection, status } };
    });
    if (changed) {
      file.teams[id] = { ...team, members, updatedAt: new Date(at).toISOString() };
    }
  }
  if (changed) await writeTeamFile(path, file);
}

export function memberOnlineForAssign(
  member: TeamMember,
  allowDegraded: boolean,
): boolean {
  if (member.connection.status === "online") return true;
  if (allowDegraded && member.connection.status === "degraded") return true;
  return false;
}

/** Resolve plaintext token for a team (origin-only). Does not check expiry. */
export async function teamTokenPlain(path: string, teamId: string): Promise<string | undefined> {
  const team = await getTeamRecord(path, teamId);
  return team?.token;
}

/**
 * Live team token only — undefined when missing or expired (hard TTL / idle).
 * Prefer this for pre-auth mutators so an expired invite secret cannot still accept work.
 */
export async function liveTeamTokenPlain(
  path: string,
  teamId: string,
  now: () => Date = () => new Date(),
): Promise<string | undefined> {
  const team = await getTeamRecord(path, teamId);
  if (!team?.token) return undefined;
  if (tokenExpired(team, now())) return undefined;
  return team.token;
}

/**
 * Resolve a live team from a plaintext token (mesh handshake / session identity).
 * Returns null when unknown, expired, or idle-expired — same fail-closed as join.
 */
export async function findActiveTeamByToken(
  path: string,
  token: string,
  now: () => Date = () => new Date(),
): Promise<{ teamId: string; label: string } | null> {
  if (!token.trim()) return null;
  const file = await readTeamFile(path);
  const at = now();
  const hash = hashToken(token);
  const team = Object.values(file.teams).find((t) => t.tokenHash === hash || t.token === token);
  if (!team) return null;
  if (tokenExpired(team, at)) return null;
  return { teamId: team.id, label: team.label };
}
