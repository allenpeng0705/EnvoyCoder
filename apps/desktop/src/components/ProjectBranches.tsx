/**
 * The project's branch: which one the folder is on, and how to change it.
 *
 * ## Why the rail, and why a panel rather than a `RowMenu`
 *
 * Branches belong to the **project folder**, which is the row this control sits on; a task may later have
 * its own worktree (`Task.worktree`), and that is a different chip in a different place. `RowMenu` is the
 * app's one menu of *actions* — choose one and it closes — while this panel is a **list of branches plus a
 * form**: the list has to stay open while a user compares names, and creating one keeps it open to show
 * what happened. The keyboard contract is copied from the menu deliberately (Escape closes, focus returns
 * to the trigger, click-outside closes, the first branch takes focus) because a user should not be able to
 * tell which of the two they are in.
 *
 * ## What it refuses to render
 *
 * Nothing, for a folder git does not track. `Project.vcs.kind` is the stored fact that makes that free —
 * a rail of ten projects spawns nothing for the nine that are not repositories — and a *measured* status
 * overrides it in both directions, because the stored kind can be missing (a project added by an older
 * build) or wrong (a folder that became a repository after it was added).
 *
 * ## The one thing it will not do quietly
 *
 * A detached HEAD is said out loud, in the chip and in the panel. Reading "no branch is current" as a
 * branch with a strange name is how a user commits onto a commit instead of onto a branch.
 */

import type { JSX, KeyboardEvent } from "react";

import { useEffect, useRef, useState } from "react";

import type { GitBranch, GitStatus, Project } from "@envoydev/protocol";

import { useI18n } from "../i18n/context.js";
import type { Refusal } from "../i18n/notice.js";
import { localize } from "../i18n/notice.js";
import type { GitSnapshot } from "../state/coderStore.js";
import { BranchIcon } from "./icons.js";

export interface ProjectBranchesProps {
  project: Project;
  /** What the window last measured, or nothing yet. */
  snapshot: GitSnapshot | undefined;
  /** Measure the repository. Called on mount and when the panel opens without a snapshot. */
  onRead: () => Promise<{ ok: true } | Refusal>;
  onCheckout: (branch: string) => Promise<{ ok: true } | Refusal>;
  onCreate: (name: string) => Promise<{ ok: true } | Refusal>;
  /** Merge a branch **into the current one** — git's own direction, and the workflow's last step. */
  onMerge: (branch: string) => Promise<{ ok: true; into?: string } | Refusal>;
  /** Fetch: the safe half of talking to a remote, and allowed while a run is live. */
  onFetch: () => Promise<{ ok: true; summary: string } | Refusal>;
  /** Pull: a fast-forward, or a refusal saying the histories have diverged. */
  onPull: () => Promise<{ ok: true; summary: string } | Refusal>;
  /**
   * Merge a branch **and hand a conflict to an agent**, which is the one path that leaves the repository
   * mid-merge on purpose. Offered where a merge has just conflicted, so the branch is the one the user chose.
   */
  onResolve: (branch: string) => Promise<{ ok: true; outcome: "merged"; into?: string } | { ok: true; outcome: "resolving"; task: string } | Refusal>;
  /** Record a merge whose conflicts are resolved. Refused while any remain, naming them. */
  onFinishMerge: () => Promise<{ ok: true; sha: string } | Refusal>;
  /** Take a merge in progress back — the way out, and the only one when nobody resolves it. */
  onAbortMerge: () => Promise<{ ok: true } | Refusal>;
}

export function ProjectBranches(props: ProjectBranchesProps): JSX.Element | null {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  /** The branch whose merge just conflicted, so the offer to resolve it names the one the user chose. */
  const [conflicted, setConflicted] = useState<string | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  /** One measurement per project per window, unless something asks again. */
  const asked = useRef(false);
  /** The read, through a ref so the effect that runs it can depend on `open` and nothing else. */
  const read = useRef(props.onRead);
  read.current = props.onRead;

  const status: GitStatus | undefined = props.snapshot?.status;
  const branches = props.snapshot?.branches ?? [];
  const kind = status?.kind ?? props.project.vcs?.kind ?? "none";

  // **Measured once, on the rows that could have branches.** Guarded by a ref rather than by `status`,
  // because a failed read leaves `status` undefined and would otherwise retry on every render — a spawn
  // loop on a folder git cannot answer about.
  useEffect(() => {
    if (kind !== "git" || props.snapshot !== undefined || asked.current) return;
    asked.current = true;
    void props.onRead();
  }, [kind, props.snapshot, props.onRead]);

  useEffect(() => {
    if (!open) return;
    /**
     * **Opening the panel measures again.**
     *
     * The branch and the merge state both move under this window — a terminal, another window, an agent that
     * has just resolved a conflict — and the panel is where a user acts on those facts. Measuring once per
     * window would leave *Finish* disabled after an agent had done its work, with no way to find out except
     * pressing something that refuses. The mount read below stays guarded, so a folder git cannot answer about
     * is still asked once rather than on every render.
     *
     * Read through a ref, and keyed on `open` alone: callers pass an inline arrow, so a dependency on the
     * callback would re-run this on **every** render — and since the read updates the snapshot that renders
     * the caller, that is a spawn loop, not a re-measure.
     */
    void read.current();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPress = (event: Event): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPress, true);
    document.addEventListener("mousedown", onPress, true);
    return () => {
      document.removeEventListener("pointerdown", onPress, true);
      document.removeEventListener("mousedown", onPress, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const buttons = itemRefs.current.filter((item): item is HTMLButtonElement => item !== null);
    // The branch list first, then the form: a user who opened this wants to switch, not to type.
    (buttons.find((button) => !button.disabled) ?? buttons[0])?.focus();
  }, [open]);

  if (kind !== "git") return null;

  /**
   * What the trigger says, and the branch name it needs as a *value* elsewhere.
   *
   * A conflict outranks the branch in the chip: it is the one state here a user has to act on, and the title
   * still names the branch. The two are kept apart because `label` is interpolated into the merge sentences
   * ("Merge {branch} into {current}"), and a chip word leaking into one of those would read as a branch
   * called "Conflicts".
   */
  const currentBranch =
    status?.branch ?? (status?.detached === true ? t("git.branches.detachedChip") : t("sidebar.project.branch", { branch: "…" }));
  const label =
    status?.merge !== undefined && status.conflicted ? t("git.branches.conflictsChip") : currentBranch;

  const close = (returnFocus = true): void => {
    setOpen(false);
    setNotice(undefined);
    setRefusal(undefined);
    if (returnFocus) triggerRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      // The shell binds Escape globally to "stop the run"; dismissing this panel must not kill a run.
      event.stopPropagation();
      close();
    }
  };

  const switchTo = async (branch: GitBranch): Promise<void> => {
    if (branch.current || busy) return;
    setBusy(true);
    setRefusal(undefined);
    const result = await props.onCheckout(branch.name);
    setBusy(false);
    if (!result.ok) {
      setRefusal(localize(t, result));
      return;
    }
    setNotice(t("git.branches.switched", { branch: branch.name }));
  };

  const merge = async (branch: GitBranch): Promise<void> => {
    if (branch.current || busy) return;
    setBusy(true);
    setRefusal(undefined);
    setNotice(undefined);
    setConflicted(undefined);
    const result = await props.onMerge(branch.name);
    setBusy(false);
    if (!result.ok) {
      setRefusal(localize(t, result));
      // **A conflict is the one refusal with a second act to it**, and the keys are how this panel knows
      // which refusal it is holding without re-reading the sentence: the branch is still here to hand over.
      setConflicted(result.key === "error.gitMergeConflict" ? branch.name : undefined);
      return;
    }
    setNotice(t("git.merge.done", { branch: branch.name, into: result.into ?? currentBranch }));
  };

  /** Merge again — this time keeping the conflict — and let an agent resolve it. */
  const resolve = async (branch: string): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setRefusal(undefined);
    setNotice(undefined);
    const result = await props.onResolve(branch);
    setBusy(false);
    setConflicted(undefined);
    if (!result.ok) {
      setRefusal(localize(t, result));
      return;
    }
    setNotice(
      result.outcome === "merged"
        ? t("git.merge.done", { branch, into: result.into ?? currentBranch })
        : t("git.merge.resolving", { task: result.task }),
    );
  };

  /** Record a resolved merge, or take one back — the two ends of the state the block above reports. */
  const settleMerge = async (finish: boolean): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setRefusal(undefined);
    setNotice(undefined);
    const result = finish ? await props.onFinishMerge() : await props.onAbortMerge();
    setBusy(false);
    if (!result.ok) {
      setRefusal(localize(t, result));
      return;
    }
    setNotice(t(finish ? "git.merge.recorded" : "git.merge.aborted"));
  };

  /** A fetch or a pull, which differ only in which call they make and what they say afterwards. */
  const sync = async (run: () => Promise<{ ok: true; summary: string } | Refusal>, key: "fetch" | "pull"): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setRefusal(undefined);
    setNotice(undefined);
    const result = await run();
    setBusy(false);
    if (!result.ok) {
      setRefusal(localize(t, result));
      return;
    }
    // **An empty summary is git saying nothing changed**, which is a fact and not an empty sentence: the
    // wording for it is this window's, in the user's language, and never a value the daemon filled in.
    setNotice(
      result.summary === ""
        ? t(key === "fetch" ? "git.fetch.nothing" : "git.pull.nothing")
        : t(key === "fetch" ? "git.fetch.done" : "git.pull.done", { summary: result.summary }),
    );
  };

  const create = async (): Promise<void> => {
    const name = draft.trim();
    if (name === "" || busy) return;
    setBusy(true);
    setRefusal(undefined);
    const result = await props.onCreate(name);
    setBusy(false);
    if (!result.ok) {
      setRefusal(localize(t, result));
      return;
    }
    setDraft("");
    setNotice(t("git.branches.created", { branch: name }));
  };

  return (
    <div className="project__branch" ref={rootRef} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className="project__branch-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("git.branches.aria", { project: props.project.label })}
        title={t("sidebar.project.branch", { branch: currentBranch })}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <BranchIcon size={13} />
        <span className="project__branch-name">{label}</span>
      </button>

      {open ? (
        <div className="project__branch-panel row-menu__list" role="dialog" aria-label={t("git.branches.aria", { project: props.project.label })}>
          <p className="project__branch-title">{t("git.branches.title")}</p>

          {/* **A merge in progress is the state of the repository**, so it comes before the list of branches
              a user could switch to — and it is where Finish and Abort live, because a merge without them is
              the state this product refuses to leave behind. */}
          {status?.merge !== undefined ? (
            <div className="project__branch-merge-state" data-testid="merge-state">
              <p className="project__branch-note">
                {status.merge.branch !== undefined
                  ? t("git.merge.stoppedFrom", { branch: status.merge.branch })
                  : t("git.merge.stopped")}
              </p>
              {status.conflicted ? null : (
                <p className="project__branch-note">{t("git.merge.resolved")}</p>
              )}
              <div className="project__branch-sync">
                <button
                  type="button"
                  className="button"
                  // Off while files are still in conflict: the daemon would refuse, and the sentence above is
                  // what tells the user what has to happen first.
                  disabled={busy || status.conflicted}
                  onClick={() => void settleMerge(true)}
                >
                  {t("git.merge.finish")}
                </button>
                <button
                  type="button"
                  className="button button--ghost"
                  disabled={busy}
                  onClick={() => void settleMerge(false)}
                >
                  {t("git.merge.abort")}
                </button>
              </div>
            </div>
          ) : null}

          {status?.detached === true ? (
            <p className="project__branch-note">{t("git.branches.detached")}</p>
          ) : null}
          {branches.length === 0 ? (
            <p className="project__branch-note">{t("git.branches.empty")}</p>
          ) : (
            <ul className="project__branch-list">
              {branches.map((branch, index) => (
                <li key={branch.name} className="project__branch-row">
                  <button
                    ref={(element) => {
                      itemRefs.current[index] = element;
                    }}
                    type="button"
                    className="project__branch-item row-menu__item"
                    aria-current={branch.current ? "true" : undefined}
                    disabled={busy || branch.current}
                    onClick={() => void switchTo(branch)}
                  >
                    <span>{branch.name}</span>
                  </button>
                  {/* **Merge is offered on the branch you would merge *from*** — chosen while looking at the
                      list, and always into the branch HEAD is on, which is git's own direction. */}
                  {branch.current ? null : (
                    <button
                      type="button"
                      className="project__branch-merge"
                      title={t("git.merge.into", { branch: branch.name, current: currentBranch })}
                      aria-label={t("git.merge.into", { branch: branch.name, current: currentBranch })}
                      disabled={busy}
                      onClick={() => void merge(branch)}
                    >
                      {t("git.merge.cta")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          <div className="project__branch-sync">
            <button
              type="button"
              className="button button--ghost"
              disabled={busy}
              onClick={() => void sync(props.onFetch, "fetch")}
            >
              {t("git.fetch.cta")}
            </button>
            <button
              type="button"
              className="button button--ghost"
              disabled={busy}
              onClick={() => void sync(props.onPull, "pull")}
            >
              {t("git.pull.cta")}
            </button>
          </div>
          <div className="project__branch-new">
            <label className="project__branch-label" htmlFor={`new-branch-${props.project.id}`}>
              {t("git.branches.new")}
            </label>
            <div className="project__branch-new-row">
              <input
                id={`new-branch-${props.project.id}`}
                className="project__branch-input"
                type="text"
                value={draft}
                placeholder={t("git.branches.name")}
                disabled={busy}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void create();
                }}
              />
              <button
                type="button"
                className="button button--ghost"
                disabled={busy || draft.trim() === ""}
                onClick={() => void create()}
              >
                {t("git.branches.create")}
              </button>
            </div>
          </div>

          {notice !== undefined ? <p className="project__branch-note">{notice}</p> : null}
          {refusal !== undefined ? (
            <p className="project__branch-refusal" role="alert">
              {refusal}
            </p>
          ) : null}
          {/* The refusal above names the files; this is the act that follows from it. It stays here, under
              the sentence, rather than being one of the branch rows' own controls: the conflict belongs to the
              merge that just failed, not to the branch list. */}
          {conflicted !== undefined ? (
            <button
              type="button"
              className="button button--ghost project__branch-resolve"
              disabled={busy}
              onClick={() => void resolve(conflicted)}
            >
              {t("git.merge.resolve")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
