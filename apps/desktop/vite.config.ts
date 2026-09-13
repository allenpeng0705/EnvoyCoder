import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The desktop UI is a plain Vite app, served from disk by the Tauri shell and by `vite dev` in a
 * browser during development. `strictPort` matters for the shell: the supervisor is told where the
 * dev server is, and a silently different port would leave the window blank.
 *
 * `clearScreen: false` keeps Rust compile output visible when Tauri drives the dev server.
 */
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
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
