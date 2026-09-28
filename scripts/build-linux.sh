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
# Output: release/envoydev-desktop-{version}-linux-{arch}.deb
#         release/envoydev-desktop-{version}-linux-{arch}.AppImage
# Override the folder with OUT_DIR=… (default: release).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/${OUT_DIR:-release}"
if [ -f "$ROOT/VERSION" ]; then
  VERSION="$(tr -d '[:space:]' < "$ROOT/VERSION")"
else
  VERSION="$(node -p "require('$ROOT/package.json').version" 2>/dev/null || echo 0.0.0)"
fi

desktop_arch() {
  case "$(uname -m)" in
    arm64|aarch64) echo "arm64" ;;
    x86_64|amd64) echo "x64" ;;
    *) echo "unknown" ;;
  esac
}

if [ "$(uname -s)" != "Linux" ]; then
  echo "This script builds the Linux installer. Run it on Linux." >&2
  echo "Mac: scripts/build-dmg.sh    Windows: scripts/build-exe.ps1" >&2
  exit 1
fi

echo "[1/3] Staging the daemon, Node, and the pinned Envoy Harness…"
node "$ROOT/scripts/stage-desktop-bundle.mjs"

echo "[2/3] Building the app and the installer…"
cd "$ROOT/apps/desktop"
if [ ! -x "$ROOT/node_modules/.bin/tauri" ]; then
  echo "The Tauri CLI is not installed. Run npm install in this checkout, then try again." >&2
  exit 1
fi
"$ROOT/node_modules/.bin/tauri" build --config src-tauri/tauri.conf.bundle.json --bundles deb,appimage

echo "[3/3] Publishing the packages to ${OUT#$ROOT/}/…"
mkdir -p "$OUT"
shopt -s nullglob
copied=0
arch="$(desktop_arch)"
for artifact in \
  "$ROOT"/apps/desktop/src-tauri/target/*/release/bundle/deb/*.deb \
  "$ROOT"/apps/desktop/src-tauri/target/release/bundle/deb/*.deb \
  "$ROOT"/apps/desktop/src-tauri/target/*/release/bundle/appimage/*.AppImage \
  "$ROOT"/apps/desktop/src-tauri/target/release/bundle/appimage/*.AppImage; do
  base="$(basename "$artifact")"
  case "$base" in
    *.deb) kind=deb ;;
    *.AppImage) kind=AppImage ;;
    *) kind="${base##*.}" ;;
  esac
  versioned="envoydev-desktop-${VERSION}-linux-${arch}.${kind}"
  cp -f "$artifact" "$OUT/$versioned"
  echo "  $versioned"
  copied=$((copied + 1))
done
if [ "$copied" -eq 0 ]; then
  echo "The build finished, but no .deb or AppImage was found under apps/desktop/src-tauri/target." >&2
  exit 1
fi
echo "Done. The installer is in $OUT"
