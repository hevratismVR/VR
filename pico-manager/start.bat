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

:: Check scrcpy (required for mirroring)
where scrcpy >nul 2>&1
if %errorlevel% neq 0 (
    if not exist "scrcpy\scrcpy.exe" (
        echo [INFO] scrcpy not found - downloading for mirror support...
        echo.
        powershell -Command "& { $url='https://github.com/Genymobile/scrcpy/releases/download/v3.1/scrcpy-win64-v3.1.zip'; $zip='scrcpy.zip'; Write-Host 'Downloading scrcpy...'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing; Write-Host 'Extracting...'; Expand-Archive -Path $zip -DestinationPath '.' -Force; Rename-Item 'scrcpy-win64-v3.1' 'scrcpy' -Force; Remove-Item $zip; Write-Host 'scrcpy installed successfully!' }"
        if exist "scrcpy\scrcpy.exe" (
            echo [OK] scrcpy ready!
        ) else (
            echo [WARNING] scrcpy download failed - mirroring will not work
            echo          Download manually from: https://github.com/Genymobile/scrcpy/releases
        )
        echo.
    ) else (
        echo [OK] scrcpy found in project folder
    )
) else (
    echo [OK] scrcpy found in PATH
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
