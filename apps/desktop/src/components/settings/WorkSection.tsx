/**
 * Work Engine settings — one mode, GitHub-first, review queue, advanced.
 *
 * Work items are a separate lane from Team jobs / JobSteps.
 */

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactElement } from "react";

import type { WorkCandidate, WorkPolicy } from "@envoydev/work-model";

import { useI18n } from "../../i18n/context.js";
import type { MessageKey } from "../../i18n/messages/en.js";
import { asFailure, localize } from "../../i18n/notice.js";
import { showShellToast } from "../../state/shell-toast.js";
import { SettingRow } from "../SettingsRows.js";
import type { SettingsSectionProps } from "./SectionProps.js";

type WorkModeUi = "off" | "watch" | "take";

function parseAllowList(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function formatAllowList(list: readonly string[]): string {
  return list.join("\n");
}

function truncateCandidateText(text: string, max = 160): string {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function teamDraftTitleGoal(text: string): { title: string; goal: string } {
  const trimmed = text.trim();
  const firstLine = trimmed.split(/\n/)[0]?.trim() || trimmed;
  return {
    title: firstLine.slice(0, 200) || "Team job",
    goal: trimmed.slice(0, 16_000) || firstLine.slice(0, 200) || "Team job",
  };
}

function modeFromPolicy(policy: WorkPolicy): WorkModeUi {
  if (!policy.enabled || policy.acceptMode === "off") return "off";
  if (policy.acceptMode === "auto") return "take";
  return "watch";
}

function patchForMode(mode: WorkModeUi): Partial<WorkPolicy> {
  if (mode === "off") return { enabled: false };
  if (mode === "take") return { enabled: true, acceptMode: "auto" };
  return { enabled: true, acceptMode: "observe" };
}

function sourceLabelKey(sourceKind: WorkCandidate["sourceKind"]): MessageKey {
  if (sourceKind === "github") return "settings.work.github.source.github";
  if (sourceKind === "manual") return "settings.work.github.source.manual";
  return "settings.work.github.source.other";
}

function dispositionLabelKey(
  disposition: NonNullable<WorkCandidate["disposition"]>,
): MessageKey {
  if (disposition === "would-accept") return "settings.work.github.disposition.would-accept";
  if (disposition === "accept") return "settings.work.github.disposition.accept";
  return "settings.work.github.disposition.ignore";
}

function formatPollSuccess(
  t: (key: MessageKey, values?: Record<string, string | number>) => string,
  result: {
    wouldAccept?: number;
    accepted?: number;
    ackFailed?: number;
  },
): { tone: "ok" | "error"; text: string } {
  const wouldAccept = result.wouldAccept ?? 0;
  const accepted = result.accepted ?? 0;
  const ackFailed = result.ackFailed ?? 0;

  let headline: string;
  if (accepted > 0 && wouldAccept > 0) {
    headline = t("settings.work.github.ok.mixed", { wouldAccept, accepted });
  } else if (accepted > 0) {
    headline = t("settings.work.github.ok.auto", { accepted });
  } else if (wouldAccept > 0) {
    headline = t("settings.work.github.ok.observe", { wouldAccept });
  } else {
    headline = t("settings.work.github.ok.none");
  }

  if (ackFailed > 0) {
    return {
      tone: "error",
      text: `${headline} ${t("settings.work.github.ok.ackFailed", { ackFailed })}`,
    };
  }
  return { tone: "ok", text: headline };
}

export function WorkSection(
  props: SettingsSectionProps & { onOpenJob?: (jobId: string) => void },
): ReactElement {
  const { t } = useI18n();
  const [policy, setPolicy] = useState<WorkPolicy | undefined>(undefined);
  const [allowDraft, setAllowDraft] = useState("");
  const [candidateText, setCandidateText] = useState("");
  const [candidates, setCandidates] = useState<readonly WorkCandidate[]>([]);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [githubRepo, setGithubRepo] = useState("");
  const [githubBusy, setGithubBusy] = useState(false);
  const [githubNotice, setGithubNotice] = useState<
    { tone: "ok" | "error"; text: string } | undefined
  >(undefined);
  const [teams, setTeams] = useState<ReadonlyArray<{ id: string; label: string }>>([]);
  const [draftTeamId, setDraftTeamId] = useState<string>("");
  const [teamDraftBusy, setTeamDraftBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refreshCandidates = useCallback(async () => {
    const listed = await props.agents.listWorkCandidates();
    if (listed.ok) setCandidates(listed.candidates);
  }, [props.agents]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const got = await props.agents.getWorkPolicy();
      if (cancelled) return;
      if (!got.ok) {
        setLoadError(localize(t, got) ?? got.message);
        return;
      }
      setPolicy(got.policy);
      setAllowDraft(formatAllowList(got.policy.allowList));
      setGithubRepo(got.policy.githubPollRepo ?? "");
      setLoadError(undefined);
    })();
    void refreshCandidates();
    void props.agents.listTeams().then((listed) => {
      if (cancelled || !listed.ok) return;
      const rows = listed.teams.map((team) => ({ id: team.id, label: team.label }));
      setTeams(rows);
      if (rows[0]) setDraftTeamId(rows[0].id);
    });
    return () => {
      cancelled = true;
    };
  }, [props.agents, refreshCandidates, t]);

  const openTeamJobDraft = async (candidate: WorkCandidate): Promise<void> => {
    const sourceRef = candidate.externalRef?.trim();
    if (!sourceRef || candidate.sourceKind !== "github") return;
    const teamId = teams.length === 1 ? teams[0]!.id : draftTeamId;
    if (!teamId) {
      setGithubNotice({ tone: "error", text: t("settings.work.review.openTeamDraft.noTeam") });
      return;
    }
    const { title, goal } = teamDraftTitleGoal(candidate.text);
    setTeamDraftBusy(true);
    try {
      // Omit projectId — step run resolves the project from the step cwd.
      const result = await props.agents.createJobFromSource({
        teamId,
        sourceRef,
        title,
        goal,
      });
      if (!result.ok) {
        setGithubNotice({
          tone: "error",
          text: localize(t, result) ?? result.message,
        });
        return;
      }
      if (result.created) {
        showShellToast(t("settings.work.review.openTeamDraft.created"));
      } else {
        showShellToast(t("settings.work.review.openTeamDraft.existing"));
      }
      props.onOpenJob?.(result.job.id);
    } finally {
      setTeamDraftBusy(false);
    }
  };

  const patchPolicy = async (patch: Partial<WorkPolicy>, write?: (p: Promise<unknown>) => void) => {
    const run = props.agents.setWorkPolicy(patch);
    if (write) write(run);
    const result = await run;
    if (result.ok) {
      setPolicy(result.policy);
      setAllowDraft(formatAllowList(result.policy.allowList));
      setGithubRepo(result.policy.githubPollRepo ?? "");
    }
    return result;
  };

  const onGithubRepoBlur = (): void => {
    if (policy === undefined) return;
    const next = githubRepo.trim();
    const current = policy.githubPollRepo ?? "";
    if (next === current) return;
    void patchPolicy({ githubPollRepo: next });
  };

  const onAllowBlur = (): void => {
    if (policy === undefined) return;
    const next = parseAllowList(allowDraft);
    const same =
      next.length === policy.allowList.length &&
      next.every((entry, index) => entry === policy.allowList[index]);
    if (same) return;
    void patchPolicy({ allowList: next });
  };

  const enqueueCandidate = async (text: string): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const result = await props.agents.enqueueWorkCandidate(trimmed);
    if (result.ok) {
      setCandidateText("");
      await refreshCandidates();
    }
  };

  const onFilePicked = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const text = await file.text();
    await enqueueCandidate(text);
  };

  const mode = policy ? modeFromPolicy(policy) : "off";
  const workOn = mode !== "off";
  const pollEnabled = workOn;

  const needsReview = candidates.filter(
    (c) => c.disposition === undefined || c.disposition === "would-accept",
  );
  const recentActivity = candidates
    .filter((c) => c.disposition === "accept" || c.disposition === "ignore")
    .slice()
    .reverse()
    .slice(0, 10);

  const pollGithub = async (): Promise<void> => {
    if (!pollEnabled) {
      setGithubNotice({ tone: "error", text: t("settings.work.github.pollDisabled") });
      return;
    }
    setGithubBusy(true);
    setGithubNotice(undefined);
    try {
      const repo = githubRepo.trim();
      const result = await props.agents.githubPoll(repo.length > 0 ? repo : undefined);
      if (!result.ok) {
        const softError =
          "error" in result && typeof result.error === "string" && result.error.trim() !== ""
            ? result.error
            : undefined;
        const refused =
          "key" in result && result.key !== undefined
            ? localize(t, { message: softError ?? "GitHub poll failed.", key: result.key })
            : "message" in result && typeof result.message === "string"
              ? result.message
              : undefined;
        setGithubNotice({
          tone: "error",
          text: softError ?? refused ?? "GitHub poll failed.",
        });
        await refreshCandidates();
        return;
      }
      setGithubNotice(formatPollSuccess(t, result));
      await refreshCandidates();
    } finally {
      setGithubBusy(false);
    }
  };

  const modeNoteKey: MessageKey =
    mode === "take"
      ? "settings.work.mode.takeNote"
      : mode === "watch"
        ? "settings.work.mode.watchNote"
        : "settings.work.mode.offNote";

  return (
    <div data-testid="work-section">
      {loadError !== undefined ? (
        <p className="settings__note settings__note--refused" role="status">
          {loadError}
        </p>
      ) : null}

      <SettingRow
        title={t("settings.work.mode.title")}
        detail={t("settings.work.mode.detail")}
        developerNote="work.policy.enabled+acceptMode"
      >
        {(write) => (
          <select
            className="select"
            value={mode}
            disabled={policy === undefined}
            aria-label={t("settings.work.mode.title")}
            data-testid="work-mode"
            onChange={(event) =>
              write(
                patchPolicy(patchForMode(event.target.value as WorkModeUi)).then((r) =>
                  r.ok ? undefined : asFailure(r),
                ),
              )
            }
          >
            <option value="off">{t("settings.work.mode.off")}</option>
            <option value="watch">{t("settings.work.mode.watch")}</option>
            <option value="take">{t("settings.work.mode.take")}</option>
          </select>
        )}
      </SettingRow>
      <p className="settings__note">{t(modeNoteKey)}</p>

      {workOn ? (
        <>
          <h3 className="settings__heading">{t("settings.work.github.title")}</h3>
          <p className="settings__note">{t("settings.work.github.detail")}</p>
          <SettingRow
            title={t("settings.work.github.repo")}
            detail={t("settings.work.github.repoDetail")}
            developerNote="work.policy.githubPollRepo"
          >
            {() => (
              <input
                className="input"
                value={githubRepo}
                aria-label={t("settings.work.github.repo")}
                placeholder={t("settings.work.github.repoPlaceholder")}
                onChange={(event) => setGithubRepo(event.target.value)}
                onBlur={() => onGithubRepoBlur()}
                data-testid="work-github-repo"
              />
            )}
          </SettingRow>
          <SettingRow
            title={t("settings.work.github.autoPoll.title")}
            detail={t("settings.work.github.autoPoll.detail")}
            developerNote="work.policy.githubPollIntervalMs"
          >
            {(write) => (
              <select
                className="select"
                value={String(policy?.githubPollIntervalMs ?? 0)}
                disabled={policy === undefined}
                aria-label={t("settings.work.github.autoPoll.title")}
                data-testid="work-github-auto-poll"
                onChange={(event) =>
                  write(
                    patchPolicy({
                      githubPollIntervalMs: Number.parseInt(event.target.value, 10) || 0,
                    }).then((r) => (r.ok ? undefined : asFailure(r))),
                  )
                }
              >
                <option value="0">{t("settings.work.github.autoPoll.off")}</option>
                <option value="300000">{t("settings.work.github.autoPoll.5m")}</option>
                <option value="900000">{t("settings.work.github.autoPoll.15m")}</option>
                <option value="3600000">{t("settings.work.github.autoPoll.60m")}</option>
              </select>
            )}
          </SettingRow>
          {(policy?.githubPollIntervalMs ?? 0) > 0 ? (
            <p className="settings__note" role="note">
              {t("settings.work.github.autoPoll.onNote")}
            </p>
          ) : null}
          <div className="settings__row-actions">
            <button
              type="button"
              className="button button--secondary"
              disabled={githubBusy || !pollEnabled}
              data-testid="work-github-poll"
              onClick={() => void pollGithub()}
            >
              {githubBusy ? t("settings.work.github.pollBusy") : t("settings.work.github.poll")}
            </button>
          </div>
          {githubNotice !== undefined ? (
            <p
              className={
                githubNotice.tone === "error"
                  ? "settings__note settings__note--refused"
                  : "settings__note"
              }
              role="status"
              data-testid="work-github-notice"
            >
              {githubNotice.text}
            </p>
          ) : null}

          <h3 className="settings__heading">{t("settings.work.review.title")}</h3>
          <p className="settings__note">{t("settings.work.review.detail")}</p>
          {needsReview.length === 0 ? (
            <p className="settings__note">{t("settings.work.review.empty")}</p>
          ) : (
            <ul className="settings__work-candidates" data-testid="work-needs-review">
              {needsReview.map((candidate) => {
                const isWouldAccept = candidate.disposition === "would-accept";
                return (
                  <li key={candidate.id} className="settings__work-candidate">
                    <p className="settings__work-candidate-text">
                      {isWouldAccept
                        ? `${t("settings.work.github.disposition.would-accept")} · ${t(sourceLabelKey(candidate.sourceKind))}`
                        : t(sourceLabelKey(candidate.sourceKind))}
                    </p>
                    <p className="settings__note">{truncateCandidateText(candidate.text)}</p>
                    <div className="settings__row-actions">
                      <button
                        type="button"
                        className="button button--secondary"
                        onClick={() =>
                          void props.agents
                            .triageWorkCandidate(candidate.id, true)
                            .then((r) => (r.ok ? refreshCandidates() : undefined))
                        }
                      >
                        {isWouldAccept
                          ? t("settings.work.review.take")
                          : t("settings.work.review.accept")}
                      </button>
                      {!isWouldAccept ? (
                        <button
                          type="button"
                          className="button button--ghost"
                          onClick={() =>
                            void props.agents
                              .triageWorkCandidate(candidate.id, false)
                              .then((r) => (r.ok ? refreshCandidates() : undefined))
                          }
                        >
                          {t("settings.work.review.ignore")}
                        </button>
                      ) : null}
                      {candidate.sourceKind === "github" && candidate.externalRef ? (
                        <>
                          {teams.length > 1 ? (
                            <label className="settings__work-team-pick">
                              <select
                                className="select"
                                value={draftTeamId}
                                disabled={teamDraftBusy}
                                aria-label={t("settings.teams.jobTeam")}
                                onChange={(e) => setDraftTeamId(e.target.value)}
                              >
                                {teams.map((team) => (
                                  <option key={team.id} value={team.id}>
                                    {team.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                          ) : null}
                          <button
                            type="button"
                            className="button button--ghost"
                            disabled={teamDraftBusy || teams.length === 0}
                            data-testid="work-open-team-draft"
                            onClick={() => void openTeamJobDraft(candidate)}
                          >
                            {t("settings.work.review.openTeamDraft")}
                          </button>
                        </>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <h3 className="settings__heading">{t("settings.work.activity.title")}</h3>
          {recentActivity.length === 0 ? (
            <p className="settings__note">{t("settings.work.activity.empty")}</p>
          ) : (
            <ul className="settings__work-candidates" data-testid="work-recent-activity">
              {recentActivity.map((candidate) => {
                const disposition = candidate.disposition ?? "ignore";
                return (
                  <li key={candidate.id} className="settings__work-candidate">
                    <p className="settings__work-candidate-text">
                      {t(dispositionLabelKey(disposition))} · {t(sourceLabelKey(candidate.sourceKind))}
                    </p>
                    <p className="settings__note">{truncateCandidateText(candidate.text)}</p>
                  </li>
                );
              })}
            </ul>
          )}

          <h3 className="settings__heading">{t("settings.work.advanced.title")}</h3>
          <SettingRow
            title={t("settings.work.allowList.title")}
            detail={t("settings.work.allowList.detail")}
            developerNote="work.policy.allowList"
          >
            {() => (
              <textarea
                className="input"
                rows={3}
                value={allowDraft}
                disabled={policy === undefined}
                aria-label={t("settings.work.allowList.title")}
                placeholder={t("settings.work.allowList.placeholder")}
                onChange={(event) => setAllowDraft(event.target.value)}
                onBlur={() => onAllowBlur()}
              />
            )}
          </SettingRow>
          <SettingRow
            title={t("settings.work.requireApprovals.title")}
            detail={t("settings.work.requireApprovals.detail")}
            developerNote="work.policy.requireApprovalsForUnattended"
          >
            {(write) => (
              <input
                type="checkbox"
                checked={policy?.requireApprovalsForUnattended === true}
                disabled={policy === undefined}
                aria-label={t("settings.work.requireApprovals.title")}
                onChange={(event) =>
                  write(
                    patchPolicy({ requireApprovalsForUnattended: event.target.checked }).then((r) =>
                      r.ok ? undefined : asFailure(r),
                    ),
                  )
                }
              />
            )}
          </SettingRow>

          <h3 className="settings__heading">{t("settings.work.inbox.title")}</h3>
          <p className="settings__note">{t("settings.work.inbox.detail")}</p>
          <textarea
            className="input settings__textarea"
            rows={3}
            value={candidateText}
            aria-label={t("settings.work.inbox.text")}
            placeholder={t("settings.work.inbox.placeholder")}
            onChange={(event) => setCandidateText(event.target.value)}
          />
          <div className="settings__row-actions">
            <button
              type="button"
              className="button button--secondary"
              onClick={() => void enqueueCandidate(candidateText)}
            >
              {t("settings.work.inbox.enqueue")}
            </button>
            <button
              type="button"
              className="button button--ghost"
              onClick={() => fileRef.current?.click()}
            >
              {t("settings.work.inbox.file")}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.md,text/plain"
              className="visually-hidden"
              onChange={(event) => void onFilePicked(event)}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
