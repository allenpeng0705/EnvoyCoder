/**
 * The stashes a repository is holding, under the Changes tab.
 *
 * ## Why it lives with the changes and not with the branches
 *
 * A stash is *uncommitted work set aside*, so the tab that shows uncommitted work is the tab where a user
 * looks for it — and the branch panel is already the one place that answers "which branch am I on". The
 * panel therefore sits under the commit box, and every write it makes reports the refreshed change list
 * back up to the sidebar, because a stash empties the tree the list is describing.
 *
 * ## The four operations, and which of them can hurt
 *
 * `list` and `push` are the pair a user reaches for: one read and one press. `pop` puts a stash back, and
 * the daemon refuses it onto a tree with changes — the panel does not pre-empt that, it shows the refusal
 * where the press was. `drop` is the only one that destroys something git cannot recover, so it asks first,
 * **in place**: the row turns into the question, which is a confirmation that names the thing it is about
 * rather than a dialog that covers the list.
 *
 * ## What a row shows
 *
 * Git's own subject — `WIP on main: 3c3a2b9 one`, or whatever a user's terminal wrote — verbatim and
 * untranslated, because it is not our sentence, next to *how long ago* it was made (`formatAgo`, so the
 * reading is in the user's language and calendar). The `stash@{n}` ref is the row's tooltip: it is what
 * they would type in a terminal, which is where the audit vocabulary belongs.
 */

import type { JSX } from "react";

import { useEffect, useRef, useState } from "react";

import { useI18n, useT } from "../i18n/context.js";
import { localize, type Refusal } from "../i18n/notice.js";
import { formatAgo } from "../i18n/when.js";
import type { ExplorerChange } from "./ExplorerSidebar.js";

/** One stash, as the daemon lists it. `index` is the only part the window sends back. */
export interface ExplorerStash {
  index: number;
  ref: string;
  /** Git's own subject, untranslated because it is not our sentence. */
  message: string;
  at?: string;
}

/** What a stash write changed. The list is the daemon's, measured after the write. */
export interface StashWriteAnswer {
  ok: true;
  changes: readonly ExplorerChange[];
  stashes: readonly ExplorerStash[];
}

/**
 * The stash operations, as this window can reach them.
 *
 * One object rather than four props, and passed only when all four exist: a daemon that does not serve them
 * (an older build, a paired surface with fewer methods) shows the changes and offers no stash control at all
 * — rather than a button whose press comes back "method not found".
 */
export interface StashActions {
  list: () => Promise<{ ok: true; stashes: readonly ExplorerStash[] } | Refusal>;
  push: () => Promise<StashWriteAnswer | Refusal>;
  pop: (index: number) => Promise<StashWriteAnswer | Refusal>;
  drop: (index: number) => Promise<{ ok: true; stashes: readonly ExplorerStash[] } | Refusal>;
}

export function StashPanel(props: {
  actions: StashActions;
  /** Is there anything in the tree to set aside? The daemon refuses otherwise; the control is simply off. */
  canStash: boolean;
  /** The refreshed change list, which the stash just emptied (a push) or filled (a pop). */
  onChanges: (changes: readonly ExplorerChange[]) => void;
  /** Another write in the same tab is in flight, so this one waits rather than racing it. */
  disabled?: boolean;
}): JSX.Element {
  const t = useT();
  const { locale } = useI18n();
  const actions = useRef(props.actions);
  actions.current = props.actions;
  const onChanges = useRef(props.onChanges);
  onChanges.current = props.onChanges;

  const [stashes, setStashes] = useState<readonly ExplorerStash[] | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | undefined>(undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  /**
   * The list read itself failing is **not** the same as an empty list.
   *
   * A daemon that is a build behind — reached over the mesh, or an older window's — refuses the method, and
   * "Nothing stashed." would then be a claim about the repository made out of a call that never happened.
   * So the failure is its own state, and it is shown as the sentence that came back.
   */
  const [listFailure, setListFailure] = useState<string | undefined>(undefined);
  /** The stash a user has asked to discard, while the row is asking them to be sure. */
  const [confirming, setConfirming] = useState<number | undefined>(undefined);

  // The list is read once when the tab opens: it is a read, so it is never refused, and a count a user can
  // see is worth one spawn. A failure here stays in the panel: the Changes tab is about the working tree, and
  // a stash list nobody could read must not take the tab down with it.
  useEffect(() => {
    let cancelled = false;
    void actions.current.list().then((result) => {
      if (cancelled) return;
      if (result.ok === false) {
        setListFailure(localize(t, result) ?? t("explorer.changes.failed"));
        return;
      }
      setStashes(result.stashes);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const run = async (
    operation: () => Promise<StashWriteAnswer | { ok: true; stashes: readonly ExplorerStash[] } | Refusal>,
    /** What to say afterwards, when the answer is not visible by itself. A push empties a list; a pop fills it. */
    done?: string,
  ): Promise<void> => {
    setBusy(true);
    setFailure(undefined);
    setNotice(undefined);
    const result = await operation();
    setBusy(false);
    setConfirming(undefined);
    if (result.ok === false) {
      setFailure(localize(t, result) ?? t("explorer.changes.failed"));
      return;
    }
    setStashes(result.stashes);
    if ("changes" in result) onChanges.current(result.changes);
    if (done !== undefined) setNotice(done);
  };

  const working = busy || props.disabled === true;

  return (
    <div className="explorer__stash" data-testid="stash-panel">
      <div className="explorer__stash-head">
        <span className="explorer__stash-title">
          {t("git.stash.title")}
          {stashes === undefined ? "" : ` ${stashes.length}`}
        </span>
        <button
          type="button"
          className="button button--ghost"
          // Off when the daemon would refuse it anyway: a clean tree has nothing to set aside. The daemon's
          // own `gitNothingToStash` is the backstop for a surface whose status is stale.
          disabled={working || !props.canStash}
          onClick={() => void run(() => actions.current.push(), t("git.stash.done"))}
        >
          {t("git.stash.cta")}
        </button>
      </div>
      {notice !== undefined ? <p className="explorer__status">{notice}</p> : null}
      {failure !== undefined ? (
        <p className="explorer__status explorer__change-write-error" role="alert">
          {failure}
        </p>
      ) : null}
      {stashes === undefined ? (
        listFailure === undefined ? null : (
          <p className="explorer__status" role="status">
            {listFailure}
          </p>
        )
      ) : stashes.length === 0 ? (
        <p className="explorer__status">{t("git.stash.empty")}</p>
      ) : (
        <ul className="explorer__stash-list">
          {stashes.map((stash) => (
            <li key={stash.ref} className="explorer__stash-row">
              {confirming === stash.index ? (
                <>
                  {/* **The question takes the row, and the stash keeps the tooltip.** A sidebar is about 280px
                      wide: the message, the question and two buttons on one line do not fit, and the row the
                      user just pressed is what the question is about — so the words move to `title` rather
                      than pushing the buttons off the edge. */}
                  <span className="explorer__stash-ask" title={stash.message}>
                    {t("git.stash.confirm")}
                  </span>
                  <span className="explorer__change-actions">
                    <button
                      type="button"
                      className="button button--ghost"
                      disabled={working}
                      onClick={() => setConfirming(undefined)}
                    >
                      {t("action.cancel")}
                    </button>
                    <button
                      type="button"
                      className="button button--danger"
                      disabled={working}
                      onClick={() => void run(() => actions.current.drop(stash.index))}
                    >
                      {t("git.stash.drop")}
                    </button>
                  </span>
                </>
              ) : (
                <>
                  <span className="explorer__stash-what" title={stash.ref}>
                    <span className="explorer__stash-message">{stash.message}</span>
                    {stash.at === undefined ? null : (
                      <span className="explorer__stash-when">{formatAgo(stash.at, locale, Date.now())}</span>
                    )}
                  </span>
                  <span className="explorer__change-actions">
                    <button
                      type="button"
                      className="button button--ghost"
                      disabled={working}
                      onClick={() => void run(() => actions.current.pop(stash.index))}
                    >
                      {t("git.stash.pop")}
                    </button>
                    <button
                      type="button"
                      className="button button--ghost"
                      disabled={working}
                      onClick={() => setConfirming(stash.index)}
                    >
                      {t("git.stash.drop")}
                    </button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
