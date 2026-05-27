const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

let state = null;
let chosen = false; // true after the user has chosen "load X" or "new contest" this session

function toast(msg, kind = "good") {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast show " + kind;
  setTimeout(() => t.classList.remove("show"), 2200);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || "GET",
    headers: { "Content-Type": "application/json" },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function fmtTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString();
}

function fmtDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString();
}

function userDisplayName(u) {
  if (u.name && u.badge) return `${u.name} (#${u.badge})`;
  if (u.name) return u.name;
  if (u.badge) return `#${u.badge}`;
  return "(unknown)";
}

function applyIcon(iconImage) {
  const el = document.getElementById("contestIcon");
  if (!el) return;
  if (iconImage) {
    el.innerHTML = "";
    const img = document.createElement("img");
    img.src = iconImage;
    img.style.cssText = "height:0.85em;vertical-align:middle;";
    el.appendChild(img);
  } else {
    el.textContent = "🔒";
  }
}

function totalOpenTime(user) {
  return Object.values(user.open_times || {}).reduce((s, t) => s + t, 0);
}

function render() {
  if (!chosen || !state) {
    applyTheme(null);
    applyIcon(null);
    $("#startupPanel").style.display = "block";
    $("#entryPanel").style.display = "none";
    $("#usersPanel").style.display = "none";
    $("#contestName").textContent = "";
    return;
  }
  applyTheme(state.primary_color);
  applyIcon(state.icon_image);
  $("#startupPanel").style.display = "none";
  $("#entryPanel").style.display = "block";
  $("#usersPanel").style.display = "block";
  $("#contestName").textContent = `${state.contest_name} • ${state.num_locks} locks`;
  $("#inpLock").max = state.num_locks;
  $("#inpLock").placeholder = `1–${state.num_locks}`;

  const users = Object.values(state.users).sort((a, b) =>
    b.opens.length - a.opens.length ||
    totalOpenTime(a) - totalOpenTime(b) ||
    (a.first_open_at || "").localeCompare(b.first_open_at || "")
  );
  $("#userCount").textContent = `(${users.length})`;
  const search = ($("#userSearch").value || "").toLowerCase().trim();
  const tbody = $("#usersTbody");
  tbody.innerHTML = "";
  for (const u of users) {
    if (search) {
      const hay = (u.name + " " + u.badge).toLowerCase();
      if (!hay.includes(search)) continue;
    }
    const tr = document.createElement("tr");
    tr.className = "clickable";
    tr.innerHTML = `
      <td>${escapeHtml(u.name) || "—"}</td>
      <td>${escapeHtml(u.badge) || "—"}</td>
      <td style="text-align:right; font-weight:700;">${u.opens.length}</td>
      <td style="text-align:right;" class="muted">${fmtTime(u.last_open_at)}</td>
    `;
    tr.addEventListener("click", () => showUser(u.id));
    tbody.appendChild(tr);
  }
  if (!tbody.children.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="muted" style="text-align:center;">No users yet — record an open above to get started.</td></tr>`;
  }
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

async function refresh() {
  try {
    const data = await api("/api/state");
    state = data.active ? data.state : null;
    render();
  } catch (e) {
    toast(e.message, "bad");
  }
}

async function loadSavesList() {
  const wrap = $("#savesList");
  try {
    const { saves } = await api("/api/saves");
    if (!saves.length) {
      wrap.innerHTML = `<div class="muted">No saves yet — start a new contest above.</div>`;
      return;
    }
    let html = `<table><thead><tr>
      <th>Contest</th><th>Started</th><th style="text-align:right;">Locks</th>
      <th style="text-align:right;">Users</th><th style="text-align:right;">Opens</th><th></th>
    </tr></thead><tbody>`;
    for (const s of saves) {
      if (s.error) {
        html += `<tr><td colspan="6" class="muted">${escapeHtml(s.filename)} — ${escapeHtml(s.error)}</td></tr>`;
        continue;
      }
      const label = s.is_active
        ? `<strong>${escapeHtml(s.contest_name) || "Untitled"}</strong> <span style="color:var(--good); font-size:12px;">● current</span>`
        : escapeHtml(s.contest_name) || "Untitled";
      html += `<tr>
        <td>${label}<div class="muted" style="font-size:11px;">${escapeHtml(s.filename)}</div></td>
        <td class="muted">${fmtDateTime(s.started_at || s.modified)}</td>
        <td style="text-align:right;">${s.num_locks}</td>
        <td style="text-align:right;">${s.num_users}</td>
        <td style="text-align:right;">${s.total_opens}</td>
        <td style="text-align:right;"><button class="secondary" data-fn="${escapeHtml(s.filename)}">${s.is_active ? "Continue" : "Load"}</button></td>
      </tr>`;
    }
    html += "</tbody></table>";
    wrap.innerHTML = html;
    wrap.querySelectorAll("button[data-fn]").forEach(btn => {
      btn.addEventListener("click", () => loadNamedSave(btn.getAttribute("data-fn")));
    });
  } catch (e) {
    wrap.innerHTML = `<div class="muted">Failed to load saves: ${escapeHtml(e.message)}</div>`;
  }
}

async function loadNamedSave(filename) {
  try {
    const { state: loaded } = await api("/api/load_named_save", { method: "POST", body: { filename } });
    state = loaded;
    chosen = true;
    toast(`Loaded: ${loaded.contest_name || filename}`, "good");
    render();
  } catch (e) {
    toast(e.message, "bad");
  }
}

async function recordOpen(e) {
  e.preventDefault();
  const name = $("#inpName").value.trim();
  const badge = $("#inpBadge").value.trim();
  const lock_number = parseInt($("#inpLock").value, 10);
  if (!name && !badge) { toast("Enter a name or badge", "warn"); return; }
  if (!lock_number) { toast("Enter a lock number", "warn"); return; }
  try {
    const res = await api("/api/record_open", {
      method: "POST",
      body: { name, badge, lock_number },
    });
    if (res.duplicate) {
      toast(`${userDisplayName(res.user)} already opened lock #${lock_number}`, "warn");
    } else {
      toast(`✓ Lock #${lock_number} → ${userDisplayName(res.user)} (total: ${res.user.opens.length})`, "good");
    }
    $("#inpName").value = "";
    $("#inpBadge").value = "";
    $("#inpLock").value = "";
    $("#inpName").focus();
    await refresh();
  } catch (err) {
    toast(err.message, "bad");
  }
}

let currentModalUser = null;
let editingUserId = null;

async function deleteCurrentUser() {
  if (!currentModalUser) return;
  const u = currentModalUser;
  const display = userDisplayName(u);
  if (!confirm(`Delete "${display}"?\n\nThis removes the player and all ${u.opens.length} recorded open(s). This cannot be undone.`)) return;
  try {
    await api("/api/delete_user", { method: "POST", body: { user_id: u.id } });
    $("#userModal").classList.remove("show");
    toast(`Deleted: ${display}`, "warn");
    await refresh();
  } catch (e) {
    toast(e.message, "bad");
  }
}

function openEditModal() {
  if (!currentModalUser) return;
  editingUserId = currentModalUser.id;
  $("#euName").value = currentModalUser.name || "";
  $("#euBadge").value = currentModalUser.badge || "";
  $("#editUserModal").classList.add("show");
}

async function doEditUser(userId, name, badge, forceMerge) {
  try {
    const res = await api("/api/edit_user", {
      method: "POST",
      body: { user_id: userId, name, badge, force_merge: forceMerge },
    });
    if (res.conflict) {
      const ex = res.existing;
      const exDisplay = userDisplayName(ex);
      const ok = confirm(
        `"${exDisplay}" already exists with ${ex.opens.length} open(s).\n\n` +
        `Merge into "${exDisplay}"? Their opens will be combined and this player removed.\n\n` +
        `This cannot be undone.`
      );
      if (!ok) return;
      await doEditUser(userId, name, badge, true);
      return;
    }
    $("#editUserModal").classList.remove("show");
    $("#userModal").classList.remove("show");
    toast("Player updated", "good");
    await refresh();
  } catch (e) {
    toast(e.message, "bad");
  }
}

async function saveEdit() {
  const name = $("#euName").value.trim();
  const badge = $("#euBadge").value.trim();
  if (!name && !badge) { toast("Name or badge required", "warn"); return; }
  await doEditUser(editingUserId, name, badge, false);
}

async function showUser(userId) {
  try {
    const { user, locks } = await api("/api/user/" + encodeURIComponent(userId));
    currentModalUser = user;
    $("#umTitle").textContent = userDisplayName(user);
    $("#umMeta").textContent = `First open: ${fmtTime(user.first_open_at)} • Last open: ${fmtTime(user.last_open_at)}`;
    $("#umCount").textContent = user.opens.length;
    const wrap = $("#umLocks");
    wrap.innerHTML = "";
    const opened = new Set(user.opens);
    for (const lock of locks) {
      const div = document.createElement("div");
      const isOpen = opened.has(lock.number);
      div.className = "lock-chip clickable" + (isOpen ? " opened" : "");
      const modelTxt = lock.make_model ? " — " + lock.make_model : "";
      div.title = isOpen
        ? `Click to UNMARK lock #${lock.number}${modelTxt}`
        : `Click to mark lock #${lock.number} opened${modelTxt}`;
      div.textContent = `#${lock.number}` + (lock.make_model ? ` ${lock.make_model}` : "");
      if (isOpen) {
        div.addEventListener("click", () => unmarkLockForCurrentUser(lock.number));
      } else {
        div.addEventListener("click", () => markLockOpenForCurrentUser(lock.number));
      }
      wrap.appendChild(div);
    }
    $("#userModal").classList.add("show");
  } catch (e) {
    toast(e.message, "bad");
  }
}

async function markLockOpenForCurrentUser(lockNumber) {
  if (!currentModalUser) return;
  const u = currentModalUser;
  try {
    const res = await api("/api/record_open", {
      method: "POST",
      body: { name: u.name, badge: u.badge, lock_number: lockNumber },
    });
    if (res.duplicate) {
      toast(`Already opened lock #${lockNumber}`, "warn");
    } else {
      toast(`✓ Lock #${lockNumber} → ${userDisplayName(res.user)} (total: ${res.user.opens.length})`, "good");
    }
    await refresh();
    await showUser(u.id);
  } catch (e) {
    toast(e.message, "bad");
  }
}

async function unmarkLockForCurrentUser(lockNumber) {
  if (!currentModalUser) return;
  const u = currentModalUser;
  if (!confirm(`Remove lock #${lockNumber} from ${userDisplayName(u)}?\n\nTheir total opens will decrease by 1. This cannot be undone except by re-recording the open.`)) return;
  try {
    const res = await api("/api/unrecord_open", {
      method: "POST",
      body: { user_id: u.id, lock_number: lockNumber },
    });
    toast(`✗ Lock #${lockNumber} removed from ${userDisplayName(res.user)} (total: ${res.user.opens.length})`, "warn");
    await refresh();
    await showUser(u.id);
  } catch (e) {
    toast(e.message, "bad");
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function openNewContestModal() {
  $("#ncName").value = "";
  $("#ncNumLocks").value = 36;
  $("#ncStartAt").value = "";
  $("#ncEndAt").value = "";
  $("#ncColor").value = "#4cc9f0";
  $("#ncModels").value = "";
  $("#ncIcon").value = "";
  $("#ncBg").value = "";
  $("#ncIconPreview").innerHTML = "";
  $("#ncBgPreview").innerHTML = "";
  $("#newContestModal").classList.add("show");
}

async function startNewContest() {
  const contest_name = $("#ncName").value.trim();
  const num_locks = parseInt($("#ncNumLocks").value, 10);
  const lock_models = $("#ncModels").value.split("\n").map(s => s.trim());
  const starts_at = $("#ncStartAt").value ? $("#ncStartAt").value + ":00" : null;
  const ends_at = $("#ncEndAt").value ? $("#ncEndAt").value + ":00" : null;
  const primary_color = $("#ncColor").value || "#4cc9f0";
  if (!num_locks || num_locks < 1) { toast("Enter number of locks", "warn"); return; }

  let icon_image = null, bg_image = null;
  try {
    const iconFile = $("#ncIcon").files[0];
    const bgFile = $("#ncBg").files[0];
    if (iconFile) icon_image = await fileToDataUrl(iconFile);
    if (bgFile) bg_image = await fileToDataUrl(bgFile);
  } catch (e) {
    toast("Failed to read image file", "bad"); return;
  }

  try {
    await api("/api/new_contest", {
      method: "POST",
      body: { contest_name, num_locks, lock_models, starts_at, ends_at, primary_color, icon_image, bg_image },
    });
    $("#newContestModal").classList.remove("show");
    chosen = true;
    toast("New contest started", "good");
    await refresh();
  } catch (e) {
    toast(e.message, "bad");
  }
}

async function loadSave() {
  try {
    await api("/api/load_save", { method: "POST" });
    chosen = true;
    await refresh();
    toast("Save loaded", "good");
  } catch (e) {
    toast(e.message, "bad");
  }
}

async function undoLast() {
  if (!confirm("Undo the most recent recorded open?")) return;
  try {
    const res = await api("/api/undo_last", { method: "POST" });
    toast(`Undone: lock #${res.undone.lock_number}`, "warn");
    await refresh();
  } catch (e) {
    toast(e.message, "bad");
  }
}

// Wire up
window.addEventListener("DOMContentLoaded", () => {
  $("#openForm").addEventListener("submit", recordOpen);
  $("#btnNewContest").addEventListener("click", openNewContestModal);
  $("#ncCancel").addEventListener("click", () => $("#newContestModal").classList.remove("show"));
  $("#ncStart").addEventListener("click", startNewContest);
  $("#umClose").addEventListener("click", () => $("#userModal").classList.remove("show"));
  $("#umEdit").addEventListener("click", openEditModal);
  $("#umDelete").addEventListener("click", deleteCurrentUser);
  $("#euCancel").addEventListener("click", () => $("#editUserModal").classList.remove("show"));
  $("#euSave").addEventListener("click", saveEdit);
  $("#btnUndo").addEventListener("click", undoLast);
  $("#userSearch").addEventListener("input", render);
  // Click outside modal to close
  $$(".modal-bg").forEach(bg => bg.addEventListener("click", (e) => {
    if (e.target === bg) bg.classList.remove("show");
  }));
  // Image file previews in new-contest modal
  function wireFilePreview(inputId, previewId, maxH) {
    const inp = document.getElementById(inputId);
    const prev = document.getElementById(previewId);
    if (!inp || !prev) return;
    inp.addEventListener("change", () => {
      const file = inp.files[0];
      if (!file) { prev.innerHTML = ""; return; }
      const reader = new FileReader();
      reader.onload = (e) => {
        prev.innerHTML = `<img src="${e.target.result}" style="max-height:${maxH}px;max-width:100%;border-radius:4px;margin-top:2px;">`;
      };
      reader.readAsDataURL(file);
    });
  }
  wireFilePreview("ncIcon", "ncIconPreview", 40);
  wireFilePreview("ncBg", "ncBgPreview", 60);

  // On launch: always show chooser (even if active.json exists)
  loadSavesList();
  render();
  // Refresh state periodically once a contest is chosen
  setInterval(() => { if (chosen) refresh(); }, 5000);
});
