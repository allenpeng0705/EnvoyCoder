/**
 * Teams settings — create / join / connection chips / token (M5 §11.2).
 */

import { useCallback, useEffect, useState, type ReactElement } from "react";

import type { AcceptPolicy, Job, JobRole, MemberStatus } from "@envoydev/protocol";

import { useI18n } from "../../i18n/context.js";
import type { SettingsSectionProps } from "./SectionProps.js";
import { copyText } from "./clipboard.js";

const AUTO_ACCEPT_ROLES = ["plan", "implement", "review", "observe"] as const satisfies readonly JobRole[];

function rolesFromPolicy(policy: AcceptPolicy): readonly JobRole[] {
  if (policy.mode !== "auto-roles") return [];
  return (policy.autoAcceptRoles ?? []).filter((r): r is JobRole =>
    (AUTO_ACCEPT_ROLES as readonly string[]).includes(r),
  );
}

function policyFromRoles(roles: readonly JobRole[]): AcceptPolicy {
  if (roles.length === 0) return { mode: "manual" };
  return { mode: "auto-roles", autoAcceptRoles: [...roles] };
}

function tokenExpiringSoon(expiresAt: string, withinMs = 2 * 60 * 60 * 1000): boolean {
  return Date.parse(expiresAt) - Date.now() < withinMs;
}

type TeamPublicView = {
  id: string;
  label: string;
  tokenExpiresAt: string;
  tokenGeneration: number;
  members: readonly {
    id: string;
    label: string;
    rolesOffered: readonly string[];
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
  const [joinToken, setJoinToken] = useState("");
  const [joinLabel, setJoinLabel] = useState("laptop");
  const [joinRoles, setJoinRoles] = useState<Record<"plan" | "implement" | "review" | "observe", boolean>>({
    plan: false,
    implement: true,
    review: true,
    observe: false,
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
      acceptPolicy: import("@envoydev/protocol").AcceptPolicy;
    }>
  >([]);

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
          acceptPolicy: m.acceptPolicy,
        })),
      );
    }
  }, [props.agents]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function create(): Promise<void> {
    setBusy(true);
    setNotice(undefined);
    const result = await props.agents.createTeam({ label: label.trim() || "Team" });
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
    const rolesOffered = (["plan", "implement", "review", "observe"] as const).filter(
      (r) => joinRoles[r],
    );
    const result = await props.agents.joinTeam({
      token: joinToken.trim(),
      label: joinLabel.trim() || "member",
      rolesOffered: rolesOffered.length > 0 ? rolesOffered : ["implement"],
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
          role: "implement",
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
      {notice ? <p className="settings__note" role="status">{notice}</p> : null}
      {freshInvite || freshToken ? (
        <div className="settings__pairing-route" data-testid="team-token-once">
          <p className="settings__note">{t("settings.teams.tokenOnce")}</p>
          <code className="settings__pairing-value">{freshInvite ?? freshToken}</code>
          <button
            type="button"
            className="button"
            onClick={() =>
              void copyText(freshInvite ?? freshToken ?? "").then(() => setNotice(t("settings.teams.copied")))
            }
          >
            {t("settings.teams.copyToken")}
          </button>
        </div>
      ) : null}

      {inbound.length > 0 ? (
        <section aria-labelledby="teams-inbound" data-testid="inbound-offers">
          <h2 className="settings__heading" id="teams-inbound">
            {t("settings.teams.inboundOffers")}
          </h2>
          <ul className="settings__list">
            {inbound.map((offer) => (
              <li key={offer.offerId}>
                <span className="chip">{offer.role}</span> {offer.brief}
                <p className="settings__note">cwd: {offer.cwdHint}</p>
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
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {lastPeerTaskId ? (
        <p className="settings__note" data-testid="peer-run-link">
          <button
            type="button"
            className="button button--ghost"
            onClick={() => props.onOpenTask?.(lastPeerTaskId)}
          >
            {t("job.pane.openRun")}
          </button>
        </p>
      ) : null}

      {memberships.length > 0 ? (
        <section aria-labelledby="teams-memberships">
          <h2 className="settings__heading" id="teams-memberships">
            {t("settings.teams.memberships")}
          </h2>
          <ul className="settings__list">
            {memberships.map((m) => {
              const roles = rolesFromPolicy(m.acceptPolicy);
              return (
                <li key={m.teamId}>
                  {m.teamLabel}
                  <fieldset className="settings__pairing-field" data-testid={`accept-roles-${m.teamId}`}>
                    <legend className="setting__title">{t("settings.teams.autoAccept")}</legend>
                    {(
                      [
                        ["plan", "settings.teams.role.plan"],
                        ["implement", "settings.teams.role.implement"],
                        ["review", "settings.teams.role.review"],
                        ["observe", "settings.teams.role.observe"],
                      ] as const
                    ).map(([role, key]) => (
                      <label key={role} className="settings__pairing-field">
                        <input
                          type="checkbox"
                          checked={roles.includes(role)}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...new Set([...roles, role])]
                              : roles.filter((r) => r !== role);
                            void props.agents
                              .setMemberAcceptPolicy(
                                m.teamId,
                                m.memberId,
                                policyFromRoles(next),
                              )
                              .then((r) => {
                                if (!r.ok) setNotice(r.message);
                                else void reload();
                              });
                          }}
                        />{" "}
                        {t(key)}
                      </label>
                    ))}
                  </fieldset>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="teams-create">
        <h2 className="settings__heading" id="teams-create">
          {t("settings.teams.create")}
        </h2>
        <label className="settings__pairing-field">
          <span className="setting__title">{t("settings.teams.label")}</span>
          <input
            className="settings__pairing-input"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <button type="button" className="button button--primary" disabled={busy} onClick={() => void create()}>
          {t("settings.teams.create")}
        </button>
      </section>

      <section aria-labelledby="teams-join">
        <h2 className="settings__heading" id="teams-join">
          {t("settings.teams.join")}
        </h2>
        <label className="settings__pairing-field">
          <span className="setting__title">{t("settings.teams.pasteToken")}</span>
          <input
            className="settings__pairing-input"
            value={joinToken}
            onChange={(e) => setJoinToken(e.target.value)}
            autoComplete="off"
          />
        </label>
        <label className="settings__pairing-field">
          <span className="setting__title">{t("settings.teams.memberLabel")}</span>
          <input
            className="settings__pairing-input"
            value={joinLabel}
            onChange={(e) => setJoinLabel(e.target.value)}
          />
        </label>
        <fieldset className="settings__pairing-field" data-testid="join-roles">
          <legend className="setting__title">{t("settings.teams.roles")}</legend>
          {(
            [
              ["plan", "settings.teams.role.plan"],
              ["implement", "settings.teams.role.implement"],
              ["review", "settings.teams.role.review"],
              ["observe", "settings.teams.role.observe"],
            ] as const
          ).map(([role, key]) => (
            <label key={role} className="settings__pairing-field">
              <input
                type="checkbox"
                checked={joinRoles[role]}
                onChange={(e) => setJoinRoles((prev) => ({ ...prev, [role]: e.target.checked }))}
              />{" "}
              {t(key)}
            </label>
          ))}
        </fieldset>
        <button type="button" className="button" disabled={busy || joinToken.trim().length < 16} onClick={() => void join()}>
          {t("settings.teams.join")}
        </button>
      </section>

      {teams.length === 0 ? (
        <p className="settings__note">{t("settings.teams.empty")}</p>
      ) : (
        <ul className="settings__list">
          {teams.map((team) => {
            const board = boards[team.id] ?? [];
            const expiring = tokenExpiringSoon(team.tokenExpiresAt);
            return (
              <li key={team.id} className="settings__list-item" data-testid={`team-${team.id}`}>
                <strong>{team.label}</strong>
                <span className="settings__note">
                  {t("settings.teams.expires", { when: team.tokenExpiresAt.slice(0, 16) })}
                </span>
                {expiring ? (
                  <p className="settings__note" role="status" data-testid={`token-expiry-banner-${team.id}`}>
                    {t("settings.teams.tokenExpiring")}{" "}
                    <button
                      type="button"
                      className="button button--small"
                      disabled={busy}
                      onClick={() => void rotate(team.id)}
                    >
                      {t("settings.teams.rotate")}
                    </button>
                  </p>
                ) : null}
                <ul>
                  {(board.length > 0 ? board : team.members.map((m) => ({
                    memberId: m.id,
                    label: m.label,
                    rolesOffered: m.rolesOffered,
                    connection: m.connection,
                  }))).map((row) => (
                    <li key={row.memberId}>
                      <span className={`chip chip--${row.connection.status === "online" ? "live" : "quiet"}`}>
                        {connectionChip(row.connection.status, row.connection.transport)}
                      </span>{" "}
                      {row.label} · {row.rolesOffered.join(", ")}
                    </li>
                  ))}
                </ul>
                <div className="settings__pairing-actions">
                  <button type="button" className="button" disabled={busy} onClick={() => void rotate(team.id)}>
                    {t("settings.teams.rotate")}
                  </button>
                  <button type="button" className="button" disabled={busy} onClick={() => void dissolve(team.id)}>
                    {t("settings.teams.dissolve")}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {teams.length > 0 ? (
        <section aria-labelledby="teams-jobs">
          <h2 className="settings__heading" id="teams-jobs">
            {t("job.pane.title")}
          </h2>
          <label className="settings__pairing-field">
            <span className="setting__title">{t("settings.teams.jobTitle")}</span>
            <input className="settings__pairing-input" value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
          </label>
          <label className="settings__pairing-field">
            <span className="setting__title">{t("settings.teams.jobGoal")}</span>
            <textarea className="settings__pairing-uri" value={jobGoal} onChange={(e) => setJobGoal(e.target.value)} rows={3} />
          </label>
          <label className="settings__pairing-field">
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
          {jobs.length > 0 ? (
            <ul className="settings__list">
              {jobs.map((job) => (
                <li key={job.id}>
                  <button type="button" className="button button--ghost" onClick={() => props.onOpenJob?.(job.id)}>
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
