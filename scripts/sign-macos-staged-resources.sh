#!/usr/bin/env bash
# Sign Mach-O binaries embedded in Tauri resources/ before notarization.
#
# Tauri codesigns EnvoyDev.app but does not deep-sign natives under
# resources/{daemon,node-runtime,envoy-harness}/ (Node itself, .node addons, …).
# Apple notarization rejects the bundle until every nested Mach-O has a
# Developer ID signature with hardened runtime and a secure timestamp.
#
# Requires APPLE_SIGNING_IDENTITY (set by apply_apple_signing_env in build-dmg.sh).
# Usage: bash scripts/sign-macos-staged-resources.sh [resources-dir]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
RESOURCES="${1:-$ROOT/apps/desktop/src-tauri/resources}"

# shellcheck source=codesign-macos-lib.sh
source "${SCRIPT_DIR}/codesign-macos-lib.sh"

if [ -z "${APPLE_SIGNING_IDENTITY:-}" ]; then
  echo "sign-macos-staged-resources: APPLE_SIGNING_IDENTITY not set — skip"
  exit 0
fi

if [ ! -d "$RESOURCES" ]; then
  echo "sign-macos-staged-resources: no resources dir at $RESOURCES — skip"
  exit 0
fi

# Fail fast: root-owned natives → errSecInternalComponent (not a cert problem).
root_sample="$(find "$RESOURCES" -user root 2>/dev/null | head -1 || true)"
if [ -n "$root_sample" ]; then
  echo "error: cannot codesign root-owned staged resources (errSecInternalComponent)." >&2
  echo "  Example: $root_sample" >&2
  echo "  Fix: sudo chown -R \"\$(whoami):staff\" \"$RESOURCES\"" >&2
  exit 1
fi

codesign_macos_init
codesign_macos_unlock_keychain

candidate_paths() {
  find "$RESOURCES" -depth -type f \( \
    -name '*.node' -o -name '*.dylib' -o -name 'spawn-helper' \
    -o -name 'node' -o -path '*/bin/fd' -o -path '*/bin/rg' \
  \) 2>/dev/null
}

while IFS= read -r f; do
  [ -n "$f" ] || continue
  codesign_macos_is_macho "$f" || continue
  codesign_macos_sign_file "$f" || true
done < <(candidate_paths)

codesign_macos_print_summary "nested Mach-O file(s) under resources/" || exit 1
