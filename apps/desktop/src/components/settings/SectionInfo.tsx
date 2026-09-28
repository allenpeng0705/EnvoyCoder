/**
 * Section Info — a short “what / how” block at the top of complex Settings pages.
 *
 * Agents, LLM, Pairing, Paired homes and Teams are not self-explanatory from the bar caption alone.
 * The copy is short enough to sit on the page (muted, under the title) rather than behind a dialog.
 * The page title names the section; this block orients, then the controls follow.
 */

import type { JSX } from "react";

import { useI18n } from "../../i18n/context.js";
import type { MessageKey } from "../../i18n/messages/en.js";
import type { SettingsSectionId } from "../../state/settings-sections.js";

/** Sections that carry the orientation block. */
export const SECTIONS_WITH_INFO = ["agents", "llm", "pairing", "homes", "teams"] as const;
export type SectionWithInfo = (typeof SECTIONS_WITH_INFO)[number];

export function hasSectionInfo(id: SettingsSectionId): id is SectionWithInfo {
  return (SECTIONS_WITH_INFO as readonly string[]).includes(id);
}

type InfoKeys = {
  what: MessageKey;
  steps: readonly MessageKey[];
};

const INFO: Record<SectionWithInfo, InfoKeys> = {
  agents: {
    what: "settings.section.agents.info.what",
    steps: [
      "settings.section.agents.info.how.1",
      "settings.section.agents.info.how.2",
      "settings.section.agents.info.how.3",
      "settings.section.agents.info.how.4",
    ],
  },
  llm: {
    what: "settings.section.llm.info.what",
    steps: [
      "settings.section.llm.info.how.1",
      "settings.section.llm.info.how.2",
      "settings.section.llm.info.how.3",
    ],
  },
  pairing: {
    what: "settings.section.pairing.info.what",
    steps: [
      "settings.section.pairing.info.how.1",
      "settings.section.pairing.info.how.2",
      "settings.section.pairing.info.how.3",
    ],
  },
  homes: {
    what: "settings.section.homes.info.what",
    steps: [
      "settings.section.homes.info.how.1",
      "settings.section.homes.info.how.2",
      "settings.section.homes.info.how.3",
    ],
  },
  teams: {
    what: "settings.section.teams.info.what",
    steps: [
      "settings.section.teams.info.how.1",
      "settings.section.teams.info.how.2",
      "settings.section.teams.info.how.3",
      "settings.section.teams.info.how.4",
    ],
  },
};

export function SectionInfo(props: { section: SectionWithInfo }): JSX.Element {
  const { t } = useI18n();
  const keys = INFO[props.section];

  return (
    <section className="settings-info" data-testid={`settings-info-${props.section}`}>
      <p className="settings-info__what">{t(keys.what)}</p>
      <h3 className="settings-info__heading">{t("settings.info.howHeading")}</h3>
      <ol className="settings-info__steps">
        {keys.steps.map((key) => (
          <li key={key}>{t(key)}</li>
        ))}
      </ol>
    </section>
  );
}
