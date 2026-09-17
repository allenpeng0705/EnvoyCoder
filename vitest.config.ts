import { readFileSync } from "node:fs";

import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

/** The same build constant the app inlines (`apps/desktop/vite.config.ts`), so a test sees the real
    number rather than the "this build carries no version" branch — which is itself asserted, once,
    by deleting the global in the test that covers it. */
const { version } = JSON.parse(
  readFileSync(new URL("apps/desktop/package.json", import.meta.url), "utf8"),
);

/**
 * Aliases point at **source**, not build output.
 *
 * The EnvoyMesh family learned this the hard way: when `vitest` resolves built `dist/`
 * while the run path resolves source, a suite can be green while the real process cannot
 * start. Source resolution in tests is the smaller lie.
 */
export default defineConfig({
  define: { __ENVOYDEV_VERSION__: JSON.stringify(version) },
  resolve: {
    alias: {
      "@envoydev/protocol": `${here}packages/protocol/src/index.ts`,
      "@envoydev/platform": `${here}packages/platform/src/index.ts`,
      "@envoydev/task-model": `${here}packages/task-model/src/index.ts`,
      "@envoydev/agent-catalog": `${here}packages/agent-catalog/src/index.ts`,
      "@envoydev/host-bridge": `${here}packages/host-bridge/src/index.ts`,
    },
  },
  test: {
    environment: "node",
    include: [
      "packages/*/test/**/*.test.ts",
      "apps/desktop/test/**/*.test.{ts,tsx}",
      "scripts/test/**/*.test.ts",
    ],
    testTimeout: 20_000,
  },
});
