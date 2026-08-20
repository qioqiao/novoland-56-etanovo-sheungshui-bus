@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 需要先安裝 Node.js 才能啟動本機伺服器。
  pause
  exit /b 1
)
start "" "http://127.0.0.1:8756/"
node server.mjs
