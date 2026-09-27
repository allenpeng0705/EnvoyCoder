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
  RESERVED_ORCHESTRATE_ROLE,
  defaultRoleCatalog,
  effectiveRoles,
  isJobRoleId,
  type JobRole,
  type MemberStatus,
  type RoleDef,
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
  roleCatalog: readonly RoleDef[];
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

/** Ensure every on-disk team has a roleCatalog (migration from pre-catalog files). */
export function normalizeTeamRecord(team: TeamRecord): TeamRecord {
  if (team.roleCatalog && team.roleCatalog.length > 0) return team;
  return { ...team, roleCatalog: defaultRoleCatalog() };
}

export function catalogIds(catalog: readonly RoleDef[]): ReadonlySet<string> {
  return new Set(catalog.map((r) => r.id));
}

export function validateRoleCatalog(catalog: readonly RoleDef[]): RoleDef[] {
  if (catalog.length === 0) {
    throw coderError(ENVOYDEV_ERRORS.badRequest, "A team needs at least one role.", ref("error.team.badRoles"));
  }
  const seen = new Set<string>();
  const out: RoleDef[] = [];
  for (const raw of catalog) {
    const id = raw.id.trim();
    if (!id || seen.has(id)) {
      throw coderError(
        ENVOYDEV_ERRORS.badRequest,
        "Role ids must be unique.",
        ref("error.team.badRoles"),
      );
    }
    if (!isJobRoleId(id)) {
      throw coderError(
        ENVOYDEV_ERRORS.badRequest,
        `Role id “${id}” is not a valid slug.`,
        ref("error.team.badRoles"),
      );
    }
    seen.add(id);
    const writer = id === RESERVED_ORCHESTRATE_ROLE ? false : !!raw.writer;
    out.push({
      id,
      writer,
      ...(raw.label?.trim() ? { label: raw.label.trim() } : {}),
    });
  }
  if (!seen.has(RESERVED_ORCHESTRATE_ROLE)) {
    throw coderError(
      ENVOYDEV_ERRORS.badRequest,
      "The role catalog must include orchestrate.",
      ref("error.team.badRoles"),
    );
  }
  return out;
}

/** Steps must use roles from the team catalog. */
export function assertStepsInCatalog(
  steps: readonly { role: string }[],
  catalog: readonly RoleDef[],
): void {
  const ids = catalogIds(catalog);
  for (const step of steps) {
    if (!ids.has(step.role)) {
      throw coderError(
        ENVOYDEV_ERRORS.badRequest,
        `Role “${step.role}” is not on this team.`,
        ref("error.team.badRoles"),
      );
    }
  }
}

/**
 * Roles a remote member may claim. Rejects unknown ids and reserved orchestrate.
 * Empty is allowed (origin may assign later).
 */
export function validateMemberRolesOffered(
  roles: readonly JobRole[] | undefined,
  catalog: readonly RoleDef[],
  opts: { allowOrchestrate: boolean },
): JobRole[] {
  const list = roles ? [...roles] : [];
  const ids = catalogIds(catalog);
  for (const role of list) {
    if (!ids.has(role)) {
      throw coderError(
        ENVOYDEV_ERRORS.badRequest,
        `Role “${role}” is not on this team.`,
        ref("error.team.badRoles"),
      );
    }
    if (role === RESERVED_ORCHESTRATE_ROLE && !opts.allowOrchestrate) {
      throw coderError(
        ENVOYDEV_ERRORS.badRequest,
        "Only this machine may offer the orchestrator role.",
        ref("error.team.badRoles"),
      );
    }
  }
  return list;
}

export function toPublic(team: TeamRecord): TeamPublic {
  const normalized = normalizeTeamRecord(team);
  return {
    id: normalized.id,
    label: normalized.label,
    tokenExpiresAt: normalized.tokenExpiresAt,
    tokenGeneration: normalized.tokenGeneration,
    roleCatalog: normalized.roleCatalog,
    members: normalized.members.map(({ memberTokenHash: _h, ...m }) => m),
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt,
  };
}

export async function readTeamFile(path: string): Promise<TeamFile> {
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as TeamFile;
    if (typeof parsed !== "object" || parsed === null || typeof parsed.teams !== "object") {
      return { teams: {} };
    }
    const teams: Record<string, TeamRecord> = {};
    for (const [id, team] of Object.entries(parsed.teams)) {
      if (team && typeof team === "object") {
        teams[id] = normalizeTeamRecord(team as TeamRecord);
      }
    }
    return { teams };
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

function buildInvite(token: string, originWs: string, label: string, roleCatalog: readonly RoleDef[]): string {
  return encodeTeamInvite({ token, originWs, label, roleCatalog });
}

export async function createTeam(
  path: string,
  input: {
    label: string;
    memberLabel?: string;
    rolesOffered?: readonly JobRole[];
    roleCatalog?: readonly RoleDef[];
    ttlHours?: number;
    originWs: string;
  },
  now: () => Date = () => new Date(),
): Promise<{ team: TeamPublic; token: string; invite: string }> {
  const file = await readTeamFile(path);
  const at = now();
  const token = mintToken();
  const ttlMs = (input.ttlHours ?? 24) * 60 * 60 * 1000;
  const roleCatalog = validateRoleCatalog(input.roleCatalog ?? defaultRoleCatalog());
  const offered = validateMemberRolesOffered(
    input.rolesOffered && input.rolesOffered.length > 0
      ? input.rolesOffered
      : roleCatalog.map((r) => r.id),
    roleCatalog,
    { allowOrchestrate: true },
  );
  if (!offered.includes(RESERVED_ORCHESTRATE_ROLE)) {
    offered.unshift(RESERVED_ORCHESTRATE_ROLE);
  }
  const localMember: TeamMember = {
    id: "local",
    label: (input.memberLabel ?? "This machine").trim() || "This machine",
    rolesOffered: offered,
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
    roleCatalog,
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
    invite: buildInvite(token, input.originWs, record.label, roleCatalog),
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
      rolesOffered: effectiveRoles(m),
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
    invite: buildInvite(token, input.originWs, next.label, normalizeTeamRecord(next).roleCatalog),
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
  const catalog = normalizeTeamRecord(team).roleCatalog;
  const roles = validateMemberRolesOffered(input.rolesOffered, catalog, { allowOrchestrate: false });
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
  const prior = existingIdx >= 0 ? team.members[existingIdx]! : undefined;
  const member: TeamMember = {
    id: memberId,
    label,
    rolesOffered: roles,
    ...(prior?.rolesAssigned && prior.rolesAssigned.length > 0
      ? { rolesAssigned: prior.rolesAssigned }
      : {}),
    ...(input.hostHints !== undefined ? { hostHints: input.hostHints } : {}),
    joinedAt: prior?.joinedAt ?? at.toISOString(),
    // §4.4: unknown until first dial / heartbeat — not silently "online".
    connection: unknownConnection(input.hostHints),
    acceptPolicy: prior?.acceptPolicy ?? { ...DEFAULT_ACCEPT_POLICY },
    memberTokenHash: hashToken(memberToken),
  };
  const members =
    existingIdx >= 0
      ? team.members.map((m, i) => (i === existingIdx ? member : m))
      : [...team.members, member];
  const next: TeamRecord = {
    ...team,
    roleCatalog: catalog,
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
    rolesOffered?: readonly JobRole[];
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
  const catalog = normalizeTeamRecord(team).roleCatalog;
  const rolesOffered =
    input.rolesOffered !== undefined
      ? validateMemberRolesOffered(input.rolesOffered, catalog, { allowOrchestrate: false })
      : row.rolesOffered;
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
    rolesOffered,
    connection,
    ...(input.acceptPolicy ? { acceptPolicy: input.acceptPolicy } : {}),
  };
  file.teams[team.id] = {
    ...team,
    roleCatalog: catalog,
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

/** Orchestrator override — empty clears so member rolesOffered apply again. */
export async function setMemberRolesAssigned(
  path: string,
  input: { teamId: string; memberId: string; roles: readonly JobRole[] },
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
  const catalog = normalizeTeamRecord(team).roleCatalog;
  const allowOrchestrate = input.memberId === "local";
  const roles =
    input.roles.length === 0
      ? []
      : validateMemberRolesOffered(input.roles, catalog, { allowOrchestrate });
  if (allowOrchestrate && roles.length > 0 && !roles.includes(RESERVED_ORCHESTRATE_ROLE)) {
    roles.unshift(RESERVED_ORCHESTRATE_ROLE);
  }
  const members = [...team.members];
  const row = members[idx]!;
  if (roles.length > 0) {
    members[idx] = { ...row, rolesAssigned: roles };
  } else {
    const { rolesAssigned: _cleared, ...rest } = row;
    members[idx] = rest;
  }
  file.teams[team.id] = { ...team, roleCatalog: catalog, members, updatedAt: new Date().toISOString() };
  await writeTeamFile(path, file);
  return members[idx]!;
}

/** Member (or origin for local) updates self-offered roles. */
export async function setMemberRolesOffered(
  path: string,
  input: { teamId: string; memberId: string; rolesOffered: readonly JobRole[] },
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
  const catalog = normalizeTeamRecord(team).roleCatalog;
  const allowOrchestrate = input.memberId === "local";
  const rolesOffered = validateMemberRolesOffered(input.rolesOffered, catalog, { allowOrchestrate });
  if (allowOrchestrate && !rolesOffered.includes(RESERVED_ORCHESTRATE_ROLE)) {
    rolesOffered.unshift(RESERVED_ORCHESTRATE_ROLE);
  }
  const members = [...team.members];
  members[idx] = { ...members[idx]!, rolesOffered };
  file.teams[team.id] = { ...team, roleCatalog: catalog, members, updatedAt: new Date().toISOString() };
  await writeTeamFile(path, file);
  return members[idx]!;
}

export async function setTeamRoleCatalog(
  path: string,
  input: { teamId: string; roleCatalog: readonly RoleDef[] },
): Promise<TeamPublic> {
  const file = await readTeamFile(path);
  const team = file.teams[input.teamId];
  if (!team) {
    throw coderError(ENVOYDEV_ERRORS.teamMissing, "No team with that id.", ref("error.team.missing"));
  }
  const roleCatalog = validateRoleCatalog(input.roleCatalog);
  const ids = catalogIds(roleCatalog);
  // Reject if any member still references a removed role (idle prune would surprise).
  for (const m of team.members) {
    for (const role of [...m.rolesOffered, ...(m.rolesAssigned ?? [])]) {
      if (!ids.has(role)) {
        throw coderError(
          ENVOYDEV_ERRORS.badRequest,
          `Cannot remove role “${role}” while a member still uses it.`,
          ref("error.team.badRoles"),
        );
      }
    }
  }
  const next: TeamRecord = {
    ...team,
    roleCatalog,
    updatedAt: new Date().toISOString(),
  };
  file.teams[team.id] = next;
  await writeTeamFile(path, file);
  return toPublic(next);
}

/**
 * Propose roles for a member when offered/assigned are empty (Phase 2).
 * Heuristic only — human must confirm via setMemberRolesAssigned / setMemberRolesOffered.
 * Never invents ids outside the team catalog; never includes orchestrate for remotes.
 */
export function suggestMemberRoles(
  team: TeamRecord,
  member: TeamMember,
  hint?: string,
): { roles: JobRole[]; note: string } {
  const catalog = normalizeTeamRecord(team).roleCatalog;
  const current = effectiveRoles(member);
  if (current.length > 0) {
    throw coderError(
      ENVOYDEV_ERRORS.badRequest,
      "That member already has roles. Clear the override or their offer first.",
      ref("error.team.badRoles"),
    );
  }
  const workers = catalog.filter((r) => r.id !== RESERVED_ORCHESTRATE_ROLE);
  const workerIds = workers.map((r) => r.id);
  if (workerIds.length === 0) {
    return {
      roles: [],
      note: "This team has no worker roles to suggest. Add roles to the catalog first.",
    };
  }
  const hintLower = hint?.toLowerCase() ?? "";
  const byHint = workerIds.find(
    (id) => hintLower.includes(id) || hintLower.includes(catalog.find((r) => r.id === id)?.label?.toLowerCase() ?? "\0"),
  );
  // Prefer a single primary: hint match → first writer → developer → first worker.
  const writerId = workers.find((r) => r.writer)?.id;
  let primary: JobRole =
    byHint ??
    (workerIds.includes("developer") ? "developer" : undefined) ??
    writerId ??
    workerIds[0]!;
  // Optional second role from hint keywords (tester/review, document/doc).
  const secondary: JobRole | undefined = (() => {
    if (hintLower.includes("test") && workerIds.includes("tester") && primary !== "tester") return "tester";
    if (hintLower.includes("design") && workerIds.includes("designer") && primary !== "designer") return "designer";
    if (
      (hintLower.includes("doc") || hintLower.includes("write")) &&
      workerIds.includes("document") &&
      primary !== "document"
    ) {
      return "document";
    }
    // Legacy catalog keywords
    if (hintLower.includes("review") && workerIds.includes("review") && primary !== "review") return "review";
    return undefined;
  })();
  const proposed: JobRole[] = secondary ? [primary, secondary] : [primary];
  return {
    roles: proposed,
    note: "Proposal only — confirm to assign. Daemon does not auto-apply.",
  };
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
