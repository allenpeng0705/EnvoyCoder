import { describe, expect, it } from "vitest";

import type { ServiceStatus } from "@envoydev/platform";

import { describeService, serviceActionFrom } from "../src/daemon/service-cli.js";

const status = (state: ServiceStatus["state"], extra: Partial<ServiceStatus> = {}): ServiceStatus => ({
  state,
  detail: "",
  ...extra,
});

describe("reading the command line", () => {
  it("accepts the four actions after the `service` word", () => {
    // `main.mjs service uninstall`: argv[0] is node, argv[1] the entry point, which is why this offset is 2.
    expect(serviceActionFrom(["node", "main.mjs", "service", "uninstall"])).toBe("uninstall");
    expect(serviceActionFrom(["node", "main.mjs", "service", "install"])).toBe("install");
    expect(serviceActionFrom(["node", "main.mjs", "service", "status"])).toBe("status");
    expect(serviceActionFrom(["node", "main.mjs", "service", "restart"])).toBe("restart");
  });

  it("refuses anything else rather than guessing", () => {
    // A typo must not silently uninstall: an unknown action exits non-zero with the usage line.
    expect(serviceActionFrom(["node", "main.mjs", "service", "uninstall "])).toBe("uninstall");
    expect(serviceActionFrom(["node", "main.mjs", "service"])).toBeUndefined();
    expect(serviceActionFrom(["node", "main.mjs", "service", "remove"])).toBeUndefined();
    expect(serviceActionFrom(["node", "main.mjs", "--install-payload"])).toBeUndefined();
  });
});

describe("what a person is told", () => {
  it("treats an accepted-but-not-yet-running install as success, and says when it will start", () => {
    // Measured: launchd accepts a job and starts the process asynchronously, so this state is normal right after
    // an install. Reporting failure here would show an error for something that was starting.
    const waiting = describeService("install", status("installed-stopped"));
    expect(waiting.ok).toBe(true);
    expect(waiting.lines.join(" ")).toContain("will start at login");
  });

  it("reports a running service with its pid", () => {
    const running = describeService("install", status("running", { pid: 4242 }));
    expect(running.ok).toBe(true);
    expect(running.lines.join(" ")).toContain("pid 4242");
  });

  it("answers a status question successfully whatever it finds", () => {
    for (const state of ["running", "installed-stopped", "failed", "not-installed", "unknown"] as const) {
      expect(describeService("status", status(state)).ok).toBe(true);
    }
  });

  it("promises that uninstalling leaves the user's work alone, and only when it really is gone", () => {
    const gone = describeService("uninstall", status("not-installed"));
    expect(gone.ok).toBe(true);
    expect(gone.lines.join(" ")).toContain("projects, tasks and pairings are untouched");
    expect(describeService("uninstall", status("running", { pid: 7 })).ok).toBe(false);
  });

  it("fails an install that ended nowhere, in the supervisor's own words", () => {
    const failed = describeService("install", status("not-installed", { detail: "Bootstrap failed: 5" }));
    expect(failed.ok).toBe(false);
    expect(failed.lines).toContain("Bootstrap failed: 5");
  });

  it("says a machine has no service manager without pretending the product is broken", () => {
    const unsupported = describeService("install", status("unsupported", { detail: "on openbsd" }));
    expect(unsupported.ok).toBe(false);
    expect(unsupported.lines[0]).toContain("no service manager");
    expect(unsupported.lines.join(" ")).toContain("started from the app");
  });
});

describe("what a person is not told", () => {
  it("does not show a supervisor's complaint about a service that was simply never installed", () => {
    // launchd says "Bad request. Could not find service …" for an unknown label, which is the expected answer on
    // a machine that never switched the service on. Printing it would read as a fault.
    const plain = describeService("status", status("not-installed", { detail: "Bad request." }));
    expect(plain.lines).toEqual(["EnvoyDev does not run as a service on this machine."]);
    // But when something is genuinely wrong, the supervisor's own words are the most useful line there is.
    const broken = describeService("status", status("failed", { detail: "exit status 4" }));
    expect(broken.lines).toContain("exit status 4");
  });
});
