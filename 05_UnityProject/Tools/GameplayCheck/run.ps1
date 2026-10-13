# Gameplay layer offline compile + behavior verification (one-click).
#
# NOTE: this file is intentionally ASCII-only.
# Windows PowerShell 5.1 reads BOM-less .ps1 files as ANSI, which corrupts
# non-ASCII text and can break parsing. Chinese documentation lives in README.md.
#
# Prereq: Unity installed (provides Roslyn + netstandard2.1 reference assemblies),
#         plus a dotnet runtime.
# Usage:  pwsh -File Tools/GameplayCheck/run.ps1
# Exit:   0 = all passed, 1 = compile error or assertion failure.

$ErrorActionPreference = 'Stop'

# --- Path resolution (this script lives in 05_UnityProject/Tools/GameplayCheck) ---
$here     = Split-Path -Parent $MyInvocation.MyCommand.Path
$projRoot = (Resolve-Path (Join-Path $here '..\..')).Path          # 05_UnityProject
$scripts  = Join-Path $projRoot 'Assets\_Project\Scripts'
$buildDir = Join-Path $here '_build'

# --- Toolchain discovery ---
$unityRoot = if ($env:UNITY_ROOT) { $env:UNITY_ROOT } else { 'E:\Unity\Editor' }
$csc       = Join-Path $unityRoot 'Data\DotNetSdkRoslyn\csc.dll'
$refDir    = Join-Path $unityRoot 'Data\NetStandard\ref\2.1.0'
$netstd    = Join-Path $refDir 'netstandard.dll'

$dotnet = (Get-Command dotnet -ErrorAction SilentlyContinue).Source
if (-not $dotnet) { $dotnet = 'C:\Program Files\dotnet\dotnet.exe' }

foreach ($p in @($csc, $netstd, $dotnet)) {
    if (-not (Test-Path $p)) {
        Write-Host "MISSING TOOLCHAIN COMPONENT: $p"
        Write-Host "Set UNITY_ROOT to your Unity editor root if it is not E:\Unity\Editor ."
        exit 1
    }
}

Write-Host "Unity Roslyn : $csc"
Write-Host "netstandard  : $netstd"
Write-Host "dotnet       : $dotnet"

# --- Collect sources: the four layers + the verification program ---
$layers  = @('Core', 'Simulation', 'World', 'Gameplay')
$sources = @()
foreach ($n in $layers) {
    $f = Get-ChildItem (Join-Path $scripts $n) -File -Filter '*.cs' | Sort-Object Name
    if ($f.Count -eq 0) { Write-Host "LAYER $n HAS NO .cs FILES"; exit 1 }
    Write-Host ("  {0,-11} {1,2} .cs" -f $n, $f.Count)
    $sources += $f.FullName
}
$sources += (Join-Path $here 'Program.cs')
Write-Host ("  total       {0} .cs" -f $sources.Count)

New-Item -ItemType Directory -Path $buildDir -Force | Out-Null

# --- Emit response file and compile to an executable ---
$lines  = @()
$lines += "/r:`"$netstd`""
$lines += $sources | ForEach-Object { "`"$_`"" }
$lines += '/target:exe'
$lines += '/langversion:9.0'
$lines += "/out:`"$buildDir\check.dll`""
$lines += '/nologo'
$lines += '/main:GameplayCheck'
$rsp = Join-Path $buildDir 'check.rsp'
[System.IO.File]::WriteAllLines($rsp, $lines, (New-Object System.Text.UTF8Encoding $false))

Write-Host ""
Write-Host "=== COMPILE ==="
& $dotnet $csc "@$rsp"
if ($LASTEXITCODE -ne 0) { Write-Host "COMPILE FAILED"; exit 1 }
Write-Host "COMPILE OK (0 error)"

# --- runtimeconfig so check.dll can be executed directly by dotnet ---
$cfg = @'
{
  "runtimeOptions": {
    "tfm": "net8.0",
    "framework": { "name": "Microsoft.NETCore.App", "version": "8.0.0" }
  }
}
'@
[System.IO.File]::WriteAllText((Join-Path $buildDir 'check.runtimeconfig.json'), $cfg, (New-Object System.Text.UTF8Encoding $false))

Write-Host ""
Write-Host "=== RUN BEHAVIOR CHECKS ==="
& $dotnet (Join-Path $buildDir 'check.dll')
$code = $LASTEXITCODE
Write-Host ""
if ($code -eq 0) { Write-Host "ALL ASSERTIONS PASSED" } else { Write-Host "SOME ASSERTIONS FAILED (see FAIL lines above)" }
exit $code
