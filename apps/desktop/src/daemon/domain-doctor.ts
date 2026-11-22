/**
 * Lightweight readiness hints for Envoy Harness Mobile / Web tool loops.
 *
 * Does not install anything — only reports what is missing so the composer can
 * show an in-place notice next to the Tools chip.
 */

import { spawnSync } from "node:child_process";

export type DomainDoctorKind = "mobile" | "webdev";

export type DomainDoctorHint = {
  kind: DomainDoctorKind;
  /** i18n key under task.composer.domain.doctor.* */
  messageKey: "task.composer.domain.doctor.mobile" | "task.composer.domain.doctor.webdev";
};

function onPath(bin: string): boolean {
  const which = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(which, [bin], { encoding: "utf8" });
  return result.status === 0;
}

function playwrightAvailable(): boolean {
  // A missing Chromium browser is still "available" at the package level; the harness's own
  // error names the install step. `--no-install` avoids a surprise download during the probe.
  const result = spawnSync("npx", ["--no-install", "playwright", "--version"], {
    encoding: "utf8",
    timeout: 8_000,
  });
  return result.status === 0;
}

/** Return a hint when the chosen domain's host tools look absent; otherwise undefined. */
export function domainDoctorHint(domain: DomainDoctorKind | undefined): DomainDoctorHint | undefined {
  if (domain === "mobile") {
    const ok = onPath("xcrun") || onPath("adb") || onPath("flutter");
    if (ok) return undefined;
    return { kind: "mobile", messageKey: "task.composer.domain.doctor.mobile" };
  }
  if (domain === "webdev") {
    if (playwrightAvailable()) return undefined;
    return { kind: "webdev", messageKey: "task.composer.domain.doctor.webdev" };
  }
  return undefined;
}
