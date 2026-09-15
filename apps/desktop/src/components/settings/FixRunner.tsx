/**
 * **The press that resolves a row, and what it says afterwards.**
 *
 * ## Why it lives inside the fix block
 *
 * The block already shows the exact command (§7.18) and a Copy control. This adds the one gesture that makes the
 * block *resolvable* rather than instructive — and it belongs here, next to the command, because that is the
 * thing the user is deciding about. A failure lands in the same place: the output tail is rendered under the
 * command that produced it, where the user is already looking, rather than in a notice strip at the top of the
 * pane that says something went wrong somewhere.
 *
 * ## What the press does, and what it deliberately cannot do
 *
 * It sends the **target** — a harness id, a catalogue id, a provider id — and never a command line: the daemon
 * resolves the commands through the same probes that drew this row, at the moment of the press (`fixes.ts`). So
 * the command above the button is the command that runs. This component's whole contribution is to say what
 * happened: `succeeded`, `failed` with the tail, `nothing-to-do` (the world moved — the user installed it
 * themselves a moment ago), or a refusal.
 *
 * ## Four sentences, and no fifth
 *
 * Every outcome is one of the daemon's four, rendered as a sentence a user can act on. The one that matters most
 * is `failed`: it shows the **command's own output**, because a package manager's error is the only useful
 * explanation of a package manager's failure, and hiding it behind "something went wrong" would send the user to
 * a terminal to reproduce what this press just did.
 */

import { useCallback, useState } from "react";
import type { JSX } from "react";

import type { FixRunResult } from "@envoycoder/protocol";

import { useI18n } from "../../i18n/context.js";
import { localize, type Refusal } from "../../i18n/notice.js";

/** What the store's `runFix` answers with — the daemon's result, or a refusal that nothing ran. */
export type FixRunAnswer = { ok: true; result: FixRunResult } | Refusal;

export function FixRunner(props: { run: () => Promise<FixRunAnswer> }): JSX.Element {
  const { t } = useI18n();
  const [running, setRunning] = useState(false);
  const [answer, setAnswer] = useState<FixRunAnswer | undefined>(undefined);

  const press = useCallback(() => {
    setRunning(true);
    setAnswer(undefined);
    void props.run().then((result) => {
      setAnswer(result);
      setRunning(false);
    });
  }, [props.run]);

  const outcome = answer?.ok === true ? answer.result : undefined;
  const refusal = answer?.ok === false ? answer : undefined;
  /**
   * One line for the outcome, chosen by what happened rather than by a tone of voice. `{code}` is the exit code
   * the command reported — the only number a user can act on, and the one a bug report needs.
   */
  const line =
    refusal !== undefined
      ? localize(t, refusal)
      : outcome === undefined
        ? undefined
        : outcome.outcome === "succeeded"
          ? t("settings.agents.fix.run.done")
          : outcome.outcome === "nothing-to-do"
            ? t("settings.agents.fix.run.nothing")
            : outcome.outcome === "refused"
              ? t("settings.agents.fix.run.refused")
              : outcome.reason === "timeout"
                ? t("settings.agents.fix.run.timedOut")
                : t("settings.agents.fix.run.failed", { code: outcome.exitCode ?? 0 });

  return (
    <div className="settings__agent-fix-run">
      <button
        type="button"
        className="button button--secondary button--small"
        title={t("settings.agents.fix.run.title")}
        disabled={running}
        onClick={press}
      >
        {running ? t("settings.agents.fix.run.busy") : t("settings.agents.fix.run")}
      </button>
      {line !== undefined ? (
        <p
          className={`settings__agent-fact settings__agent-fix-outcome${
            outcome?.outcome === "failed" ? " settings__agent-fix-outcome--failed" : ""
          }`}
          role="status"
        >
          {line}
        </p>
      ) : null}
      {/* **The command's own words**, because that is what explains a failure. Bounded and scrollable: an npm
          transcript is long, and a block that pushed the row's other content off screen would be worse than no
          output at all. */}
      {outcome !== undefined && outcome.outcome === "failed" && outcome.output.trim() !== "" ? (
        <pre className="settings__agent-output">{outcome.output.trim()}</pre>
      ) : null}
    </div>
  );
}
