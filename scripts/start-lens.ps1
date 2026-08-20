<#
    Starts everything, in the order it has to happen.

    The daily routine was four commands in two windows, and forgetting the
    `git pull` meant working with last week's app. This does the lot: brings
    Docker up, fetches the latest code, rebuilds, waits until the app really
    answers, opens it, then opens the tunnel and shows the address for the
    phone.

    Written to be read and edited by whoever is running it, and to explain
    itself when a step fails — on a clinic PC the useful thing is knowing
    which step went wrong, not a stack trace.
#>

# Deliberately NOT "Stop". Under Stop, Windows PowerShell turns anything a
# native command writes to stderr into a terminating error — and git, docker
# and cloudflared all write ordinary progress there. Every native command
# below is checked by its exit code instead, which is the thing that actually
# says whether it worked.
$ErrorActionPreference = "Continue"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

function Say([string]$text) { Write-Host "" ; Write-Host $text -ForegroundColor Cyan }
function Warn([string]$text) { Write-Host $text -ForegroundColor Yellow }
function Problem([string]$text) { Write-Host $text -ForegroundColor Red }

# Native commands don't raise exceptions, so every one of them is checked by
# its exit code rather than trusted.
function Ran-OK { return $LASTEXITCODE -eq 0 }

Write-Host "=====================================" -ForegroundColor Green
Write-Host "  Lens - IOL calculator assistant" -ForegroundColor Green
Write-Host "=====================================" -ForegroundColor Green
Write-Host "Folder: $repo"

# --- the port the app is published on ------------------------------------
# docker-compose reads HOST_PORT from .env; this has to agree with it, or
# the health check and the tunnel would point at the wrong place.
$port = 80
if (Test-Path ".env") {
    foreach ($line in Get-Content ".env") {
        if ($line -match '^\s*HOST_PORT\s*=\s*(\d+)') { $port = [int]$Matches[1] }
    }
}
$localUrl = if ($port -eq 80) { "http://localhost" } else { "http://localhost:$port" }

# --- Docker --------------------------------------------------------------
# The engine answering is the only thing that counts. The window being open
# doesn't mean the engine is up, and the engine can be up with no window.
function Docker-Up {
    docker info 2>&1 | Out-Null
    return (Ran-OK)
}

<#
    Docker Desktop is not always at one path: a per-machine install lands in
    Program Files, a per-user one under AppData, and the installer lets you
    choose. So this asks Windows where it is, in the order that gives the
    most reliable answer, rather than guessing a single location — which is
    exactly what an earlier version of this script did, on a machine where
    Docker was installed and working.
#>
function Find-DockerDesktop {
    foreach ($key in @(
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\Docker Desktop.exe",
        "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\Docker Desktop.exe"
    )) {
        try {
            $path = (Get-ItemProperty -Path $key -ErrorAction Stop).'(default)'
            if ($path -and (Test-Path $path)) { return $path }
        } catch { }
    }

    try {
        $dir = (Get-ItemProperty -Path "HKLM:\SOFTWARE\Docker Inc.\Docker\1.0" -ErrorAction Stop).AppPath
        if ($dir) {
            $exe = Join-Path $dir "Docker Desktop.exe"
            if (Test-Path $exe) { return $exe }
        }
    } catch { }

    foreach ($candidate in @(
        (Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "Docker\Docker\Docker Desktop.exe"),
        (Join-Path $env:LOCALAPPDATA "Docker\Docker Desktop.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\Docker\Docker\Docker Desktop.exe")
    )) {
        if ($candidate -and (Test-Path $candidate)) { return $candidate }
    }

    # The Start Menu shortcut is there whichever way it was installed.
    foreach ($menu in @($env:ProgramData, $env:AppData)) {
        if (-not $menu) { continue }
        $link = Join-Path $menu "Microsoft\Windows\Start Menu\Programs\Docker Desktop.lnk"
        if (Test-Path $link) { return $link }
    }

    return $null
}

Say "1/5  Checking Docker..."
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Problem "     Docker isn't installed on this machine (no 'docker' command)."
    Problem "     See docs/RUNNING.md, step 2."
    Read-Host "`nPress Enter to close"
    exit 1
}

if (-not (Docker-Up)) {
    $desktop = Find-DockerDesktop
    if ($desktop) {
        Warn "     Docker isn't running yet - starting Docker Desktop."
        Start-Process $desktop | Out-Null
    } else {
        # Not fatal. Docker is clearly installed (the command exists), this
        # script just can't find the launcher — so ask, and keep waiting.
        Warn "     Docker isn't running, and I couldn't find Docker Desktop to start it."
        Warn "     Please open Docker Desktop from the Start menu now - this will"
        Warn "     carry on by itself as soon as the engine answers."
    }

    # A cold start can take a couple of minutes, longer on a busy machine.
    $waited = 0
    while ($waited -lt 240) {
        Start-Sleep -Seconds 3
        $waited += 3
        if (Docker-Up) { break }
        if ($waited % 15 -eq 0) { Write-Host "     ...waiting for the Docker engine ($waited s)" }
    }

    if (-not (Docker-Up)) {
        Problem "     Docker still isn't answering after 4 minutes."
        Problem "     Open Docker Desktop and see what it says - if it reports"
        Problem "     'Virtualization support not detected', that is a BIOS setting,"
        Problem "     not this app. Then run this again."
        Read-Host "`nPress Enter to close"
        exit 1
    }
}
Write-Host "     Docker is running." -ForegroundColor Green

# --- latest code ---------------------------------------------------------
Say "2/5  Fetching the latest version..."
git pull --ff-only 2>&1 | ForEach-Object { Write-Host "     $_" }
if (-not (Ran-OK)) {
    # Not fatal: no network, or local edits. The app that is already built
    # still works, and saying so beats refusing to start.
    Warn "     Couldn't update (no internet, or local changes). Continuing with"
    Warn "     the version already on this machine."
}

# --- build and start -----------------------------------------------------
Say "3/5  Building and starting the app (a few seconds if nothing changed)..."
docker compose up -d --build 2>&1 | ForEach-Object { Write-Host "     $_" }
if (-not (Ran-OK)) {
    Problem "     The app didn't start. The lines above say why."
    Problem "     If a port is already in use, set HOST_PORT=8080 in the .env file."
    Read-Host "`nPress Enter to close"
    exit 1
}

# --- wait until it actually answers --------------------------------------
Say "4/5  Waiting for the app to answer on $localUrl ..."
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
    try {
        Invoke-WebRequest -Uri "http://127.0.0.1:$port/healthz" -UseBasicParsing `
            -TimeoutSec 3 -ErrorAction Stop | Out-Null
        $ready = $true
        break
    } catch {
        Start-Sleep -Seconds 2
    }
}
if (-not $ready) {
    Problem "     The app isn't answering. Run this to see why:"
    Problem "         docker compose logs --tail 50"
    Read-Host "`nPress Enter to close"
    exit 1
}
Write-Host "     The app is up." -ForegroundColor Green
Start-Process $localUrl | Out-Null

# --- the tunnel, for the phone -------------------------------------------
Say "5/5  Opening the address for your phone..."
$cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cloudflared) {
    Warn "     cloudflared isn't installed, so there's no address for the phone."
    Warn "     Install it once with:  winget install --id Cloudflare.cloudflared"
    Write-Host ""
    Write-Host "The app is running on this computer at $localUrl" -ForegroundColor Green
    Read-Host "Press Enter to close (the app keeps running)"
    exit 0
}

$log = Join-Path $env:TEMP "lens-tunnel.log"
if (Test-Path $log) { Remove-Item $log -Force }

$tunnel = Start-Process -FilePath $cloudflared.Source `
    -ArgumentList @("tunnel", "--url", "http://127.0.0.1:$port") `
    -RedirectStandardError $log -RedirectStandardOutput "$log.out" `
    -NoNewWindow -PassThru

try {
    # cloudflared prints the address a second or two after starting; it is
    # read back out of the log rather than asked of the user.
    $address = $null
    for ($i = 0; $i -lt 45; $i++) {
        Start-Sleep -Seconds 1
        foreach ($file in @($log, "$log.out")) {
            if (-not (Test-Path $file)) { continue }
            $match = Select-String -Path $file -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" `
                -AllMatches -ErrorAction SilentlyContinue |
                Select-Object -First 1
            if ($match) { $address = $match.Matches[0].Value }
        }
        if ($address) { break }
        if ($tunnel.HasExited) { break }
    }

    Write-Host ""
    Write-Host "=====================================================" -ForegroundColor Green
    Write-Host "  On this computer:  $localUrl" -ForegroundColor Green
    if ($address) {
        Write-Host "  On your phone:     $address" -ForegroundColor Green
        try { Set-Clipboard -Value $address } catch { }
        Write-Host "  (copied to the clipboard)"
    } else {
        Warn "  The phone address didn't appear. The log is at:"
        Warn "  $log"
    }
    Write-Host "=====================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "KEEP THIS WINDOW OPEN while you work." -ForegroundColor Yellow
    Write-Host "Closing it only stops the phone address - the app itself keeps"
    Write-Host "running, and this computer can still use $localUrl."
    Write-Host ""
    Write-Host "Press Ctrl+C to stop." -ForegroundColor DarkGray

    Wait-Process -Id $tunnel.Id
} finally {
    if (-not $tunnel.HasExited) {
        Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue
    }
}
