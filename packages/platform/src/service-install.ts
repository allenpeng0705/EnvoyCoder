/**
 * Installing the service: which program to run, in which order, and how to read the answer.
 *
 * ## Why this is here and not in the daemon
 *
 * `service.ts` next door writes the supervisor's *text*; this file writes the *conversation* with the supervisor,
 * and both are platform knowledge in the sense this package means it — not a path separator, but the fact that
 * launchd reports a missing label by exiting non-zero while systemd reports it by exiting zero with
 * `LoadState=not-found`, and that `schtasks` says it in a sentence. That is the kind of thing that must be tested
 * on whichever OS runs the suite, so it lives beside the text and takes its I/O as an argument:
 *
 *     the caller supplies `run` and the file operations; this module decides what to run and what it meant
 *
 * ## The rule the plans encode
 *
 * Every plan is **idempotent in both directions**: installing over a running service works, uninstalling
 * something absent works, and restarting a stopped service works. That is why the loading step is preceded by an
 * unloading step marked `tolerate: "failure"` — the failure of `launchctl bootout` on a service that is not there
 * is the *expected* path, not an error to report to somebody who just pressed a switch.
 */

import { dirname, posix, win32 } from "node:path";

import type { PlatformId } from "./index.js";
import {
  serviceDefinition,
  type ServiceDefinition,
  type ServiceDefinitionInput,
} from "./service.js";

/**
 * Where an argument is the unit file's own path.
 *
 * A NUL byte is the one thing that cannot appear in a path, so it cannot collide with a real argument — and the
 * path is not known when the plan is built, because the plan says where the file goes, not the other way round.
 */
const UNIT_FILE = "\u0000unit-file";

/** One program invocation. `args` go straight to `execFile` — never through a shell, so nothing here is quoted. */
export interface ServiceStep {
  command: string;
  args: string[];
  /** A failure that is part of the happy path: unloading what is not loaded, deleting what is absent. */
  tolerate?: "failure";
}

export interface ServicePlanInput extends ServiceDefinitionInput {
  /** The OS *user's* home, where a per-user unit file lives. Not the shared EnvoyMesh home. */
  userHome: string;
  /** The uid that owns the launchd GUI domain. Passed in because only the caller's platform knows how to ask. */
  uid: number;
}

export interface ServicePlan {
  definition: ServiceDefinition;
  /** The unit file, absolute. */
  file: string;
  /** Directories the installer must have before the supervisor will start: the unit's and the log's. */
  directories: string[];
  install: ServiceStep[];
  uninstall: ServiceStep[];
  restart: ServiceStep[];
  /** Ask the supervisor what it thinks. Its exit code and output are the only source of truth. */
  status: ServiceStep[];
}

/** What the supervisor says about the service, in the terms the product needs. */
export interface ServiceStatus {
  /** `unsupported` is not `unknown`: one means this build cannot, the other means it asked and did not understand. */
  state: "not-installed" | "installed-stopped" | "running" | "failed" | "unsupported" | "unknown";
  /** Whether it will come back at login. `undefined` when the platform does not say. */
  enabled?: boolean;
  pid?: number;
  /** The supervisor's own words, kept for the log and for support rather than parsed away. */
  detail: string;
}

/** The I/O the plan needs. Real in the daemon, a queue of canned answers in the suite. */
export interface ServiceIo {
  run(step: ServiceStep): Promise<{ code: number; stdout: string; stderr: string }>;
  writeFile(path: string, contents: string): Promise<void>;
  removeFile(path: string): Promise<void>;
  ensureDirectory(path: string): Promise<void>;
}

function join(platform: PlatformId, ...parts: string[]): string {
  return platform === "windows" ? win32.join(...parts) : posix.join(...parts);
}

function launchdPlan(input: ServicePlanInput, definition: ServiceDefinition): ServicePlan {
  const domain = `gui/${input.uid}`;
  const target = `${domain}/${definition.label}`;
  return {
    definition,
    file: join("macos", input.userHome, definition.relativePath),
    directories: [join("macos", input.userHome, "Library/LaunchAgents"), dirname(input.logPath)],
    install: [
      // `bootstrap` refuses a label that is already loaded. Unloading first makes the switch idempotent, and the
      // "not loaded" failure it hits on a first install is the expected path.
      //
      // **The target, not the domain and the label as two arguments.** Measured on macOS 15: `launchctl bootout
      // gui/501 <label>` boots nothing out and reports nothing, so the step that was meant to make installing
      // idempotent did not — and, worse, the same form in `uninstall` left the service *running* after the file
      // was deleted. Only executed code catches that; the unit test had encoded the wrong form.
      { command: "launchctl", args: ["bootout", target], tolerate: "failure" },
      // The plist's own path: `bootstrap` takes the file, while `enable`/`print` take the domain-target form.
      { command: "launchctl", args: ["bootstrap", domain, UNIT_FILE] },
      { command: "launchctl", args: ["enable", target], tolerate: "failure" },
    ],
    uninstall: [{ command: "launchctl", args: ["bootout", target], tolerate: "failure" }],
    restart: [{ command: "launchctl", args: ["kickstart", "-k", target] }],
    status: [{ command: "launchctl", args: ["print", target] }],
  };
}

function systemdPlan(input: ServicePlanInput, definition: ServiceDefinition): ServicePlan {
  const unit = `${definition.label}.service`;
  return {
    definition,
    file: join("linux", input.userHome, definition.relativePath),
    directories: [dirname(input.logPath)],
    install: [
      // The unit file is not visible to systemd until it re-reads the directory, and `enable --now` is one step
      // rather than two because a half-done install that is enabled but not started reads as broken.
      { command: "systemctl", args: ["--user", "daemon-reload"] },
      { command: "systemctl", args: ["--user", "enable", "--now", unit] },
    ],
    uninstall: [
      { command: "systemctl", args: ["--user", "disable", "--now", unit], tolerate: "failure" },
      { command: "systemctl", args: ["--user", "daemon-reload"] },
    ],
    restart: [{ command: "systemctl", args: ["--user", "restart", unit] }],
    status: [
      {
        command: "systemctl",
        args: [
          "--user",
          "show",
          unit,
          "--property=LoadState,ActiveState,SubState,UnitFileState,MainPID",
        ],
      },
    ],
  };
}

function schtasksPlan(input: ServicePlanInput, definition: ServiceDefinition): ServicePlan {
  return {
    definition,
    file: join("windows", input.userHome, definition.relativePath),
    directories: [join("windows", input.userHome, "AppData/Local/EnvoyDev"), dirname(input.logPath)],
    install: [
      { command: "schtasks", args: ["/Create", "/TN", definition.label, "/XML", UNIT_FILE, "/F"] },
    ],
    uninstall: [
      { command: "schtasks", args: ["/Delete", "/TN", definition.label, "/F"], tolerate: "failure" },
    ],
    restart: [
      { command: "schtasks", args: ["/End", "/TN", definition.label], tolerate: "failure" },
      { command: "schtasks", args: ["/Run", "/TN", definition.label] },
    ],
    status: [{ command: "schtasks", args: ["/Query", "/TN", definition.label, "/FO", "LIST"] }],
  };
}

/**
 * The plan for this platform, or `undefined` where this build cannot install a service.
 *
 * The step that names the unit file (`launchctl bootstrap`, `schtasks /Create /XML`) is completed here from the
 * plan's own file path, so no caller has to remember which supervisor wants the file and which wants the label.
 */
export function servicePlan(input: ServicePlanInput): ServicePlan | undefined {
  const definition = serviceDefinition(input);
  if (definition === undefined) return undefined;
  const plan =
    definition.kind === "launchd"
      ? launchdPlan(input, definition)
      : definition.kind === "systemd"
        ? systemdPlan(input, definition)
        : schtasksPlan(input, definition);
  // Every plan that names its unit file on the command line gets the absolute path here, so no caller has to
  // remember which supervisor wants the file and which wants the label.
  const fill = (steps: ServiceStep[]): ServiceStep[] =>
    steps.map((step) =>
      step.args.includes(UNIT_FILE)
        ? { ...step, args: step.args.map((argument) => (argument === UNIT_FILE ? plan.file : argument)) }
        : step,
    );
  return {
    ...plan,
    install: fill(plan.install),
    uninstall: fill(plan.uninstall),
    restart: fill(plan.restart),
    status: fill(plan.status),
  };
}

/**
 * Read one supervisor's answer.
 *
 * The three disagree about how to say "there is no such service", and that disagreement is the whole reason this
 * function exists: launchd and `schtasks` exit non-zero, while systemd exits **zero** and reports
 * `LoadState=not-found`. Treating a non-zero exit as an error in the first two, or a zero exit as success in the
 * third, would show somebody "failed" for a service that is simply not installed yet.
 */
export function parseServiceStatus(
  kind: ServiceDefinition["kind"],
  code: number,
  stdout: string,
  stderr: string,
): ServiceStatus {
  const detail = (code === 0 ? stdout : `${stdout}${stderr}`).trim();

  if (kind === "launchd") {
    if (code !== 0) return { state: "not-installed", detail };
    const pid = /pid = (\d+)/.exec(stdout);
    if (/state = running/.test(stdout)) {
      return { state: "running", enabled: true, ...(pid ? { pid: Number(pid[1]) } : {}), detail };
    }
    // `state = waiting` is a loaded launchd job between runs — installed, and it will come back.
    if (/state = /.test(stdout)) return { state: "installed-stopped", enabled: true, detail };
    return { state: "unknown", detail };
  }

  if (kind === "systemd") {
    if (code !== 0) return { state: "unknown", detail };
    const field = (name: string): string => new RegExp(`^${name}=(.*)$`, "m").exec(stdout)?.[1]?.trim() ?? "";
    if (field("LoadState") === "not-found") return { state: "not-installed", detail };
    // `enabled-runtime` and `static` both mean it is there; only `disabled` means it will not come back.
    const unitFileState = field("UnitFileState");
    const enabled = unitFileState !== "" && unitFileState !== "disabled";
    const active = field("ActiveState");
    const mainPid = Number(field("MainPID"));
    const pid = Number.isInteger(mainPid) && mainPid > 0 ? { pid: mainPid } : {};
    if (active === "active") return { state: "running", enabled, ...pid, detail };
    if (active === "failed") return { state: "failed", enabled, ...pid, detail };
    if (active === "inactive" || active === "activating" || active === "deactivating") {
      return { state: "installed-stopped", enabled, detail };
    }
    return { state: "unknown", detail };
  }

  if (code !== 0) return { state: "not-installed", detail };
  const status = /Status:\s*(\S+)/i.exec(stdout)?.[1] ?? "";
  const enabled = /Scheduled Task State:\s*Enabled/i.test(stdout);
  if (/^running$/i.test(status)) return { state: "running", enabled, detail };
  if (status !== "") return { state: "installed-stopped", enabled, detail };
  return { state: "unknown", detail };
}

/** The result every entry point returns. `unsupported` is not `unknown`: one means "cannot", the other "asked". */
function unsupported(platform: PlatformId): ServiceStatus {
  return { state: "unsupported", detail: `this build cannot install a service on ${platform}` };
}

async function runSteps(io: ServiceIo, steps: readonly ServiceStep[]): Promise<void> {
  for (const step of steps) {
    const result = await io.run(step);
    if (result.code !== 0 && step.tolerate !== "failure") {
      throw new Error(
        `${step.command} ${step.args.join(" ")} failed (exit ${result.code}): ` +
          `${result.stderr.trim() || result.stdout.trim() || "no output"}`,
      );
    }
  }
}

/** Write the unit file where the supervisor looks, then tell it to pick that up. */
export async function installService(io: ServiceIo, input: ServicePlanInput): Promise<ServiceStatus> {
  const plan = servicePlan(input);
  if (plan === undefined) return unsupported(input.platform);
  for (const directory of plan.directories) await io.ensureDirectory(directory);
  await io.writeFile(plan.file, plan.definition.contents);
  await runSteps(io, plan.install);
  // Ask rather than assume: a supervisor that accepted the file and refused the job says so only here.
  return readServiceStatus(io, input);
}

/** Tell the supervisor to forget it, then take the file away — in that order, or it writes the file back. */
export async function uninstallService(io: ServiceIo, input: ServicePlanInput): Promise<ServiceStatus> {
  const plan = servicePlan(input);
  if (plan === undefined) return unsupported(input.platform);
  await runSteps(io, plan.uninstall);
  await io.removeFile(plan.file);
  return readServiceStatus(io, input);
}

export async function restartService(io: ServiceIo, input: ServicePlanInput): Promise<ServiceStatus> {
  const plan = servicePlan(input);
  if (plan === undefined) return unsupported(input.platform);
  await runSteps(io, plan.restart);
  return readServiceStatus(io, input);
}

/**
 * What the supervisor thinks, without changing anything.
 *
 * A plan this build cannot make is `unsupported`; a supervisor that answers something unrecognisable is
 * `unknown`. Neither is "not-installed", because claiming a service is absent when the truth is that we could not
 * ask would invite the UI to offer an install that will not work.
 */
export async function readServiceStatus(io: ServiceIo, input: ServicePlanInput): Promise<ServiceStatus> {
  const plan = servicePlan(input);
  if (plan === undefined) return unsupported(input.platform);
  const step = plan.status[0];
  if (step === undefined) return { state: "unknown", detail: "no status command for this platform" };
  const result = await io.run(step);
  return parseServiceStatus(plan.definition.kind, result.code, result.stdout, result.stderr);
}
