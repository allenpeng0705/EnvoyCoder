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
    // launchd takes the arguments as separate array entries, so the pair is split by tags there.
    const flagThenValue = {
      macos: "--managed-by</string>\n    <string>service</string>",
      linux: "--managed-by service",
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
    expect(contents).toContain(`<string>${base.logPath}</string>`);
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
