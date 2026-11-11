@echo off
cd /d "%~dp0"
title Crex Scorer Server (Console Mode)

echo ======================================================
echo  Starting Crex Scorer in Console Mode...
echo ======================================================

if not exist "node_modules" (
    echo [INFO] Installing required dependencies (npm install)...
    call npm install
)

echo.
echo [INFO] Starting Node.js server on http://localhost:3000 ...
echo [INFO] Press Ctrl + C to stop the server anytime.
echo.

call npm start
pause
