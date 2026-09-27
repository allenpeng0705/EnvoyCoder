/**
 * Create a Team job on a project (§13) — pick/create team, title, goal → Job pane.
 *
 * Layout is three beats: status → team → job. Secondary team actions stay as
 * text links so the primary “Create draft” button stays obvious.
 */

import { useEffect, useRef, useState, type ReactElement } from "react";

import type { Project } from "@envoydev/protocol";

import { useI18n } from "../i18n/context.js";
import type { AgentActions } from "../state/agent-actions.js";
import {
  defaultTeamBase,
  hostMemberLabel,
  uniqueTeamLabel,
} from "../state/team-defaults.js";
import {
  gitUiFromAssess,
  gitUiMessageKey,
  type GitUiPolicy,
} from "../state/job-git-ui.js";
import { canCopyText, copyText } from "./settings/clipboard.js";

type TeamRow = {
  id: string;
  label: string;
  members: ReadonlyArray<{ id: string; label: string; connection: { status: string } }>;
};

export function TeamJobCreateSheet(props: {
  project: Project;
  agents: AgentActions;
  onCreated: (jobId: string) => void;
  onCancel: () => void;
  onOpenTeams: () => void;
}): ReactElement {
  const { t } = useI18n();
  const [teams, setTeams] = useState<readonly TeamRow[]>([]);
  const [teamId, setTeamId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [notice, setNotice] = useState<string | undefined>();
  const [freshInvite, setFreshInvite] = useState<string | undefined>();
  const [loaded, setLoaded] = useState(false);
  const [gitPolicy, setGitPolicy] = useState<GitUiPolicy>("checking");

  function toRows(
    listed: ReadonlyArray<{
      id: string;
      label: string;
      members: ReadonlyArray<{ id: string; label: string; connection: { status: string } }>;
    }>,
  ): TeamRow[] {
    return listed.map((team) => ({
      id: team.id,
      label: team.label,
      members: team.members,
    }));
  }

  useEffect(() => {
    let cancelled = false;
    void props.agents.listTeams().then((r) => {
      if (cancelled) return;
      setLoaded(true);
      if (!r.ok) {
        setNotice(r.message);
        return;
      }
      const rows = toRows(r.teams);
      setTeams(rows);
      if (rows[0]) setTeamId(rows[0].id);
    });
    void props.agents.assessGitContentBus(props.project.path).then((r) => {
      if (cancelled) return;
      if (!r.ok && "message" in r) setNotice(r.message);
      setGitPolicy(gitUiFromAssess(r));
    });
    return () => {
      cancelled = true;
    };
  }, [props.agents, props.project.path]);

  async function createTeamInline(): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setNotice(undefined);
    try {
      const existing = teams.map((x) => x.label);
      const result = await props.agents.createTeam({
        label: uniqueTeamLabel(defaultTeamBase(props.project.label), existing),
        memberLabel: hostMemberLabel(t("settings.teams.role.orchestrate"), props.project.label),
      });
      if (!result.ok) {
        setNotice(result.message);
        return;
      }
      setFreshInvite(result.invite ?? result.token);
      const created: TeamRow = {
        id: result.team.id,
        label: result.team.label,
        members: (result.team.members as TeamRow["members"]) ?? [],
      };
      const listed = await props.agents.listTeams();
      if (listed.ok) {
        const rows = toRows(listed.teams);
        if (!rows.some((r) => r.id === created.id)) rows.unshift(created);
        setTeams(rows);
      } else {
        setTeams([created]);
        setNotice(listed.message);
      }
      setTeamId(created.id);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function copyInvite(): Promise<void> {
    if (inFlight.current) return;
    let token = freshInvite;
    if (!token && teamId) {
      inFlight.current = true;
      setBusy(true);
      try {
        const result = await props.agents.getTeamToken(teamId);
        if (!result.ok) {
          setNotice(result.message);
          return;
        }
        token = result.token;
        setFreshInvite(token);
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    }
    if (!token) return;
    const ok = await copyText(token);
    setNotice(ok ? t("settings.teams.copied") : t("settings.pairing.copyFailed"));
  }

  async function submit(): Promise<void> {
    if (inFlight.current) return;
    if (!teamId || !title.trim() || !goal.trim()) return;
    inFlight.current = true;
    setBusy(true);
    setNotice(undefined);
    try {
      const result = await props.agents.createJob({
        teamId,
        title: title.trim(),
        goal: goal.trim(),
        projectId: props.project.id,
        steps: [
          {
            role: "developer",
            brief: goal.trim().slice(0, 500),
            worktreeKey: `${props.project.id}:main`,
            cwdHint: props.project.path,
          },
        ],
      });
      if (!result.ok) {
        setNotice(result.message);
        return;
      }
      props.onCreated(result.job.id);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const selected = teams.find((x) => x.id === teamId);
  const joinedPeers = selected?.members.filter((m) => m.id !== "local") ?? [];
  const onlinePeers = joinedPeers.filter(
    (m) => m.connection.status === "online" || m.connection.status === "degraded",
  );
  const showCopyInvite = Boolean(freshInvite) || (selected !== undefined && joinedPeers.length === 0);
  const gitOk = gitPolicy === "ok";
  const canSubmit =
    !busy && Boolean(teamId) && title.trim() !== "" && goal.trim() !== "" && gitPolicy !== "checking";

  let peersNote: string | undefined;
  if (selected && joinedPeers.length === 0) {
    peersNote = t("teamJob.crew.noJoiners");
  } else if (selected && joinedPeers.length > 0 && onlinePeers.length === 0) {
    peersNote = t("teamJob.crew.allOffline", {
      machines: joinedPeers.map((m) => m.label).join(", "),
    });
  }

  return (
    <div className="team-job-sheet" data-testid="team-job-create">
      <header className="team-job-sheet__header">
        <div className="team-job-sheet__intro">
          <h1 className="task-pane__title">{t("teamJob.create.title")}</h1>
          <p className="team-job-sheet__blurb">
            {t("teamJob.create.blurb", { project: props.project.label })}
          </p>
        </div>
        <button type="button" className="button" onClick={props.onCancel}>
          {t("action.cancel")}
        </button>
      </header>

      {notice ? (
        <p className="team-job-sheet__notice" role="status">
          {notice}
        </p>
      ) : null}

      <p
        className={`team-job-sheet__status${gitOk ? "" : " team-job-sheet__status--warn"}`}
        role="status"
        data-testid="team-job-git"
        data-git={gitPolicy}
      >
        {t(gitUiMessageKey(gitPolicy))}
      </p>

      {!loaded ? (
        <p className="settings__note">{t("connection.starting")}</p>
      ) : teams.length === 0 ? (
        <section className="team-job-sheet__section" data-testid="team-job-no-team">
          <h2 className="team-job-sheet__section-title">{t("teamJob.create.sectionTeam")}</h2>
          <p className="team-job-sheet__hint">{t("teamJob.crew.noTeam")}</p>
          <div className="team-job-sheet__actions">
            <button
              type="button"
              className="button button--primary"
              disabled={busy}
              onClick={() => void createTeamInline()}
            >
              {t("teamJob.create.createTeam")}
            </button>
            <button type="button" className="button" onClick={props.onOpenTeams}>
              {t("teamJob.create.openTeams")}
            </button>
          </div>
        </section>
      ) : (
        <>
          <section className="team-job-sheet__section">
            <h2 className="team-job-sheet__section-title">{t("teamJob.create.sectionTeam")}</h2>
            {teams.length === 1 ? (
              <p className="team-job-sheet__team-name" data-testid="team-job-single-team">
                {teams[0]!.label}
              </p>
            ) : (
              <select
                className="settings__pairing-input"
                value={teamId}
                disabled={busy}
                data-testid="team-job-team"
                aria-label={t("teamJob.create.team")}
                onChange={(e) => setTeamId(e.target.value)}
              >
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.label}
                  </option>
                ))}
              </select>
            )}

            {peersNote ? (
              <p
                className="team-job-sheet__hint team-job-sheet__hint--warn"
                data-testid={joinedPeers.length === 0 ? "team-job-await-join" : "team-job-await-online"}
              >
                {peersNote}
              </p>
            ) : null}

            {freshInvite ? (
              <div className="settings__teams-invite" role="status" data-testid="team-job-invite">
                <p className="team-job-sheet__hint">{t("teamJob.create.inviteReady")}</p>
                <code className="settings__pairing-value settings__teams-token">{freshInvite}</code>
                {canCopyText() ? (
                  <button
                    type="button"
                    className="button button--secondary"
                    disabled={busy}
                    data-testid="team-job-copy-invite"
                    onClick={() => void copyInvite()}
                  >
                    {t("teamJob.create.copyInvite")}
                  </button>
                ) : null}
              </div>
            ) : showCopyInvite && canCopyText() ? (
              <button
                type="button"
                className="button button--secondary"
                disabled={busy}
                data-testid="team-job-copy-invite"
                onClick={() => void copyInvite()}
              >
                {t("teamJob.create.copyInvite")}
              </button>
            ) : null}

            <p className="team-job-sheet__links">
              <details className="settings__teams-advanced team-job-sheet__more">
                <summary className="setting__title">{t("teamJob.create.moreTeam")}</summary>
                <div className="team-job-sheet__actions">
                  <button
                    type="button"
                    className="button button--secondary button--small"
                    disabled={busy}
                    onClick={() => void createTeamInline()}
                  >
                    {t("teamJob.create.createTeam")}
                  </button>
                  <button
                    type="button"
                    className="button button--ghost button--small"
                    onClick={props.onOpenTeams}
                  >
                    {t("teamJob.create.openTeams")}
                  </button>
                </div>
              </details>
            </p>
          </section>

          <section className="team-job-sheet__section">
            <h2 className="team-job-sheet__section-title">{t("teamJob.create.sectionJob")}</h2>
            <label className="settings__teams-field">
              <span className="setting__title">{t("teamJob.create.jobTitle")}</span>
              <input
                className="settings__pairing-input"
                value={title}
                disabled={busy}
                data-testid="team-job-title"
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label className="settings__teams-field">
              <span className="setting__title">{t("teamJob.create.jobGoal")}</span>
              <textarea
                className="settings__pairing-uri"
                value={goal}
                disabled={busy}
                rows={3}
                data-testid="team-job-goal"
                onChange={(e) => setGoal(e.target.value)}
              />
            </label>
          </section>

          <div className="team-job-sheet__footer">
            <button
              type="button"
              className="button button--primary"
              disabled={!canSubmit}
              data-testid="team-job-submit"
              onClick={() => void submit()}
            >
              {t("teamJob.create.submit")}
            </button>
            <p className="team-job-sheet__hint">{t("teamJob.create.draftHint")}</p>
          </div>
        </>
      )}
    </div>
  );
}
