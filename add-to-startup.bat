@echo off
setlocal
title Crex Scorer - Add to Windows Startup

echo ======================================================
echo  Adding Crex Scorer to Windows Startup
echo ======================================================

set "SCRIPT_PATH=%~dp0run-background.vbs"
set "STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "SHORTCUT_PATH=%STARTUP_FOLDER%\CrexScorer247.lnk"

:: Use PowerShell to create the shortcut pointing to run-background.vbs
powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT_PATH%'); $s.TargetPath = 'wscript.exe'; $s.Arguments = '\"%SCRIPT_PATH%\"'; $s.WorkingDirectory = '%~dp0'; $s.Description = 'Crex Scorer 24/7 Server'; $s.Save()"

if exist "%SHORTCUT_PATH%" (
    echo.
    echo [SUCCESS] Crex Scorer has been added to your Windows Startup!
    echo.
    echo The server will now automatically launch silently in the background
    echo every time your computer boots up or restarts.
    echo.
) else (
    echo.
    echo [ERROR] Could not create shortcut. Please try running as Administrator.
    echo.
)

pause
