#!/usr/bin/env bash
# Build the macOS DMG.
#
# The Tauri app and the daemon are one package. The app starts the daemon
# when the first window opens and stops it when the last window closes.
# Envoy Harness is cloned from its repo (scripts/envoy-harness.pin) and built
# into the same package. If the clone fails, the stager falls back to
# ../envoy-harness when that sibling checkout exists (or set ENVOY_HARNESS_DIR).
#
# Run this on a Mac, from the EnvoyCoder checkout:
#   bash scripts/build-dmg.sh
#
# Needs: git, Node.js >= 22, pnpm (or corepack), Rust, and the Xcode
# command line tools.
#
# Apple Developer ID + notarization is **required** (Gatekeeper-friendly download):
#   Copy scripts/sign-macos-release.env.example → scripts/sign-macos-release.env
#   (gitignored) and fill the four exports — same values as EnvoyMesh work.
#   Missing or placeholder credentials abort the build; this script never ships
#   an unsigned DMG. With credentials:
#     1. deep-sign staged resources (Node + native addons)
#     2. build an unsigned .app, then sign it (TAURI_DEFER_APP_SIGN=1, default)
#        so Apple timestamp outages do not abort the whole Tauri build
#     3. package the DMG; Tauri notarizes when APPLE_ID is set
#   Set TAURI_DEFER_APP_SIGN=0 to let Tauri codesign the .app inline instead.
#   Family guide: ../EnvoyMesh/docs/macos-mirror-signing.md
#
# Output: release/envoydev-desktop-{version}-macos-{arch}.dmg
# Override the folder with OUT_DIR=… (default: release).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/${OUT_DIR:-release}"
TAURI_TARGET="$ROOT/apps/desktop/src-tauri/target"
UNSIGNED_CONF="src-tauri/tauri.conf.unsigned-build.json"
BUNDLE_CONF="src-tauri/tauri.conf.bundle.json"
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

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This script builds a Mac DMG. Run it on a Mac." >&2
  echo "Windows: scripts/build-exe.ps1    Linux: scripts/build-linux.sh" >&2
  exit 1
fi

# Developer ID + notarization for a Gatekeeper-friendly DMG (not Mac App Store).
# Signing is mandatory — refuse to produce an unsigned package.
require_apple_signing_env() {
  local sign_env="$ROOT/scripts/sign-macos-release.env"
  if [ ! -f "$sign_env" ]; then
    echo "error: missing $sign_env" >&2
    echo "  Copy scripts/sign-macos-release.env.example → scripts/sign-macos-release.env" >&2
    echo "  and fill APPLE_SIGNING_IDENTITY, APPLE_ID, APPLE_PASSWORD, APPLE_TEAM_ID." >&2
    echo "  Release DMGs are always signed; unsigned builds are not supported." >&2
    exit 1
  fi

  set -a
  # shellcheck source=/dev/null
  source "$sign_env"
  set +a

  export APPLE_SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:-}"
  export APPLE_ID="${APPLE_ID:-}"
  export APPLE_PASSWORD="${APPLE_PASSWORD:-}"
  export APPLE_TEAM_ID="${APPLE_TEAM_ID:-}"

  if [ -z "$APPLE_SIGNING_IDENTITY" ] || [ "$APPLE_SIGNING_IDENTITY" = "Developer ID Application: …" ] || \
     [[ "$APPLE_SIGNING_IDENTITY" == *"Your Name"* ]] || \
     [ -z "$APPLE_ID" ] || [ "$APPLE_ID" = "…" ] || [[ "$APPLE_ID" == *"example.com"* ]] || \
     [ -z "$APPLE_PASSWORD" ] || [ "$APPLE_PASSWORD" = "…" ] || [[ "$APPLE_PASSWORD" == *"xxxx"* ]] || \
     [ -z "$APPLE_TEAM_ID" ] || [ "$APPLE_TEAM_ID" = "…" ] || [[ "$APPLE_TEAM_ID" == *"XXXXXXXXXX"* ]]; then
    echo "error: $sign_env still has placeholders or empty Apple credentials." >&2
    echo "  Fill all four exports before building a release DMG." >&2
    echo "  Release DMGs are always signed; unsigned builds are not supported." >&2
    exit 1
  fi

  echo "  Apple signing: Developer ID + notarization required (enabled)"
}

# Newest EnvoyDev.app under the Cargo target tree (triple or host release).
newest_envoydev_app() {
  local best="" best_m=0 d probe m
  while IFS= read -r d; do
    [ -d "$d" ] || continue
    probe="$d"
    [ -f "$d/Contents/Info.plist" ] && probe="$d/Contents/Info.plist"
    m="$(stat -f '%m' "$probe" 2>/dev/null || echo 0)"
    if [ "$m" -gt "$best_m" ]; then
      best_m="$m"
      best="$d"
    fi
  done < <(find "$TAURI_TARGET" -path '*/release/bundle/macos/EnvoyDev.app' -type d 2>/dev/null)
  [ -n "$best" ] && echo "$best"
}

# create-dmg leaves `rw.<pid>.….dmg` mounted under /Volumes/dmg.* when a prior
# bundle dies mid-flight. The next `bundle_dmg.sh` then fails with a bare
# "failed to run bundle_dmg.sh" and no useful stderr.
cleanup_stale_bundle_dmg_mounts() {
  local vol img
  echo "  Clearing stale create-dmg mounts (if any)…"
  # Temp volumes from create-dmg (random /Volumes/dmg.XXXX).
  for vol in /Volumes/dmg.*; do
    [ -e "$vol" ] || continue
    hdiutil detach "$vol" -force >/dev/null 2>&1 || true
  done
  # RW scratch images under the Tauri bundle tree.
  while IFS= read -r img; do
    [ -n "$img" ] || continue
    hdiutil detach "$img" -force >/dev/null 2>&1 || true
    rm -f "$img"
  done < <(find "$TAURI_TARGET" -path '*/release/bundle/macos/rw.*.dmg' -type f 2>/dev/null)
}

require_apple_signing_env

echo "[1/4] Staging the daemon, Node, and the pinned Envoy Harness…"
node "$ROOT/scripts/stage-desktop-bundle.mjs"

echo "[1.5/4] Signing nested Mach-O in staged resources…"
bash "$ROOT/scripts/sign-macos-staged-resources.sh"

echo "[2/4] Building the app and the DMG…"
cd "$ROOT/apps/desktop"
if [ ! -x "$ROOT/node_modules/.bin/tauri" ]; then
  echo "The Tauri CLI is not installed. Run npm install in this checkout, then try again." >&2
  exit 1
fi
TAURI="$ROOT/node_modules/.bin/tauri"

# When Apple timestamp.apple.com flakes, Tauri's inline codesign fails the whole
# bundle. Build an unsigned .app, deep-sign with retry/fallback, then package DMG.
defer_sign=0
saved_identity=""
if [ "${TAURI_DEFER_APP_SIGN:-1}" = "1" ]; then
  defer_sign=1
  saved_identity="$APPLE_SIGNING_IDENTITY"
  unset APPLE_SIGNING_IDENTITY
  echo "  Tauri: deferring app codesign (sign-macos-app-bundle.sh handles timestamp fallback)"
  if [ ! -f "$ROOT/apps/desktop/$UNSIGNED_CONF" ]; then
    echo "error: missing $UNSIGNED_CONF (required for TAURI_DEFER_APP_SIGN)" >&2
    exit 1
  fi
fi

if [ "$defer_sign" = "1" ]; then
  "$TAURI" build --config "$BUNDLE_CONF" --config "$UNSIGNED_CONF" --bundles app
  export APPLE_SIGNING_IDENTITY="$saved_identity"
  app="$(newest_envoydev_app || true)"
  if [ -z "$app" ]; then
    echo "error: deferred codesign enabled but EnvoyDev.app not found under target/" >&2
    exit 1
  fi
  echo ""
  echo "[3/4] Signing EnvoyDev.app (deferred from Tauri)…"
  bash "$ROOT/scripts/sign-macos-app-bundle.sh" "$app"
  echo ""
  echo "Packaging DMG from signed .app…"
  cleanup_stale_bundle_dmg_mounts
  # App is already signed; force unsigned bundle config so Tauri does not re-codesign.
  # Keep APPLE_ID / PASSWORD / TEAM_ID so notarization still runs.
  unset APPLE_SIGNING_IDENTITY
  "$TAURI" bundle --config "$BUNDLE_CONF" --config "$UNSIGNED_CONF" --bundles dmg
  export APPLE_SIGNING_IDENTITY="$saved_identity"
else
  cleanup_stale_bundle_dmg_mounts
  "$TAURI" build --config "$BUNDLE_CONF" --bundles dmg,app
fi

echo "[4/4] Publishing the DMG to ${OUT#$ROOT/}/…"
mkdir -p "$OUT"
shopt -s nullglob
copied=0
arch="$(desktop_arch)"
versioned="envoydev-desktop-${VERSION}-macos-${arch}.dmg"
for dmg in "$TAURI_TARGET"/*/release/bundle/dmg/*.dmg \
           "$TAURI_TARGET"/release/bundle/dmg/*.dmg; do
  cp -f "$dmg" "$OUT/$versioned"
  echo "  $versioned"
  copied=$((copied + 1))
done
if [ "$copied" -eq 0 ]; then
  echo "The build finished, but no DMG was found under apps/desktop/src-tauri/target." >&2
  exit 1
fi

echo "Done. Signed (and notarized when Apple accepted the ticket) DMG is in $OUT/$versioned"
