@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [Missing dependency]
  echo Node.js was not found on this computer.
  echo.
  echo Please install Node.js LTS first, then double-click start.bat again.
  echo Download page will open now:
  echo https://nodejs.org/
  echo.
  start "" "https://nodejs.org/"
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies...
  call npm.cmd install
  if errorlevel 1 (
    echo Dependency install failed.
    pause
    exit /b 1
  )
)

echo Building local app...
call npm.cmd run build
if errorlevel 1 (
  echo Build failed.
  pause
  exit /b 1
)

node server\index.mjs
pause
