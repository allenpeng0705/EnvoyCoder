import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * **The window's own version, inlined at build time.**
 *
 * The daemon can report its version over `coder.hello`; the renderer cannot, because it is a bundle
 * served from disk with no process to read a `package.json` from — so the number is baked in here and
 * `src/app-version.ts` is the one module that reads it. Same file the daemon's own version comes from
 * (`apps/desktop/package.json`), which is what makes "these two should agree" a sentence About can
 * print: both halves are built together, and a mismatch means one of them is a build behind.
 */
const { version } = JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8"));

const desktopRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(desktopRoot, "../..");
/** Sibling EnvoyMesh — pairing-token only (never the reuse-host / harness barrel). */
const meshPairingToken = path.resolve(
  repoRoot,
  "../EnvoyMesh/packages/api/dist/pairing-token.js",
);

/**
 * The desktop UI is a plain Vite app, served from disk by the Tauri shell and by `vite dev` in a
 * browser during development. `strictPort` matters for the shell: the supervisor is told where the
 * dev server is, and a silently different port would leave the window blank.
 *
 * `clearScreen: false` keeps Rust compile output visible when Tauri drives the dev server.
 */
export default defineConfig({
  plugins: [react()],
  define: { __ENVOYDEV_VERSION__: JSON.stringify(version) },
  clearScreen: false,
  resolve: {
    alias: {
      /**
       * Compressed `pairing=` decode without importing `@envoydev/host-bridge` / `@envoymesh/reuse-host`,
       * which pull native `.node` addons into Vite and blank the window.
       */
      "@envoydev/window-pairing-token": meshPairingToken,
    },
  },
  server: {
    /**
     * **6173, not 5173.** 5173 is Vite's default and therefore already spoken for on a machine that
     * runs the rest of the family — EnvoyMesh's Social app uses it — so two products in the group
     * collided on one port and the second one refused to start ("Port 5173 is already in use"), which
     * reads as *this* app being broken. Our ports are our own: `6173` for the UI, `4770` for the daemon.
     *
     * `strictPort` stays on, and that is the important half of the fix: if 6173 is ever taken we want a
     * loud failure, not Vite quietly moving to 6174 while the shell keeps looking at 6173 and renders a
     * blank window.
     */
    port: 6173,
    strictPort: true,
    host: "127.0.0.1",
    fs: {
      // pairing-token lives in the sibling EnvoyMesh checkout.
      allow: [repoRoot, path.dirname(meshPairingToken)],
    },
    watch: {
      // Cargo writes locked `.exe` build scripts under `src-tauri/target` while `tauri dev` compiles.
      // On Windows, Vite's FSWatcher on those paths throws EBUSY and kills `beforeDevCommand` (vite).
      ignored: [
        "**/src-tauri/target/**",
        path.resolve(desktopRoot, "src-tauri/target"),
      ],
    },
  },
  optimizeDeps: {
    // Never prebundle the daemon/mesh barrels into the window.
    exclude: ["@envoydev/host-bridge", "@envoymesh/reuse-host", "@envoymesh/harness"],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Tauri's WebViews are the floor here: WKWebView (macOS), WebView2 (Windows), WebKitGTK (Linux).
    target: "es2022",
    sourcemap: true,
  },
});
