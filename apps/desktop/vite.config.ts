import { readFileSync } from "node:fs";

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
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Tauri's WebViews are the floor here: WKWebView (macOS), WebView2 (Windows), WebKitGTK (Linux).
    target: "es2022",
    sourcemap: true,
  },
});
