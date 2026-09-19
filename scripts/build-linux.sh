#!/usr/bin/env bash
# Build the Linux installer.
#
# The Tauri app and the daemon are one package. The app starts the daemon
# when the first window opens and stops it when the last window closes.
# Envoy Harness is cloned from its repo and built into the same package.
#
# Run this on Linux, from the EnvoyCoder checkout:
#   bash scripts/build-linux.sh
#
# Needs: git, Node.js >= 22, pnpm (or corepack), Rust, and the WebKit
# libraries Tauri links against. On Debian or Ubuntu that is:
#   sudo apt install libwebkit2gtk-4.1-dev build-essential libssl-dev \
#     libayatana-appindicator3-dev librsvg2-dev patchelf
#
# Output: dist/desktop/*.deb (the installer) and *.AppImage

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist/desktop"

if [ "$(uname -s)" != "Linux" ]; then
  echo "This script builds the Linux installer. Run it on Linux." >&2
  echo "Mac: scripts/build-dmg.sh    Windows: scripts/build-exe.ps1" >&2
  exit 1
fi

echo "[1/3] Staging the daemon, Node, and the latest Envoy Harness…"
node "$ROOT/scripts/stage-desktop-bundle.mjs"

echo "[2/3] Building the app and the installer…"
cd "$ROOT/apps/desktop"
if [ ! -x "$ROOT/node_modules/.bin/tauri" ]; then
  echo "The Tauri CLI is not installed. Run npm install in this checkout, then try again." >&2
  exit 1
fi
"$ROOT/node_modules/.bin/tauri" build --config src-tauri/tauri.conf.bundle.json --bundles deb,appimage

echo "[3/3] Copying the packages to dist/desktop…"
mkdir -p "$OUT"
shopt -s nullglob
copied=0
for artifact in \
  "$ROOT"/apps/desktop/src-tauri/target/*/release/bundle/deb/*.deb \
  "$ROOT"/apps/desktop/src-tauri/target/release/bundle/deb/*.deb \
  "$ROOT"/apps/desktop/src-tauri/target/*/release/bundle/appimage/*.AppImage \
  "$ROOT"/apps/desktop/src-tauri/target/release/bundle/appimage/*.AppImage; do
  cp -f "$artifact" "$OUT/"
  echo "  $(basename "$artifact")"
  copied=$((copied + 1))
done
if [ "$copied" -eq 0 ]; then
  echo "The build finished, but no .deb or AppImage was found under apps/desktop/src-tauri/target." >&2
  exit 1
fi
echo "Done. The installer is in $OUT"
