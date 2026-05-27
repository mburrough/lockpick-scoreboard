# Lockpick Scoreboard - Windows run script
# Run from PowerShell:  .\run.ps1

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

$venvPython = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    Write-Host "Virtual environment not found. Run .\setup.ps1 first." -ForegroundColor Red
    exit 1
}

Write-Host "Starting Lockpick Scoreboard on http://localhost:5050/ ..." -ForegroundColor Cyan
Write-Host "Admin:      http://localhost:5050/"
Write-Host "Scoreboard: http://localhost:5050/scoreboard"
Write-Host "Press Ctrl+C to stop." -ForegroundColor Yellow
Write-Host ""

& $venvPython app.py
