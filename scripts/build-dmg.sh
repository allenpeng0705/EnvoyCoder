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
# command line tools.
#
# Apple Developer ID + notarization (Gatekeeper-friendly direct download):
#   Copy scripts/sign-macos-release.env.example → scripts/sign-macos-release.env
#   (gitignored) and fill the four exports — same values as EnvoyMesh work.
#   Without that file (or with placeholders), this script builds an **unsigned**
#   DMG. With credentials:
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
apply_apple_signing_env() {
  local sign_env="$ROOT/scripts/sign-macos-release.env"
  if [ -f "$sign_env" ]; then
    set -a
    # shellcheck source=/dev/null
    source "$sign_env"
    set +a
  fi

  export APPLE_SIGNING_IDENTITY="${APPLE_SIGNING_IDENTITY:-Developer ID Application: …}"
  export APPLE_ID="${APPLE_ID:-…}"
  export APPLE_PASSWORD="${APPLE_PASSWORD:-…}"
  export APPLE_TEAM_ID="${APPLE_TEAM_ID:-…}"

  if [ "$APPLE_SIGNING_IDENTITY" = "Developer ID Application: …" ] || \
     [ "$APPLE_ID" = "…" ] || [ "$APPLE_PASSWORD" = "…" ] || [ "$APPLE_TEAM_ID" = "…" ]; then
    unset APPLE_SIGNING_IDENTITY APPLE_ID APPLE_PASSWORD APPLE_TEAM_ID
    echo "  Apple signing: skipped (unsigned DMG — fill scripts/sign-macos-release.env)"
    return 0
  fi

  echo "  Apple signing: Developer ID + notarization enabled"
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

apply_apple_signing_env

echo "[1/4] Staging the daemon, Node, and the pinned Envoy Harness…"
node "$ROOT/scripts/stage-desktop-bundle.mjs"

if [ -n "${APPLE_SIGNING_IDENTITY:-}" ]; then
  echo "[1.5/4] Signing nested Mach-O in staged resources…"
  bash "$ROOT/scripts/sign-macos-staged-resources.sh"
fi

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
if [ -n "${APPLE_SIGNING_IDENTITY:-}" ] && [ "${TAURI_DEFER_APP_SIGN:-1}" = "1" ]; then
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
  # App is already signed; force unsigned bundle config so Tauri does not re-codesign.
  # Keep APPLE_ID / PASSWORD / TEAM_ID so notarization still runs.
  unset APPLE_SIGNING_IDENTITY
  "$TAURI" bundle --config "$BUNDLE_CONF" --config "$UNSIGNED_CONF" --bundles dmg
  export APPLE_SIGNING_IDENTITY="$saved_identity"
else
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

if [ -n "${APPLE_SIGNING_IDENTITY:-}" ]; then
  echo "Done. Signed (and notarized when Apple accepted the ticket) DMG is in $OUT/$versioned"
else
  echo "Done. The DMG is in $OUT/$versioned (unsigned — add scripts/sign-macos-release.env to sign)"
fi
