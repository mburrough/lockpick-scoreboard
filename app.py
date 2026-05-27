"""Lockpick competition scoreboard - Flask app."""
import json
import logging
import os
import re
import threading
import time
from datetime import datetime
from pathlib import Path
from flask import Flask, render_template, request, jsonify, abort

BASE_DIR = Path(__file__).parent
SAVES_DIR = BASE_DIR / "saves"
SAVES_DIR.mkdir(exist_ok=True)
ACTIVE_FILE = SAVES_DIR / "active.json"

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 20 * 1024 * 1024  # 20 MB — allows two large base64 images
_lock = threading.Lock()

# Suppress high-frequency polling noise from the Werkzeug access log.
# /api/state is hit every 2 s by the scoreboard and every 5 s by the admin.
class _SuppressPolling(logging.Filter):
    def filter(self, record):
        return "GET /api/state" not in record.getMessage()

logging.getLogger("werkzeug").addFilter(_SuppressPolling())


def empty_state():
    return {
        "contest_name": "",
        "started_at": None,
        "ends_at": None,
        "primary_color": "#4cc9f0",
        "icon_image": None,   # base64 data URL
        "bg_image": None,     # base64 data URL
        "num_locks": 0,
        "locks": [],  # list of {"number": int, "make_model": str}
        "users": {},  # key: user_id (lowercased name or badge), value: user dict
        "events": [],  # audit log of opens
    }


def load_state():
    if ACTIVE_FILE.exists():
        try:
            with open(ACTIVE_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return None
    return None


def save_state(state):
    tmp = ACTIVE_FILE.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)
    os.replace(tmp, ACTIVE_FILE)


def archive_current():
    """Move the current active save aside before starting a new contest."""
    if ACTIVE_FILE.exists():
        ts = datetime.now().strftime("%Y%m%d-%H%M%S")
        archive = SAVES_DIR / f"contest-{ts}.json"
        os.replace(ACTIVE_FILE, archive)
        return archive.name
    return None


def user_key(name, badge):
    name = (name or "").strip()
    badge = (badge or "").strip()
    if badge:
        return f"badge:{badge.lower()}"
    if name:
        return f"name:{name.lower()}"
    return None


def get_or_create_user(state, name, badge):
    key = user_key(name, badge)
    if not key:
        return None, None
    if key not in state["users"]:
        state["users"][key] = {
            "id": key,
            "name": (name or "").strip(),
            "badge": (badge or "").strip(),
            "opens": [],       # list of lock numbers
            "open_times": {},  # lock_number -> elapsed seconds since contest start
            "first_open_at": None,
            "last_open_at": None,
        }
    else:
        # Fill in any missing field if provided this time
        u = state["users"][key]
        if name and not u["name"]:
            u["name"] = name.strip()
        if badge and not u["badge"]:
            u["badge"] = badge.strip()
        if "open_times" not in u:
            u["open_times"] = {}
    return key, state["users"][key]


# ---------- Routes ----------

@app.route("/")
def index():
    return render_template("admin.html")


@app.route("/scoreboard")
def scoreboard_view():
    return render_template("scoreboard.html")


@app.route("/api/state")
def api_state():
    with _lock:
        state = load_state()
    if state is None:
        return jsonify({"active": False})
    return jsonify({"active": True, "state": state})


@app.route("/api/has_save")
def api_has_save():
    return jsonify({"has_save": ACTIVE_FILE.exists()})


@app.route("/api/new_contest", methods=["POST"])
def api_new_contest():
    data = request.get_json(force=True) or {}
    num_locks = int(data.get("num_locks", 0))
    if num_locks < 1 or num_locks > 1000:
        return jsonify({"error": "num_locks must be 1-1000"}), 400
    contest_name = (data.get("contest_name") or "").strip() or "Lockpick Contest"
    lock_models = data.get("lock_models") or []

    # Optional start / end datetimes
    starts_at_raw = (data.get("starts_at") or "").strip()
    ends_at_raw = (data.get("ends_at") or "").strip()
    starts_at_iso = None
    ends_at_iso = None
    if starts_at_raw:
        try:
            starts_at_iso = datetime.fromisoformat(starts_at_raw).isoformat()
        except ValueError:
            return jsonify({"error": "invalid starts_at"}), 400
    if ends_at_raw:
        try:
            ends_at_dt = datetime.fromisoformat(ends_at_raw)
            ends_at_iso = ends_at_dt.isoformat()
        except ValueError:
            return jsonify({"error": "invalid ends_at"}), 400
        if starts_at_iso and ends_at_dt <= datetime.fromisoformat(starts_at_iso):
            return jsonify({"error": "ends_at must be after starts_at"}), 400

    # Primary color — validated hex, falls back to default
    primary_color = (data.get("primary_color") or "#4cc9f0").strip()
    if not re.match(r'^#[0-9a-fA-F]{6}$', primary_color):
        primary_color = "#4cc9f0"

    # Optional images stored as base64 data URLs
    icon_image = data.get("icon_image") or None
    bg_image = data.get("bg_image") or None
    if icon_image and len(icon_image) > 5_000_000:
        return jsonify({"error": "Icon image too large (max ~3.75 MB)"}), 400
    if bg_image and len(bg_image) > 10_000_000:
        return jsonify({"error": "Background image too large (max ~7.5 MB)"}), 400

    locks = []
    for i in range(1, num_locks + 1):
        mm = ""
        if i - 1 < len(lock_models):
            mm = (lock_models[i - 1] or "").strip()
        locks.append({"number": i, "make_model": mm})

    with _lock:
        archived = archive_current()
        state = empty_state()
        state["contest_name"] = contest_name
        state["started_at"] = starts_at_iso or datetime.now().isoformat()
        state["ends_at"] = ends_at_iso
        state["primary_color"] = primary_color
        state["icon_image"] = icon_image
        state["bg_image"] = bg_image
        state["num_locks"] = num_locks
        state["locks"] = locks
        save_state(state)
    return jsonify({"ok": True, "archived": archived})


@app.route("/api/saves")
def api_saves():
    """List all save files (active + archives) with summary metadata."""
    items = []
    for path in sorted(SAVES_DIR.glob("*.json")):
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            num_users = len(data.get("users", {}))
            total_opens = sum(len(u.get("opens", [])) for u in data.get("users", {}).values())
            items.append({
                "filename": path.name,
                "is_active": path.name == ACTIVE_FILE.name,
                "contest_name": data.get("contest_name", ""),
                "started_at": data.get("started_at"),
                "num_locks": data.get("num_locks", 0),
                "num_users": num_users,
                "total_opens": total_opens,
                "size": path.stat().st_size,
                "modified": datetime.fromtimestamp(path.stat().st_mtime).isoformat(),
            })
        except Exception:
            # Skip unreadable files but report their existence
            items.append({"filename": path.name, "error": "unreadable"})
    # Active first, then archives by most-recent modified
    items.sort(key=lambda x: (not x.get("is_active", False), -datetime.fromisoformat(x["modified"]).timestamp() if x.get("modified") else 0))
    return jsonify({"saves": items})


@app.route("/api/load_named_save", methods=["POST"])
def api_load_named_save():
    """Make the named save file the active contest. Archives the current active first if different."""
    data = request.get_json(force=True) or {}
    filename = (data.get("filename") or "").strip()
    if not filename or "/" in filename or "\\" in filename or ".." in filename:
        return jsonify({"error": "invalid filename"}), 400
    target = SAVES_DIR / filename
    if not target.exists() or target.suffix != ".json":
        return jsonify({"error": "save not found"}), 404
    with _lock:
        # If the user picked the current active, just confirm
        if target.resolve() == ACTIVE_FILE.resolve():
            state = load_state()
            if state is None:
                return jsonify({"error": "active save unreadable"}), 500
            return jsonify({"ok": True, "state": state})
        # Otherwise: archive current active (if any), then copy chosen save to active
        archive_current()
        with open(target, "r", encoding="utf-8") as f:
            payload = json.load(f)
        save_state(payload)
    return jsonify({"ok": True, "state": payload})


@app.route("/api/load_save", methods=["POST"])
def api_load_save():
    with _lock:
        state = load_state()
    if state is None:
        return jsonify({"error": "no save file"}), 404
    return jsonify({"ok": True, "state": state})


@app.route("/api/record_open", methods=["POST"])
def api_record_open():
    data = request.get_json(force=True) or {}
    name = data.get("name", "")
    badge = data.get("badge", "")
    try:
        lock_number = int(data.get("lock_number"))
    except (TypeError, ValueError):
        return jsonify({"error": "lock_number must be an integer"}), 400

    with _lock:
        state = load_state()
        if state is None:
            return jsonify({"error": "no active contest"}), 400
        if lock_number < 1 or lock_number > state["num_locks"]:
            return jsonify({"error": f"lock_number must be 1-{state['num_locks']}"}), 400
        key = user_key(name, badge)
        if not key:
            return jsonify({"error": "name or badge required"}), 400
        _, user = get_or_create_user(state, name, badge)
        already = lock_number in user["opens"]
        if not already:
            user["opens"].append(lock_number)
            user["opens"].sort()
            now = datetime.now()
            now_iso = now.isoformat()
            try:
                elapsed = max(0.0, (now - datetime.fromisoformat(state["started_at"])).total_seconds())
            except (TypeError, ValueError):
                elapsed = 0.0
            if not user["first_open_at"]:
                user["first_open_at"] = now_iso
            user["last_open_at"] = now_iso
            user["open_times"][str(lock_number)] = elapsed
            state["events"].append({
                "user_id": key,
                "name": user["name"],
                "badge": user["badge"],
                "lock_number": lock_number,
                "elapsed_seconds": elapsed,
                "at": now_iso,
            })
            save_state(state)
        return jsonify({
            "ok": True,
            "duplicate": already,
            "user": user,
        })


@app.route("/api/user/<path:user_id>")
def api_user(user_id):
    with _lock:
        state = load_state()
    if state is None:
        return jsonify({"error": "no active contest"}), 400
    user = state["users"].get(user_id)
    if not user:
        return jsonify({"error": "user not found"}), 404
    return jsonify({"user": user, "locks": state["locks"]})


@app.route("/api/undo_last", methods=["POST"])
def api_undo_last():
    """Remove the most recent open event (admin convenience)."""
    with _lock:
        state = load_state()
        if state is None or not state["events"]:
            return jsonify({"error": "nothing to undo"}), 400
        ev = state["events"].pop()
        user = state["users"].get(ev["user_id"])
        if user and ev["lock_number"] in user["opens"]:
            user["opens"].remove(ev["lock_number"])
            user.get("open_times", {}).pop(str(ev["lock_number"]), None)
            # Recompute timestamps from remaining events
            user_events = [e for e in state["events"] if e["user_id"] == ev["user_id"]]
            user["first_open_at"] = user_events[0]["at"] if user_events else None
            user["last_open_at"] = user_events[-1]["at"] if user_events else None
        save_state(state)
        return jsonify({"ok": True, "undone": ev})


@app.route("/api/unrecord_open", methods=["POST"])
def api_unrecord_open():
    """Remove a single lock open from a user (operator correction)."""
    data = request.get_json(force=True) or {}
    user_id = (data.get("user_id") or "").strip()
    try:
        lock_number = int(data.get("lock_number"))
    except (TypeError, ValueError):
        return jsonify({"error": "lock_number must be an integer"}), 400

    with _lock:
        state = load_state()
        if state is None:
            return jsonify({"error": "no active contest"}), 400
        user = state["users"].get(user_id)
        if not user:
            return jsonify({"error": "user not found"}), 404
        if lock_number not in user["opens"]:
            return jsonify({"error": "user did not have that lock open"}), 400
        user["opens"].remove(lock_number)
        user.get("open_times", {}).pop(str(lock_number), None)
        # Drop the most recent matching event for this user+lock
        for i in range(len(state["events"]) - 1, -1, -1):
            ev = state["events"][i]
            if ev["user_id"] == user_id and ev["lock_number"] == lock_number:
                del state["events"][i]
                break
        # Recompute timestamps from remaining events for this user
        user_events = [e for e in state["events"] if e["user_id"] == user_id]
        user["first_open_at"] = user_events[0]["at"] if user_events else None
        user["last_open_at"] = user_events[-1]["at"] if user_events else None
        save_state(state)
        return jsonify({"ok": True, "user": user})


@app.route("/api/delete_user", methods=["POST"])
def api_delete_user():
    data = request.get_json(force=True) or {}
    user_id = (data.get("user_id") or "").strip()
    with _lock:
        state = load_state()
        if state is None:
            return jsonify({"error": "no active contest"}), 400
        if user_id not in state["users"]:
            return jsonify({"error": "user not found"}), 404
        del state["users"][user_id]
        state["events"] = [e for e in state["events"] if e["user_id"] != user_id]
        save_state(state)
    return jsonify({"ok": True})


@app.route("/api/edit_user", methods=["POST"])
def api_edit_user():
    data = request.get_json(force=True) or {}
    user_id = (data.get("user_id") or "").strip()
    new_name = (data.get("name") or "").strip()
    new_badge = (data.get("badge") or "").strip()
    force_merge = bool(data.get("force_merge", False))

    with _lock:
        state = load_state()
        if state is None:
            return jsonify({"error": "no active contest"}), 400
        user = state["users"].get(user_id)
        if not user:
            return jsonify({"error": "user not found"}), 404

        new_key = user_key(new_name, new_badge)
        if not new_key:
            return jsonify({"error": "name or badge required"}), 400

        if new_key == user_id:
            # Same identity key — just update display fields
            user["name"] = new_name
            user["badge"] = new_badge
            save_state(state)
            return jsonify({"ok": True, "user": user})

        if new_key in state["users"] and not force_merge:
            return jsonify({"conflict": True, "existing": state["users"][new_key]})

        if new_key in state["users"]:
            # Merge: fold this user's opens into the existing user
            existing = state["users"][new_key]
            existing["opens"] = sorted(set(user["opens"]) | set(existing["opens"]))
            # Merge open_times: for locks both opened, keep the faster time.
            # Normalise all keys to str — JSON load produces strings, direct writes use str().
            merged_times = {str(k): v for k, v in existing.get("open_times", {}).items()}
            for lock, t in user.get("open_times", {}).items():
                sk = str(lock)
                merged_times[sk] = min(merged_times[sk], t) if sk in merged_times else t
            existing["open_times"] = merged_times
            existing["name"] = new_name or existing["name"]
            existing["badge"] = new_badge or existing["badge"]
            first_times = [t for t in [user["first_open_at"], existing["first_open_at"]] if t]
            existing["first_open_at"] = min(first_times) if first_times else None
            last_times = [t for t in [user["last_open_at"], existing["last_open_at"]] if t]
            existing["last_open_at"] = max(last_times) if last_times else None
            for ev in state["events"]:
                if ev["user_id"] == user_id:
                    ev["user_id"] = new_key
                    ev["name"] = existing["name"]
                    ev["badge"] = existing["badge"]
            del state["users"][user_id]
            save_state(state)
            return jsonify({"ok": True, "user": existing})
        else:
            # Rename: move to new key
            user["id"] = new_key
            user["name"] = new_name
            user["badge"] = new_badge
            state["users"][new_key] = user
            del state["users"][user_id]
            for ev in state["events"]:
                if ev["user_id"] == user_id:
                    ev["user_id"] = new_key
                    ev["name"] = new_name
                    ev["badge"] = new_badge
            save_state(state)
            return jsonify({"ok": True, "user": user})


def _csv_response(rows, filename):
    import csv, io
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    for r in rows:
        writer.writerow(r)
    from flask import Response
    return Response(
        buf.getvalue(),
        mimetype="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.route("/api/export/users.csv")
def api_export_users():
    with _lock:
        state = load_state()
    if state is None:
        return jsonify({"error": "no active contest"}), 400
    rows = [["Badge #", "Name", "Total Locks Open"]]
    users = sorted(
        state["users"].values(),
        key=lambda u: (-len(u["opens"]), (u["name"] or "").lower(), u["badge"]),
    )
    for u in users:
        rows.append([u.get("badge", ""), u.get("name", ""), len(u["opens"])])
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    safe = "".join(c for c in (state.get("contest_name") or "contest") if c.isalnum() or c in "-_") or "contest"
    return _csv_response(rows, f"{safe}-users-{ts}.csv")


@app.route("/api/export/locks.csv")
def api_export_locks():
    with _lock:
        state = load_state()
    if state is None:
        return jsonify({"error": "no active contest"}), 400
    counts = [0] * (state["num_locks"] + 1)
    for u in state["users"].values():
        for ln in u["opens"]:
            if 1 <= ln <= state["num_locks"]:
                counts[ln] += 1
    rows = [["Lock #", "Lock Name", "Number of Opens"]]
    for lock in state["locks"]:
        rows.append([lock["number"], lock.get("make_model", ""), counts[lock["number"]]])
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    safe = "".join(c for c in (state.get("contest_name") or "contest") if c.isalnum() or c in "-_") or "contest"
    return _csv_response(rows, f"{safe}-locks-{ts}.csv")


if __name__ == "__main__":
    # Bind to 0.0.0.0 so a second monitor on the same machine (or a tablet on the LAN) can view scoreboard
    app.run(host="0.0.0.0", port=5050, debug=False, threaded=True)
