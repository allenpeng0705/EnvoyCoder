#!/usr/bin/env bash
# Build the macOS DMG.
#
# The Tauri app and the daemon are one package. The app starts the daemon
# when the first window opens and stops it when the last window closes.
# Envoy Harness is cloned from its repo and built into the same package,
# so the installer does not depend on a copy the user already has.
#
# Run this on a Mac, from the EnvoyCoder checkout:
#   bash scripts/build-dmg.sh
#
# Needs: git, Node.js >= 22, pnpm (or corepack), Rust, and the Xcode
# command line tools. Produces an **unsigned** DMG by default.
# Apple signing / notarization are M6 work — this script does not read
# APPLE_SIGNING_IDENTITY or pass it into Tauri yet.
#
# Output: dist/desktop/*.dmg

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist/desktop"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This script builds a Mac DMG. Run it on a Mac." >&2
  echo "Windows: scripts/build-exe.ps1    Linux: scripts/build-linux.sh" >&2
  exit 1
fi

echo "[1/3] Staging the daemon, Node, and the latest Envoy Harness…"
node "$ROOT/scripts/stage-desktop-bundle.mjs"

echo "[2/3] Building the app and the DMG…"
cd "$ROOT/apps/desktop"
if [ ! -x "$ROOT/node_modules/.bin/tauri" ]; then
  echo "The Tauri CLI is not installed. Run npm install in this checkout, then try again." >&2
  exit 1
fi
"$ROOT/node_modules/.bin/tauri" build --config src-tauri/tauri.conf.bundle.json --bundles dmg,app

echo "[3/3] Copying the DMG to dist/desktop…"
mkdir -p "$OUT"
shopt -s nullglob
copied=0
for dmg in "$ROOT"/apps/desktop/src-tauri/target/*/release/bundle/dmg/*.dmg \
           "$ROOT"/apps/desktop/src-tauri/target/release/bundle/dmg/*.dmg; do
  cp -f "$dmg" "$OUT/"
  echo "  $(basename "$dmg")"
  copied=$((copied + 1))
done
if [ "$copied" -eq 0 ]; then
  echo "The build finished, but no DMG was found under apps/desktop/src-tauri/target." >&2
  exit 1
fi
echo "Done. The DMG is in $OUT"
