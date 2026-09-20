import { describe, expect, it } from "vitest";

import type { ServiceStatus } from "@envoydev/platform";

import {
  askToStop,
  describeService,
  describeStop,
  serviceActionFrom,
  type StopSocket,
} from "../src/daemon/service-cli.js";

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

describe("asking a daemon to stop", () => {
  /** A socket that answers synchronously, so the test needs no timing. */
  const answering = (frame: unknown, sent: string[] = []): StopSocket =>
    ({
      send: (data: string) => void sent.push(data),
      close: () => undefined,
      addEventListener: (type: string, listener: (event?: unknown) => void) => {
        if (type === "open") listener();
        if (type === "message") listener({ data: JSON.stringify(frame) });
      },
    }) as unknown as StopSocket;

  it("sends coder.shutdown over the claim's own port and path, and reports acceptance", async () => {
    const sent: string[] = [];
    const result = await askToStop({
      port: 4770,
      path: "/ws",
      connect: () => answering({ id: "stop", result: { stopping: true } }, sent),
    });
    expect(result.stopped).toBe(true);
    // The method is the one the daemon answers *before* it drains, which is what makes this a stop rather than a kill.
    expect(JSON.parse(sent[0] ?? "null")).toEqual({ id: "stop", method: "coder.shutdown", params: {} });
  });

  it("says nobody answered instead of hanging on a wedged daemon", async () => {
    const result = await askToStop({
      port: 4770,
      path: "/ws",
      timeoutMs: 5,
      connect: () => ({ send: () => undefined, close: () => undefined, addEventListener: () => undefined }) as unknown as StopSocket,
    });
    expect(result.stopped).toBe(false);
    expect(result.detail).toContain("did not answer within 5 ms");
    // The advice matters more than the diagnosis: there is a way out of a wedged daemon.
    expect(describeStop(result, false).join(" ")).toContain("service uninstall");
  });

  it("treats an error frame as a refusal, not as a stop", async () => {
    const result = await askToStop({
      port: 4770,
      path: "/ws",
      connect: () => answering({ id: "stop", error: { code: "envoydev.unauthorized" } }),
    });
    expect(result.stopped).toBe(false);
    expect(result.detail).toContain("error");
  });

  it("tells the owner of a service-managed daemon that it will come back", async () => {
    const line = describeStop({ stopped: true, detail: "" }, true).join(" ");
    expect(line).toContain("start again at your next login");
    // …and a daemon the app started will not, which is the difference the person needs to know.
    expect(describeStop({ stopped: true, detail: "" }, false).join(" ")).toContain("next time you open EnvoyDev");
  });
});
