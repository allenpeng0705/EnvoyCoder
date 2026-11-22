import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveEnvoyHarnessRuntime } from "../src/daemon/harness-runtime.js";

describe("resolveEnvoyHarnessRuntime", () => {
  it("reads the pin and package version from this checkout", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const info = resolveEnvoyHarnessRuntime(root);
    expect(info).toBeDefined();
    const pin = readFileSync(path.join(root, "scripts", "envoy-harness.pin"), "utf8").trim();
    expect(info!.commit).toBe(pin);
    expect(info!.shortCommit).toBe(pin.slice(0, 7));
    expect(info!.version.length).toBeGreaterThan(0);
  });
});
