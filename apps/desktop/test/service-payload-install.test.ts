import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { coderPaths } from "@envoydev/host-bridge";
import type { ServiceIo, ServiceStep } from "@envoydev/platform";

import { readCurrent, versionDir } from "../src/daemon/payload.js";
import { installDaemonService } from "../src/daemon/supervisor.js";

const homes: string[] = [];
afterEach(async () => {
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
});

/** A bench that never touches a real supervisor: the file writes go to a temporary user home. */
function fakeIo() {
  const calls: ServiceStep[] = [];
  const files = new Map<string, string>();
  return {
    calls,
    files,
    io: {
      run: async (step: ServiceStep) => {
        calls.push(step);
        // `launchctl print` on the freshly written label: a running job, which is what a successful install means.
        return step.args[0] === "print"
          ? { code: 0, stdout: "state = running\n\tpid = 777\n", stderr: "" }
          : { code: 0, stdout: "", stderr: "" };
      },
      writeFile: async (path: string, contents: string) => void files.set(path, contents),
      removeFile: async (path: string) => void files.delete(path),
      ensureDirectory: async () => undefined,
    } satisfies ServiceIo,
  };
}

describe("switching the service on for the first time", () => {
  it("installs a payload before the unit, because a unit naming a version that was never copied runs nothing", async () => {
    const home = await mkdtemp(join(tmpdir(), "envoydev-first-switch-"));
    homes.push(home);
    const paths = coderPaths(home);
    const userHome = join(home, "user");

    // What the app's shell spawns: an entry point inside a directory that carries its dependencies.
    const bundle = join(home, "checkout", "dist-daemon");
    await mkdir(bundle, { recursive: true });
    await writeFile(join(bundle, "main.mjs"), "// the daemon's entry point\n", "utf8");
    const node = join(home, "node-runtime");
    await writeFile(node, "// a stand-in for the runtime the unit will run\n", "utf8");
    // The staged agent binaries the app's shell passes with `--harness`: a service started by launchd is not
    // spawned by that shell, so a payload without them runs a daemon that can find no agent.
    const harness = join(home, "harness");
    await mkdir(harness, { recursive: true });
    await writeFile(join(harness, "envoy-harness"), "#!/bin/sh\n", "utf8");

    expect(await readCurrent(paths)).toBeUndefined();

    const { io, files, calls } = fakeIo();
    const status = await installDaemonService({
      paths,
      userHome,
      io,
      version: "9.9.9",
      argv: [node, join(bundle, "main.mjs"), "--harness", harness],
      node,
    });

    // The payload exists, under the version the unit names, with its entry inside the bundle.
    expect(await readCurrent(paths)).toBe("9.9.9");
    const installed = versionDir(paths, "9.9.9");
    expect(await readFile(join(installed, "app", "main.mjs"), "utf8")).toContain("the daemon's entry point");
    // The staged agent binaries came across too, wherever `installPayload` puts them.
    const copied = await Promise.all(
      ["harness/envoy-harness", "app/harness/envoy-harness"].map((rel) =>
        readFile(join(installed, rel), "utf8").then(
          () => rel,
          () => undefined,
        ),
      ),
    );
    expect(copied.filter(Boolean)).toHaveLength(1);

    // And only then the unit, which runs the path the payload was installed at.
    const plist = [...files.keys()].find((path) => path.endsWith(".plist"));
    expect(plist).toBeDefined();
    expect(files.get(plist ?? "")).toContain(join(installed, "app", "main.mjs"));
    expect(calls.map((step) => step.args[0])).toEqual(["bootout", "bootstrap", "enable", "print"]);
    expect(status).toMatchObject({ state: "running", pid: 777 });
  });
});
