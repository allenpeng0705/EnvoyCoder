import { describe, expect, it } from "vitest";

import { autonomyLabelKind } from "../src/composer/autonomy-label.js";

describe("autonomyLabelKind", () => {
  it("prefers Full access when the selected mode is unattended", () => {
    expect(
      autonomyLabelKind({ requireApproval: true, modeUnattended: true }),
    ).toBe("full-access");
    expect(
      autonomyLabelKind({ requireApproval: false, modeUnattended: true }),
    ).toBe("full-access");
  });

  it("mirrors Settings Asking on/off when the mode is attended", () => {
    expect(
      autonomyLabelKind({ requireApproval: true, modeUnattended: false }),
    ).toBe("asking-on");
    expect(
      autonomyLabelKind({ requireApproval: false, modeUnattended: false }),
    ).toBe("asking-off");
  });
});
