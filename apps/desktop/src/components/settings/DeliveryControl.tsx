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
  /**
   * The package this connector could be fetched from — the *offer*, from the wire.
   *
   * `undefined` for an agent whose adapter is in this repository, and that absence is what stops this control
   * drawing a press that could only come back `connector-not-fetchable`.
   */
  fetchable?: { package: string; covers: "connector" | "agent" };
  /**
   * Why the row is not ready, when it is not — from `rowVerdict`'s own reason.
   *
   * The offer is made only for `connector`: the agent is here and the piece that drives it is not, which is exactly
   * the case fetching resolves. A row that is `absent` is missing the **agent** too, so fetching its connector
   * would leave it just as unusable — and an offer that does not resolve the row is not an offer.
   */
  reason?: "connector" | "absent" | "env" | "our-gap" | "unlooked";
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
  /**
   * **What this control may offer, and when it may offer nothing.**
   *
   * The owner's report, verbatim: *"For the 'Ready' status agent, why they still have 'Run it through npx'?"* They
   * were pointing at a control that cannot work in two different ways at once, which is the one thing this pane's
   * laws forbid outright:
   *
   *   * **a Ready agent has nothing to work around.** The installed route is working; offering to fetch the same
   *     connector would be a preference with no problem behind it. (If the user *has* chosen fetching, the row is
   *     Ready *through* it — and then the offer runs the other way, as it must.)
   *   * **an agent with no npm connector cannot be fetched at all.** Envoy Harness, DeepSeek Harness and Cursor
   *     Agent have their adapters in this repository, so `fetchable` is absent and the press would come back
   *     `connector-not-fetchable` — a refusal the user can do nothing with.
   *
   * So the offer is made in exactly one case: the agent is here, the piece that drives it is not, and the catalogue
   * knows where that piece could be fetched from.
   */
  /**
   * **And it is offered only where fetching would resolve *this* row.**
   *
   * The two shapes are not interchangeable, which is what `covers` is for: a **bridge** package helps a row that
   * has the agent and is missing the adapter (`connector`), while an agent that *is* its own ACP server — Copilot,
   * whose `npx -y @github/copilot --acp` was measured to answer `initialize` — is exactly what is missing when the
   * row reads `absent`. Offering either in the other's state would be a press that downloads something and leaves
   * the row exactly as it was.
   */
  const offerable =
    props.fetchable !== undefined &&
    ((props.fetchable.covers === "connector" && props.reason === "connector") ||
      (props.fetchable.covers === "agent" && props.reason === "absent"));
  if (!fetching && !offerable) return null;

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
