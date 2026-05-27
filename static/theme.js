// Shared color-derivation utilities used by both admin and scoreboard pages.

function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  switch (max) {
    case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
    case g: h = ((b - r) / d + 2) / 6; break;
    default: h = ((r - g) / d + 4) / 6;
  }
  return [h * 360, s * 100, l * 100];
}

function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return Math.round((l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))) * 255)
      .toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// Given a primary hex color, derive a full palette and apply it as CSS custom
// properties on :root.  Branches into light or dark mode based on the primary
// color's own lightness.  Good / warn / bad stay fixed (semantic colors).
function applyTheme(primary) {
  if (!primary || !/^#[0-9a-fA-F]{6}$/.test(primary)) primary = '#4cc9f0';
  const [h, s, l] = hexToHsl(primary);

  let theme;
  if (l > 65) {
    // ── Light mode ──────────────────────────────────────────────────────────
    // The chosen color is light (L > 65%), so use it as the background basis.
    // Pull the accent down to a medium-dark shade so it reads on the light bg.
    const ds      = Math.min(s * 0.15, 18); // lightly tinted panels
    const accentL = Math.min(l, 42);        // keep accent dark enough to contrast
    theme = {
      '--bg':       hslToHex(h, ds, 97),
      '--panel':    hslToHex(h, ds, 91),
      '--panel-2':  hslToHex(h, ds, 84),
      '--border':   hslToHex(h, ds, 72),
      '--muted':    hslToHex(h, Math.min(s * 0.3, 25), 44),
      '--accent':   hslToHex(h, Math.max(s, 55), accentL),
      '--accent-2': hslToHex((h + 150) % 360, Math.max(s, 70), 40),
      '--text':     hslToHex(h, Math.min(s * 0.5, 35), 11),
      '--btn-text': '#f0f4f8',
    };
  } else {
    // ── Dark mode (default) ─────────────────────────────────────────────────
    const ds = Math.min(s * 0.3, 28);
    theme = {
      '--bg':       hslToHex(h, ds, 8),
      '--panel':    hslToHex(h, ds, 13),
      '--panel-2':  hslToHex(h, ds, 17),
      '--border':   hslToHex(h, ds, 21),
      '--muted':    hslToHex(h, Math.min(s * 0.2, 18), 52),
      '--accent':   hslToHex(h, Math.max(s, 65), 62),
      '--accent-2': hslToHex((h + 150) % 360, Math.max(s, 70), 58),
      '--text':     '#e7ecf3',
      '--btn-text': hslToHex(h, Math.min(s * 0.6, 50), 7),
    };
  }

  const root = document.documentElement;
  for (const [k, v] of Object.entries(theme)) root.style.setProperty(k, v);
}
