/**
 * Teams settings — create / join / roster / jobs (M5 §11.2).
 *
 * Create and Join are two ruled routes (same pattern as Pairing). Phase 1 roles:
 * preset + custom catalog (orchestrator), member rolesOffered, orchestrator rolesAssigned override.
 */

import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";

import {
  PRESET_ROLE_CATALOG,
  RESERVED_ORCHESTRATE_ROLE,
  defaultRoleCatalog,
  effectiveRoles,
  type AcceptPolicy,
  type Job,
  type JobRole,
  type MemberStatus,
  type RoleDef,
} from "@envoydev/protocol";

import { useI18n } from "../../i18n/context.js";
import type { SettingsSectionProps } from "./SectionProps.js";
import { copyText } from "./clipboard.js";
import { peekInviteRoleCatalog } from "./peek-team-invite.js";

const AUTO_ACCEPT_ROLES = ["developer", "tester", "designer", "document"] as const satisfies readonly JobRole[];

function rolesFromPolicy(policy: AcceptPolicy): readonly JobRole[] {
  if (policy.mode !== "auto-roles") return [];
  return (policy.autoAcceptRoles ?? []).filter((r): r is JobRole =>
    (AUTO_ACCEPT_ROLES as readonly string[]).includes(r) || typeof r === "string",
  );
}

function policyFromRoles(roles: readonly JobRole[]): AcceptPolicy {
  if (roles.length === 0) return { mode: "manual" };
  return { mode: "auto-roles", autoAcceptRoles: [...roles] };
}

function tokenExpiringSoon(expiresAt: string, withinMs = 2 * 60 * 60 * 1000): boolean {
  return Date.parse(expiresAt) - Date.now() < withinMs;
}

function roleLabel(def: RoleDef): string {
  return def.label?.trim() || def.id;
}

type TeamPublicView = {
  id: string;
  label: string;
  tokenExpiresAt: string;
  tokenGeneration: number;
  roleCatalog: readonly RoleDef[];
  members: readonly {
    id: string;
    label: string;
    rolesOffered: readonly string[];
    rolesAssigned?: readonly string[];
    connection: { status: string; transport: string };
  }[];
  createdAt: string;
  updatedAt: string;
};

export function TeamsSection(
  props: SettingsSectionProps & {
    onOpenJob?: (jobId: string) => void;
    onOpenTask?: (taskId: string) => void;
  },
): ReactElement {
  const { t } = useI18n();
  const [teams, setTeams] = useState<readonly TeamPublicView[]>([]);
  const [boards, setBoards] = useState<Record<string, readonly MemberStatus[]>>({});
  const [jobs, setJobs] = useState<readonly Job[]>([]);
  const [label, setLabel] = useState("Desk team");
  const [memberLabel, setMemberLabel] = useState("desk");
  const [createCatalog, setCreateCatalog] = useState<RoleDef[]>(() => defaultRoleCatalog());
  const [createOffered, setCreateOffered] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(PRESET_ROLE_CATALOG.map((r) => [r.id, true])),
  );
  const [customRoleId, setCustomRoleId] = useState("");
  const [customRoleWriter, setCustomRoleWriter] = useState(true);
  const [joinToken, setJoinToken] = useState("");
  const [joinLabel, setJoinLabel] = useState("laptop");
  const [joinCatalog, setJoinCatalog] = useState<readonly RoleDef[]>(PRESET_ROLE_CATALOG.filter(
    (r) => r.id !== RESERVED_ORCHESTRATE_ROLE,
  ));
  const [joinRoles, setJoinRoles] = useState<Record<string, boolean>>({
    implement: true,
    review: true,
  });
  const [freshToken, setFreshToken] = useState<string | undefined>();
  const [freshInvite, setFreshInvite] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [jobTitle, setJobTitle] = useState("");
  const [jobGoal, setJobGoal] = useState("");
  const [jobTeamId, setJobTeamId] = useState<string | undefined>();
  const [inbound, setInbound] = useState<
    ReadonlyArray<
      import("@envoydev/protocol").StepOffer & {
        originWs: string;
        receivedAt: string;
        taskId?: string;
        runId?: string;
      }
    >
  >([]);
  const [lastPeerTaskId, setLastPeerTaskId] = useState<string | undefined>();
  const [memberships, setMemberships] = useState<
    ReadonlyArray<{
      teamId: string;
      memberId: string;
      teamLabel: string;
      rolesOffered: readonly string[];
      rolesAssigned?: readonly string[];
      roleCatalog?: readonly RoleDef[];
      acceptPolicy: import("@envoydev/protocol").AcceptPolicy;
    }>
  >([]);

  const createOfferable = useMemo(
    () => createCatalog.filter((r) => r.id === RESERVED_ORCHESTRATE_ROLE || createOffered[r.id]),
    [createCatalog, createOffered],
  );

  const reload = useCallback(async () => {
    const listed = await props.agents.listTeams();
    if (!listed.ok) {
      setNotice(listed.message);
      return;
    }
    setTeams(listed.teams as unknown as TeamPublicView[]);
    const nextBoards: Record<string, readonly MemberStatus[]> = {};
    for (const team of listed.teams) {
      const status = await props.agents.teamStatus(team.id);
      if (status.ok) nextBoards[team.id] = status.board;
    }
    setBoards(nextBoards);
    const jobList = await props.agents.listJobs({});
    if (jobList.ok) setJobs(jobList.jobs);
    const inboundList = await props.agents.listInboundJobOffers?.();
    if (inboundList?.ok) setInbound(inboundList.offers);
    const mem = await props.agents.listTeamMemberships?.();
    if (mem?.ok) {
      setMemberships(
        mem.memberships.map((m) => ({
          teamId: m.teamId,
          memberId: m.memberId,
          teamLabel: m.teamLabel,
          rolesOffered: m.rolesOffered,
          ...(m.rolesAssigned ? { rolesAssigned: m.rolesAssigned } : {}),
          ...(m.roleCatalog ? { roleCatalog: m.roleCatalog } : {}),
          acceptPolicy: m.acceptPolicy,
        })),
      );
    }
  }, [props.agents]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!joinToken.trim()) {
      setJoinCatalog(PRESET_ROLE_CATALOG.filter((r) => r.id !== RESERVED_ORCHESTRATE_ROLE));
      return;
    }
    try {
      const catalog = peekInviteRoleCatalog(joinToken);
      if (catalog && catalog.length > 0) {
        setJoinCatalog(catalog.filter((r) => r.id !== RESERVED_ORCHESTRATE_ROLE));
      }
    } catch {
      /* keep current catalog until paste is valid */
    }
  }, [joinToken]);

  function addCustomRole(): void {
    const id = customRoleId.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_-]{0,39}$/.test(id)) {
      setNotice(t("settings.teams.roleIdInvalid"));
      return;
    }
    if (createCatalog.some((r) => r.id === id)) {
      setNotice(t("settings.teams.roleIdDuplicate"));
      return;
    }
    setCreateCatalog((prev) => [...prev, { id, writer: customRoleWriter }]);
    setCreateOffered((prev) => ({ ...prev, [id]: false }));
    setCustomRoleId("");
    setCustomRoleWriter(true);
  }

  async function create(): Promise<void> {
    setBusy(true);
    setNotice(undefined);
    const rolesOffered = createOfferable.map((r) => r.id);
    const result = await props.agents.createTeam({
      label: label.trim() || "Team",
      memberLabel: memberLabel.trim() || "desk",
      rolesOffered,
      roleCatalog: createCatalog,
    });
    setBusy(false);
    if (!result.ok) {
      setNotice(result.message);
      return;
    }
    setFreshToken(result.token);
    setFreshInvite(result.invite ?? result.token);
    await reload();
  }

  async function join(): Promise<void> {
    setBusy(true);
    setNotice(undefined);
    const rolesOffered = joinCatalog.map((r) => r.id).filter((id) => joinRoles[id]);
    const result = await props.agents.joinTeam({
      token: joinToken.trim(),
      label: joinLabel.trim() || "member",
      rolesOffered,
    });
    setBusy(false);
    if (!result.ok) {
      setNotice(result.message);
      return;
    }
    setJoinToken("");
    setNotice(t("settings.teams.joinOk", { label: result.team.label }));
    await reload();
  }

  async function rotate(teamId: string): Promise<void> {
    if (!window.confirm(t("settings.teams.rotateConfirm"))) return;
    setBusy(true);
    const result = await props.agents.rotateTeamToken(teamId);
    setBusy(false);
    if (!result.ok) {
      setNotice(result.message);
      return;
    }
    setFreshToken(result.token);
    setFreshInvite(result.invite ?? result.token);
    await reload();
  }

  async function dissolve(teamId: string): Promise<void> {
    if (!window.confirm(t("settings.teams.dissolveConfirm"))) return;
    setBusy(true);
    const result = await props.agents.dissolveTeam(teamId);
    setBusy(false);
    if (!result.ok) {
      setNotice(result.message);
      return;
    }
    await reload();
  }

  async function createJob(): Promise<void> {
    const teamId = jobTeamId ?? teams[0]?.id;
    if (!teamId || !jobTitle.trim() || !jobGoal.trim()) return;
    setBusy(true);
    const cwd = props.state.projects[0]?.path ?? ".";
    const result = await props.agents.createJob({
      teamId,
      title: jobTitle.trim(),
      goal: jobGoal.trim(),
      projectId: props.state.projects[0]?.id,
      steps: [
        {
          role: "developer",
          brief: jobGoal.trim().slice(0, 500),
          worktreeKey: "main",
          cwdHint: cwd,
        },
      ],
    });
    setBusy(false);
    if (!result.ok) {
      setNotice(result.message);
      return;
    }
    setJobTitle("");
    setJobGoal("");
    await reload();
    props.onOpenJob?.(result.job.id);
  }

  return (
    <div className="settings__teams" data-testid="teams-section">
      <p className="settings__note">{t("settings.teams.blurb")}</p>
      {notice ? (
        <p className="settings__note settings__teams-status" role="status">
          {notice}
        </p>
      ) : null}

      {freshInvite || freshToken ? (
        <div className="settings__teams-invite" data-testid="team-token-once">
          <p className="settings__note">{t("settings.teams.tokenOnce")}</p>
          <code className="settings__pairing-value">{freshInvite ?? freshToken}</code>
          <button
            type="button"
            className="button button--secondary button--small"
            onClick={() =>
              void copyText(freshInvite ?? freshToken ?? "").then(() => setNotice(t("settings.teams.copied")))
            }
          >
            {t("settings.teams.copyToken")}
          </button>
        </div>
      ) : null}

      {inbound.length > 0 ? (
        <section className="settings__pairing-route" aria-labelledby="teams-inbound" data-testid="inbound-offers">
          <h2 className="settings__heading" id="teams-inbound">
            {t("settings.teams.inboundOffers")}
          </h2>
          <ul className="settings__teams-list">
            {inbound.map((offer) => (
              <li key={offer.offerId} className="settings__teams-offer">
                <div className="settings__teams-offer-main">
                  <span className="chip chip--quiet">{offer.role}</span>
                  <span>{offer.brief}</span>
                </div>
                <p className="settings__note">{offer.cwdHint}</p>
                <div className="settings__pairing-actions">
                  <button
                    type="button"
                    className="button button--primary button--small"
                    disabled={busy}
                    onClick={() => {
                      setBusy(true);
                      void props.agents.acceptInboundJobStepOffer(offer.offerId, offer.cwdHint).then((r) => {
                        setBusy(false);
                        if (!r.ok) setNotice(r.message);
                        else {
                          const withTask = r as { ok: true; taskId?: string };
                          if (withTask.taskId) {
                            setLastPeerTaskId(withTask.taskId);
                            props.onOpenTask?.(withTask.taskId);
                          }
                          void reload();
                        }
                      });
                    }}
                  >
                    {t("settings.teams.acceptOffer")}
                  </button>
                  <button
                    type="button"
                    className="button button--small"
                    disabled={busy}
                    onClick={() => {
                      const reason =
                        window.prompt(t("job.pane.refuseReasonPrompt"), "")?.trim() || "manual-refuse";
                      setBusy(true);
                      void props.agents.refuseInboundJobStepOffer(offer.offerId, reason).then((r) => {
                        setBusy(false);
                        if (!r.ok) setNotice(r.message);
                        else void reload();
                      });
                    }}
                  >
                    {t("settings.teams.refuseOffer")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {lastPeerTaskId ? (
        <p className="settings__note" data-testid="peer-run-link">
          <button
            type="button"
            className="button button--ghost button--small"
            onClick={() => props.onOpenTask?.(lastPeerTaskId)}
          >
            {t("job.pane.openRun")}
          </button>
        </p>
      ) : null}

      <section
        className="settings__pairing-route"
        data-route="create"
        aria-labelledby="teams-create"
        data-testid="teams-create"
      >
        <div className="settings__pairing-route-head">
          <h2 className="settings__heading" id="teams-create">
            {t("settings.teams.create")}
          </h2>
          <span className="chip chip--quiet">{t("settings.teams.create.badge")}</span>
        </div>
        <p className="settings__note">{t("settings.teams.create.detail")}</p>
        <div className="settings__pairing-fields">
          <label className="settings__teams-field">
            <span className="setting__title">{t("settings.teams.label")}</span>
            <input
              className="settings__pairing-input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </label>
          <label className="settings__teams-field">
            <span className="setting__title">{t("settings.teams.memberLabel")}</span>
            <input
              className="settings__pairing-input"
              value={memberLabel}
              onChange={(e) => setMemberLabel(e.target.value)}
              data-testid="create-member-label"
            />
          </label>

          <fieldset className="settings__teams-roles" data-testid="create-role-catalog">
            <legend className="setting__title">{t("settings.teams.roleCatalog")}</legend>
            <p className="settings__note">{t("settings.teams.roleCatalog.detail")}</p>
            <p className="settings__note">{t("settings.teams.writer.hint")}</p>
            <ul className="settings__teams-catalog">
              {createCatalog.map((def) => (
                <li key={def.id} className="settings__teams-catalog-row">
                  <span>
                    {roleLabel(def)}
                    {def.writer ? (
                      <span className="chip chip--quiet"> {t("settings.teams.writer")}</span>
                    ) : null}
                  </span>
                  {def.id !== RESERVED_ORCHESTRATE_ROLE ? (
                    <button
                      type="button"
                      className="button button--ghost button--small"
                      onClick={() => {
                        setCreateCatalog((prev) => prev.filter((r) => r.id !== def.id));
                        setCreateOffered((prev) => {
                          const next = { ...prev };
                          delete next[def.id];
                          return next;
                        });
                      }}
                    >
                      {t("settings.teams.removeRole")}
                    </button>
                  ) : (
                    <span className="settings__note">{t("settings.teams.roleLocked")}</span>
                  )}
                </li>
              ))}
            </ul>
            <div className="settings__teams-add-role">
              <input
                className="settings__pairing-input"
                placeholder={t("settings.teams.customRoleId")}
                value={customRoleId}
                onChange={(e) => setCustomRoleId(e.target.value)}
                data-testid="custom-role-id"
              />
              <label className="settings__teams-role">
                <input
                  type="checkbox"
                  checked={customRoleWriter}
                  onChange={(e) => setCustomRoleWriter(e.target.checked)}
                />
                {t("settings.teams.writer")}
              </label>
              <button type="button" className="button button--small" onClick={addCustomRole}>
                {t("settings.teams.addRole")}
              </button>
            </div>
          </fieldset>

          <fieldset className="settings__teams-roles" data-testid="create-roles-offered">
            <legend className="setting__title">{t("settings.teams.rolesThisMachine")}</legend>
            <div className="settings__teams-role-row">
              {createCatalog.map((def) => (
                <label key={def.id} className="settings__teams-role">
                  <input
                    type="checkbox"
                    checked={def.id === RESERVED_ORCHESTRATE_ROLE || !!createOffered[def.id]}
                    disabled={def.id === RESERVED_ORCHESTRATE_ROLE}
                    onChange={(e) =>
                      setCreateOffered((prev) => ({ ...prev, [def.id]: e.target.checked }))
                    }
                  />
                  {roleLabel(def)}
                </label>
              ))}
            </div>
          </fieldset>

          <button
            type="button"
            className="button button--primary"
            disabled={busy}
            onClick={() => void create()}
          >
            {t("settings.teams.create")}
          </button>
        </div>
      </section>

      <section
        className="settings__pairing-route"
        data-route="join"
        aria-labelledby="teams-join"
        data-testid="teams-join"
      >
        <div className="settings__pairing-route-head">
          <h2 className="settings__heading" id="teams-join">
            {t("settings.teams.join")}
          </h2>
          <span className="chip chip--quiet">{t("settings.teams.join.badge")}</span>
        </div>
        <p className="settings__note">{t("settings.teams.join.detail")}</p>
        <div className="settings__pairing-fields">
          <label className="settings__teams-field">
            <span className="setting__title">{t("settings.teams.pasteToken")}</span>
            <input
              className="settings__pairing-input"
              value={joinToken}
              onChange={(e) => setJoinToken(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <label className="settings__teams-field">
            <span className="setting__title">{t("settings.teams.memberLabel")}</span>
            <input
              className="settings__pairing-input"
              value={joinLabel}
              onChange={(e) => setJoinLabel(e.target.value)}
            />
          </label>
          <fieldset className="settings__teams-roles" data-testid="join-roles">
            <legend className="setting__title">{t("settings.teams.roles")}</legend>
            <p className="settings__note">{t("settings.teams.joinRolesHint")}</p>
            <div className="settings__teams-role-row">
              {joinCatalog.map((def) => (
                <label key={def.id} className="settings__teams-role">
                  <input
                    type="checkbox"
                    checked={!!joinRoles[def.id]}
                    onChange={(e) => setJoinRoles((prev) => ({ ...prev, [def.id]: e.target.checked }))}
                  />
                  {roleLabel(def)}
                </label>
              ))}
            </div>
          </fieldset>
          <button
            type="button"
            className="button button--secondary"
            disabled={busy || joinToken.trim().length < 16}
            onClick={() => void join()}
          >
            {t("settings.teams.join")}
          </button>
        </div>
      </section>

      <section className="settings__pairing-route" aria-labelledby="teams-yours">
        <h2 className="settings__heading" id="teams-yours">
          {t("settings.teams.yourTeams")}
        </h2>
        {teams.length === 0 ? (
          <p className="settings__note">{t("settings.teams.empty")}</p>
        ) : (
          <ul className="settings__teams-list">
            {teams.map((team) => {
              const board = boards[team.id] ?? [];
              const catalog = team.roleCatalog?.length ? team.roleCatalog : defaultRoleCatalog();
              const expiring = tokenExpiringSoon(team.tokenExpiresAt);
              return (
                <li key={team.id} className="settings__teams-card" data-testid={`team-${team.id}`}>
                  <div className="settings__teams-card-head">
                    <strong>{team.label}</strong>
                    <span className="settings__note">
                      {t("settings.teams.expires", { when: team.tokenExpiresAt.slice(0, 16) })}
                    </span>
                  </div>
                  {expiring ? (
                    <p className="settings__note" role="status" data-testid={`token-expiry-banner-${team.id}`}>
                      {t("settings.teams.tokenExpiring")}
                    </p>
                  ) : null}
                  <ul className="settings__teams-members">
                    {(board.length > 0
                      ? board.map((row) => {
                          const member = team.members.find((m) => m.id === row.memberId);
                          return { ...row, member };
                        })
                      : team.members.map((m) => ({
                          memberId: m.id,
                          label: m.label,
                          rolesOffered: effectiveRoles(m),
                          connection: m.connection,
                          member: m,
                        }))
                    ).map((row) => {
                      const member = row.member;
                      const assigned = member?.rolesAssigned ?? [];
                      const overrideActive = assigned.length > 0;
                      const effective = member
                        ? effectiveRoles(member)
                        : row.rolesOffered;
                      const unset = effective.length === 0;
                      const assignable = catalog.filter((r) =>
                        member?.id === "local" ? true : r.id !== RESERVED_ORCHESTRATE_ROLE,
                      );
                      return (
                        <li key={row.memberId} className="settings__teams-member-row">
                          <div>
                            <span
                              className={`chip chip--${row.connection.status === "online" ? "live" : "quiet"}`}
                            >
                              {connectionChip(row.connection.status, row.connection.transport)}
                            </span>{" "}
                            {row.label}
                            {member?.id === "local" ? (
                              <span className="chip chip--quiet"> {t("settings.teams.create.badge")}</span>
                            ) : null}
                            <span className="settings__note">
                              {" "}
                              · {effective.join(", ") || t("settings.teams.noRoles")}
                            </span>
                            {overrideActive ? (
                              <span className="settings__note"> · {t("settings.teams.overrideActive")}</span>
                            ) : null}
                          </div>
                          {member?.id === "local" ? (
                            <fieldset className="settings__teams-roles" data-testid={`local-offer-${member.id}`}>
                              <legend className="setting__title">{t("settings.teams.rolesThisMachine")}</legend>
                              <div className="settings__teams-role-row">
                                {catalog.map((def) => (
                                  <label key={def.id} className="settings__teams-role">
                                    <input
                                      type="checkbox"
                                      checked={
                                        def.id === RESERVED_ORCHESTRATE_ROLE ||
                                        member.rolesOffered.includes(def.id)
                                      }
                                      disabled={busy || def.id === RESERVED_ORCHESTRATE_ROLE}
                                      onChange={(e) => {
                                        const next = e.target.checked
                                          ? [...new Set([...member.rolesOffered, def.id])]
                                          : member.rolesOffered.filter((r) => r !== def.id);
                                        if (!next.includes(RESERVED_ORCHESTRATE_ROLE)) {
                                          next.unshift(RESERVED_ORCHESTRATE_ROLE);
                                        }
                                        void props.agents
                                          .setMemberRolesOffered(team.id, "local", next)
                                          .then((r) => {
                                            if (!r.ok) setNotice(r.message);
                                            else void reload();
                                          });
                                      }}
                                    />
                                    {roleLabel(def)}
                                  </label>
                                ))}
                              </div>
                            </fieldset>
                          ) : null}
                          {member ? (
                            <fieldset className="settings__teams-roles" data-testid={`assign-roles-${member.id}`}>
                              <legend className="setting__title">{t("settings.teams.assignRoles")}</legend>
                              <div className="settings__teams-role-row">
                                {assignable.map((def) => {
                                  const checked = overrideActive
                                    ? assigned.includes(def.id)
                                    : false;
                                  return (
                                    <label key={def.id} className="settings__teams-role">
                                      <input
                                        type="checkbox"
                                        checked={
                                          def.id === RESERVED_ORCHESTRATE_ROLE && member.id === "local"
                                            ? true
                                            : checked
                                        }
                                        disabled={
                                          busy ||
                                          (def.id === RESERVED_ORCHESTRATE_ROLE && member.id === "local")
                                        }
                                        onChange={(e) => {
                                          const base = overrideActive
                                            ? [...assigned]
                                            : [...effective];
                                          const next = e.target.checked
                                            ? [...new Set([...base, def.id])]
                                            : base.filter((r) => r !== def.id);
                                          if (member.id === "local" && !next.includes(RESERVED_ORCHESTRATE_ROLE)) {
                                            next.unshift(RESERVED_ORCHESTRATE_ROLE);
                                          }
                                          void props.agents
                                            .setMemberRolesAssigned(team.id, member.id, next)
                                            .then((r) => {
                                              if (!r.ok) setNotice(r.message);
                                              else void reload();
                                            });
                                        }}
                                      />
                                      {roleLabel(def)}
                                    </label>
                                  );
                                })}
                              </div>
                              <div className="settings__pairing-actions">
                                {unset ? (
                                  <button
                                    type="button"
                                    className="button button--small"
                                    disabled={busy}
                                    data-testid={`suggest-roles-${member.id}`}
                                    onClick={() => {
                                      setBusy(true);
                                      void props.agents
                                        .suggestMemberRoles(team.id, member.id)
                                        .then((r) => {
                                          if (!r.ok) {
                                            setBusy(false);
                                            setNotice(r.message);
                                            return;
                                          }
                                          if (r.roles.length === 0) {
                                            setBusy(false);
                                            setNotice(r.note);
                                            return;
                                          }
                                          setNotice(r.note);
                                          if (
                                            !window.confirm(
                                              t("settings.teams.suggestConfirm", {
                                                roles: r.roles.join(", "),
                                              }),
                                            )
                                          ) {
                                            setBusy(false);
                                            return;
                                          }
                                          void props.agents
                                            .setMemberRolesAssigned(team.id, member.id, r.roles)
                                            .then((apply) => {
                                              setBusy(false);
                                              if (!apply.ok) setNotice(apply.message);
                                              else void reload();
                                            });
                                        });
                                    }}
                                  >
                                    {t("settings.teams.suggestRoles")}
                                  </button>
                                ) : null}
                                {overrideActive ? (
                                  <button
                                    type="button"
                                    className="button button--ghost button--small"
                                    disabled={busy}
                                    onClick={() => {
                                      void props.agents
                                        .setMemberRolesAssigned(team.id, member.id, [])
                                        .then((r) => {
                                          if (!r.ok) setNotice(r.message);
                                          else void reload();
                                        });
                                    }}
                                  >
                                    {t("settings.teams.clearOverride")}
                                  </button>
                                ) : null}
                              </div>
                            </fieldset>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                  <div className="settings__pairing-actions">
                    <button
                      type="button"
                      className="button button--small"
                      disabled={busy}
                      onClick={() => void rotate(team.id)}
                    >
                      {t("settings.teams.rotate")}
                    </button>
                    <button
                      type="button"
                      className="button button--small"
                      disabled={busy}
                      onClick={() => void dissolve(team.id)}
                    >
                      {t("settings.teams.dissolve")}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {memberships.length > 0 ? (
        <section className="settings__pairing-route" aria-labelledby="teams-memberships">
          <h2 className="settings__heading" id="teams-memberships">
            {t("settings.teams.memberships")}
          </h2>
          <ul className="settings__teams-list">
            {memberships.map((m) => {
              const roles = rolesFromPolicy(m.acceptPolicy);
              const catalog = (m.roleCatalog ?? PRESET_ROLE_CATALOG).filter(
                (r) => r.id !== RESERVED_ORCHESTRATE_ROLE,
              );
              const override = m.rolesAssigned ?? [];
              return (
                <li key={m.teamId} className="settings__teams-card">
                  <strong>{m.teamLabel}</strong>
                  {override.length > 0 ? (
                    <p className="settings__note" role="status">
                      {t("settings.teams.assignedByOrigin", { roles: override.join(", ") })}
                    </p>
                  ) : null}
                  <fieldset className="settings__teams-roles" data-testid={`offer-roles-${m.teamId}`}>
                    <legend className="setting__title">{t("settings.teams.roles")}</legend>
                    <div className="settings__teams-role-row">
                      {catalog.map((def) => (
                          <label key={def.id} className="settings__teams-role">
                            <input
                              type="checkbox"
                              checked={m.rolesOffered.includes(def.id)}
                              disabled={busy || override.length > 0}
                              onChange={(e) => {
                                const next = e.target.checked
                                  ? [...new Set([...m.rolesOffered, def.id])]
                                  : m.rolesOffered.filter((r) => r !== def.id);
                                void props.agents
                                  .setMemberRolesOffered(m.teamId, m.memberId, next)
                                  .then((r) => {
                                    if (!r.ok) setNotice(r.message);
                                    else void reload();
                                  });
                              }}
                            />
                            {roleLabel(def)}
                          </label>
                        ))}
                    </div>
                  </fieldset>
                  <fieldset className="settings__teams-roles" data-testid={`accept-roles-${m.teamId}`}>
                    <legend className="setting__title">{t("settings.teams.autoAccept")}</legend>
                    <div className="settings__teams-role-row">
                      {catalog.map((def) => (
                          <label key={def.id} className="settings__teams-role">
                            <input
                              type="checkbox"
                              checked={roles.includes(def.id)}
                              onChange={(e) => {
                                const next = e.target.checked
                                  ? [...new Set([...roles, def.id])]
                                  : roles.filter((r) => r !== def.id);
                                void props.agents
                                  .setMemberAcceptPolicy(m.teamId, m.memberId, policyFromRoles(next))
                                  .then((r) => {
                                    if (!r.ok) setNotice(r.message);
                                    else void reload();
                                  });
                              }}
                            />
                            {roleLabel(def)}
                          </label>
                        ))}
                    </div>
                  </fieldset>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {teams.length > 0 ? (
        <section className="settings__pairing-route" aria-labelledby="teams-jobs">
          <h2 className="settings__heading" id="teams-jobs">
            {t("settings.teams.jobs")}
          </h2>
          <div className="settings__pairing-fields">
            <label className="settings__teams-field">
              <span className="setting__title">{t("settings.teams.jobTitle")}</span>
              <input
                className="settings__pairing-input"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
              />
            </label>
            <label className="settings__teams-field">
              <span className="setting__title">{t("settings.teams.jobGoal")}</span>
              <textarea
                className="settings__pairing-uri"
                value={jobGoal}
                onChange={(e) => setJobGoal(e.target.value)}
                rows={3}
              />
            </label>
            <label className="settings__teams-field">
              <span className="setting__title">{t("settings.teams.jobTeam")}</span>
              <select
                className="settings__pairing-input"
                value={jobTeamId ?? teams[0]?.id ?? ""}
                onChange={(e) => setJobTeamId(e.target.value)}
              >
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="button button--primary"
              disabled={busy || !jobTitle.trim() || !jobGoal.trim()}
              onClick={() => void createJob()}
            >
              {t("settings.teams.createJob")}
            </button>
          </div>
          {jobs.length > 0 ? (
            <ul className="settings__teams-list settings__teams-jobs">
              {jobs.map((job) => (
                <li key={job.id}>
                  <button
                    type="button"
                    className="button button--ghost"
                    onClick={() => props.onOpenJob?.(job.id)}
                  >
                    {job.title} · {job.status}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function connectionChip(status: string, transport: string): string {
  if (status === "online") return `Online · ${transport.toUpperCase()}`;
  if (status === "degraded") return `Unstable · ${transport.toUpperCase()}`;
  if (status === "connecting") return "Connecting…";
  if (status === "unknown") return "Unknown";
  if (status === "offline") return "Offline";
  return "Unknown";
}
