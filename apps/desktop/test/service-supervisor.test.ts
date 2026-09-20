/**
 * The operations that run the supervisor **in a child process**, and the exit code that must not drift.
 *
 * ## Why this file exists
 *
 * `supervisor.ts`'s `uninstall`/`restart` deliberately do not call the platform's plans in this process: on
 * systemd both commands SIGTERM the daemon that invoked them and wait for it to become inactive, so the step
 * *after* the call — the `removeFile`, the status read, the RPC reply — never ran (finding A). These cases drive
 * the child seam instead: what is spawned, with which home, and what each exit code means.
 *
 * ## And one cross-package constant
 *
 * The systemd unit's `RestartPreventExitStatus=0 4` duplicates `boot.ts`'s `EXIT_DAMAGED_HOME`. Neither package
 * can import the other's answer without inverting a dependency, so the last case binds them by *value*: the
 * generated text must carry the daemon's own constant, and a change to either side fails here rather than
 * silently making the supervisor restart a damaged profile for ever.
 */

import { describe, expect, it, vi } from "vitest";

import { coderPaths } from "@envoydev/host-bridge";
import { detectPlatform, serviceDefinition, type ServiceIo, type ServiceStep } from "@envoydev/platform";

import { EXIT_DAMAGED_HOME } from "../src/daemon/boot.js";
import {
  restartServiceOutOfProcess,
  uninstallServiceOutOfProcess,
  type ServiceCommandResult,
} from "../src/daemon/supervisor.js";

/** A home that exists only as a string: every operation below injects its I/O, so nothing is written. */
const paths = coderPaths("/tmp/envoydev-supervisor-unit-test");
const argv = ["/runtime/node", "/runtime/app/main.mjs"];
const program = { node: "/runtime/node", entry: "/runtime/app/main.mjs" };

/** A supervisor's answer for the *read* that follows a successful child, on whichever OS runs the suite. */
function statusIo(running: boolean): ServiceIo {
  const platform = detectPlatform();
  return {
    run: async (step: ServiceStep) => {
      if (platform === "macos") {
        return running
          ? { code: 0, stdout: "state = running\n\tpid = 7\n", stderr: "" }
          : { code: 1, stdout: "", stderr: "Could not find service" };
      }
      if (platform === "linux") {
        return {
          code: 0,
          stdout: running
            ? "LoadState=loaded\nActiveState=active\nSubState=running\nUnitFileState=enabled\nMainPID=7\n"
            : "LoadState=not-found\nActiveState=inactive\nSubState=dead\nUnitFileState=\nMainPID=0\n",
          stderr: "",
        };
      }
      return running
        ? { code: 0, stdout: "Status: Running\nScheduled Task State: Enabled\n", stderr: "" }
        : { code: 1, stdout: "", stderr: "ERROR: The system cannot find the file specified." };
    },
    writeFile: async () => undefined,
    removeFile: async () => undefined,
    ensureDirectory: async () => undefined,
  };
}

const answer = (over: Partial<ServiceCommandResult> = {}): ServiceCommandResult => ({
  code: 0,
  stdout: "",
  stderr: "",
  timedOut: false,
  ...over,
});

describe("the supervisor commands that must outlive the daemon (A)", () => {
  it("runs `service uninstall` as a child, with the daemon's own home on the environment", async () => {
    // **The mutation this fails on:** calling the platform's `uninstallService` here. On systemd
    // `disable --now` SIGTERMs this process and waits for it to go inactive, so `removeFile` and the second
    // `daemon-reload` never ran and "turn off" left the unit on disk.
    const spawn = vi.fn(async () => answer({ stdout: "EnvoyDev no longer starts as a service." }));
    const status = await uninstallServiceOutOfProcess({
      paths,
      argv,
      spawnServiceCommand: spawn,
      io: statusIo(false),
    });

    expect(spawn).toHaveBeenCalledTimes(1);
    const [command, args, options] = spawn.mock.calls[0] as unknown as [
      string,
      string[],
      { env: NodeJS.ProcessEnv; cwd: string },
    ];
    expect(command).toBe(program.node);
    expect(args).toEqual([program.entry, "service", "uninstall"]);
    // The same home this daemon resolved: a child left to the process's default would act on another home's
    // unit file, which is the class of defect the handler options exist to prevent.
    expect(options.env.ENVOYMESH_HOME).toBe(paths.home);
    expect(options.cwd).toBe("/runtime/app");
    // Exit 0 is the state the command aimed at; the read that follows asks the supervisor which state that is.
    expect(status.state).toBe("not-installed");
  });

  it("runs `service restart` the same way, and reports the state the supervisor settles on", async () => {
    const spawn = vi.fn(async () => answer());
    const status = await restartServiceOutOfProcess({
      paths,
      argv,
      spawnServiceCommand: spawn,
      io: statusIo(true),
    });
    expect((spawn.mock.calls[0] as unknown as [string, string[]])[1]).toEqual([
      program.entry,
      "service",
      "restart",
    ]);
    expect(status.state).toBe("running");
  });

  it("turns a non-zero exit into a failure in the command's own words, not a guess", async () => {
    const status = await uninstallServiceOutOfProcess({
      paths,
      argv,
      spawnServiceCommand: async () => answer({ code: 1, stderr: "Failed to disable unit: Access denied" }),
      io: statusIo(false),
    });
    expect(status.state).toBe("failed");
    expect(status.detail).toContain("Access denied");
  });

  it("gives up on a wedged supervisor instead of holding the reply for ever", async () => {
    const status = await uninstallServiceOutOfProcess({
      paths,
      argv,
      commandTimeoutMs: 1_234,
      spawnServiceCommand: async () => answer({ code: null, timedOut: true }),
      io: statusIo(false),
    });
    expect(status.state).toBe("failed");
    expect(status.detail).toContain("1234 ms");
  });
});

describe("a restart asks before it kills (B)", () => {
  it("begins the graceful drain before the supervisor's command is spawned", async () => {
    // **The defect this pins:** `service restart` alone is a kill. systemd's stop is a SIGTERM, which cuts a
    // live agent's turn in half — the drain rule (`runs.stopAll`, up to ten seconds) exists so that a restart
    // asks first. The order is the whole assertion.
    const order: string[] = [];
    const spawn = vi.fn(async () => {
      order.push("spawn");
      return answer();
    });
    await restartServiceOutOfProcess({
      paths,
      argv,
      shutdown: () => order.push("shutdown"),
      spawnServiceCommand: spawn,
      io: statusIo(true),
    });
    expect(order).toEqual(["shutdown", "spawn"]);
  });
});

describe("the damaged-home exit code, which two packages share", () => {
  it("keeps the systemd unit's RestartPreventExitStatus in step with the daemon's own constant", () => {
    // `packages/platform` hardcodes the family's damaged-profile code in the unit text and the daemon owns it
    // (`boot.ts`'s `EXIT_DAMAGED_HOME`). Neither can import the other without inverting a dependency, so this
    // binds them by value: change either side and the supervisor would restart a profile no restart can fix.
    const definition = serviceDefinition({
      platform: "linux",
      node: "/runtime/node",
      entry: "/runtime/app/main.mjs",
      home: paths.home,
      logPath: "/runtime/logs/service.log",
    });
    expect(definition?.contents).toContain(`RestartPreventExitStatus=0 ${EXIT_DAMAGED_HOME}`);
  });
});
