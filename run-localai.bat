@echo off
setlocal
cd /d "%~dp0"

REM Ensure Node.js and Cargo are on PATH even if launched from Explorer
if exist "C:\Program Files\nodejs\node.exe" set "PATH=C:\Program Files\nodejs;%PATH%"
if exist "%USERPROFILE%\.cargo\bin\cargo.exe" set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"

where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js was not found on PATH.
    pause
    exit /b 1
)

where cargo >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Rust/Cargo was not found on PATH.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo Installing npm dependencies...
    call npm.cmd install
    if %ERRORLEVEL% NEQ 0 (
        pause
        exit /b %ERRORLEVEL%
    )
)

echo Starting LocalAI...
taskkill /F /IM localai.exe >nul 2>&1
taskkill /F /IM llama-server.exe >nul 2>&1
call npm.cmd run tauri dev
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo LocalAI exited with error code %ERRORLEVEL%.
    pause
    exit /b %ERRORLEVEL%
)
