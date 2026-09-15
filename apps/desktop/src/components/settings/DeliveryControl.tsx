/**
 * **The one control that changes what a run starts** — installed connector, or one fetched by `npx`.
 *
 * ## Why it is a press rather than a fallback
 *
 * The tempting alternative is to fetch silently whenever the installed connector is missing: no setting, no
 * control, and the row "just works". It is refused for the reason this product refuses every other silent change
 * to a user's machine — the first run would **download a package** for an agent whose program they believed they
 * had installed, and nothing on screen would have said so. So the route is chosen here, stored, and rendered as a
 * property of the row (`Delivered by: npm, fetched on the first run`).
 *
 * ## Two directions, one component
 *
 * `installed` offers *Run it through npx*; `npx` offers *Use the installed copy*, which stops the fetching. The
 * second is not a nicety: a delivery is a preference like any other, and one that could not be undone would be a
 * decision a user has to live with — the opposite of what this page is for.
 *
 * Rendered only where the agent could conceivably take both routes. A refusal is still possible (an agent whose
 * connector is not on npm) and is shown here, where the press was, rather than in a strip elsewhere.
 */

import { useCallback, useState } from "react";
import type { JSX } from "react";

import type { AgentDelivery, HarnessId } from "@envoycoder/protocol";

import { useI18n } from "../../i18n/context.js";
import { localize, type Refusal } from "../../i18n/notice.js";

export function DeliveryControl(props: {
  harness: HarnessId;
  delivery: AgentDelivery | undefined;
  /** `undefined` when the daemon does not serve `coder.setAgentDelivery` — the control is not drawn then. */
  onChoose?: (harness: HarnessId, delivery: "installed" | "npx") => Promise<{ ok: true } | Refusal>;
}): JSX.Element | null {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | undefined>(undefined);

  const choose = useCallback(
    (next: "installed" | "npx") => {
      if (props.onChoose === undefined) return;
      setBusy(true);
      setRefusal(undefined);
      void props
        .onChoose(props.harness, next)
        .then((answer) => {
          if (!answer.ok) setRefusal(answer);
        })
        .finally(() => setBusy(false));
    },
    [props],
  );

  if (props.onChoose === undefined) return null;
  const fetching = props.delivery?.kind === "npx";

  return (
    <div className="settings__agent-delivery">
      <button
        type="button"
        className="button button--ghost button--small"
        disabled={busy}
        title={t(fetching ? "settings.agents.delivery.installed.title" : "settings.agents.delivery.npx.title")}
        onClick={() => choose(fetching ? "installed" : "npx")}
      >
        {t(fetching ? "settings.agents.delivery.installed" : "settings.agents.delivery.npx")}
      </button>
      {refusal !== undefined ? (
        <p className="settings__agent-fact" role="status">
          {localize(t, refusal)}
        </p>
      ) : null}
    </div>
  );
}
