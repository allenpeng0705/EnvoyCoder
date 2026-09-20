import { describe, expect, it } from "vitest";

import {
  DEFAULT_SERVICE_LABEL,
  installService,
  parseServiceStatus,
  readServiceStatus,
  restartService,
  servicePlan,
  uninstallService,
  type ServiceIo,
  type ServicePlanInput,
  type ServiceStep,
} from "../src/index.js";

const input = (platform: ServicePlanInput["platform"]): ServicePlanInput => ({
  platform,
  node: "/opt/envoydev/runtime/0.1.0/node",
  entry: "/opt/envoydev/runtime/0.1.0/app/main.mjs",
  home: "/Users/anna/EnvoyMesh",
  logPath: "/Users/anna/Library/Logs/envoydev.log",
  userHome: "/Users/anna",
  uid: 501,
});

const label = DEFAULT_SERVICE_LABEL;
const join = (...parts: string[]): string => parts.join("/");

/** A supervisor that answers from a queue and records everything it was asked. */
function fakeIo(answers: { code: number; stdout?: string; stderr?: string }[] = []) {
  const calls: ServiceStep[] = [];
  const files = new Map<string, string>();
  const directories: string[] = [];
  const queue = [...answers];
  const io: ServiceIo = {
    run: async (step) => {
      calls.push(step);
      const next = queue.shift() ?? { code: 0, stdout: "" };
      return { code: next.code, stdout: next.stdout ?? "", stderr: next.stderr ?? "" };
    },
    writeFile: async (path, contents) => void files.set(path, contents),
    removeFile: async (path) => void files.delete(path),
    ensureDirectory: async (path) => void directories.push(path),
  };
  return { io, calls, files, directories };
}

describe("the plan a supervisor gets", () => {
  it("names the unit file, the directories it needs, and asks for status in the same breath", () => {
    const mac = servicePlan(input("macos"));
    expect(mac?.file).toBe(join("/Users/anna", `Library/LaunchAgents/${label}.plist`));
    expect(mac?.directories).toContain("/Users/anna/Library/LaunchAgents");
    expect(mac?.directories).toContain("/Users/anna/Library/Logs");
    // The status command is the supervisor's own view of the truth, not a file this code wrote.
    expect(servicePlan(input("linux"))?.file).toBe(
      join("/Users/anna", `.config/systemd/user/${label}.service`),
    );
    expect(servicePlan(input("windows"))?.file).toContain(`EnvoyDev\\${label}.xml`);
  });

  it("unloads before loading, so pressing the switch twice works", () => {
    const mac = servicePlan(input("macos"));
    expect(mac?.install.map((step) => step.args.join(" "))).toEqual([
      // The service target as one argument: `bootout gui/501 <label>` is the form that looks right and does
      // nothing (measured — see the plan's own comment).
      `bootout gui/501/${label}`,
      `bootstrap gui/501 ${mac?.file}`,
      `enable gui/501/${label}`,
    ]);
    // The first failure is the expected one on a fresh machine: nothing is loaded to unload.
    expect(mac?.install[0]?.tolerate).toBe("failure");
    expect(mac?.install[1]?.tolerate).toBeUndefined();
  });

  it("gives the Windows task the file it was written to, since /Create is told, not shown", () => {
    const windows = servicePlan(input("windows"));
    expect(windows?.install[0]?.args).toContain("/XML");
    expect(windows?.install[0]?.args).toContain(windows?.file);
    expect(windows?.install[0]?.args).toContain(label);
  });

  it("asks the Task Scheduler for the invariant XML first, then the localized LIST as a hint", () => {
    const windows = servicePlan(input("windows"));
    expect(windows?.status.map((step) => step.args.join(" "))).toEqual([
      `/Query /TN ${label} /XML`,
      `/Query /TN ${label} /FO LIST`,
    ]);
  });

  it("has no plan for a platform this build cannot install on", () => {
    expect(servicePlan(input("other"))).toBeUndefined();
  });
});

describe("installing", () => {
  it("writes the definition's own text, creates what it needs, then reports what the supervisor says", async () => {
    const { io, calls, files, directories } = fakeIo([
      { code: 113, stderr: "Could not find service" }, // bootout: expected
      { code: 0 },
      { code: 0 },
      { code: 0, stdout: "state = running\n\tpid = 4242\n" },
    ]);
    const status = await installService(io, input("macos"));
    expect([...files.keys()]).toEqual([join("/Users/anna", `Library/LaunchAgents/${label}.plist`)]);
    expect(files.get(join("/Users/anna", `Library/LaunchAgents/${label}.plist`))).toContain(
      "<key>RunAtLoad</key>",
    );
    expect(directories).toContain("/Users/anna/Library/LaunchAgents");
    expect(calls).toHaveLength(4);
    expect(status).toEqual({
      state: "running",
      enabled: true,
      pid: 4242,
      detail: "state = running\n\tpid = 4242",
    });
  });

  it("reports a step the supervisor refused, in the supervisor's own words", async () => {
    const { io } = fakeIo([{ code: 113 }, { code: 1, stderr: "Bootstrap failed: 5: Input/output error" }]);
    await expect(installService(io, input("macos"))).rejects.toThrow(
      /launchctl bootstrap .* failed \(exit 1\): Bootstrap failed: 5/,
    );
  });

  it("starts the Linux unit with one command that enables and starts it together", async () => {
    const { io, calls } = fakeIo([
      { code: 0 },
      { code: 0 },
      { code: 0, stdout: "LoadState=loaded\nActiveState=active\nSubState=running\nUnitFileState=enabled\nMainPID=99\n" },
    ]);
    const status = await installService(io, input("linux"));
    expect(calls.map((step) => step.args.join(" "))).toEqual([
      "--user daemon-reload",
      `--user enable --now ${label}.service`,
      `--user show ${label}.service --property=LoadState,ActiveState,SubState,UnitFileState,MainPID`,
    ]);
    expect(status).toMatchObject({ state: "running", enabled: true, pid: 99 });
  });

  it("runs both Windows status questions and keeps the XML answer as the fact", async () => {
    const { io, calls } = fakeIo([
      { code: 0, stdout: `<Task><Settings><Enabled>true</Enabled></Settings></Task>` },
      { code: 0, stdout: "Status:        Running\n" },
    ]);
    const status = await readServiceStatus(io, input("windows"));
    expect(calls.map((step) => step.args.join(" "))).toEqual([
      `/Query /TN ${label} /XML`,
      `/Query /TN ${label} /FO LIST`,
    ]);
    expect(status).toMatchObject({ state: "running", enabled: true });
  });

  it("cannot install on a platform it does not understand, and says so rather than guessing", async () => {
    const { io, calls } = fakeIo();
    expect(await installService(io, input("other"))).toEqual({
      state: "unsupported",
      detail: "this build cannot install a service on other",
    });
    expect(await readServiceStatus(io, input("other"))).toMatchObject({ state: "unsupported" });
    expect(calls).toHaveLength(0);
  });
});

describe("uninstalling and restarting", () => {
  it("unloads before deleting the file, and tolerates a service that was not there", async () => {
    // The status read that follows is launchd's own words: the exit code alone is not an absence any more, so the
    // fixture carries the sentence the supervisor prints.
    const { io, calls, files } = fakeIo([
      { code: 1, stderr: "Could not find service" },
      { code: 113, stderr: "Could not find service" },
    ]);
    const status = await uninstallService(io, input("macos"));
    expect(calls[0]?.args[0]).toBe("bootout");
    expect(files.size).toBe(0);
    expect(status.state).toBe("not-installed");
  });

  it("restarts by asking for a restart, not by stopping and hoping", async () => {
    const { io, calls } = fakeIo([{ code: 0 }, { code: 0, stdout: "LoadState=loaded\nActiveState=active\nUnitFileState=enabled\nMainPID=7\n" }]);
    expect(await restartService(io, input("linux"))).toMatchObject({ state: "running", pid: 7 });
    expect(calls[0]?.args).toEqual(["--user", "restart", `${label}.service`]);
  });
});

describe("what the supervisors each mean", () => {
  it("reads launchd: no non-zero exit is not an error, it is an absent service", () => {
    expect(parseServiceStatus("launchd", 113, "", "Could not find service")).toMatchObject({
      state: "not-installed",
    });
    expect(parseServiceStatus("launchd", 0, "state = waiting\n", "")).toMatchObject({
      state: "installed-stopped",
      enabled: true,
    });
    // macOS 15 says `state = not running` rather than `state = waiting`, and both are a loaded job between runs.
    expect(parseServiceStatus("launchd", 0, "state = not running\n", "")).toMatchObject({
      state: "installed-stopped",
    });
    expect(parseServiceStatus("launchd", 0, "something else\n", "")).toMatchObject({ state: "unknown" });
  });

  it("does not read 'I could not ask' as 'not installed'", () => {
    // `launchctl print` answers `Bad request.` when there is no `gui/<uid>` domain (SSH, no GUI session), and it
    // exits 127 when `launchctl` itself is missing. Both mean we could not ask, not that the service is gone, and
    // the exit code alone cannot tell them apart from launchd's not-found words.
    expect(parseServiceStatus("launchd", 113, "", "Bad request.")).toMatchObject({ state: "unknown" });
    expect(parseServiceStatus("launchd", 127, "", "spawn launchctl ENOENT")).toMatchObject({ state: "unknown" });
    // `schtasks /Query` fails the same way on access denied and on a stopped Task Scheduler, with a task that may
    // well be installed and running.
    expect(parseServiceStatus("schtasks", 1, "", "ERROR: Access is denied.")).toMatchObject({ state: "unknown" });
    expect(parseServiceStatus("schtasks", 1, "", "ERROR: The Task Scheduler service is not running.")).toMatchObject({
      state: "unknown",
    });
  });

  it("reads systemd, which says absent with exit 0", () => {
    // The asymmetry this module exists for: a zero exit is not success here.
    expect(
      parseServiceStatus("systemd", 0, "LoadState=not-found\nActiveState=inactive\nUnitFileState=\n", ""),
    ).toMatchObject({ state: "not-installed" });
    expect(
      parseServiceStatus("systemd", 0, "LoadState=loaded\nActiveState=failed\nUnitFileState=enabled\n", ""),
    ).toMatchObject({ state: "failed", enabled: true });
    expect(
      parseServiceStatus("systemd", 0, "LoadState=loaded\nActiveState=inactive\nUnitFileState=disabled\n", ""),
    ).toMatchObject({ state: "installed-stopped", enabled: false });
  });

  it("does not turn a UnitFileState it cannot classify into a login promise either way", () => {
    const parse = (unitFileState: string) =>
      parseServiceStatus(
        "systemd",
        0,
        `LoadState=loaded\nActiveState=inactive\nUnitFileState=${unitFileState}\n`,
        "",
      );
    // `enabled` and `disabled` are facts; `static` has no `[Install]` for `enable` to promise anything with, and an
    // empty state is a transient unit. Saying `false` there told the window "not set to start when you log in"
    // about a unit nothing had established that about.
    expect(parse("enabled").enabled).toBe(true);
    expect(parse("disabled").enabled).toBe(false);
    expect(parse("masked").enabled).toBe(false);
    expect(parse("static").enabled).toBeUndefined();
    expect(parse("indirect").enabled).toBeUndefined();
    expect(parse("").enabled).toBeUndefined();
  });

  it("reads the Task Scheduler's invariant XML, and treats a localized Status as a hint only", () => {
    const xml = (enabled: string) => `<Task><Settings><Enabled>${enabled}</Enabled></Settings></Task>`;
    // `Scheduled Task State` is only printed with `/V`, which the plan never asked for, so `enabled` used to be
    // false for every task. `<Settings><Enabled>` is a boolean with no translation.
    expect(parseServiceStatus("schtasks", 0, xml("true"), "", { code: 0, stdout: "Status:        Running\n" })).toMatchObject(
      { state: "running", enabled: true },
    );
    expect(parseServiceStatus("schtasks", 0, xml("false"), "", { code: 0, stdout: "Status:        Ready\n" })).toMatchObject(
      { state: "installed-stopped", enabled: false },
    );
    // German prints `Wird ausgeführt` under the same `Status:` label. Mapping it to "stopped" would be a wrong state
    // rather than an admitted unknown; the enabled fact from the XML still stands.
    expect(
      parseServiceStatus("schtasks", 0, xml("true"), "", { code: 0, stdout: "Status:        Wird ausgeführt\n" }),
    ).toMatchObject({ state: "unknown", enabled: true });
    // A Chinese build labels the field differently, so there is no word to read at all.
    expect(
      parseServiceStatus("schtasks", 0, xml("true"), "", { code: 0, stdout: "状态:  正在运行\n" }),
    ).toMatchObject({ state: "unknown", enabled: true });
    // No second answer at all: installed, and which run state it is in is not something this answer says.
    expect(parseServiceStatus("schtasks", 0, xml("true"), "")).toMatchObject({ state: "unknown", enabled: true });
    // The known not-found words still report absence.
    expect(parseServiceStatus("schtasks", 1, "", "ERROR: The system cannot find the file specified.")).toMatchObject({
      state: "not-installed",
    });
    expect(parseServiceStatus("schtasks", 1, "", 'ERROR: The specified task name "x" does not exist in the system.')).toMatchObject(
      { state: "not-installed" },
    );
  });
});
