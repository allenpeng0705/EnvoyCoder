import { describe, expect, it } from "vitest";

import { domainDoctorHint } from "../src/daemon/domain-doctor.js";

describe("domainDoctorHint", () => {
  it("returns nothing when domain is unset", () => {
    expect(domainDoctorHint(undefined)).toBeUndefined();
  });

  it("names a message key when probing mobile or webdev", () => {
    // Presence of tools depends on the machine; we only assert the shape when a hint appears.
    const mobile = domainDoctorHint("mobile");
    if (mobile !== undefined) {
      expect(mobile.messageKey).toBe("task.composer.domain.doctor.mobile");
    }
    const web = domainDoctorHint("webdev");
    if (web !== undefined) {
      expect(web.messageKey).toBe("task.composer.domain.doctor.webdev");
    }
  });
});
