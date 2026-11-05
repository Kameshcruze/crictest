# 24/7 Watchdog for Crex Live Scorer and Chrome Window
$workingDir = "C:\Users\Admin\Downloads\crex-live-cricket-scorer"
Set-Location $workingDir

function Start-Server {
    Start-Process -WindowStyle Hidden cmd -ArgumentList "/c cd /d `"$workingDir`" && npm start"
    Start-Sleep -Seconds 4
}

function Open-Chrome {
    Start-Process chrome -ArgumentList "http://localhost:3000"
}

# 1. Initial Start on Launch
Start-Server
Start-Sleep -Seconds 3
Open-Chrome

# 2. Continuous 60-second watchdog loop
while ($true) {
    Start-Sleep -Seconds 60

    # Check 1: Is the server actively responding?
    $serverAlive = $false
    try {
        $res = Invoke-WebRequest -Uri "http://localhost:3000" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
        if ($res.StatusCode -ge 200 -and $res.StatusCode -lt 500) {
            $serverAlive = $true
        }
    } catch {
        $serverAlive = $false
    }

    if (-not $serverAlive) {
        # Server is down, restart it
        Stop-Process -Name "node" -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
        Start-Server
    }

    # Check 2: Is the actual visible Chrome window for our app open?
    # This specifically checks for the visible window title, ignoring invisible background Chrome helpers
    $appWindow = Get-Process chrome -ErrorAction SilentlyContinue | Where-Object {
        $_.MainWindowTitle -like "*Crex*" -or $_.MainWindowTitle -like "*3000*" -or $_.MainWindowTitle -like "*localhost*"
    }

    if (-not $appWindow) {
        # The visible window was closed! Relaunch Chrome to localhost:3000 immediately!
        Open-Chrome
    }
}
