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
    alias: [
      // Before the package root. A prefix alias for the root would turn this subpath into
      // `index.ts/features` and the window tests would load the Node barrel.
      {
        find: "@envoydev/agent-catalog/features",
        replacement: `${here}packages/agent-catalog/src/features.ts`,
      },
      { find: "@envoydev/protocol", replacement: `${here}packages/protocol/src/index.ts` },
      { find: "@envoydev/platform", replacement: `${here}packages/platform/src/index.ts` },
      { find: "@envoydev/task-model", replacement: `${here}packages/task-model/src/index.ts` },
      { find: "@envoydev/agent-catalog", replacement: `${here}packages/agent-catalog/src/index.ts` },
      { find: "@envoydev/host-bridge", replacement: `${here}packages/host-bridge/src/index.ts` },
    ],
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
