const $ = (sel) => document.querySelector(sel);

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function userDisplayName(u) {
  if (u.name && u.badge) return `${u.name} (#${u.badge})`;
  if (u.name) return u.name;
  if (u.badge) return `#${u.badge}`;
  return "(unknown)";
}

function totalOpenTime(user) {
  return Object.values(user.open_times || {}).reduce((s, t) => s + t, 0);
}

function topUsers(state, n = 10) {
  return Object.values(state.users)
    .sort((a, b) =>
      b.opens.length - a.opens.length ||
      totalOpenTime(a) - totalOpenTime(b) ||
      (a.first_open_at || "").localeCompare(b.first_open_at || "")
    )
    .slice(0, n);
}

function renderLeaderboard(top) {
  if (!top.length) return `<div class="empty-state">No opens recorded yet.</div>`;
  let html = `<table class="sb-table"><thead><tr>
    <th>#</th><th>Competitor</th><th style="text-align:right;">Opens</th>
  </tr></thead><tbody>`;
  top.forEach((u, i) => {
    html += `<tr>
      <td class="rank">${i + 1}</td>
      <td>${escapeHtml(userDisplayName(u))}</td>
      <td class="opens">${u.opens.length}</td>
    </tr>`;
  });
  html += "</tbody></table>";
  return html;
}

function firstOpenerPerLock(state) {
  const first = {};
  for (const ev of state.events) {
    if (!(ev.lock_number in first)) first[ev.lock_number] = ev.user_id;
  }
  return first;
}

function renderHeatmap(state, top) {
  if (!top.length) return "";
  const numLocks = state.num_locks;
  const opensCount = new Array(numLocks + 1).fill(0);
  for (const u of top) for (const ln of u.opens) opensCount[ln]++;
  const maxCount = Math.max(1, ...opensCount);
  const firstOpener = firstOpenerPerLock(state);

  let html = `<div class="heatmap-wrap"><div class="heat-row-flex">
    <div class="heat-name muted">Lock #</div>`;
  for (let i = 1; i <= numLocks; i++) {
    html += `<div class="heat-cell" style="background:transparent; color:var(--muted);">${i}</div>`;
  }
  html += `<div class="heat-count muted">Total</div></div>`;

  for (const u of top) {
    const opened = new Set(u.opens);
    html += `<div class="heat-row-flex">
      <div class="heat-name" title="${escapeHtml(userDisplayName(u))}">${escapeHtml(userDisplayName(u))}</div>`;
    for (let i = 1; i <= numLocks; i++) {
      if (opened.has(i)) {
        const isFirst = firstOpener[i] === u.id;
        const hot = !isFirst && opensCount[i] >= Math.max(2, Math.ceil(maxCount * 0.7));
        const lock = state.locks[i - 1];
        const title = (lock && lock.make_model ? `Lock #${i} — ${lock.make_model}` : `Lock #${i}`) + (isFirst ? " ★ first open" : "");
        const cls = isFirst ? "heat-cell opened first" : (hot ? "heat-cell opened hot" : "heat-cell opened");
        html += `<div class="${cls}" title="${escapeHtml(title)}">${i}</div>`;
      } else {
        html += `<div class="heat-cell" title="Lock #${i}"></div>`;
      }
    }
    html += `<div class="heat-count">${u.opens.length}</div></div>`;
  }
  html += "</div>";
  return html;
}

function totalOpens(state) {
  return Object.values(state.users).reduce((s, u) => s + u.opens.length, 0);
}

function lockOpenCounts(state) {
  // Count opens per lock across all users
  const counts = new Array(state.num_locks + 1).fill(0);
  for (const u of Object.values(state.users)) {
    for (const ln of u.opens) counts[ln]++;
  }
  const result = [];
  for (let i = 1; i <= state.num_locks; i++) {
    const lock = state.locks[i - 1] || { number: i, make_model: "" };
    result.push({ number: i, make_model: lock.make_model, count: counts[i] });
  }
  return result;
}

function renderLockRanking(locks, label, emoji) {
  if (!locks.length) return "";
  let html = `<h3 style="margin-top:0;">${emoji} ${label}</h3><table class="sb-table"><tbody>`;
  for (const l of locks) {
    const name = l.make_model
      ? `<strong>#${l.number}</strong> <span class="muted">${escapeHtml(l.make_model)}</span>`
      : `<strong>#${l.number}</strong>`;
    html += `<tr><td>${name}</td><td class="opens">${l.count}</td></tr>`;
  }
  html += "</tbody></table>";
  return html;
}

let currentEndsAt = null;

function applyIcon(iconImage) {
  const el = document.getElementById("sbIcon");
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

function applyBgImage(bgImage) {
  const overlay = document.getElementById("bgOverlay");
  if (bgImage) {
    document.body.style.backgroundImage = `url(${bgImage})`;
    document.body.style.backgroundSize = "cover";
    document.body.style.backgroundPosition = "center";
    document.body.style.backgroundAttachment = "fixed";
    if (overlay) overlay.style.display = "block";
  } else {
    document.body.style.backgroundImage = "";
    if (overlay) overlay.style.display = "none";
  }
}

function updateCountdown() {
  const el = document.getElementById("sbCountdown");
  if (!el || !currentEndsAt) return;
  const diff = new Date(currentEndsAt) - Date.now();
  if (diff <= 0) {
    el.textContent = "CONTEST ENDED";
    el.className = "ended";
    return;
  }
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  el.textContent = `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  el.className = diff < 300000 ? "ending" : "";
}

async function refresh() {
  try {
    const res = await fetch("/api/state");
    const data = await res.json();
    if (!data.active) {
      $("#sbContent").innerHTML = `<div class="empty-state">No active contest. Start one in the admin panel.</div>`;
      $("#sbMeta").textContent = "";
      document.getElementById("sbTitleText").textContent = "Lockpick Scoreboard";
      applyIcon(null);
      applyBgImage(null);
      applyTheme(null);
      currentEndsAt = null;
      document.getElementById("sbCountdown").style.display = "none";
      return;
    }
    const state = data.state;
    document.getElementById("sbTitleText").textContent = state.contest_name;
    applyTheme(state.primary_color);
    applyIcon(state.icon_image);
    applyBgImage(state.bg_image);

    // Countdown
    const countdown = document.getElementById("sbCountdown");
    currentEndsAt = state.ends_at || null;
    if (currentEndsAt) {
      countdown.style.display = "block";
      updateCountdown();
    } else {
      countdown.style.display = "none";
    }

    const userCount = Object.keys(state.users).length;
    $("#sbMeta").textContent = `${userCount} competitor${userCount === 1 ? "" : "s"} • ${totalOpens(state)} total opens • ${state.num_locks} locks`;
    $("#sbUpdated").textContent = `updated ${new Date().toLocaleTimeString()}`;

    const top = topUsers(state, 10);
    const allUsers = topUsers(state, Infinity);
    const lockCounts = lockOpenCounts(state);
    // "Most opened" = highest count first; "Least opened" = lowest count first.
    // Tie-breaker: lower lock number first for both, so output is stable.
    const mostOpened = [...lockCounts].sort((a, b) => b.count - a.count || a.number - b.number).slice(0, 5);
    const leastOpened = [...lockCounts].sort((a, b) => a.count - b.count || a.number - b.number).slice(0, 5);

    $("#sbContent").innerHTML = `
      <div class="sb-grid">
        <div class="panel">
          <h2 style="margin-top:0;">Top 10</h2>
          ${renderLeaderboard(top)}
        </div>
        <div class="panel">
          <h2 style="margin-top:0;">Heatmap — All Competitors</h2>
          ${renderHeatmap(state, allUsers)}
        </div>
      </div>
      <div class="sb-grid" style="margin-top:16px;">
        <div class="panel">
          ${renderLockRanking(mostOpened, "Top 5 Most Opened Locks", "🔓")}
        </div>
        <div class="panel">
          ${renderLockRanking(leastOpened, "Top 5 Least Opened Locks", "🔒")}
        </div>
      </div>
    `;
  } catch (e) {
    $("#sbContent").innerHTML = `<div class="empty-state">Connection error: ${escapeHtml(e.message)}</div>`;
  }
}

window.addEventListener("DOMContentLoaded", () => {
  refresh();
  setInterval(refresh, 2000);
  setInterval(updateCountdown, 1000);
});
