@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Crex Scorer 24/7 Watchdog Server

echo ======================================================
echo  Crex Scorer 24/7 Server Watchdog Started
echo  Directory: %CD%
echo  Port: 3000
echo ======================================================

:: Check if node_modules exists. If not, auto-install dependencies first!
if not exist "node_modules" (
    echo [%date% %time%] node_modules not found. Running npm install...
    echo [%date% %time%] node_modules not found. Running npm install... >> server.log
    call npm install >> server.log 2>&1
    if not exist "node_modules" (
        echo [ERROR] npm install failed. Please check your internet or Node.js installation. >> server.log
        echo [ERROR] npm install failed. Please check your internet or Node.js installation.
        pause
        exit /b 1
    )
    echo [%date% %time%] Dependencies installed successfully! >> server.log
)

:loop
echo [%date% %time%] Starting Crex Scorer server...
echo [%date% %time%] Starting Crex Scorer server... >> server.log

call npm start >> server.log 2>&1

echo [%date% %time%] Server process stopped or crashed (Exit Code: %errorlevel%). Auto-restarting in 3 seconds...
echo [%date% %time%] Server process stopped or crashed (Exit Code: %errorlevel%). Auto-restarting in 3 seconds... >> server.log
timeout /t 3 /nobreak >nul
goto loop
