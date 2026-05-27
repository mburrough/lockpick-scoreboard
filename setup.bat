@echo off
REM Lockpick Scoreboard - Windows setup (double-click friendly)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
pause
