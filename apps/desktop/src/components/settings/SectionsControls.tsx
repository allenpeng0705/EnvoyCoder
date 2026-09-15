/**
 * The three sections that **hold controls**: General, New tasks, Safety.
 *
 * ## What moved here, and what did not
 *
 * These rows were one scrolling column in `SettingsPane.tsx` with three headings above them. Nothing
 * about a row changed in the move — same keys, same controls, same notes, same write path — only the
 * *page* each group sits on: a heading was a claim about a group, and a section is a place with a name,
 * a row in the bar and its own back control. The rows are grouped exactly as the headings grouped them,
 * which is why this diff is a move plus a wrapper rather than a rewrite.
 *
 * ## The one rule every row here follows
 *
 * A control either does what it says or says why it cannot, on screen, in the user's language. The four
 * places that rule is load-bearing are: the language (stored on the daemon, and §7.4 of the settings
 * audit records what it does *not* reach), the folder `Add project` starts in (read by the palette's
 * own row), the approvals switch (handed to the agent as its own session policy, and **disabled with
 * the reason naming the agent** when it cannot be told), and transcripts (the daemon's own
 * `appendTranscript`).
 */

import type { JSX } from "react";

import { useState } from "react";

import type { CoderSettings, HarnessId } from "@envoycoder/protocol";

import { offeredAgents } from "../../composer/agent-for.js";
import { useI18n } from "../../i18n/context.js";
import { LOCALES, LOCALE_LABELS } from "../../i18n/locales.js";
import { FolderSetting, SettingRow, TextSetting } from "../SettingsRows.js";
import type { SettingsSectionProps } from "./SectionProps.js";
import { ApprovalRow, ModelRow, summaryFor } from "./SettingsRowParts.js";

/**
 * **General** — the language this window speaks, and the folder a new project starts from.
 *
 * The two are together because they are the two answers a user gives *before* any work exists: what
 * language the app talks to them in, and where their work lives.
 */
export function GeneralSection(props: SettingsSectionProps): JSX.Element {
  const { t, locale, preference } = useI18n();
  const { settings } = props.state;
  // A value the daemon has not stored yet reads as `system`, which is what the daemon will apply.
  const language = settings.language ?? "system";
  // The folder the chooser would not open in, or `undefined`. Kept here rather than in the row so the
  // sentence survives a re-render: a problem the user has to read must not vanish on the next paint.
  const [folderProblem, setFolderProblem] = useState<string | undefined>(undefined);

  return (
    <>
      {/* **The language, and why it is a daemon setting rather than `localStorage`.**
          It is a per-user preference, and the daemon already owns this user's settings: a value in
          the webview's own storage would be invisible to the phone, would not survive a webview
          cache clear, and would have to be re-sent to whichever surface renders a refusal. Stored
          with the rest, it follows the user to every window and every client — which is what
          "the language must be unified" requires, since the daemon's refusals are rendered by
          whoever is looking. */}
      <SettingRow
        title={t("settings.language.title")}
        detail={t("settings.language.detail")}
        developerNote="settings.language"
      >
        <select
          className="select"
          value={language}
          aria-label={t("settings.language.aria")}
          onChange={(event) =>
            props.onUpdate({ language: event.target.value as CoderSettings["language"] })
          }
        >
          <option value="system">{t("settings.language.system")}</option>
          {LOCALES.map((option) => (
            // Endonyms: a language is listed in its own language, so the one a user is looking for
            // is the one they can read. The row is also the only place the *resolved* locale is
            // visible, when the setting is "system".
            <option key={option} value={option}>
              {LOCALE_LABELS[option]}
              {option === locale && preference === "system" ? ` — ${t("settings.language.system")}` : ""}
            </option>
          ))}
        </select>
      </SettingRow>

      {/* **The one setting that is read by a workflow rather than by the app.**
          `defaultProjectPath` sat in the schema, was advertised on the wire and was read by nobody until
          slice 1. It is read now by the palette's own `project.add` row, which seeds its text stage with
          it — so the field a user meets when they add a project starts from the folder they nominated
          instead of asking them to paste one they have already told us about. */}
      <SettingRow
        title={t("settings.defaultPath.title")}
        detail={t("settings.defaultPath.detail")}
        developerNote="settings.defaultProjectPath"
        note={folderProblem}
      >
        <FolderSetting
          ariaLabel={t("settings.defaultPath.title")}
          value={settings.defaultProjectPath}
          placeholder={t("settings.defaultPath.placeholder")}
          onCommit={(value) => {
            setFolderProblem(undefined);
            // `""` is "clear it": a user who nominated a folder must be able to un-nominate one, and a
            // JSON patch cannot carry an absent key (`daemon/store.ts` records why).
            props.onUpdate({ defaultProjectPath: value });
          }}
          pickPrompt={t("palette.addProject.pickPrompt")}
          onProblem={setFolderProblem}
        />
      </SettingRow>
    </>
  );
}

/**
 * **New tasks** — the agent, the model and the agent's own argv that a task starts with.
 *
 * The three are one question ("what does a new task start on?") and they resolve together: a project's
 * answer, then this machine's, then the agent's own default — `resolveTaskDefaults`'s order, which is
 * why every row here says it can be overridden rather than claiming to be final.
 */
export function TasksSection(props: SettingsSectionProps): JSX.Element {
  const { t } = useI18n();
  const { settings } = props.state;
  // **The picker's contents, derived from what a probe measured.** `offeredAgents` drops only an agent we
  // established is absent and orders the rest by how usable it says it is; nothing a user stored can enter
  // into it, which is why this row cannot be made to forget an agent. See its doc for the reasoning, and the
  // note under the select for where the ones it drops are.
  const available = offeredAgents(props.state.harnesses);
  const defaultHarness = settings.defaults.harness ?? "envoy-harness";

  return (
    <>
      <SettingRow
        title={t("settings.defaultHarness.title")}
        detail={t("settings.defaultHarness.detail")}
        developerNote="settings.defaults.harness"
      >
        {/* One child, because `SettingRow` renders exactly one control beside its row — so the select and
            the note under it are wrapped rather than passed as siblings. */}
        <div className="setting__field-group">
          <select
            className="select"
            value={defaultHarness}
            aria-label={t("settings.defaultHarness.title")}
            onChange={(event) => props.onUpdate({ defaults: { harness: event.target.value as HarnessId } })}
          >
            {available.length === 0 ? (
              // An empty picker is a lie by omission: it suggests nothing is installed when the
              // truth is that we have not been told yet.
              <option value={defaultHarness}>{defaultHarness}</option>
            ) : null}
            {available.map((harness) => (
              <option key={harness.id} value={harness.id}>
                {harness.label}
                {harness.tier === "catalogued" ? ` ${t("settings.needsInstalling")}` : ""}
              </option>
            ))}
          </select>
          {/* **Where the agents this picker does not offer are, said out loud.** The picker drops the one
              state that asserts a program is absent, and an unexplained short list is how a user concludes
              the product does not support their agent — which is precisely the complaint the catalogue screen
              exists to answer. So the row names that place, where every agent we ship, every agent the user
              declared and all 38 recipes are listed with the state each one was measured in. */}
          <p className="settings__note">
            {t("settings.defaultHarness.catalog", { section: t("settings.section.agents.title") })}
          </p>
        </div>
      </SettingRow>

      {/* **Read but unsettable, until slice 1.** `resolveTaskDefaults` has honoured `defaults.model`
          since it was written, and no control wrote one — a capability a user was told about by the docs
          and could not reach. The shapes are the composer's, from the same `ModelChoice`, so the app's
          default model, a project's default model and a task's model cannot come to mean three things. */}
      <ModelRow
        idPrefix="setting-app"
        harness={defaultHarness}
        summary={summaryFor(props.state, defaultHarness)}
        value={settings.defaults.model}
        title={t("settings.defaultModel.title")}
        detail={t("settings.defaultModel.detail")}
        developerNote="settings.defaults.model"
        onChoose={(model) => props.onUpdate({ defaults: { model } })}
      />

      {/* And its sibling, which is free text by nature: argv belongs to the agent's own CLI, and the row
          therefore has to say what it is for rather than pretend to know what is valid. */}
      <SettingRow
        title={t("settings.extraArgs.title")}
        detail={t("settings.extraArgs.detail")}
        developerNote="settings.defaults.extraArgs"
      >
        <TextSetting
          ariaLabel={t("settings.extraArgs.title")}
          value={settings.defaults.extraArgs}
          placeholder={t("settings.extraArgs.placeholder")}
          onCommit={(value) => props.onUpdate({ defaults: { extraArgs: value } })}
        />
      </SettingRow>
    </>
  );
}

/**
 * **Safety** — what an agent may do without asking, and what is kept afterwards.
 *
 * Two settings, and the first one is the row this whole pane was rebuilt around: it is delivered as the
 * agent's **own session policy** rather than as a switch this app pretends to enforce.
 */
export function SafetySection(props: SettingsSectionProps): JSX.Element {
  const { t } = useI18n();
  const { settings } = props.state;
  const defaultHarness = settings.defaults.harness ?? "envoy-harness";

  return (
    <>
      <ApprovalRow
        state={props.state}
        harness={defaultHarness}
        checked={settings.requireApprovalForDestructive}
        onToggle={(checked) => props.onUpdate({ requireApprovalForDestructive: checked })}
      />

      <SettingRow
        title={t("settings.transcripts.title")}
        detail={t("settings.transcripts.detail")}
        developerNote="settings.keepTranscripts"
      >
        <input
          type="checkbox"
          checked={settings.keepTranscripts}
          onChange={(event) => props.onUpdate({ keepTranscripts: event.target.checked })}
          aria-label={t("settings.transcripts.title")}
        />
      </SettingRow>
    </>
  );
}
