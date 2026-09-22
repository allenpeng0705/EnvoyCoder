import { describe, expect, it } from "vitest";

import {
  DEFAULT_SERVICE_LABEL,
  serviceDefinition,
  type ServiceDefinitionInput,
} from "../src/index.js";

const base = {
  node: "/Users/anna/Library/Application Support/EnvoyDev/runtime/0.1.0/node",
  entry: "/Users/anna/Library/Application Support/EnvoyDev/runtime/0.1.0/app/main.mjs",
  home: "/Users/anna/EnvoyMesh",
  logPath: "/Users/anna/Library/Application Support/EnvoyDev/logs/daemon.log",
} as const;

function define(overrides: Partial<ServiceDefinitionInput> = {}) {
  const platform = overrides.platform ?? "macos";
  const definition = serviceDefinition({ ...base, ...overrides, platform });
  if (!definition) throw new Error(`no definition for ${platform}`);
  return definition;
}

describe("a service definition says how to run the daemon without the app", () => {
  it("always passes --managed-by service, which is what makes the window leave it running", () => {
    // The daemon's claim records this, and the shell only stops a pid it started itself. Drop the flag and the
    // window silently starts killing a service it no longer owns.
    // launchd takes the arguments as separate array entries, so the pair is split by tags there; systemd's
    // `ExecStart` quotes every argument, and the task's raw command line only quotes the ones with a space.
    const flagThenValue = {
      macos: "--managed-by</string>\n    <string>service</string>",
      linux: '"--managed-by" "service"',
      windows: "--managed-by service",
    } as const;
    for (const platform of ["macos", "linux", "windows"] as const) {
      expect(define({ platform }).contents).toContain(flagThenValue[platform]);
    }
  });

  it("names the same unit everywhere, so status and uninstall can find it", () => {
    expect(define({ platform: "macos" }).relativePath).toBe(
      `Library/LaunchAgents/${DEFAULT_SERVICE_LABEL}.plist`,
    );
    expect(define({ platform: "linux" }).relativePath).toBe(
      `.config/systemd/user/${DEFAULT_SERVICE_LABEL}.service`,
    );
    expect(define({ platform: "windows" }).label).toBe(DEFAULT_SERVICE_LABEL);
  });

  it("has no definition for a platform it does not understand, rather than inventing one", () => {
    expect(serviceDefinition({ ...base, platform: "other" })).toBeUndefined();
  });
});

describe("the macOS agent", () => {
  it("loads at login, restarts on failure, and stays down after a deliberate stop", () => {
    const { kind, contents } = define({ platform: "macos" });
    expect(kind).toBe("launchd");
    expect(contents).toContain("<key>RunAtLoad</key>\n  <true/>");
    expect(contents).toContain("<key>SuccessfulExit</key>\n    <false/>");
    expect(contents).toContain("<key>ThrottleInterval</key>\n  <integer>10</integer>");
    // launchd keeps no exit-code predicate, so SuccessfulExit=false is the whole policy: exit 0 means "I meant it".
  });

  it("runs the installed payload, not the app bundle, and logs where the daemon already writes", () => {
    const { contents } = define({ platform: "macos" });
    expect(contents).toContain(`<string>${base.node}</string>`);
    expect(contents).toContain(`<string>${base.entry}</string>`);
    // Same path for both streams truncates one with the other. They share the log directory only.
    expect(contents).toContain("<string>/Users/anna/Library/Application Support/EnvoyDev/logs/daemon.out.log</string>");
    expect(contents).toContain("<string>/Users/anna/Library/Application Support/EnvoyDev/logs/daemon.err.log</string>");
    expect(contents).not.toContain(`<string>${base.logPath}</string>`);
    expect(contents).toContain(`<key>ENVOYMESH_HOME</key>\n    <string>${base.home}</string>`);
  });

  it("escapes a home directory that would otherwise make the file invalid", () => {
    const { contents } = define({ platform: "macos", home: "/Users/a&b/<Devel>" });
    expect(contents).toContain("<string>/Users/a&amp;b/&lt;Devel&gt;</string>");
    expect(contents).not.toMatch(/&(?!amp;|lt;|gt;|quot;)/);
  });
});

describe("the systemd user unit", () => {
  it("restarts on failure but not on exit 0 or the damaged-profile code", () => {
    const { kind, contents } = define({ platform: "linux" });
    expect(kind).toBe("systemd");
    expect(contents).toContain("Restart=always");
    expect(contents).toContain("RestartSec=5");
    // 4 is this family's "home is damaged" code: a restart loop cannot fix it. 0 is a deliberate stop.
    expect(contents).toContain("RestartPreventExitStatus=0 4");
    expect(contents).toContain("WantedBy=default.target");
  });

  it("quotes a path with a space, because systemd splits ExecStart on whitespace", () => {
    const { contents } = define({
      platform: "linux",
      node: "/home/anna/Envoy Dev/runtime/node",
    });
    expect(contents).toContain('ExecStart="/home/anna/Envoy Dev/runtime/node"');
  });

  it("always quotes and escapes, so a home systemd would expand is passed through literally", () => {
    const home = String.raw`/home/a\b$c%d`;
    const { contents } = define({ platform: "linux", home });
    // ExecStart: a backslash is doubled (the C-escape table), `$` is doubled (a literal dollar is `$$`) and `%` is
    // doubled (`%%`) — and the value is quoted even though it has no space, because systemd parses and expands an
    // unquoted word too.
    expect(contents).toContain(String.raw`"--home" "/home/a\\b$$c%%d"`);
    // `Environment=` does not expand variables — the manual's own example keeps `$word` literal — but `%` is still a
    // specifier there, so it is doubled while `$` is left alone.
    expect(contents).toContain(String.raw`Environment=ENVOYMESH_HOME="/home/a\\b$c%%d"`);
  });
});

describe("the Windows task", () => {
  it("starts at logon, under the user's own credentials, and keeps running", () => {
    const { kind, contents } = define({ platform: "windows" });
    expect(kind).toBe("schtasks");
    expect(contents).toContain("<LogonTrigger>");
    expect(contents).toContain("<LogonType>InteractiveToken</LogonType>");
    expect(contents).toContain("<RestartOnFailure>");
    expect(contents).toContain("<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>");
  });

  it("does not refuse to start, or stop, on battery, because a laptop is the normal case", () => {
    const { contents } = define({ platform: "windows" });
    // Both default to true in the Task Scheduler: `DisallowStartIfOnBatteries` refuses to start the task on a laptop
    // on battery, and `StopIfGoingOnBatteries` kills it when the charger comes out.
    expect(contents).toContain("<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>");
    expect(contents).toContain("<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>");
  });

  it("declares the encoding it is actually written in", () => {
    // `realServiceIo.writeFile` writes UTF-8 with no BOM. A UTF-16 declaration over those bytes makes expat say
    // `encoding specified in XML declaration is incorrect` and .NET report no Unicode byte order mark, so
    // `schtasks /Create /XML` refuses the file — while every string-level assertion above still passes.
    expect(define({ platform: "windows" }).contents).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(define({ platform: "windows" }).contents).not.toContain("UTF-16");
  });

  it("puts the flag in the action's arguments, where the task actually runs them", () => {
    const { contents } = define({ platform: "windows" });
    expect(contents).toContain(`<Command>${base.node}</Command>`);
    // The quoting shows up as &quot; in the file: an XML parser hands the scheduler the command line it needs
    // for a path with a space, so the file text and the running command legitimately differ.
    expect(contents).toContain(
      `<Arguments>&quot;${base.entry}&quot; --home ${base.home} --managed-by service</Arguments>`,
    );
  });

  it("passes the home the window uses, and escapes it", () => {
    // Not inherited from the logon session: the task says which home, so a user who never exported
    // ENVOYMESH_HOME still gets the daemon the app talks to.
    const { contents } = define({ platform: "windows", home: String.raw`C:\Users\a&b` });
    expect(contents).toContain("--home ");
    expect(contents).toContain("C:\\Users\\a&amp;b");
    expect(contents).not.toMatch(/&(?!amp;|lt;|gt;|quot;)/);
  });

  it("quotes an argument containing a space, because the command line is raw", () => {
    const { contents } = define({ platform: "windows", entry: String.raw`C:\Envoy Dev\main.mjs` });
    expect(contents).toContain(String.raw`<Arguments>&quot;C:\Envoy Dev\main.mjs&quot;`);
  });
});
