<#
.SYNOPSIS
    Reactivates and permanently installs PHP Syntax Highlighting for Antigravity 2.0 on Windows.

.DESCRIPTION
    Antigravity desktop Electron updates replace app.asar with stock versions that omit PHP Prism syntax.
    This script restores PHP syntax highlighting by:
    1. Installing phpHighlighting.js to %APPDATA%\Antigravity\extensions
    2. Injecting and activating PHP syntax highlighting in currently running Antigravity sessions immediately via Chrome DevTools Protocol
    3. Safely backing up and patching app.asar to permanently inject the grammar across all future launches and new windows
    4. Providing a safe -Restore switch to roll back to the original stock app.asar anytime

.PARAMETER AntigravityPath
    Custom path to the Antigravity installation folder (defaults to auto-detection).

.PARAMETER Restore
    Restores the original app.asar backup and uninstalls the extension.

.PARAMETER Uninstall
    Alias for -Restore.

.PARAMETER Restart
    Restarts Antigravity if it is currently running to finalize the permanent patch immediately.
    If not specified and Antigravity is running, live injection activates highlighting immediately
    and a background watcher applies the permanent patch automatically upon exit.

.PARAMETER SkipLive
    Skips live session injection into running Antigravity windows.

.PARAMETER Force
    Suppresses interactive confirmation prompts.

.EXAMPLE
    .\enable-php-highlighting.ps1
    # Standard installation and live reactivation

.EXAMPLE
    .\enable-php-highlighting.ps1 -Restart
    # Installs and immediately restarts Antigravity to apply patch on disk

.EXAMPLE
    .\enable-php-highlighting.ps1 -Restore
    # Restores original backup and removes custom extensions

.EXAMPLE
    .\enable-php-highlighting.ps1 -Restore -Restart
    # Restores backup and restarts Antigravity immediately
#>

[CmdletBinding(DefaultParameterSetName = 'Install')]
param (
    [Parameter(ParameterSetName = 'Install')]
    [Parameter(ParameterSetName = 'Restore')]
    [string]$AntigravityPath,

    [Parameter(ParameterSetName = 'Restore')]
    [switch]$Restore,

    [Parameter(ParameterSetName = 'Restore')]
    [switch]$Uninstall,

    [Parameter(ParameterSetName = 'Install')]
    [Parameter(ParameterSetName = 'Restore')]
    [switch]$Restart,

    [Parameter(ParameterSetName = 'Install')]
    [switch]$SkipLive,

    [Parameter(ParameterSetName = 'Install')]
    [Parameter(ParameterSetName = 'Restore')]
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$ScriptDir = $PSScriptRoot

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "     Antigravity 2.0 - PHP Syntax Highlighting Bundle     " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# 1. Verify Prerequisites
# ---------------------------------------------------------------------------
try {
    $nodeVersion = & node -v 2>$null
    if (-not $nodeVersion) {
        Write-Error "Node.js is required but was not found in PATH. Please install Node.js (https://nodejs.org) to continue."
        exit 1
    }
    Write-Host "[+] Found Node.js: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Error "Failed to invoke Node.js. Please verify Node.js is installed."
    exit 1
}

# Auto-install npm dependencies if missing (e.g. after git clone)
$asarModulePath = Join-Path $ScriptDir "node_modules\@electron\asar"
if (-not (Test-Path $asarModulePath)) {
    Write-Host "[*] Installing required dependencies (@electron/asar)..." -ForegroundColor Cyan
    try {
        & npm --prefix "$ScriptDir" install --omit=dev --no-audit --no-fund
        if ($LASTEXITCODE -ne 0 -or (-not (Test-Path $asarModulePath))) {
            Write-Error "Failed to install dependencies. Please run 'npm install' manually in: $ScriptDir"
            exit 1
        }
        Write-Host "[+] Dependencies installed successfully." -ForegroundColor Green
    } catch {
        Write-Error "Failed to install npm dependencies: $($_.Exception.Message)"
        exit 1
    }
}

# ---------------------------------------------------------------------------
# 2. Detect Antigravity Installation
# ---------------------------------------------------------------------------
function Find-AntigravityDir {
    param ([string]$ExplicitPath)

    if ($ExplicitPath) {
        if (Test-Path (Join-Path $ExplicitPath "resources\app.asar")) {
            return (Resolve-Path $ExplicitPath).Path
        }
        if (Test-Path (Join-Path $ExplicitPath "app.asar")) {
            return (Resolve-Path (Join-Path $ExplicitPath "..")).Path
        }
        Write-Error "Specified AntigravityPath does not contain resources\app.asar: $ExplicitPath"
        exit 1
    }

    # Check running process
    $runningProc = Get-Process -Name "Antigravity" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($runningProc -and $runningProc.Path) {
        $procDir = Split-Path -Parent $runningProc.Path
        if (Test-Path (Join-Path $procDir "resources\app.asar")) {
            return $procDir
        }
    }

    # Check standard install locations
    $candidates = @(
        "$env:LOCALAPPDATA\Programs\antigravity",
        "C:\Program Files\Antigravity",
        "C:\Program Files (x86)\Antigravity"
    )

    if ($env:ANTIGRAVITY_PATH) {
        $candidates = @($env:ANTIGRAVITY_PATH) + $candidates
    }

    foreach ($dir in $candidates) {
        if ($dir -and (Test-Path (Join-Path $dir "resources\app.asar"))) {
            return (Resolve-Path $dir).Path
        }
    }

    # Check registry uninstall entries
    $regPaths = @(
        "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*"
    )
    foreach ($reg in $regPaths) {
        try {
            $items = Get-ItemProperty -Path $reg -ErrorAction SilentlyContinue
            foreach ($item in $items) {
                if ($item.DisplayName -like "*Antigravity*" -and $item.InstallLocation) {
                    if (Test-Path (Join-Path $item.InstallLocation "resources\app.asar")) {
                        return (Resolve-Path $item.InstallLocation).Path
                    }
                }
            }
        } catch {}
    }

    return $null
}

$InstallDir = Find-AntigravityDir -ExplicitPath $AntigravityPath
if (-not $InstallDir) {
    Write-Error "Could not locate Antigravity installation. Please pass the folder path using: -AntigravityPath 'C:\Path\To\Antigravity'"
    exit 1
}

$ResourcesDir = Join-Path $InstallDir "resources"
$AppAsar = Join-Path $ResourcesDir "app.asar"
$AppAsarBak = Join-Path $ResourcesDir "app.asar.bak"
$ExePath = Join-Path $InstallDir "Antigravity.exe"
$StagedPatchedAsar = "$AppAsar.patched"

Write-Host "[+] Detected Antigravity at: $InstallDir" -ForegroundColor Green
Write-Host "    Target ASAR: $AppAsar" -ForegroundColor Gray

# ---------------------------------------------------------------------------
# 3. Handle Restore / Uninstall
# ---------------------------------------------------------------------------
if ($Restore -or $Uninstall) {
    Write-Host "`n[*] Starting uninstallation / restore..." -ForegroundColor Yellow

    if (-not (Test-Path $AppAsarBak)) {
        Write-Error "No backup found at '$AppAsarBak'. Cannot automatically restore."
        exit 1
    }

    $runningProcesses = Get-Process -Name "Antigravity" -ErrorAction SilentlyContinue
    if ($runningProcesses -and $Restart) {
        Write-Host "[*] Stopping Antigravity processes to apply restore..." -ForegroundColor Yellow
        $runningProcesses | Stop-Process -Force
        Start-Sleep -Seconds 2
    }

    $restoreResult = & node "$ScriptDir\restore-asar.js" --asar "$AppAsar"
    Write-Host $restoreResult

    # Check if restore was blocked by lock
    if ($LASTEXITCODE -eq 2) {
        Write-Host "`n[!] app.asar is currently locked by running Antigravity instance." -ForegroundColor Yellow
        if ($Restart) {
            Write-Host "[*] Stopping remaining Antigravity processes..." -ForegroundColor Yellow
            Get-Process -Name "Antigravity" -ErrorAction SilentlyContinue | Stop-Process -Force
            Start-Sleep -Seconds 2
            Copy-Item -Path $AppAsarBak -Destination $AppAsar -Force
            if (Test-Path "$AppAsarBak.unpacked") {
                Copy-Item -Path "$AppAsarBak.unpacked" -Destination "$AppAsar.unpacked" -Recurse -Force
            }
            Write-Host "[+] Backup restored successfully." -ForegroundColor Green
        } else {
            Write-Host "[*] Staging automatic restore upon Antigravity exit..." -ForegroundColor Cyan
            $watchScript = "Wait-Process -Name Antigravity -ErrorAction SilentlyContinue; Start-Sleep -Seconds 1; Copy-Item -Path '$AppAsarBak' -Destination '$AppAsar' -Force; if (Test-Path '$AppAsarBak.unpacked') { Copy-Item -Path '$AppAsarBak.unpacked' -Destination '$AppAsar.unpacked' -Recurse -Force }"
            $encodedCmd = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($watchScript))
            Start-Process powershell.exe -WindowStyle Hidden -ArgumentList "-NoProfile", "-EncodedCommand", $encodedCmd
            Write-Host "[+] Restore will be automatically applied as soon as Antigravity closes." -ForegroundColor Green
            Write-Host "    (Or re-run with -Restart to restore and relaunch immediately)." -ForegroundColor Gray
        }
    } elseif ($LASTEXITCODE -eq 0) {
        Write-Host "[+] Uninstallation complete! Original app.asar restored." -ForegroundColor Green
    } else {
        Write-Error "Restore failed with exit code $LASTEXITCODE."
        exit 1
    }

    if ($Restart -and (Test-Path $ExePath)) {
        Write-Host "[*] Relaunching Antigravity..." -ForegroundColor Cyan
        Start-Process -FilePath $ExePath
        Write-Host "[+] Antigravity relaunched with clean stock version." -ForegroundColor Green
    }

    exit 0
}

# ---------------------------------------------------------------------------
# 4. Install User Extension Script
# ---------------------------------------------------------------------------
Write-Host "`n[*] Step 1: Installing user extension script..." -ForegroundColor Cyan
$UserExtDir = Join-Path $env:APPDATA "Antigravity\extensions"
if (-not (Test-Path $UserExtDir)) {
    New-Item -ItemType Directory -Path $UserExtDir -Force | Out-Null
}
$DestPhpScript = Join-Path $UserExtDir "phpHighlighting.js"
Copy-Item -Path (Join-Path $ScriptDir "phpHighlighting.js") -Destination $DestPhpScript -Force
Write-Host "[+] Grammar installed to: $DestPhpScript" -ForegroundColor Green

# ---------------------------------------------------------------------------
# 5. Live Session Injection (if Antigravity is running)
# ---------------------------------------------------------------------------
$runningAntigravity = Get-Process -Name "Antigravity" -ErrorAction SilentlyContinue
if ($runningAntigravity -and (-not $SkipLive)) {
    Write-Host "`n[*] Step 2: Activating in active Antigravity session..." -ForegroundColor Cyan
    try {
        & node "$ScriptDir\inject-live.js"
        if ($LASTEXITCODE -eq 0) {
            Write-Host "[+] PHP syntax highlighting is NOW ACTIVE in your running window!" -ForegroundColor Green
        } else {
            Write-Host "[!] Live injection completed with code $LASTEXITCODE (will be active on next window load)." -ForegroundColor Yellow
        }
    } catch {
        Write-Warning "Live injection encountered an issue: $($_.Exception.Message)"
    }
} else {
    Write-Host "`n[*] Step 2: Live session check - Antigravity is not currently running." -ForegroundColor Gray
}

# ---------------------------------------------------------------------------
# 6. Patch app.asar (Permanent across restarts)
# ---------------------------------------------------------------------------
Write-Host "`n[*] Step 3: Patching app.asar for permanent activation..." -ForegroundColor Cyan

# If user specified -Restart and Antigravity is running, stop it before patching to avoid in-memory staleness
if ($Restart -and $runningAntigravity) {
    Write-Host "[*] -Restart specified: gracefully stopping Antigravity before applying disk patch..." -ForegroundColor Yellow
    $runningAntigravity | Stop-Process -Force
    Start-Sleep -Seconds 2
}

$patchOutput = & node "$ScriptDir\patch-asar.js" --asar "$AppAsar"
Write-Host $patchOutput

if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to patch app.asar. Check error details above."
    exit 1
}

if (Test-Path $StagedPatchedAsar) {
    # File was locked because Antigravity is running
    Write-Host "`n[!] app.asar is currently locked by running Antigravity instance." -ForegroundColor Yellow
    if ($Restart) {
        Write-Host "[*] Stopping Antigravity processes..." -ForegroundColor Yellow
        Get-Process -Name "Antigravity" -ErrorAction SilentlyContinue | Stop-Process -Force
        Start-Sleep -Seconds 2

        # Move staged file over target
        Move-Item -Path $StagedPatchedAsar -Destination $AppAsar -Force
        if (Test-Path "$StagedPatchedAsar.unpacked") {
            Move-Item -Path "$StagedPatchedAsar.unpacked" -Destination "$AppAsar.unpacked" -Force
        }
        Write-Host "[+] Successfully swapped patched app.asar on disk." -ForegroundColor Green
    } else {
        Write-Host "[*] Background watcher initialized: file will auto-swap when Antigravity closes." -ForegroundColor Cyan
        $watchScript = "Wait-Process -Name Antigravity -ErrorAction SilentlyContinue; Start-Sleep -Seconds 1; if (Test-Path '$StagedPatchedAsar') { Move-Item -Path '$StagedPatchedAsar' -Destination '$AppAsar' -Force }; if (Test-Path '$StagedPatchedAsar.unpacked') { Move-Item -Path '$StagedPatchedAsar.unpacked' -Destination '$AppAsar.unpacked' -Force }"
        $encodedCmd = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($watchScript))
        Start-Process powershell.exe -WindowStyle Hidden -ArgumentList "-NoProfile", "-EncodedCommand", $encodedCmd
        Write-Host "[+] Background auto-updater scheduled." -ForegroundColor Green
        Write-Host "    PHP Highlighting is ACTIVE right now in your current session!" -ForegroundColor Green
        Write-Host "    (Permanent patch will finalize automatically when you next exit Antigravity)." -ForegroundColor Gray
    }
} else {
    Write-Host "[+] Permanent patch applied directly to app.asar!" -ForegroundColor Green
}

# If -Restart was passed and Antigravity is installed, relaunch it
if ($Restart -and (Test-Path $ExePath)) {
    Write-Host "[*] Relaunching Antigravity..." -ForegroundColor Cyan
    Start-Process -FilePath $ExePath
    Write-Host "[+] Antigravity relaunched with permanent PHP syntax highlighting!" -ForegroundColor Green
}

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host " [+] SUCCESS: PHP Syntax Highlighting Ready & Active!     " -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
exit 0
