@echo off
setlocal
title Crex Scorer - Remove from Windows Startup

set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT_PATH=%STARTUP_FOLDER%\CrexScorer247.lnk"

if exist "%SHORTCUT_PATH%" (
    del "%SHORTCUT_PATH%"
    echo [SUCCESS] Removed Crex Scorer from Windows Startup.
) else (
    echo [INFO] Crex Scorer was not in Windows Startup.
)

pause
