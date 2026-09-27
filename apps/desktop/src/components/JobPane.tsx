/**
 * Job pane — steps, peers, ledger, manual critical actions (M5 §11.2).
 * Stall automation is not enabled from this UI by default (§4.6 ship gate).
 */

import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";

import type { AcceptPolicy, Job, JobLedgerNote, JobRole, MemberStatus, StepOffer } from "@envoydev/protocol";

import { useI18n } from "../i18n/context.js";
import type { AgentActions } from "../state/agent-actions.js";
import { type GitUiPolicy } from "../state/job-git-ui.js";

type LedgerFilter = "all" | "step" | "member";

type StartReadiness = Extract<
  Awaited<ReturnType<AgentActions["assessTeamJobReadiness"]>>,
  { ok: true }
>;

const AUTO_ACCEPT_ROLES = ["developer", "tester", "designer", "document"] as const satisfies readonly JobRole[];

function rolesFromPolicy(policy: AcceptPolicy | undefined): readonly JobRole[] {
  if (policy?.mode !== "auto-roles") return [];
  return (policy.autoAcceptRoles ?? []).filter((r): r is JobRole =>
    (AUTO_ACCEPT_ROLES as readonly string[]).includes(r),
  );
}

function policyFromRoles(roles: readonly JobRole[]): AcceptPolicy {
  if (roles.length === 0) return { mode: "manual" };
  return { mode: "auto-roles", autoAcceptRoles: [...roles] };
}

/** Next online peer that offers this step's role (§11.5). Degraded only when policy allows. */
export function suggestReassignMember(
  board: readonly MemberStatus[],
  step: { role: JobRole; assigneeMemberId?: string },
  options?: { allowDegradedAssignees?: boolean },
): MemberStatus | undefined {
  const allowDegraded = options?.allowDegradedAssignees === true;
  return board.find((m) => {
    if (m.memberId === step.assigneeMemberId) return false;
    if (!m.rolesOffered.includes(step.role)) return false;
    if (m.connection.status === "online") return true;
    if (allowDegraded && m.connection.status === "degraded") return true;
    return false;
  });
}

export function JobPane(props: {
  jobId: string;
  agents: AgentActions;
  onClose: () => void;
  /** Open Settings → Teams so the user can invite / fix roles (§11.6). */
  onOpenTeams?: () => void;
}): ReactElement {
  const { t } = useI18n();
  const [job, setJob] = useState<Job | undefined>();
  const [board, setBoard] = useState<readonly MemberStatus[]>([]);
  const [tokenExpiresAt, setTokenExpiresAt] = useState<string | undefined>();
  const [pendingOffers, setPendingOffers] = useState<readonly StepOffer[]>([]);
  const [notice, setNotice] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  /** Sync lock — `setBusy(true)` alone does not stop a second Suggest click before re-render. */
  const inFlight = useRef(false);
  const [ledgerFilter, setLedgerFilter] = useState<LedgerFilter>("all");
  const [ledgerStepId, setLedgerStepId] = useState<string>("");
  const [ledgerMemberId, setLedgerMemberId] = useState<string>("");
  const [localAcceptRoles, setLocalAcceptRoles] = useState<readonly JobRole[]>([]);
  const [templates, setTemplates] = useState<ReadonlyArray<{ id: string; title: string; detail: string }>>([]);
  const [templateId, setTemplateId] = useState<string>("pipeline");
  const [parallelCount, setParallelCount] = useState(2);
  const [gitPolicy, setGitPolicy] = useState<GitUiPolicy>("checking");
  const [startReadiness, setStartReadiness] = useState<StartReadiness | undefined>();

  const reload = useCallback(async () => {
    setGitPolicy("checking");
    setStartReadiness(undefined);
    const result = await props.agents.getJob(props.jobId);
    if (!result.ok) {
      setNotice(result.message);
      setJob(undefined);
      return;
    }
    setJob(result.job);
    const readiness = await props.agents.assessTeamJobReadiness(props.jobId);
    if (readiness.ok) {
      setStartReadiness(readiness);
      if (!readiness.git.ok) {
        setGitPolicy(readiness.git.policy);
      } else if (result.job.status === "drafting" && !readiness.canStart && readiness.blockKind === "git") {
        setGitPolicy("cwd-missing");
      } else {
        setGitPolicy("ok");
      }
      // Prefer the readiness board when present so Start and the peer column share one snapshot.
      if (readiness.board.length > 0) setBoard(readiness.board);
    } else {
      setNotice(readiness.message);
      setGitPolicy("git-missing");
    }
    const status = await props.agents.teamStatus(result.job.teamId);
    if (status.ok) {
      // Keep board from readiness when it already loaded; still refresh token / accept policy.
      if (!readiness.ok || readiness.board.length === 0) setBoard(status.board);
      const team = status.team as {
        tokenExpiresAt?: string;
        members?: readonly { id: string; acceptPolicy?: AcceptPolicy }[];
      };
      setTokenExpiresAt(team.tokenExpiresAt);
      const local = team.members?.find((m) => m.id === "local");
      setLocalAcceptRoles(rolesFromPolicy(local?.acceptPolicy));
    } else {
      // Keep the last good board so a transient teamStatus blip does not fake "no members".
      setNotice(t("job.pane.teamStatusFailed"));
    }
    const offers = await props.agents.listJobOffers(result.job.id);
    if (offers.ok) {
      setPendingOffers(
        offers.offers.filter((o) => o.status === "pending" && o.assigneeMemberId === "local"),
      );
    } else setPendingOffers([]);
  }, [props.agents, props.jobId, t]);

  async function setLocalRole(role: JobRole, enabled: boolean): Promise<void> {
    if (!job) return;
    const next = enabled
      ? [...new Set([...localAcceptRoles, role])]
      : localAcceptRoles.filter((r) => r !== role);
    setBusy(true);
    // Owner window — daemon resolves team auth; no plaintext token in the UI.
    const r = await props.agents.setMemberAcceptPolicy(
      job.teamId,
      "local",
      policyFromRoles(next),
    );
    setBusy(false);
    if (!r.ok) {
      setNotice(r.message);
      return;
    }
    setLocalAcceptRoles(next);
    void reload();
  }

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    void props.agents.listJobStepTemplates().then((r) => {
      if (!r.ok) return;
      setTemplates(r.templates);
      if (r.templates[0]) setTemplateId(r.templates[0].id);
    });
  }, [props.agents]);

  async function act(fn: () => Promise<{ ok: true; job: Job } | { ok: false; message: string }>): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setNotice(undefined);
    try {
      const result = await fn();
      if (!result.ok) {
        setNotice(result.message);
        return;
      }
      setJob(result.job);
      void reload();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  if (!job) {
    return (
      <div className="task-pane" data-testid="job-pane">
        <p className="settings__note">{notice ?? t("connection.starting")}</p>
        <button type="button" className="button" onClick={props.onClose}>
          {t("settings.back")}
        </button>
      </div>
    );
  }

  const jobAttention = job.steps.filter(
    (s) => s.status === "offered" || s.blocked === "needs-attention" || s.runPhase === "needs-attention",
  ).length;

  const tokenExpiringSoon =
    tokenExpiresAt !== undefined && Date.parse(tokenExpiresAt) - Date.now() < 2 * 60 * 60 * 1000;

  const canStart = startReadiness?.canStart === true;
  const crewBlocked =
    startReadiness !== undefined &&
    !startReadiness.canStart &&
    startReadiness.blockKind !== undefined &&
    startReadiness.blockKind !== "git" &&
    startReadiness.blockKind !== "not-drafting";

  const filteredLedger = filterLedger(job.ledger, ledgerFilter, ledgerStepId, ledgerMemberId);

  function crewMessage(): string {
    if (startReadiness === undefined) return t("teamJob.git.checking");
    if (startReadiness.canStart) return "";
    const key = startReadiness.messageKey;
    const values = startReadiness.messageValues ?? {};
    switch (key) {
      case "job.pane.crew.noSteps":
        return t("job.pane.crew.noSteps");
      case "job.pane.crew.noMembers":
        return t("job.pane.crew.noMembers");
      case "job.pane.crew.allOffline":
        return t("job.pane.crew.allOffline", { machines: values.machines ?? "—" });
      case "job.pane.crew.missingRoles":
        return t("job.pane.crew.missingRoles", { roles: values.roles ?? "" });
      case "teamJob.git.pathMissing":
        return t("teamJob.git.pathMissing");
      case "teamJob.git.notARepo":
        return t("teamJob.git.notARepo");
      case "teamJob.git.noRemote":
        return t("teamJob.git.noRemote");
      case "teamJob.git.missing":
        return t("teamJob.git.missing");
      case "error.job.notDrafting":
        return t("error.job.notDrafting");
      default:
        return startReadiness.message || t("job.pane.startBlocked");
    }
  }

  return (
    <div className="task-pane job-pane" data-testid="job-pane" data-attention={jobAttention}>
      <header className="task-pane__header">
        <div>
          <h1 className="task-pane__title">{job.title}</h1>
          <p className="settings__note">{job.goal}</p>
          <span className="chip">{job.status}</span>
        </div>
        <div className="task-pane__actions">
          {job.status === "drafting" ? (
            <button
              type="button"
              className="button button--primary"
              disabled={busy || !canStart}
              title={!canStart ? crewMessage() : undefined}
              data-testid="job-start"
              onClick={() => void act(() => props.agents.startJob(job.id))}
            >
              {t("job.pane.start")}
            </button>
          ) : null}
          {job.status === "running" ? (
            <>
              <button type="button" className="button" disabled={busy} onClick={() => void act(() => props.agents.pauseJob(job.id))}>
                {t("job.pane.pause")}
              </button>
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => {
                  if (!window.confirm(t("job.pane.stopConfirm"))) return;
                  void act(() => props.agents.stopJob(job.id));
                }}
              >
                {t("job.pane.stop")}
              </button>
            </>
          ) : null}
          <label className="job-pane__template">
            <span className="settings__note">{t("job.pane.template")}</span>
            <select
              value={templateId}
              disabled={busy}
              data-testid="job-template"
              onChange={(e) => setTemplateId(e.target.value)}
              title={templates.find((x) => x.id === templateId)?.detail}
            >
              {(templates.length > 0 ? templates : [{ id: "pipeline", title: "Design → code → test → docs", detail: "" }]).map(
                (tmpl) => (
                  <option key={tmpl.id} value={tmpl.id} title={tmpl.detail}>
                    {tmpl.title}
                  </option>
                ),
              )}
            </select>
          </label>
          {templateId === "parallel-feature" || templateId === "parallel-test" ? (
            <label className="job-pane__template">
              <span className="settings__note">{t("job.pane.parallelCount")}</span>
              <select
                value={parallelCount}
                disabled={busy}
                data-testid="job-parallel-count"
                onChange={(e) => setParallelCount(Number(e.target.value))}
              >
                {[2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button
            type="button"
            className="button"
            disabled={busy || job.status !== "drafting"}
            title={job.status !== "drafting" ? t("job.pane.suggestOnlyDraft") : undefined}
            data-testid="job-suggest-steps"
            onClick={() => {
              if (job.status !== "drafting") {
                setNotice(t("job.pane.suggestOnlyDraft"));
                return;
              }
              if (inFlight.current) return;
              inFlight.current = true;
              setBusy(true);
              setNotice(undefined);
              // Daemon inherits cwdHint from existing steps (project path from create).
              void (async () => {
                try {
                  const r = await props.agents.suggestJobSteps(job.id, {
                    templateId,
                    ...(templateId === "parallel-feature" || templateId === "parallel-test"
                      ? { parallelCount }
                      : {}),
                  });
                  if (!r.ok) {
                    setNotice(r.message);
                    return;
                  }
                  const drafts = r.steps as ReadonlyArray<{
                    id?: string;
                    role: JobRole;
                    brief: string;
                    worktreeKey: string;
                    cwdHint: string;
                    dependsOn?: readonly string[];
                  }>;
                  const preview = drafts.map((s) => s.role).join(" → ");
                  if (!window.confirm(`${r.note}\n\n${preview}\n\n${t("job.pane.suggestConfirm")}`)) {
                    setNotice(`${r.note} — ${preview}`);
                    return;
                  }
                  const updated = await props.agents.updateJobSteps(job.id, drafts);
                  if (!updated.ok) {
                    setNotice(updated.message);
                    return;
                  }
                  setJob(updated.job);
                  setNotice(t("job.pane.suggestApplied"));
                  void reload();
                } finally {
                  inFlight.current = false;
                  setBusy(false);
                }
              })();
            }}
          >
            {t("job.pane.suggest")}
          </button>
          <button type="button" className="button" onClick={props.onClose}>
            {t("settings.back")}
          </button>
        </div>
      </header>
      {tokenExpiringSoon ? (
        <p className="settings__note" role="status" data-testid="token-expiry-banner">
          {t("job.pane.tokenExpiring")}
        </p>
      ) : null}
      {!canStart && job.status === "drafting" ? (
        <div className="job-pane__crew" role="status" data-testid="job-crew-guidance" data-git={gitPolicy}>
          <p className="settings__note">{crewMessage()}</p>
          {props.onOpenTeams && crewBlocked && startReadiness?.blockKind !== "no-steps" ? (
            <button type="button" className="button button--ghost button--small" onClick={props.onOpenTeams}>
              {t("job.pane.crew.openTeams")}
            </button>
          ) : null}
        </div>
      ) : null}
      {notice ? <p className="settings__note" role="status">{notice}</p> : null}

      {pendingOffers.length > 0 ? (
        <section aria-labelledby="job-local-offers" data-testid="local-pending-offers">
          <h2 id="job-local-offers">{t("job.pane.pendingOffers")}</h2>
          <ul>
            {pendingOffers.map((offer) => (
              <li key={offer.offerId}>
                <span className="chip">{offer.role}</span> {offer.brief}
                <button
                  type="button"
                  className="button button--primary button--small"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void (async () => {
                      const r = await props.agents.acceptLocalJobStepOffer(
                        offer.offerId,
                        offer.cwdHint,
                      );
                      setBusy(false);
                      if (!r.ok) setNotice(r.message);
                      else void reload();
                    })();
                  }}
                >
                  {t("job.pane.acceptOffer")}
                </button>
                <button
                  type="button"
                  className="button button--small"
                  disabled={busy}
                  onClick={() => {
                    const reason =
                      window.prompt(t("job.pane.refuseReasonPrompt"), "")?.trim() || "manual-refuse";
                    setBusy(true);
                    void (async () => {
                      const r = await props.agents.refuseLocalJobStepOffer(offer.offerId, reason);
                      setBusy(false);
                      if (!r.ok) setNotice(r.message);
                      else void reload();
                    })();
                  }}
                >
                  {t("job.pane.refuseOffer")}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="job-pane__columns">
        <section aria-labelledby="job-steps">
          <h2 id="job-steps">{t("job.pane.steps")}</h2>
          <ol>
            {job.steps.map((step) => (
              <li key={step.id}>
                <span className="chip">{step.status}</span> {step.role}: {step.brief}
                {step.assigneeMemberId ? (
                  <span className="settings__note"> · {step.assigneeMemberId === "local" ? t("job.pane.thisMachine") : step.assigneeMemberId.slice(0, 8)}</span>
                ) : null}
                {step.hasGap ? (
                  <span className="settings__note"> · {t("job.pane.hasGap")}</span>
                ) : null}
                {step.runPhase === "needs-attention" || step.blocked === "needs-attention" ? (
                  <span className="job-pane__step-actions" data-testid="job-step-approval">
                    <span className="settings__note">{t("job.pane.needsApproval")}</span>
                    <button
                      type="button"
                      className="button button--primary button--small"
                      disabled={busy}
                      onClick={() => {
                        const requestId = step.approvalRequestId ?? step.id;
                        setBusy(true);
                        void props.agents
                          .answerJobStepApproval(job.id, step.id, requestId, "allow")
                          .then((r) => {
                            setBusy(false);
                            if (!r.ok) setNotice(r.message);
                            else void reload();
                          });
                      }}
                    >
                      {t("job.pane.approve")}
                    </button>
                    <button
                      type="button"
                      className="button button--small"
                      disabled={busy}
                      onClick={() => {
                        const requestId = step.approvalRequestId ?? step.id;
                        setBusy(true);
                        void props.agents
                          .answerJobStepApproval(job.id, step.id, requestId, "deny")
                          .then((r) => {
                            setBusy(false);
                            if (!r.ok) setNotice(r.message);
                            else void reload();
                          });
                      }}
                    >
                      {t("job.pane.deny")}
                    </button>
                  </span>
                ) : null}
                {step.status === "running" || step.status === "offered" || step.status === "pending" ? (
                  <span className="job-pane__step-actions">
                    {step.status === "running" || step.status === "offered" ? (
                      <>
                        <button
                          type="button"
                          className="button button--small"
                          disabled={busy}
                          onClick={() => void act(() => props.agents.stopJobStep(job.id, step.id))}
                        >
                          {t("job.pane.stopStep")}
                        </button>
                        <button
                          type="button"
                          className="button button--small"
                          disabled={busy}
                          onClick={() => {
                            const next = suggestReassignMember(board, step, {
                              allowDegradedAssignees: job.policy.allowDegradedAssignees === true,
                            });
                            const ok = next
                              ? window.confirm(t("job.pane.reassignConfirm", { label: next.label }))
                              : window.confirm(t("job.pane.reassignConfirmNone"));
                            if (!ok) return;
                            void act(() =>
                              props.agents.reassignJobStep(job.id, step.id, next?.memberId),
                            );
                          }}
                        >
                          {t("job.pane.reassign")}
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      className="button button--small"
                      disabled={busy}
                      onClick={() => {
                        if (!window.confirm(t("job.pane.failConfirm"))) return;
                        void act(() => props.agents.failJobStep(job.id, step.id));
                      }}
                    >
                      {t("job.pane.forceFail")}
                    </button>
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
        <section aria-labelledby="job-peers">
          <h2 id="job-peers">{t("job.pane.peers")}</h2>
          <ul>
            {board.map((m) => (
              <li key={m.memberId}>
                <span className="chip">{m.connection.status}</span> {m.label} · {m.connection.transport}
                {m.currentStepId ? ` · step ${m.currentStepId.slice(0, 8)}` : ""}
                {m.runPhase ? ` · ${m.runPhase}` : ""}
                {m.blocked ? ` · Blocked · ${m.blocked}` : ""}
                {m.memberId !== "local" ? (
                  <button
                    type="button"
                    className="button button--small"
                    disabled={busy}
                    onClick={() => {
                      if (!window.confirm(t("job.pane.kickConfirm", { label: m.label }))) return;
                      void props.agents.kickMember(job.teamId, m.memberId).then((r) => {
                        if (!r.ok) setNotice(r.message);
                        else void reload();
                      });
                    }}
                  >
                    {t("job.pane.kick")}
                  </button>
                ) : (
                  <fieldset className="settings__pairing-field" data-testid="local-accept-roles">
                    <legend className="setting__title">{t("job.pane.localAutoAccept")}</legend>
                    {(
                      [
                        ["developer", "settings.teams.role.developer"],
                        ["tester", "settings.teams.role.tester"],
                        ["designer", "settings.teams.role.designer"],
                        ["document", "settings.teams.role.document"],
                      ] as const
                    ).map(([role, key]) => (
                      <label key={role} className="settings__pairing-field">
                        <input
                          type="checkbox"
                          checked={localAcceptRoles.includes(role)}
                          disabled={busy}
                          onChange={(e) => void setLocalRole(role, e.target.checked)}
                        />{" "}
                        {t(key)}
                      </label>
                    ))}
                  </fieldset>
                )}
              </li>
            ))}
          </ul>
          <label className="settings__pairing-field">
            <input
              type="checkbox"
              checked={job.stallPolicy.automationEnabled}
              disabled={busy}
              onChange={(e) => {
                void props.agents.setJobStallAutomation(job.id, e.target.checked).then((r) => {
                  if (!r.ok) setNotice(r.message);
                  else setJob(r.job);
                });
              }}
            />{" "}
            {t("job.pane.stallAutomation")}
          </label>
        </section>
      </div>

      <section aria-labelledby="job-ledger">
        <h2 id="job-ledger">{t("job.pane.ledger")}</h2>
        <div className="job-pane__ledger-filters" data-testid="ledger-filters">
          <label>
            <select
              value={ledgerFilter}
              onChange={(e) => setLedgerFilter(e.target.value as LedgerFilter)}
              aria-label={t("job.pane.ledgerFilter")}
            >
              <option value="all">{t("job.pane.ledgerAll")}</option>
              <option value="step">{t("job.pane.ledgerByStep")}</option>
              <option value="member">{t("job.pane.ledgerByMember")}</option>
            </select>
          </label>
          {ledgerFilter === "step" ? (
            <select value={ledgerStepId} onChange={(e) => setLedgerStepId(e.target.value)}>
              <option value="">{t("job.pane.ledgerAll")}</option>
              {job.steps.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.role}: {s.brief.slice(0, 40)}
                </option>
              ))}
            </select>
          ) : null}
          {ledgerFilter === "member" ? (
            <select value={ledgerMemberId} onChange={(e) => setLedgerMemberId(e.target.value)}>
              <option value="">{t("job.pane.ledgerAll")}</option>
              {board.map((m) => (
                <option key={m.memberId} value={m.memberId}>
                  {m.label}
                </option>
              ))}
            </select>
          ) : null}
        </div>
        <ul className="job-pane__ledger">
          {[...filteredLedger].reverse().map((entry) => (
            <li key={entry.id}>
              <time dateTime={entry.at}>{entry.at.slice(11, 19)}</time> [{entry.kind}]
              {entry.memberId ? ` · ${entry.memberId === "local" ? t("job.pane.thisMachine") : entry.memberId.slice(0, 8)}` : ""}{" "}
              {entry.message}
            </li>
          ))}
        </ul>
      </section>

      {job.finalReport ? (
        <section aria-labelledby="job-report">
          <h2 id="job-report">{t("job.pane.report")}</h2>
          <p>{job.finalReport.summary}</p>
          {job.finalReport.failures.length > 0 ? (
            <ul>
              {job.finalReport.failures.map((f) => (
                <li key={f.stepId}>
                  {f.stepId}: {f.lastError ?? `${f.attempts} attempts`}
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function filterLedger(
  ledger: readonly JobLedgerNote[],
  filter: LedgerFilter,
  stepId: string,
  memberId: string,
): readonly JobLedgerNote[] {
  if (filter === "step" && stepId) return ledger.filter((e) => e.stepId === stepId);
  if (filter === "member" && memberId) return ledger.filter((e) => e.memberId === memberId);
  return ledger;
}

/** Count of job steps that need human attention — folds into the one rail badge. */
export function jobAttentionCount(jobs: readonly Job[]): number {
  return jobs.reduce((n, job) => {
    if (job.status !== "running") return n;
    return (
      n +
      job.steps.filter(
        (s) =>
          s.status === "offered" ||
          s.blocked === "needs-attention" ||
          s.runPhase === "needs-attention",
      ).length
    );
  }, 0);
}
