@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js 20 or newer is required but was not found in PATH.
  echo   Install it from https://nodejs.org and run this file again.
  echo.
  pause
  exit /b 1
)

echo.
echo   Starting WP Store Lab...
echo   Keep this window open. Press Ctrl+C to stop.
echo.

node src\main.mjs %*

echo.
echo   Server stopped.
pause
