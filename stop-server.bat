@echo off
setlocal
title Stop Crex Scorer Server

echo ======================================================
echo  Stopping Crex Scorer 24/7 Background Processes...
echo ======================================================

:: Kill node.exe processes
taskkill /F /IM node.exe 2>nul
if %errorlevel% equ 0 (
    echo [OK] Stopped Node.js server.
) else (
    echo [INFO] No Node.js process was running.
)

:: Kill wscript.exe background runner
taskkill /F /IM wscript.exe 2>nul
taskkill /F /IM cscript.exe 2>nul

:: Kill any lingering watchdog cmd prompts
taskkill /F /FI "WINDOWTITLE eq Crex Scorer*" /IM cmd.exe 2>nul

echo.
echo ======================================================
echo  Crex Scorer Server is completely stopped.
echo ======================================================
echo.
pause
