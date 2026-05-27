# Lockpick Contest Scoreboard

A simple two-window Flask app for running a lockpicking competition.

## Setup on a fresh Windows machine

1. Install **Python 3.10+** if you don't have it:
   - Easiest: open PowerShell and run `winget install Python.Python.3.13`
   - Or download from https://www.python.org/downloads/windows/ — make sure to tick **"Add python.exe to PATH"** during install.
2. Copy this folder (`lockpick-scoreboard`) onto the target machine.
3. Run **`setup.bat`** (double-click) or in PowerShell: `.\setup.ps1`
   - This creates a `.venv` virtual environment and installs Flask into it. Nothing is installed system-wide.

## Run

Run **`run.bat`** (double-click) or in PowerShell: `.\run.ps1`

Then open:

- **Admin (entry):** http://localhost:5050/
- **Scoreboard (display):** http://localhost:5050/scoreboard

Drag the scoreboard browser window to your second monitor and full‑screen it (F11). Press Ctrl+C in the console to stop the server.

### Optional: view scoreboard from another device on the LAN

Open TCP 5050 in Windows Firewall (run PowerShell as Administrator):

```powershell
New-NetFirewallRule -DisplayName "Lockpick Scoreboard" -Direction Inbound -Protocol TCP -LocalPort 5050 -Action Allow
```

Then on the other device, browse to `http://<host-machine-ip>:5050/scoreboard`.

## How it works

- On launch, the admin page asks you to **start a new contest** or **load an existing save** (current `active.json` plus any archived `contest-*.json` files in `saves/`).
- Each open is saved immediately to `saves/active.json` (atomic write, so power loss won't corrupt it).
- Starting a new contest or loading a different save **archives** the current active to `saves/contest-YYYYMMDD-HHMMSS.json` so no history is ever lost.
- A user is identified by name OR badge — at least one is required. If both are given on later entries they're merged into the same record.
- Each user gets credit for a given lock only once (duplicates are flagged but not counted).
- The scoreboard refreshes every 2 seconds. The admin can click any user row to see what they've opened, and click an unopened lock chip there to mark it opened.
- Use **Undo last open** to back out an accidental entry.

## Files

- `app.py` — Flask backend + JSON save/load
- `templates/admin.html`, `static/admin.js` — admin entry UI
- `templates/scoreboard.html`, `static/scoreboard.js` — scoreboard display
- `static/style.css` — shared styles
- `requirements.txt` — Python dependencies (Flask)
- `setup.ps1` / `setup.bat` — one-time setup (creates `.venv`, installs deps)
- `run.ps1` / `run.bat` — start the server
- `saves/` — `active.json` (current) and `contest-*.json` (archived)

## Backups

To back up a contest, copy the `saves/` folder. To move a contest between machines, copy the `saves/` folder onto the other box (after running `setup.bat` there).

