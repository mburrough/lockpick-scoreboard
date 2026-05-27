# Lockpick Scoreboard - Windows setup script
# Run from PowerShell:  .\setup.ps1
# (If blocked by execution policy:  powershell -ExecutionPolicy Bypass -File .\setup.ps1)

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

Write-Host "=== Lockpick Scoreboard setup ===" -ForegroundColor Cyan

# 1. Find Python
$pythonExe = $null
$pythonArgs = @()

function Test-PythonCmd {
    param([string]$Exe, [string[]]$Args)
    try {
        $allArgs = $Args + @("--version")
        $output = & $Exe @allArgs 2>&1
        if ($LASTEXITCODE -eq 0 -and $output -match "Python\s+3") {
            return $output.ToString().Trim()
        }
    } catch { }
    return $null
}

# Try python launcher first (recommended on Windows), then python, then python3
$candidates = @(
    @{ Exe = "py";      Args = @("-3") },
    @{ Exe = "python";  Args = @() },
    @{ Exe = "python3"; Args = @() }
)
foreach ($c in $candidates) {
    $ver = Test-PythonCmd -Exe $c.Exe -Args $c.Args
    if ($ver) {
        $pythonExe  = $c.Exe
        $pythonArgs = $c.Args
        Write-Host "Found Python: $ver  (using '$pythonExe $($pythonArgs -join ' ')')" -ForegroundColor Green
        break
    }
}

if (-not $pythonExe) {
    Write-Host ""
    Write-Host "Python 3 not found." -ForegroundColor Red
    Write-Host "Install Python 3.10+ from https://www.python.org/downloads/windows/"
    Write-Host "or run:  winget install Python.Python.3.13"
    Write-Host "Make sure to check 'Add python.exe to PATH' during install."
    exit 1
}

# 2. Create venv
$venv = Join-Path $PSScriptRoot ".venv"
if (-not (Test-Path $venv)) {
    Write-Host "Creating virtual environment at .venv ..." -ForegroundColor Cyan
    & $pythonExe @pythonArgs -m venv .venv
    if ($LASTEXITCODE -ne 0) { Write-Host "Failed to create venv" -ForegroundColor Red; exit 1 }
} else {
    Write-Host "Virtual environment already exists at .venv" -ForegroundColor Yellow
}

# 3. Install requirements into venv
$venvPython = Join-Path $venv "Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    Write-Host "venv python not found at $venvPython" -ForegroundColor Red
    exit 1
}

Write-Host "Upgrading pip ..." -ForegroundColor Cyan
& $venvPython -m pip install --upgrade pip --quiet
Write-Host "Installing dependencies ..." -ForegroundColor Cyan
& $venvPython -m pip install -r requirements.txt --quiet
if ($LASTEXITCODE -ne 0) { Write-Host "pip install failed" -ForegroundColor Red; exit 1 }

# 4. Optional firewall hint
Write-Host ""
Write-Host "=== Setup complete ===" -ForegroundColor Green
Write-Host ""
Write-Host "To start the app, run:  .\run.ps1"
Write-Host "Then open in your browser:"
Write-Host "  Admin:      http://localhost:5050/"
Write-Host "  Scoreboard: http://localhost:5050/scoreboard"
Write-Host ""
Write-Host "If you want to view the scoreboard from another device on the LAN," -ForegroundColor Yellow
Write-Host "open TCP port 5050 in Windows Firewall (run as Administrator):"
Write-Host '  New-NetFirewallRule -DisplayName "Lockpick Scoreboard" -Direction Inbound -Protocol TCP -LocalPort 5050 -Action Allow'
