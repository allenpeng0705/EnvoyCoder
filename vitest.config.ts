import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

/**
 * Aliases point at **source**, not build output.
 *
 * The EnvoyMesh family learned this the hard way: when `vitest` resolves built `dist/`
 * while the run path resolves source, a suite can be green while the real process cannot
 * start. Source resolution in tests is the smaller lie.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@envoycoder/protocol": `${here}packages/protocol/src/index.ts`,
      "@envoycoder/platform": `${here}packages/platform/src/index.ts`,
      "@envoycoder/workspace-model": `${here}packages/workspace-model/src/index.ts`,
      "@envoycoder/agent-catalog": `${here}packages/agent-catalog/src/index.ts`,
      "@envoycoder/host-bridge": `${here}packages/host-bridge/src/index.ts`,
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
