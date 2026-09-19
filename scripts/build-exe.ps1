# Build the Windows installer (EXE).
#
# The Tauri app and the daemon are one package. The app starts the daemon
# when the first window opens and stops it when the last window closes.
# Envoy Harness is cloned from its repo and built into the same package.
#
# Run this on Windows, from the EnvoyCoder checkout:
#   .\scripts\build-exe.ps1
#
# Needs: git, Node.js >= 22, pnpm (or corepack), Rust, and the Visual
# Studio C++ build tools. The EXE is an NSIS installer.
#
# Output: dist\desktop\*-setup.exe

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$Out = Join-Path $Root "dist\desktop"

if ($env:OS -ne "Windows_NT") {
  Write-Error "This script builds a Windows EXE. Run it on Windows.`nMac: scripts/build-dmg.sh    Linux: scripts/build-linux.sh"
  exit 1
}

Write-Host "[1/3] Staging the daemon, Node, and the latest Envoy Harness…"
node (Join-Path $Root "scripts\stage-desktop-bundle.mjs")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "[2/3] Building the app and the EXE…"
$Tauri = Join-Path $Root "node_modules\.bin\tauri.cmd"
if (-not (Test-Path $Tauri)) {
  Write-Error "The Tauri CLI is not installed. Run npm install in this checkout, then try again."
  exit 1
}
Push-Location (Join-Path $Root "apps\desktop")
try {
  & $Tauri build --config src-tauri/tauri.conf.bundle.json --bundles nsis
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}

Write-Host "[3/3] Copying the EXE to dist\desktop…"
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$found = Get-ChildItem -Path (Join-Path $Root "apps\desktop\src-tauri\target") -Recurse -Filter "*-setup.exe" -ErrorAction SilentlyContinue
if (-not $found) {
  Write-Error "The build finished, but no setup EXE was found under apps\desktop\src-tauri\target."
  exit 1
}
foreach ($file in $found) {
  Copy-Item -Force $file.FullName (Join-Path $Out $file.Name)
  Write-Host "  $($file.Name)"
}
Write-Host "Done. The EXE is in $Out"
