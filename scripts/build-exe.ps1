# Build the Windows installer (EXE).
#
# The Tauri app and the daemon are one package. The app starts the daemon
# when the first window opens and stops it when the last window closes.
# Envoy Harness is cloned from its repo (scripts/envoy-harness.pin) and built
# into the same package. If the clone fails, the stager falls back to
# ..\envoy-harness when that sibling checkout exists (or set ENVOY_HARNESS_DIR).
#
# Run this on Windows, from the EnvoyCoder checkout:
#   .\scripts\build-exe.ps1
#
# Needs: git, Node.js >= 22, pnpm (or corepack), Rust, and the Visual
# Studio C++ build tools. The EXE is an NSIS installer.
#
# Before staging, this script:
#   * fails fast on missing host tools (Node / git / Rust / MSVC) with install hints
#   * runs `npm install` when workspace links or the Tauri CLI look incomplete
#   * installs the matching `@tauri-apps/cli-win32-*-msvc` optional when npm skipped it
#
# Output: release\envoydev-desktop-{version}-windows-{arch}-setup.exe
# Override the folder with $env:OUT_DIR (default: release).

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$OutDirName = if ($env:OUT_DIR) { $env:OUT_DIR } else { "release" }
$Out = Join-Path $Root $OutDirName

$Version = "0.0.0"
$versionFile = Join-Path $Root "VERSION"
if (Test-Path $versionFile) {
  $Version = (Get-Content -Raw $versionFile).Trim()
} else {
  try {
    Push-Location $Root
    try {
      $Version = (node -p "require('./package.json').version" 2>$null)
    } finally {
      Pop-Location
    }
    if (-not $Version) { $Version = "0.0.0" }
  } catch {
    $Version = "0.0.0"
  }
}

function Get-DesktopArch {
  switch ($env:PROCESSOR_ARCHITECTURE) {
    "ARM64" { return "arm64" }
    "AMD64" { return "x64" }
    default { return "unknown" }
  }
}

function Get-TauriWinNativePkg {
  switch ($env:PROCESSOR_ARCHITECTURE) {
    "ARM64" { return "@tauri-apps/cli-win32-arm64-msvc" }
    "AMD64" { return "@tauri-apps/cli-win32-x64-msvc" }
    "x86" { return "@tauri-apps/cli-win32-ia32-msvc" }
    default { return "@tauri-apps/cli-win32-x64-msvc" }
  }
}

function Test-TauriWinNative {
  $pkg = Get-TauriWinNativePkg
  $leaf = $pkg.Substring("@tauri-apps/".Length)
  return Test-Path (Join-Path $Root "node_modules\@tauri-apps\$leaf")
}

function Get-CommandPath([string]$Name) {
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($null -eq $cmd) { return $null }
  return $cmd.Source
}

function Assert-HostTool([string]$Name, [string]$Hint) {
  if (Get-CommandPath $Name) { return }
  Write-Error @"
Missing required tool: $Name
$Hint
"@
  exit 1
}

function Ensure-CargoOnPath {
  if (Get-CommandPath "cargo") { return }
  $cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
  $cargoExe = Join-Path $cargoBin "cargo.exe"
  if (Test-Path $cargoExe) {
    $env:Path = "$cargoBin;$env:Path"
    Write-Host "  Added $cargoBin to PATH for this session."
  }
}

function Test-MsvcToolchain {
  # Prefer vswhere (ships with VS / Build Tools installer).
  $vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
  if (Test-Path $vswhere) {
    $installPath = & $vswhere -latest -products * `
      -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
      -property installationPath 2>$null
    if ($installPath -and (Test-Path $installPath)) { return $true }
    # ARM64 hosts may only have the ARM64 VC tools component.
    $installPath = & $vswhere -latest -products * `
      -requires Microsoft.VisualStudio.Component.VC.Tools.ARM64 `
      -property installationPath 2>$null
    if ($installPath -and (Test-Path $installPath)) { return $true }
  }
  # Fallback: link.exe already on PATH (Developer PowerShell / vcvars).
  if (Get-CommandPath "link.exe") { return $true }
  return $false
}

function Join-Root([string[]]$Parts) {
  # Windows PowerShell 5.1 Join-Path takes only two args; combine manually.
  $path = $Root
  foreach ($part in $Parts) {
    $path = Join-Path $path $part
  }
  return $path
}

function Get-WorkspaceInstallGaps {
  $gaps = [System.Collections.Generic.List[string]]::new()
  $esbuildOk =
    (Test-Path (Join-Root @("node_modules", "esbuild"))) -or
    (Test-Path (Join-Root @("apps", "desktop", "node_modules", "esbuild")))
  if (-not $esbuildOk) { [void]$gaps.Add("esbuild") }

  if (-not (Test-Path (Join-Root @("node_modules", "@tauri-apps", "cli", "package.json")))) {
    [void]$gaps.Add("@tauri-apps/cli")
  }
  if (-not (Test-Path (Join-Root @("node_modules", ".bin", "tauri.cmd")))) {
    [void]$gaps.Add("tauri.cmd")
  }
  if (-not (Test-TauriWinNative)) {
    [void]$gaps.Add((Get-TauriWinNativePkg))
  }

  $pkgJsonPath = Join-Root @("package.json")
  if (-not (Test-Path $pkgJsonPath)) {
    [void]$gaps.Add("root package.json")
    return @($gaps)
  }
  try {
    $workspaces = (Get-Content -Raw $pkgJsonPath | ConvertFrom-Json).workspaces
  } catch {
    [void]$gaps.Add("root package.json")
    return @($gaps)
  }
  foreach ($rel in @($workspaces)) {
    if ($null -eq $rel -or "$rel" -match '\*') { continue }
    $wsPkg = Join-Root @($rel, "package.json")
    if (-not (Test-Path $wsPkg)) {
      [void]$gaps.Add("$rel")
      continue
    }
    try {
      $name = (Get-Content -Raw $wsPkg | ConvertFrom-Json).name
    } catch {
      [void]$gaps.Add("$rel")
      continue
    }
    if (-not $name) {
      [void]$gaps.Add("$rel")
      continue
    }
    $parts = @("$name".Split("/"))
    $atRoot = Join-Root (@("node_modules") + $parts)
    $atWs = Join-Root (@($rel, "node_modules") + $parts)
    if (-not ((Test-Path $atRoot) -or (Test-Path $atWs))) {
      [void]$gaps.Add("$name")
    }
  }
  return @($gaps)
}

function Invoke-NpmInstall {
  param(
    [Parameter(Mandatory = $false)]
    [string[]]$ExtraArgs = @()
  )
  Push-Location $Root
  try {
    if ($ExtraArgs.Count -gt 0) {
      & npm @ExtraArgs
    } else {
      & npm install
    }
    return $LASTEXITCODE
  } finally {
    Pop-Location
  }
}

function Ensure-NpmWorkspace {
  $gaps = @(Get-WorkspaceInstallGaps)
  # Native optional alone: prefer the light repair (avoids a full reinstall).
  $onlyNative =
    ($gaps.Count -eq 1) -and
    ("$($gaps[0])" -like "@tauri-apps/cli-win32-*")
  if ($gaps.Count -eq 0) { return }

  if ($onlyNative) {
    $nativePkg = Get-TauriWinNativePkg
    $cliVersion = $null
    $cliPkgJson = Join-Path $Root "node_modules\@tauri-apps\cli\package.json"
    if (Test-Path $cliPkgJson) {
      try {
        $cliVersion = (Get-Content -Raw $cliPkgJson | ConvertFrom-Json).version
      } catch {
        $cliVersion = $null
      }
    }
    $spec = if ($cliVersion) { "$nativePkg@$cliVersion" } else { $nativePkg }
    Write-Host "  Repairing Tauri Windows native binding ($spec)…"
    $code = Invoke-NpmInstall -ExtraArgs @("install", $spec, "--no-save")
    if ($code -ne 0 -or -not (Test-TauriWinNative)) {
      Write-Error @"
Could not install $spec (npm exit $code).
npm often skips optional platform packages:
  https://github.com/npm/cli/issues/4828

From the EnvoyCoder root:
  Remove-Item -Recurse -Force node_modules
  npm install
Then re-run this script.
"@
      exit 1
    }
    return
  }

  Write-Host "  Workspace deps incomplete ($($gaps -join ', ')); running npm install…"
  $code = Invoke-NpmInstall
  if ($code -ne 0) {
    Write-Error "npm install failed (exit $code). Fix that, then re-run this script."
    exit 1
  }

  # Full install can still skip the Windows optional — repair it next.
  if (-not (Test-TauriWinNative)) {
    $nativePkg = Get-TauriWinNativePkg
    $cliVersion = $null
    $cliPkgJson = Join-Path $Root "node_modules\@tauri-apps\cli\package.json"
    if (Test-Path $cliPkgJson) {
      try {
        $cliVersion = (Get-Content -Raw $cliPkgJson | ConvertFrom-Json).version
      } catch {
        $cliVersion = $null
      }
    }
    $spec = if ($cliVersion) { "$nativePkg@$cliVersion" } else { $nativePkg }
    Write-Host "  npm install skipped $nativePkg; installing $spec…"
    $code = Invoke-NpmInstall -ExtraArgs @("install", $spec, "--no-save")
    if ($code -ne 0 -or -not (Test-TauriWinNative)) {
      Write-Error @"
Could not install $spec after npm install.
From the EnvoyCoder root:
  Remove-Item -Recurse -Force node_modules
  npm install
  npm install $spec --no-save
Then re-run this script.
"@
      exit 1
    }
  }

  $still = @(Get-WorkspaceInstallGaps | Where-Object { $_ -notlike "@tauri-apps/cli-win32-*" })
  # Native already verified above.
  $still = @($still | Where-Object { $_ })
  if ($still.Count -gt 0) {
    Write-Error @"
npm install finished, but still missing: $($still -join ', ').
From the EnvoyCoder root run ``npm install`` and try again.
"@
    exit 1
  }
}

function Assert-BuildHost {
  Write-Host "[0/3] Checking Windows build tools…"

  Assert-HostTool "node" @"
Install Node.js 22 or newer from https://nodejs.org/
Then open a new PowerShell and re-run this script.
"@
  $nodeMajor = 0
  try {
    $nodeMajor = [int]((node -p "process.versions.node.split('.')[0]" 2>$null))
  } catch {
    $nodeMajor = 0
  }
  if ($nodeMajor -lt 22) {
    Write-Error "Node.js >= 22 is required (found major $nodeMajor). Upgrade from https://nodejs.org/"
    exit 1
  }
  Write-Host "  node $(node -v)"

  Assert-HostTool "npm" @"
npm should ship with Node.js. Reinstall Node from https://nodejs.org/ or repair PATH.
"@
  Write-Host "  npm $(npm -v)"

  Assert-HostTool "git" @"
Install Git for Windows: https://git-scm.com/download/win
Then open a new PowerShell and re-run this script.
"@
  Write-Host "  git $((git --version) -replace '^git version ','')"

  Ensure-CargoOnPath
  Assert-HostTool "cargo" @"
Install the Rust toolchain (includes cargo):
  https://rustup.rs/
  Or: winget install Rustlang.Rustup
Then open a new PowerShell (so PATH picks up %USERPROFILE%\.cargo\bin) and re-run.
"@
  Assert-HostTool "rustc" @"
rustc is missing even though cargo was found. Re-run rustup-init, then:
  rustup default stable
"@
  Write-Host "  $((rustc --version))"
  Write-Host "  $((cargo --version))"

  if (-not (Test-MsvcToolchain)) {
    Write-Error @"
Visual Studio C++ build tools are missing (MSVC linker / VC tools).
Tauri needs them to compile the Windows app.

Install "Desktop development with C++" (or Build Tools with the MSVC + Windows SDK workloads):
  https://visualstudio.microsoft.com/visual-cpp-build-tools/
  Or: winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"

Then open a new PowerShell and re-run this script.
"@
    exit 1
  }
  Write-Host "  MSVC C++ tools: found"

  # pnpm is required by the harness stager; try corepack before failing later with a long PATH dump.
  if (-not (Get-CommandPath "pnpm")) {
    $corepack = Get-CommandPath "corepack"
    if ($corepack) {
      Write-Host "  pnpm not on PATH; enabling via corepack…"
      try {
        & corepack enable 2>$null | Out-Null
        & corepack prepare pnpm@10.0.0 --activate
      } catch {
        # Stager still tries beside node.exe; do not hard-fail here.
        Write-Host "  corepack prepare did not finish; the stager will look beside node.exe."
      }
    } else {
      Write-Host "  pnpm not on PATH (stager will try corepack beside node.exe)."
    }
  } else {
    Write-Host "  pnpm $((pnpm -v))"
  }

  Ensure-NpmWorkspace
  Write-Host "  npm workspace + Tauri CLI: ready"
}

if ($env:OS -ne "Windows_NT") {
  Write-Error "This script builds a Windows EXE. Run it on Windows.`nMac: scripts/build-dmg.sh    Linux: scripts/build-linux.sh"
  exit 1
}

Assert-BuildHost

Write-Host "[1/3] Staging the daemon, Node, and the pinned Envoy Harness..."
node (Join-Path $Root "scripts\stage-desktop-bundle.mjs")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "[2/3] Building the app and the EXE..."
$Tauri = Join-Path $Root "node_modules\.bin\tauri.cmd"
if (-not (Test-Path $Tauri)) {
  Write-Error "The Tauri CLI is not installed after repair. From the EnvoyCoder root run ``npm install``, then try again."
  exit 1
}
if (-not (Test-TauriWinNative)) {
  # Stager / parallel edits can still leave this gap; repair once more before cargo.
  Ensure-NpmWorkspace
}
Push-Location (Join-Path $Root "apps\desktop")
try {
  & $Tauri build --config src-tauri\tauri.conf.bundle.json --bundles nsis
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
  Pop-Location
}

# Avoid "$dir\..." - in PowerShell double quotes, a trailing backslash escapes the
# closing quote and the parser reports "missing terminator" at a later line.
Write-Host "[3/3] Publishing the EXE to $OutDirName/..."
New-Item -ItemType Directory -Force -Path $Out | Out-Null
$found = Get-ChildItem -Path (Join-Path $Root "apps\desktop\src-tauri\target") -Recurse -Filter "*-setup.exe" -ErrorAction SilentlyContinue
if (-not $found) {
  Write-Error "The build finished, but no setup EXE was found under apps\desktop\src-tauri\target."
  exit 1
}
$arch = Get-DesktopArch
$versioned = "envoydev-desktop-$Version-windows-$arch-setup.exe"
foreach ($file in $found) {
  Copy-Item -Force $file.FullName (Join-Path $Out $versioned)
  Write-Host "  $versioned"
}
Write-Host "Done. The EXE is in $(Join-Path $Out $versioned)"
