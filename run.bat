@echo off
REM Lockpick Scoreboard - Windows run (double-click friendly)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1"
pause
