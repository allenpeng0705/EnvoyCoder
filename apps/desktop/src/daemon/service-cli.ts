/**
 * `service install|uninstall|status|restart` — the half of the switch that outlives the app.
 *
 * macOS is why this exists. Deleting an app from Applications runs **no code**, so whatever removes the service
 * cannot be the app: it is this entry point, which the bundle runs before it is deleted and a person can run
 * afterwards (`<stateDir>/runtime/<version>/app/main.mjs service uninstall`). NSIS and the deb call the same path,
 * which is one implementation of "remove the service" instead of three.
 *
 * **Why the two pure functions are here and not in `main.ts`.** That file boots a daemon at module scope, so no
 * test can import it; and "which action did they ask for" and "what does this state mean for that action" are
 * exactly the parts worth a test. The reading of each supervisor's answer already happened by the time this code
 * sees a `ServiceStatus` — see `@envoydev/platform`'s `service-install.ts`, which is where the platform knowledge
 * lives.
 */

import type { ServiceStatus } from "@envoydev/platform";

export type ServiceAction = "install" | "uninstall" | "status" | "restart";

/** The action named by `service <action>`, or `undefined` for a word that is not one of ours. */
export function serviceActionFrom(argv: readonly string[]): ServiceAction | undefined {
  const word = argv[2] === "service" ? argv[3]?.trim() : undefined;
  return word === "install" || word === "uninstall" || word === "status" || word === "restart"
    ? word
    : undefined;
}

/**
 * What to print, and whether the command did what was asked.
 *
 * End-user language: a person typing this has one question ("is it on, and will it stay on?") and one worry
 * ("what did it just do to my work?"), so the sentences answer those. Installation details are last, in
 * parentheses, for the log somebody pastes into a bug report.
 *
 * `status` succeeds whatever it finds, because it is a question. Every other action succeeds only in the state it
 * was aiming at — and an `install` that ends "installed, not running yet" is a **success**, because a launchd job
 * that has been accepted is not yet a running process (measured; the caller polls, and this command says so).
 */
export function describeService(
  action: ServiceAction,
  status: ServiceStatus,
): { lines: string[]; ok: boolean } {
  const pid = status.pid === undefined ? "" : ` (pid ${status.pid})`;
  if (status.state === "unsupported") {
    return {
      ok: false,
      lines: [
        "This system has no service manager that this build knows how to use.",
        "EnvoyDev can still be started from the app, as it always has been.",
        `(${status.detail})`,
      ],
    };
  }

  if (action === "status") {
    const sentence =
      status.state === "running"
        ? `EnvoyDev is running as a service${pid}.`
        : status.state === "installed-stopped"
          ? "EnvoyDev is installed as a service but is not running at the moment."
          : status.state === "failed"
            ? "EnvoyDev's service is installed but has failed. Its own log says:"
            : status.state === "not-installed"
              ? "EnvoyDev does not run as a service on this machine."
              : "The service manager answered something this build does not understand:";
    // Only when something is wrong: launchd answers an unknown label with "Bad request. Could not find service …",
    // which is exactly the expected answer on a machine that never installed the service — noise, not information.
    const explain = status.state === "failed" || status.state === "unknown";
    return { ok: true, lines: [sentence, ...(explain && status.detail !== "" ? [status.detail] : [])] };
  }

  if (action === "uninstall") {
    return status.state === "not-installed"
      ? {
          ok: true,
          lines: [
            "EnvoyDev no longer starts as a service.",
            "Your projects, tasks and pairings are untouched.",
          ],
        }
      : {
          ok: false,
          lines: ["EnvoyDev is still installed as a service.", status.detail],
        };
  }

  // install and restart share a shape: running is success, waiting to start is also success, anything else is not.
  if (status.state === "running") {
    return {
      ok: true,
      lines: [
        action === "install"
          ? `EnvoyDev now runs as a service${pid}, and will start again at login.`
          : `EnvoyDev restarted${pid}.`,
      ],
    };
  }
  if (status.state === "installed-stopped") {
    return {
      ok: true,
      lines: [
        "EnvoyDev is installed as a service.",
        "It is not running this second; it will start at login.",
      ],
    };
  }
  return {
    ok: false,
    lines: [
      action === "install"
        ? "EnvoyDev could not be installed as a service."
        : "EnvoyDev could not be restarted.",
      status.detail,
    ],
  };
}
