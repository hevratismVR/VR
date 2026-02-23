@echo off
chcp 65001 >nul
title PICO 4 VR Manager

echo.
echo ══════════════════════════════════════════════
echo        PICO 4 VR Manager - Starting...
echo ══════════════════════════════════════════════
echo.

cd /d "%~dp0"

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found! Install from https://nodejs.org
    pause
    exit /b 1
)

:: Install dependencies if needed
if not exist "node_modules" (
    echo Installing dependencies...
    npm install
    echo.
)

:: Get local IP
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    for /f "tokens=1" %%b in ("%%a") do set LOCAL_IP=%%b
)

echo   Dashboard will open at: http://%LOCAL_IP%:3000
echo.
echo   Close this window to stop the server.
echo ══════════════════════════════════════════════
echo.

:: Open browser after short delay
start "" cmd /c "timeout /t 3 /nobreak >nul && start http://%LOCAL_IP%:3000"

:: Start server
node server.js
