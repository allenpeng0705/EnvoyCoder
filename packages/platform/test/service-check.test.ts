import { describe, expect, it } from "vitest";

import { checkServiceUnitBytes, serviceDefinition, serviceUnitLintProblems } from "../src/index.js";

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

describe("the bytes a supervisor will actually receive", () => {
  it("refuses a UTF-8 file that declares UTF-16", () => {
    // The shape the Windows task used to have: text that is valid UTF-8, with a declaration telling a conforming
    // parser to read it as UTF-16. Python's expat reports `encoding specified in XML declaration is incorrect` and
    // .NET reports that there is no Unicode byte order mark, so `schtasks /Create /XML` refuses it — while a decoded
    // string looks perfect. Only reading the bytes sees the disagreement.
    const verdict = checkServiceUnitBytes(utf8(`<?xml version="1.0" encoding="UTF-16"?>\n<Task/>\n`));
    expect(verdict.ok).toBe(false);
    expect(verdict.checked).toBe(true);
    expect(verdict.detail).toMatch(/utf-16/i);
  });

  it("accepts the Windows definition as it is written now", () => {
    // The regression this pins: the generator declared UTF-16 while the writer writes UTF-8, so before the fix this
    // assertion failed on the definition's own text with no crafted input at all.
    const definition = serviceDefinition({
      platform: "windows",
      node: "/n",
      entry: "/e",
      home: "/h",
      logPath: "/l",
    });
    expect(definition).toBeDefined();
    expect(checkServiceUnitBytes(utf8(definition?.contents ?? ""))).toEqual(
      expect.objectContaining({ ok: true, checked: true }),
    );
  });

  it("accepts a UTF-16 declaration when the bytes really are UTF-16", () => {
    // A byte order mark is what a declaration of UTF-16 requires; the check compares families, not spellings.
    const text = `<?xml version="1.0" encoding="utf-16"?>\n<Task/>\n`;
    const bytes = new Uint8Array([0xff, 0xfe, ...Buffer.from(text, "utf16le")]);
    expect(checkServiceUnitBytes(bytes)).toEqual(expect.objectContaining({ ok: true, checked: true }));
  });

  it("is honest when it can only partly check", () => {
    // A systemd unit has no declaration: the check verifies the writer's UTF-8 contract rather than claiming a
    // comparison it cannot make.
    expect(checkServiceUnitBytes(utf8("[Unit]\nDescription=x\n"))).toEqual(
      expect.objectContaining({ ok: true, checked: true }),
    );
    // Bytes that are not valid UTF-8 are refused even without a declaration.
    expect(checkServiceUnitBytes(new Uint8Array([0x5b, 0x55, 0x6e, 0x69, 0x74, 0x5d, 0xff])).ok).toBe(false);
    // An encoding the check does not know is reported as *not verified*, never as verified-OK.
    const unknown = checkServiceUnitBytes(utf8(`<?xml version="1.0" encoding="shift_jis"?>\n<Task/>\n`));
    expect(unknown.checked).toBe(false);
    expect(unknown.ok).toBe(true);
  });
});

describe("a native linter's answer", () => {
  it("fails on systemd-analyze's own error lines even when it exits 0", () => {
    // The defect this pins: `systemd-analyze verify` prints these and still exits 0 on versions this repository
    // supports, so a gate that reads only the exit code passes over exactly the unit it exists to reject.
    const broken = [
      "dev.envoy.envoydev.daemon.service:4: Unknown key name 'BogusKey' in section 'Service', ignoring.",
      "dev.envoy.envoydev.daemon.service:3: Failed to locate executable /opt/nope: No such file or directory",
    ].join("\n");
    expect(serviceUnitLintProblems("systemd", 0, broken).length).toBeGreaterThan(0);
    expect(
      serviceUnitLintProblems("systemd", 0, "dev.envoy.service: Command /opt/nope is not executable"),
    ).not.toHaveLength(0);
  });

  it("passes a clean unit, and a non-zero exit is enough for the other linters", () => {
    expect(serviceUnitLintProblems("systemd", 0, "")).toHaveLength(0);
    expect(serviceUnitLintProblems("launchd", 1, "Encountered unknown tag dict")).not.toHaveLength(0);
    expect(serviceUnitLintProblems("launchd", 0, "")).toHaveLength(0);
  });
});
