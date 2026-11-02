import { describe, expect, it } from "vitest";

import {
  activeAutonomyPreset,
  modeIdForPreset,
  modeLooksReadOnly,
} from "../src/composer/autonomy-presets.js";

describe("autonomy presets", () => {
  it("maps Settings + mode into Read only / Default / Full access", () => {
    expect(
      activeAutonomyPreset({
        requireApproval: true,
        modeUnattended: false,
        modeReadOnly: false,
      }),
    ).toBe("default");
    expect(
      activeAutonomyPreset({
        requireApproval: true,
        modeUnattended: false,
        modeReadOnly: true,
      }),
    ).toBe("read-only");
    expect(
      activeAutonomyPreset({
        requireApproval: false,
        modeUnattended: false,
        modeReadOnly: false,
      }),
    ).toBe("full-access");
    expect(
      activeAutonomyPreset({
        requireApproval: true,
        modeUnattended: true,
        modeReadOnly: false,
      }),
    ).toBe("full-access");
  });

  it("recognises plan / read-only style modes", () => {
    expect(modeLooksReadOnly("plan")).toBe(true);
    expect(modeLooksReadOnly("read_only")).toBe(true);
    expect(modeLooksReadOnly("agent")).toBe(false);
  });

  it("picks a mode id for each preset", () => {
    const modes = [
      { id: "plan" },
      { id: "default" },
      { id: "yolo", unattended: true },
    ];
    expect(modeIdForPreset("read-only", modes)).toBe("plan");
    expect(modeIdForPreset("default", modes)).toBe("default");
    expect(modeIdForPreset("full-access", modes)).toBe("yolo");
    expect(modeIdForPreset("full-access", [], "danger-full-access")).toBe(
      "danger-full-access",
    );
  });
});
