/**
 * **Appearance** — how this window looks.
 *
 * Theme only in this slice: light / dark / system. Font sizes and the rest of Paseo's Appearance
 * page stay out until the token ramp can scale them (`docs/settings-parity.md` §4.2 / §8.2).
 */

import type { JSX } from "react";

import type { CoderSettings } from "@envoydev/protocol";

import { useI18n } from "../../i18n/context.js";
import { SettingRow } from "../SettingsRows.js";
import type { SettingsSectionProps } from "./SectionProps.js";

const THEMES: readonly NonNullable<CoderSettings["theme"]>[] = ["dark", "light", "system"];

export function AppearanceSection(props: SettingsSectionProps): JSX.Element {
  const { t } = useI18n();
  const theme = props.state.settings.theme ?? "dark";

  return (
    <SettingRow
      title={t("settings.theme.title")}
      detail={t("settings.theme.detail")}
      developerNote="settings.theme"
    >
      {(write) => (
        <select
          className="select"
          value={theme}
          aria-label={t("settings.theme.aria")}
          onChange={(event) =>
            write(props.onUpdate({ theme: event.target.value as CoderSettings["theme"] }))
          }
        >
          {THEMES.map((option) => (
            <option key={option} value={option}>
              {t(`settings.theme.${option}`)}
            </option>
          ))}
        </select>
      )}
    </SettingRow>
  );
}
