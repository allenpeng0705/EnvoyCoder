# Packaging scripts

How to cut desktop installers and where mobile build docs live. Run each desktop
script **on that OS** from the EnvoyCoder checkout root after `npm install`.

Desktop product version is the one-line root **`VERSION`** file
(`npm run version:desktop -- 0.2.0`). Installers land in **`release/`**
(override with `OUT_DIR`).

```bash
npm install   # required once per checkout (esbuild, Tauri CLI, workspace links)
# EnvoyMesh sibling — build only the packages EnvoyDev links (not apps/node or apps/social):
#   cd ../EnvoyMesh && npm install && npx tsc -b packages/protocol packages/identity packages/vault packages/network packages/api packages/node-core packages/harness packages/host-connect packages/reuse-host
# packaging runs EnvoyCoder's `tsc -b` itself before the daemon bundle; or do it by hand:
npx tsc -b
```

## Desktop installers

Each script stages the daemon, a Node sidecar, and Envoy Harness, then runs the
Tauri bundle for that platform.

| OS | Command | Output name pattern |
|---|---|---|
| macOS | `bash scripts/build-dmg.sh` | `envoydev-desktop-{ver}-macos-{arch}.dmg` |
| Windows | `.\scripts\build-exe.ps1` | `envoydev-desktop-{ver}-windows-{arch}-setup.exe` |
| Linux | `bash scripts/build-linux.sh` | under `release/` (AppImage / deb as Tauri emits) |

### Use a local envoy-harness checkout

By default the stager clones the commit in `scripts/envoy-harness.pin`. To build
from a sibling tree instead (no fetch/reset of that tree):

```bash
# macOS / Linux
ENVOY_HARNESS_DIR=../envoy-harness bash scripts/build-dmg.sh   # or build-linux.sh
```

```powershell
# Windows (PowerShell)
$env:ENVOY_HARNESS_DIR = "..\envoy-harness"
.\scripts\build-exe.ps1
```

Needs **pnpm** (or Node’s **corepack**) on `PATH`. On Windows, prefer
`corepack enable` then `corepack prepare pnpm@10.0.0 --activate` so the shim sits
next to `node.exe`. The stager resolves `pnpm` / `npm` / `corepack` beside
`node.exe` and runs them without the `shell: true` + `C:\Program Files` split
(`'C:\Program' is not recognized`).

Other env knobs (see `stage-desktop-bundle.mjs`): `ENVOY_HARNESS_COMMIT`,
`ENVOY_HARNESS_REPO_URL`, `ENVOYDEV_NODE_VERSION`, `FETCH_NODE_SIDECAR=1`.

### Prerequisites (desktop)

- Node.js ≥ 22, git, Rust toolchain
- pnpm or corepack (harness build)
- **macOS:** Xcode CLT; for a Gatekeeper-friendly DMG see signing below
- **Windows:** Visual Studio C++ build tools; run `build-exe.ps1` in PowerShell
- **Linux:** usual Tauri Linux deps for your distro

### macOS signing / notarization

1. Copy `sign-macos-release.env.example` → `sign-macos-release.env` (gitignored).
2. Fill the four Apple Developer ID exports (same values as EnvoyMesh are fine).
3. Run `bash scripts/build-dmg.sh`.

Without that file the DMG is **unsigned**. With it, staged Node/native addons and
`EnvoyDev.app` are signed (Node needs JIT entitlements in
`macos-node.entitlements` — keep that plist **free of XML comments**, or
`codesign` embeds nothing and the packaged daemon dies with “Daemon unreachable”).
Family operator notes: `../EnvoyMesh/docs/macos-mirror-signing.md`.

### Related checks

```bash
node scripts/check-installer-scripts.mjs   # parsers accept build-dmg / build-exe / build-linux
node scripts/check-bundle-resources.mjs    # staged resources shape (no network)
```

## Mobile app

Not built by these installer scripts. Flutter app:

- Dev / run: [`apps/mobile/README.md`](../apps/mobile/README.md)
- Store listing / icons: [`apps/mobile/store-release/README.md`](../apps/mobile/store-release/README.md)

```bash
cd apps/mobile
flutter pub get
flutter test
flutter run
```

Presence gate from the repo root: `npm run mobile:check`.
